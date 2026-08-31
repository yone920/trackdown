import type pg from "pg";
import { z } from "zod";
import { saveCoachContext } from "../coach/coach.js";
import {
	insertEntries,
	insertWeights,
	getProfile,
	updateProfile,
	type NewEntry,
	type ProfilePatch,
} from "../entries.js";
import { insertTextEvidence, linkEvidence, type EvidenceRow } from "../evidence.js";
import { InvalidGoalError, createGoal } from "../goals/store.js";
import { localDateOf } from "../localTime.js";
import type { GoalProposal } from "../goals/proposal.js";
import { FusionResultSchema, type FusionKind, type GoalFacts } from "./schema.js";

// POST /api/log/confirm's half of the pipeline: take the preview the user just approved
// (with whatever they edited) and write it, once, in one transaction.
//
// Idempotent by the client's uuid. The phone mints it before it has a connection, so a
// confirm that times out and is retried on the train home must return the first attempt's
// rows rather than log the workout twice — the ledger is `log_confirmations`, and the
// first attempt's response is replayed verbatim.

type Row = Record<string, unknown>;

const isoDate = z.string().datetime({ offset: true });

export const ConfirmBody = z.object({
	/** Minted by the client, before the request; the idempotency key. */
	client_id: z.uuid(),
	/** The preview, exactly as /api/log/analyze returned it, minus the user's corrections. */
	result: FusionResultSchema,
	/** Evidence created by /api/log/analyze (the photos) — linked to what it became. */
	evidence_ids: z.array(z.uuid()).max(8).default([]),
	/** The transcript or note behind the log, kept as evidence in its own right. */
	text: z.string().trim().max(2000).nullable().optional(),
	text_kind: z.enum(["text", "transcript"]).default("text"),
	/** When it happened, if not now — the phone's clock, with its offset. */
	logged_at: isoDate.optional(),
	/**
	 * `fused` when a model read evidence into these fields, `manual` when the user typed
	 * them. Defaults to fused whenever evidence is attached: that is what the confidence
	 * discount in the coach keys off.
	 */
	source: z.enum(["fused", "manual"]).optional(),
	/** Minutes to add to UTC for local time; a goal's dates are the user's calendar. */
	tz_offset_min: z.number().int().min(-840).max(840).optional(),
	/** kind: "goal" — keep the user's own date even if the safe rate says it is a stretch. */
	confirm_date: z.boolean().optional(),
	/** kind: "goal" — save it open-ended instead of taking the proposed date. */
	no_date: z.boolean().optional(),
});
export type ConfirmBody = z.infer<typeof ConfirmBody>;

export interface SavedLog {
	kind: FusionKind;
	activities: Row[];
	meal: Row | null;
	meal_items: Row[];
	weight: Row | null;
	goal: Row | null;
	/** The safe-rate timeline the goal was saved with (services/goals/proposal.ts). */
	goal_proposal: GoalProposal | null;
	profile: Row | null;
	/** Saved against the user's local day; the coach reads it when it is asked (WP5). */
	coach_context: { date: string; text: string } | null;
	evidence: EvidenceRow[];
}

/** Thrown for a preview that names nothing to save; the route turns it into a 422. */
export class NothingToSaveError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NothingToSaveError";
	}
}

function emptySaved(kind: FusionKind): SavedLog {
	return {
		kind,
		activities: [],
		meal: null,
		meal_items: [],
		weight: null,
		goal: null,
		goal_proposal: null,
		profile: null,
		coach_context: null,
		evidence: [],
	};
}

async function insertMealItems(client: pg.PoolClient, mealId: string, items: MealItemInput[]): Promise<Row[]> {
	if (items.length === 0) return [];
	const params: unknown[] = [];
	const tuples = items.map((item) => {
		params.push(
			mealId,
			item.name,
			item.kcal ?? null,
			item.protein_g ?? null,
			item.carbs_g ?? null,
			item.fat_g ?? null,
			item.fiber_g ?? null,
			item.serving_amount ?? null
		);
		const n = params.length;
		return `($${n - 7}, $${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
	});
	const { rows } = await client.query(
		`INSERT INTO meal_items (meal_id, name, kcal, protein_g, carbs_g, fat_g, fiber_g, serving_amount)
		 VALUES ${tuples.join(", ")} RETURNING *`,
		params
	);
	return rows;
}

interface MealItemInput {
	name: string;
	kcal: number | null;
	protein_g: number | null;
	carbs_g: number | null;
	fat_g: number | null;
	fiber_g: number | null;
	serving_amount: string | null;
}

/** Plan columns a constraint/preference may set, and their profile column names. */
const PROFILE_FIELD_COLUMNS = [
	"diet_style",
	"protein_g",
	"carbs_max_g",
	"training_days",
	"environment",
	"equipment",
	"eatback",
] as const;

async function applyProfileStatement(
	client: pg.PoolClient,
	userId: string,
	list: "constraints" | "preferences",
	text: string,
	fields: Record<string, unknown> | null
): Promise<Row> {
	await getProfile(client, userId);

	const sets: string[] = [];
	const params: unknown[] = [userId, text];
	const stated: Record<string, string> = { [list]: new Date().toISOString() };

	// Append rather than replace: a second injury does not cancel the first. Duplicates
	// are skipped so restating "bad left knee" does not grow the list.
	sets.push(`${list} = CASE WHEN $2 = ANY(${list}) THEN ${list} ELSE array_append(${list}, $2) END`);

	for (const column of PROFILE_FIELD_COLUMNS) {
		const value = fields?.[column];
		if (value === undefined || value === null) continue;
		params.push(value);
		sets.push(`${column} = $${params.length}`);
		stated[column] = new Date().toISOString();
	}

	params.push(JSON.stringify(stated));
	sets.push(`stated_at = stated_at || $${params.length}::jsonb`);

	const { rows } = await client.query(
		`UPDATE profiles SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
		params
	);
	return rows[0] as Row;
}

/**
 * The profile columns a goal's stated facts set. The age becomes a birth year because that
 * is what the profile stores and what the TDEE model reads — an age is only true for a
 * year, a birth year stays true.
 *
 * Returns null when nothing was stated, so a goal with no facts writes no profile row and
 * stamps no `stated_at`.
 */
function goalFactsToProfile(facts: GoalFacts | null, loggedAt: string | undefined): ProfilePatch | null {
	if (!facts) return null;
	const patch: ProfilePatch = {};
	if (facts.training_days != null) patch.training_days = facts.training_days;
	if (facts.environment != null) patch.environment = facts.environment;
	if (facts.age_years != null) {
		patch.birth_year = (loggedAt ? new Date(loggedAt) : new Date()).getUTCFullYear() - facts.age_years;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Write one confirmed preview. Runs inside a caller's transaction — every branch here is
 * all-or-nothing with the evidence links and the idempotency ledger.
 */
export async function saveConfirmed(
	client: pg.PoolClient,
	userId: string,
	body: ConfirmBody
): Promise<SavedLog> {
	const { result } = body;
	const saved = emptySaved(result.kind);
	const loggedAt = body.logged_at;
	const source = body.source ?? (body.evidence_ids.length > 0 ? "fused" : "manual");
	const evidenceIds = [...body.evidence_ids];

	// The words behind the log are evidence too, and the only provenance a typed log has.
	if (body.text) {
		const row = await insertTextEvidence(client, userId, body.text_kind, body.text);
		evidenceIds.push(row.id);
	}

	switch (result.kind) {
		case "activities": {
			const entries: NewEntry[] = result.items.map((item) => ({
				description: item.description,
				kcal: item.kcal ?? 0,
				exercise: item.exercise,
				category: item.category,
				muscle_groups: item.muscle_groups,
				sets: item.sets,
				reps: item.reps,
				load_lb: item.load_lb,
				duration_min: item.duration_min,
				distance_mi: item.distance_mi,
				source,
				confidence: item.confidence,
				...(loggedAt ? { logged_at: loggedAt } : {}),
			}));
			saved.activities = await insertEntries(client, userId, "movement", entries);
			// Evidence hangs off the first activity: one photo of a machine belongs to the
			// exercise it shows, and a log with several exercises was one moment anyway.
			saved.evidence = await linkEvidence(client, userId, evidenceIds, {
				activity_id: saved.activities[0]?.id as string | undefined,
			});
			break;
		}

		case "meal": {
			const rows = await insertEntries(client, userId, "meals", [
				{
					description: result.description,
					kcal: result.kcal ?? 0,
					protein_g: result.protein_g,
					carbs_g: result.carbs_g,
					fat_g: result.fat_g,
					fiber_g: result.fiber_g,
					...(loggedAt ? { logged_at: loggedAt } : {}),
				},
			]);
			const meal = rows[0] as Row;
			saved.meal = meal;
			const mealId = meal.id as string;
			saved.meal_items = await insertMealItems(client, mealId, result.items);
			if (result.meal_type) {
				// meal_type is a meals-only column, so it is not part of insertEntries'
				// shared shape; one small update beats a special case in that helper.
				await client.query(`UPDATE meals SET meal_type = $2 WHERE id = $1`, [mealId, result.meal_type]);
				meal.meal_type = result.meal_type;
			}
			saved.evidence = await linkEvidence(client, userId, evidenceIds, { meal_id: mealId });
			break;
		}

		case "weight": {
			const rows = await insertWeights(client, userId, [
				{ weight_lb: result.weight_lb, ...(loggedAt ? { logged_at: loggedAt } : {}) },
			]);
			saved.weight = rows[0] ?? null;
			// Since 0009 the scale photo points at the weigh-in it was read off, which is
			// what lets "the log, as recorded" show the picture beside the number.
			saved.evidence = await linkEvidence(client, userId, evidenceIds, {
				weight_id: saved.weight?.id as string | undefined,
			});
			break;
		}

		case "goal": {
			// The facts stated alongside the goal are saved first, and each where it
			// belongs: nobody says "I'm 212 and I want 200" expecting the 212 to be thrown
			// away. The weigh-in in particular has to land *before* the proposal is
			// computed, or the timeline is projected from whatever the scale last said.
			const facts = result.facts ?? null;
			if (facts?.current_weight_lb != null) {
				const rows = await insertWeights(client, userId, [
					{ weight_lb: facts.current_weight_lb, ...(loggedAt ? { logged_at: loggedAt } : {}) },
				]);
				saved.weight = rows[0] ?? null;
			}
			const profilePatch = goalFactsToProfile(facts, loggedAt);
			if (profilePatch) saved.profile = (await updateProfile(client, userId, profilePatch)) as Row;

			// Through the same service the Goals screen uses, so a goal set by talking and
			// a goal typed into the app get the same priority, the same validated metrics
			// and the same computed timeline (services/goals/store.ts).
			try {
				const created = await createGoal(client, userId, {
					spec: result.spec,
					...(facts?.current_weight_lb == null ? {} : { statedWeightLb: facts.current_weight_lb }),
					...(body.confirm_date === undefined ? {} : { confirmDate: body.confirm_date }),
					...(body.no_date === undefined ? {} : { noDate: body.no_date }),
					...(body.tz_offset_min === undefined ? {} : { tzOffsetMin: body.tz_offset_min }),
				});
				saved.goal = created.goal as unknown as Row;
				saved.goal_proposal = created.proposal;
			} catch (error) {
				// A spec naming a measure the app cannot compute is not something to save
				// and explain later; it is the one question that makes the goal loggable.
				if (error instanceof InvalidGoalError) throw new NothingToSaveError(error.message);
				throw error;
			}
			saved.evidence = await linkEvidence(client, userId, evidenceIds, {
				plan_id: saved.goal.id as string,
			});
			break;
		}

		case "constraint":
		case "preference": {
			saved.profile = await applyProfileStatement(
				client,
				userId,
				result.kind === "constraint" ? "constraints" : "preferences",
				result.text,
				result.fields
			);
			saved.evidence = await linkEvidence(client, userId, evidenceIds);
			break;
		}

		case "coach_context": {
			// WP5 gave this a home: one row on the user's local day (migration 0008), read
			// back when the coach is asked that day and never after it. A context that
			// outlives the day is a preference, which is a different table on purpose.
			const date = localDateOf(loggedAt ?? new Date(), body.tz_offset_min ?? 0);
			saved.coach_context = await saveCoachContext(client, userId, date, result.text);
			saved.evidence = await linkEvidence(client, userId, evidenceIds);
			break;
		}

		case "unclear":
			throw new NothingToSaveError(result.question);
	}

	return saved;
}

export interface ConfirmOutcome {
	saved: SavedLog;
	/** True when this client_id had already been confirmed and the first answer was replayed. */
	replayed: boolean;
}

/** The transaction and the idempotency ledger around {@link saveConfirmed}. */
export async function confirmLog(pool: pg.Pool, userId: string, body: ConfirmBody): Promise<ConfirmOutcome> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");

		// Claim the client_id first. A concurrent duplicate blocks on the primary key
		// until this transaction commits, then finds the row and replays it.
		const claim = await client.query(
			`INSERT INTO log_confirmations (user_id, client_id) VALUES ($1, $2)
			 ON CONFLICT (user_id, client_id) DO NOTHING RETURNING client_id`,
			[userId, body.client_id]
		);

		if (claim.rowCount === 0) {
			const { rows } = await client.query<{ result: SavedLog }>(
				`SELECT result FROM log_confirmations WHERE user_id = $1 AND client_id = $2`,
				[userId, body.client_id]
			);
			await client.query("COMMIT");
			return { saved: rows[0]!.result, replayed: true };
		}

		const saved = await saveConfirmed(client, userId, body);
		await client.query(`UPDATE log_confirmations SET result = $3::jsonb WHERE user_id = $1 AND client_id = $2`, [
			userId,
			body.client_id,
			JSON.stringify(saved),
		]);
		await client.query("COMMIT");
		return { saved, replayed: false };
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
