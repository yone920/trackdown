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
import { FieldChangeSchema, recordCorrection } from "../corrections.js";
import { insertTextEvidence, linkEvidence, type EvidenceRow } from "../evidence.js";
import { InvalidGoalError, createGoal } from "../goals/store.js";
import { localDateOf } from "../localTime.js";
import type { GoalProposal } from "../goals/proposal.js";
import {
	currentPlace,
	equipmentLabelsFor,
	recordPlaceEquipment,
	setCurrentPlace,
	upsertPlace,
} from "../places.js";
import {
	FusionResultSchema,
	MAX_PARTS,
	PLACE_KINDS,
	type FusionKind,
	type FusionResult,
	type GoalFacts,
	type PlaceKind,
	type ReferenceLoad,
} from "./schema.js";

// POST /api/log/confirm's half of the pipeline: take the preview the user just approved
// (with whatever they edited) and write it, once, in one transaction.
//
// One sentence can be several things — a meal, a run and a weigh-in — so the body carries
// `results`, a list, and every part of it is written inside the SAME transaction. One Save
// writes it all or none of it (concept-v2 §One input mechanism): a meal that saved while
// the weigh-in beside it failed is a day the user has to go and repair by hand.
//
// Idempotent by the client's uuid, still one per Save however many parts it holds. The
// phone mints it before it has a connection, so a confirm that times out and is retried on
// the train home must return the first attempt's rows rather than log the workout twice —
// the ledger is `log_confirmations`, and the first attempt's response is replayed verbatim.

type Row = Record<string, unknown>;

const isoDate = z.string().datetime({ offset: true });

/** More told changes than this on one unsaved preview is not a log, it is a conversation. */
export const MAX_CORRECTIONS = 20;

/** One told change, as `/api/log/analyze` computed it (services/corrections.ts). */
const CorrectionInput = z.object({
	part: z.number().int().min(0).max(MAX_PARTS - 1),
	/** Which item of an activities part; null (or absent) for a meal or a weigh-in. */
	item: z.number().int().min(0).max(19).nullable().default(null),
	instruction: z.string().trim().min(1).max(500),
	changes: z.array(FieldChangeSchema).min(1).max(40),
});

export const ConfirmBody = z
	.object({
		/** Minted by the client, before the request; the idempotency key. */
		client_id: z.uuid(),
		/**
		 * The preview, exactly as /api/log/analyze returned it, minus the user's
		 * corrections — one entry per part, in the order they were said.
		 */
		results: z.array(FusionResultSchema).min(1).max(MAX_PARTS).optional(),
		/**
		 * The single-part body every client written before the mixed-input fix sends.
		 * Accepted for one release; `results` is the shape to send.
		 */
		result: FusionResultSchema.optional(),
		/** Evidence created by /api/log/analyze (the photos) — linked to what it became. */
		evidence_ids: z.array(z.uuid()).max(8).default([]),
		/**
		 * Which part each evidence id belongs to, aligned with `evidence_ids`: the plate to
		 * the meal, the machine to the exercise. Missing or short means part 0, which is the
		 * only answer there is for a single-part log.
		 */
		evidence_parts: z.array(z.number().int().min(0)).max(8).default([]),
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
		/**
		 * The corrections made to this preview before it was saved (migration 0015), exactly
		 * as `/api/log/analyze` returned them from each "Make a change". They are written
		 * against the rows the parts turn into, inside the same transaction — a correction
		 * whose record failed to save is not a correction that happened.
		 *
		 * The client relays them rather than computing them: the diff is the server's, taken
		 * between the parts it was handed and the parts it answered with, and a client that
		 * could write its own history could write one that never happened.
		 */
		corrections: z.array(CorrectionInput).max(MAX_CORRECTIONS).default([]),
	})
	// One of the two has to be there. A 400 saying so beats a 201 that saved nothing.
	.refine((body) => (body.results?.length ?? 0) > 0 || body.result !== undefined, {
		message: "Send the parts to save as `results`.",
		path: ["results"],
	});
export type ConfirmBody = z.infer<typeof ConfirmBody>;

/** The parts of a confirm body, `results` first and the legacy single `result` after it. */
export function confirmParts(body: ConfirmBody): FusionResult[] {
	if (body.results && body.results.length > 0) return body.results;
	return body.result ? [body.result] : [];
}

/** The ids one part turned into, so the client can point at what it just saved. */
export interface SavedPart {
	kind: FusionKind;
	activity_ids: string[];
	meal_id: string | null;
	weight_id: string | null;
	goal_id: string | null;
	evidence_ids: string[];
}

export interface SavedLog {
	/** The first part's kind. `kinds` is the whole answer; this stays for old clients. */
	kind: FusionKind;
	kinds: FusionKind[];
	/** What each part became, in the order the parts were sent. */
	parts: SavedPart[];
	activities: Row[];
	/** The first meal saved; `meals` holds them all. */
	meal: Row | null;
	meals: Row[];
	meal_items: Row[];
	/** The first weigh-in saved; `weights` holds them all. */
	weight: Row | null;
	weights: Row[];
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
		kinds: [],
		parts: [],
		activities: [],
		meal: null,
		meals: [],
		meal_items: [],
		weight: null,
		weights: [],
		goal: null,
		goal_proposal: null,
		profile: null,
		coach_context: null,
		evidence: [],
	};
}

function emptyPart(kind: FusionKind): SavedPart {
	return { kind, activity_ids: [], meal_id: null, weight_id: null, goal_id: null, evidence_ids: [] };
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
	// How long a normal session is (migration 0014). A plan field like the rest: stated by
	// talking, dated in stated_at, and read by the coach's session sizing.
	"session_minutes",
	"environment",
	"equipment",
	"eatback",
	// The training background (migration 0011). `reference_loads` is not here: it is a
	// jsonb array and it merges rather than replaces — see mergeReferenceLoads below.
	"experience",
	"background",
] as const;

/** More stated loads than this is a list nobody re-reads; the oldest fall off. */
export const MAX_REFERENCE_LOADS = 20;

/**
 * Stated reference loads, merged into the ones already on the profile: restating an
 * exercise replaces its entry in place, a new exercise is appended. Replacing the whole
 * list would mean "I squat 225 now" quietly erased last month's bench, and appending
 * blindly would leave two answers for the same lift with no way to tell which is current.
 *
 * Returns null when the statement named none — nothing to write, and nothing to date.
 */
export function mergeReferenceLoads(
	existing: unknown,
	stated: readonly ReferenceLoad[] | null | undefined
): ReferenceLoad[] | null {
	if (!stated || stated.length === 0) return null;
	const current = Array.isArray(existing) ? (existing as ReferenceLoad[]) : [];
	// A Map keyed by the exercise keeps each entry where it was while taking the new
	// numbers, so the list reads in the order the user first named things.
	const byExercise = new Map(current.map((load) => [load.exercise.trim().toLowerCase(), load]));
	for (const load of stated) byExercise.set(load.exercise.trim().toLowerCase(), load);
	return [...byExercise.values()].slice(-MAX_REFERENCE_LOADS);
}

/**
 * What each saved activity teaches us about the room it happened in. No current place is
 * the normal state — someone who has never named their gym gets exactly the behaviour they
 * had before this existed, which is why nothing above has to check first.
 */
async function accruePlaceEquipment(client: pg.PoolClient, userId: string, rows: readonly Row[]): Promise<void> {
	const place = await currentPlace(client, userId);
	if (!place) return;
	for (const row of rows) {
		for (const { label, exerciseId } of equipmentLabelsFor({
			equipment: row.equipment as string | null,
			exercise: row.exercise as string | null,
			exercise_id: row.exercise_id as string | null,
		})) {
			await recordPlaceEquipment(client, place.id, label, { exerciseId });
		}
	}
}

/**
 * "My gym is New Millennium" — the one sentence that turns the passive equipment memory on.
 * The place is created (or found, case-insensitively) and becomes the profile's current
 * place, so every workout saved afterwards accrues against it.
 */
async function applyStatedPlace(
	client: pg.PoolClient,
	userId: string,
	fields: Record<string, unknown> | null
): Promise<void> {
	const name = typeof fields?.place_name === "string" ? fields.place_name.trim() : "";
	if (name === "") return;
	const kindSaid = fields?.place_kind;
	const kind = (PLACE_KINDS as readonly string[]).includes(kindSaid as string) ? (kindSaid as PlaceKind) : "gym";
	const place = await upsertPlace(client, userId, name, kind);
	if (place) await setCurrentPlace(client, userId, place.id);
}

async function applyProfileStatement(
	client: pg.PoolClient,
	userId: string,
	list: "constraints" | "preferences",
	text: string,
	fields: Record<string, unknown> | null
): Promise<Row> {
	const before = (await getProfile(client, userId)) as Record<string, unknown>;

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

	const loads = mergeReferenceLoads(before.reference_loads, fields?.reference_loads as ReferenceLoad[] | null);
	if (loads) {
		params.push(JSON.stringify(loads));
		sets.push(`reference_loads = $${params.length}::jsonb`);
		stated.reference_loads = new Date().toISOString();
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
 * The photos, split by the part they were read for. An id whose part is missing or out of
 * range goes to the first part rather than being dropped: evidence linked to nothing is
 * evidence the sweep deletes tomorrow.
 */
export function evidenceByPart(
	ids: readonly string[],
	parts: readonly number[],
	partCount: number
): string[][] {
	const buckets: string[][] = Array.from({ length: partCount }, () => []);
	ids.forEach((id, index) => {
		const stated = parts[index];
		const part = Number.isInteger(stated) && stated! >= 0 && stated! < partCount ? stated! : 0;
		buckets[part]!.push(id);
	});
	return buckets;
}

/**
 * Write one confirmed preview — every part of it. Runs inside a caller's transaction, so
 * the meal, the run and the weigh-in in one sentence are all-or-nothing together with the
 * evidence links and the idempotency ledger.
 */
export async function saveConfirmed(
	client: pg.PoolClient,
	userId: string,
	body: ConfirmBody
): Promise<SavedLog> {
	const results = confirmParts(body);
	const saved = emptySaved(results[0]!.kind);
	const buckets = evidenceByPart(body.evidence_ids, body.evidence_parts, results.length);

	for (const [index, result] of results.entries()) {
		await savePart(client, userId, body, result, buckets[index]!, saved);
	}
	await saveCorrections(client, userId, body, saved);
	return saved;
}

/**
 * The told changes this preview went through, written against the rows it just became
 * (migration 0015). After the parts, because until then there is nothing to point at.
 *
 * A correction naming a part or an item that is not there is dropped rather than filed
 * somewhere else: the parts can change between the revision and the Save — dropping one
 * with its ✕ renumbers everything after it — and a correction attached to the wrong record
 * is worse history than no history.
 */
async function saveCorrections(
	client: pg.PoolClient,
	userId: string,
	body: ConfirmBody,
	saved: SavedLog
): Promise<void> {
	for (const correction of body.corrections) {
		const part = saved.parts[correction.part];
		if (!part) continue;
		// By the part's own kind, never by "whichever id it happens to carry": a goal part
		// carries the weigh-in its stated facts produced, and a correction to the goal is not
		// a correction to that weight. Goals and statements keep no history here (0015).
		const activityId = part.kind === "activities" ? part.activity_ids[correction.item ?? 0] : undefined;
		const owner =
			part.kind === "activities"
				? activityId
					? { activityId }
					: null
				: part.kind === "meal" && part.meal_id
					? { mealId: part.meal_id }
					: part.kind === "weight" && part.weight_id
						? { weightId: part.weight_id }
						: null;
		if (!owner) continue;
		await recordCorrection(client, userId, owner, correction.instruction, correction.changes);
	}
}

/** One part of the confirm, written into the running {@link SavedLog}. */
async function savePart(
	client: pg.PoolClient,
	userId: string,
	body: ConfirmBody,
	result: FusionResult,
	photoIds: readonly string[],
	saved: SavedLog
): Promise<void> {
	const part = emptyPart(result.kind);
	saved.kinds.push(result.kind);
	saved.parts.push(part);
	const loggedAt = body.logged_at;
	const source = body.source ?? (photoIds.length > 0 ? "fused" : "manual");
	const evidenceIds = [...photoIds];

	// The words behind the log are evidence too, and the only provenance a typed log has.
	// One row per part, so a mixed sentence shows what was said under each record it
	// became rather than only under the first (docs/design-system.md §DayLog).
	if (body.text) {
		const row = await insertTextEvidence(client, userId, body.text_kind, body.text);
		evidenceIds.push(row.id);
	}
	part.evidence_ids = evidenceIds;

	const keep = (rows: EvidenceRow[]): void => {
		saved.evidence.push(...rows);
	};

	switch (result.kind) {
		case "activities": {
			const entries: NewEntry[] = result.items.map((item) => ({
				description: item.description,
				kcal: item.kcal ?? 0,
				exercise: item.exercise,
				equipment: item.equipment,
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
			const rows = await insertEntries(client, userId, "movement", entries);
			saved.activities.push(...rows);
			part.activity_ids = rows.map((row) => row.id as string);
			// The room remembers what was done in it (migration 0012). Passive, silent, and
			// a no-op when the user has never said where they train.
			await accruePlaceEquipment(client, userId, rows);
			// Evidence hangs off the first activity: one photo of a machine belongs to the
			// exercise it shows, and a log with several exercises was one moment anyway.
			keep(
				await linkEvidence(client, userId, evidenceIds, {
					activity_id: rows[0]?.id as string | undefined,
				})
			);
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
			saved.meals.push(meal);
			saved.meal ??= meal;
			const mealId = meal.id as string;
			part.meal_id = mealId;
			saved.meal_items.push(...(await insertMealItems(client, mealId, result.items)));
			if (result.meal_type) {
				// meal_type is a meals-only column, so it is not part of insertEntries'
				// shared shape; one small update beats a special case in that helper.
				await client.query(`UPDATE meals SET meal_type = $2 WHERE id = $1`, [mealId, result.meal_type]);
				meal.meal_type = result.meal_type;
			}
			keep(await linkEvidence(client, userId, evidenceIds, { meal_id: mealId }));
			break;
		}

		case "weight": {
			const rows = await insertWeights(client, userId, [
				{ weight_lb: result.weight_lb, ...(loggedAt ? { logged_at: loggedAt } : {}) },
			]);
			const weight = (rows[0] as Row | undefined) ?? null;
			if (weight) {
				saved.weights.push(weight);
				saved.weight ??= weight;
				part.weight_id = weight.id as string;
			}
			// Since 0009 the scale photo points at the weigh-in it was read off, which is
			// what lets "the log, as recorded" show the picture beside the number.
			keep(
				await linkEvidence(client, userId, evidenceIds, {
					weight_id: weight?.id as string | undefined,
				})
			);
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
				const weight = (rows[0] as Row | undefined) ?? null;
				if (weight) {
					saved.weights.push(weight);
					saved.weight ??= weight;
					part.weight_id = weight.id as string;
				}
			}
			const profilePatch = goalFactsToProfile(facts, loggedAt);
			if (profilePatch) saved.profile = (await updateProfile(client, userId, profilePatch)) as Row;

			// Through the same service the Goals screen uses, so a goal set by talking and
			// a goal typed into the app get the same priority, the same validated metrics
			// and the same computed timeline (services/goals/store.ts).
			let goalRow: Row;
			try {
				const created = await createGoal(client, userId, {
					spec: result.spec,
					...(facts?.current_weight_lb == null ? {} : { statedWeightLb: facts.current_weight_lb }),
					...(body.confirm_date === undefined ? {} : { confirmDate: body.confirm_date }),
					...(body.no_date === undefined ? {} : { noDate: body.no_date }),
					...(body.tz_offset_min === undefined ? {} : { tzOffsetMin: body.tz_offset_min }),
				});
				goalRow = created.goal as unknown as Row;
				saved.goal ??= goalRow;
				saved.goal_proposal ??= created.proposal;
				part.goal_id = goalRow.id as string;
			} catch (error) {
				// A spec naming a measure the app cannot compute is not something to save
				// and explain later; it is the one question that makes the goal loggable.
				if (error instanceof InvalidGoalError) throw new NothingToSaveError(error.message);
				throw error;
			}
			keep(await linkEvidence(client, userId, evidenceIds, { plan_id: goalRow.id as string }));
			break;
		}

		case "constraint":
		case "preference": {
			// Before the profile merge, so the row the merge returns already carries the id.
			await applyStatedPlace(client, userId, result.fields);
			saved.profile = await applyProfileStatement(
				client,
				userId,
				result.kind === "constraint" ? "constraints" : "preferences",
				result.text,
				result.fields
			);
			keep(await linkEvidence(client, userId, evidenceIds));
			break;
		}

		case "coach_context": {
			// WP5 gave this a home: one row on the user's local day (migration 0008), read
			// back when the coach is asked that day and never after it. A context that
			// outlives the day is a preference, which is a different table on purpose.
			const date = localDateOf(loggedAt ?? new Date(), body.tz_offset_min ?? 0);
			saved.coach_context ??= await saveCoachContext(client, userId, date, result.text);
			keep(await linkEvidence(client, userId, evidenceIds));
			break;
		}

		case "unclear":
			throw new NothingToSaveError(result.question);
	}
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
