import type pg from "pg";
import { z } from "zod";
import { insertEntries, insertWeights, getProfile, type NewEntry } from "../entries.js";
import { insertTextEvidence, linkEvidence, type EvidenceRow } from "../evidence.js";
import { FusionResultSchema, type FusionKind } from "./schema.js";

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
});
export type ConfirmBody = z.infer<typeof ConfirmBody>;

export interface SavedLog {
	kind: FusionKind;
	activities: Row[];
	meal: Row | null;
	meal_items: Row[];
	weight: Row | null;
	goal: Row | null;
	profile: Row | null;
	/** WP5 reads this back when the coach is asked; nothing else acts on it. */
	coach_context: { text: string } | null;
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
			// weight_logs has no evidence column; the scale photo stays user-owned and
			// confirmed, which is what keeps the sweep off it.
			saved.evidence = await linkEvidence(client, userId, evidenceIds);
			break;
		}

		case "goal": {
			const { spec, proposed_timeline } = result;
			// Priority is appended: a new goal never silently demotes the primary one.
			const { rows } = await client.query(
				`INSERT INTO goals (user_id, kind, title, metrics, priority, status, active_from, active_to, stated_at)
				 VALUES ($1, $2, $3, $4::jsonb,
				         (SELECT COALESCE(MAX(priority), 0) + 1 FROM goals WHERE user_id = $1 AND status = 'active'),
				         'active', COALESCE($5::date, CURRENT_DATE), $6::date, NOW())
				 RETURNING *`,
				[
					userId,
					spec.kind,
					spec.title,
					JSON.stringify(spec.metrics),
					spec.active_from,
					// The accepted timeline is the goal's end date when the user has one.
					spec.active_to ?? proposed_timeline?.by ?? null,
				]
			);
			saved.goal = rows[0] as Row;
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
			// Nothing to write: the coach (WP5) reads the day's context when it is asked,
			// and a context that outlives the day is a preference, not a context. The
			// evidence row is the record that it was said.
			saved.coach_context = { text: result.text };
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
