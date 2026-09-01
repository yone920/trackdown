import type pg from "pg";
import { z } from "zod";
import type { FusionResult } from "./fusion/schema.js";

// Correction history (migration 0015). A told change is a thing that happened to a record,
// so it is kept beside the record it changed — the instruction in the user's own words and
// the field-level diff it produced.
//
// Both ways a correction can be made write through here:
//   * a PENDING preview corrected before it was ever saved ("Make a change" → "Log it"):
//     the diff is computed while the revision comes back and travels with the confirm, so
//     it can be written against ids that do not exist yet when the change is made;
//   * a SAVED row corrected in place (the DayLog's tap → "Make a change" → PATCH): the diff
//     is computed here, from the row before and the row after.
//
// Nothing about this is a version history and it is not trying to be one. It answers the
// two questions someone asks of a number they do not recognise — did I change this, and
// what did it say before — and it answers them on the screen the number is on.

type Queryable = pg.Pool | pg.PoolClient;

/** One field that moved. `from`/`to` are JSON scalars or a small array (muscle groups). */
export const FieldChangeSchema = z.object({
	field: z.string().trim().min(1).max(40),
	from: z.unknown().nullable(),
	to: z.unknown().nullable(),
});
export type FieldChange = z.infer<typeof FieldChangeSchema>;

export interface RecordCorrection {
	id: string;
	instruction: string;
	changes: FieldChange[];
	created_at: string;
}

/** Which record a correction is about. Exactly one, checked by the table too. */
export interface CorrectionOwner {
	activityId?: string | null;
	mealId?: string | null;
	weightId?: string | null;
	/**
	 * The record this one was split out of (migration 0018). Set only on the rows a
	 * correction CREATED — "this exists because that was corrected" — and never on the row
	 * the correction is about, which is named by `activityId` and is a different fact.
	 */
	replacesActivityId?: string | null;
}

/**
 * The fields a correction is allowed to be *about*, per kind, in the order a card reads
 * them. Deliberately not "every column": `confidence` moves on every revision by design
 * (the user is the authority, so what they state is high), and a history that says
 * "confidence: medium → high" under every correction is noise on top of the one line
 * anybody wanted.
 */
export const CORRECTABLE_FIELDS = {
	activity: [
		"exercise",
		"equipment",
		"description",
		"category",
		"muscle_groups",
		"sets",
		"reps",
		"load_lb",
		"duration_min",
		"distance_mi",
		"kcal",
	],
	meal: ["description", "meal_type", "kcal", "protein_g", "carbs_g", "fat_g", "fiber_g"],
	weight: ["weight_lb"],
} as const;

/** Numbers compared with a hair of slack, everything else structurally. */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === null || a === undefined) return b === null || b === undefined;
	if (b === null || b === undefined) return false;
	if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
	return JSON.stringify(a) === JSON.stringify(b);
}

/** Values are stored as they are shown; `undefined` is a field nobody read, and is a null. */
function value(input: unknown): unknown {
	return input === undefined ? null : input;
}

/** Which of `fields` differ between two flat records, in the order `fields` names them. */
export function diffFields(
	before: Record<string, unknown> | null | undefined,
	after: Record<string, unknown> | null | undefined,
	fields: readonly string[]
): FieldChange[] {
	if (!before || !after) return [];
	const changes: FieldChange[] = [];
	for (const field of fields) {
		// A field the patch never named has not been corrected, whatever the row says.
		if (!(field in after)) continue;
		if (same(before[field], after[field])) continue;
		changes.push({ field, from: value(before[field]), to: value(after[field]) });
	}
	return changes;
}

/**
 * One correction, ready to be written: the changes one part of a log went through, and —
 * for an activities part, which is several rows — which item of it they belong to.
 */
export interface PartCorrection {
	/** Index into the log's parts. */
	part: number;
	/** Index into an activities part's items; null for a meal or a weigh-in. */
	item: number | null;
	instruction: string;
	changes: FieldChange[];
	/**
	 * Which item of the part as it went IN this one replaces — set only when the told
	 * change split one record into several (migration 0018). Absent for an ordinary
	 * field-level correction, which replaces nothing: it moves what was already there.
	 */
	replaces?: number | null;
}

/**
 * What a revision actually changed, part by part. Computed on the server because the server
 * is where both sides are: the app is handed the answer and hands it back at confirm, which
 * is the only way a change made *before* anything is saved can be written against the row it
 * eventually becomes.
 *
 * An activities part is diffed item by item and each item's changes are kept apart, because
 * each item is its own `activities` row and its own line in the log. Items are matched by
 * position; a revision that changed how many exercises there are is not a field-level
 * correction and returns nothing rather than a fictional diff.
 */
export function diffResults(
	before: readonly FusionResult[],
	after: readonly FusionResult[],
	instruction: string
): PartCorrection[] {
	const said = instruction.trim();
	const corrections: PartCorrection[] = [];
	before.forEach((was, part) => {
		const now = after[part];
		if (!now || now.kind !== was.kind) return;
		if (was.kind === "activities" && now.kind === "activities") {
			// A SPLIT: one record became several (migration 0018). Every part is diffed
			// against the record it came out of, so each new row's history says what it
			// took from the original — "sets 4 → 2, load — → 85" — and names it as the
			// record it replaces. Only ONE record splitting is handled: which of three
			// originals a new part came from is not a question the positions can answer,
			// and a guessed provenance is worse than none.
			if (was.items.length === 1 && now.items.length > 1) {
				const original = was.items[0] as unknown as Record<string, unknown>;
				now.items.forEach((item, index) => {
					const changes = diffFields(
						original,
						item as unknown as Record<string, unknown>,
						CORRECTABLE_FIELDS.activity
					);
					if (changes.length > 0) {
						corrections.push({ part, item: index, instruction: said, changes, replaces: 0 });
					}
				});
				return;
			}
			if (was.items.length !== now.items.length) return;
			was.items.forEach((item, index) => {
				const changes = diffFields(
					item as unknown as Record<string, unknown>,
					now.items[index] as unknown as Record<string, unknown>,
					CORRECTABLE_FIELDS.activity
				);
				if (changes.length > 0) corrections.push({ part, item: index, instruction: said, changes });
			});
			return;
		}
		const fields =
			was.kind === "meal" ? CORRECTABLE_FIELDS.meal : was.kind === "weight" ? CORRECTABLE_FIELDS.weight : null;
		if (!fields) return;
		const changes = diffFields(
			was as unknown as Record<string, unknown>,
			now as unknown as Record<string, unknown>,
			fields
		);
		if (changes.length > 0) corrections.push({ part, item: null, instruction: said, changes });
	});
	return corrections;
}

/**
 * Write one correction against one saved row. A correction that moved nothing is not
 * written: "make it lunch" said at a meal that was already lunch is not history, and a row
 * of empty changes under the record would read as a change the user cannot see.
 */
export async function recordCorrection(
	db: Queryable,
	userId: string,
	owner: CorrectionOwner,
	instruction: string,
	changes: readonly FieldChange[]
): Promise<RecordCorrection | null> {
	const said = instruction.trim();
	if (said === "" || changes.length === 0) return null;
	const activityId = owner.activityId ?? null;
	const mealId = owner.mealId ?? null;
	const weightId = owner.weightId ?? null;
	if ([activityId, mealId, weightId].filter(Boolean).length !== 1) return null;
	// A row cannot have been split out of itself; that would be a loop in the provenance
	// rather than a fact about where the row came from.
	const replaces = owner.replacesActivityId && owner.replacesActivityId !== activityId ? owner.replacesActivityId : null;
	const { rows } = await db.query<RecordCorrection>(
		`INSERT INTO record_corrections
		        (user_id, activity_id, meal_id, weight_id, instruction, changes, replaces_activity_id)
		 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
		 RETURNING id, instruction, changes, created_at`,
		[userId, activityId, mealId, weightId, said, JSON.stringify(changes), replaces]
	);
	return rows[0] ?? null;
}

interface CorrectionRow extends RecordCorrection {
	activity_id: string | null;
	meal_id: string | null;
	weight_id: string | null;
}

/**
 * Every correction made to any of these records, keyed by the record's id and in the order
 * they were made. One query for a whole day — the DayLog draws them under each entry.
 */
export async function correctionsByRecord(
	db: Queryable,
	userId: string,
	ids: { activityIds: readonly string[]; mealIds: readonly string[]; weightIds: readonly string[] }
): Promise<Map<string, RecordCorrection[]>> {
	const byRecord = new Map<string, RecordCorrection[]>();
	const { activityIds, mealIds, weightIds } = ids;
	if (activityIds.length + mealIds.length + weightIds.length === 0) return byRecord;
	const { rows } = await db.query<CorrectionRow>(
		`SELECT id, activity_id, meal_id, weight_id, instruction, changes, created_at
		   FROM record_corrections
		  WHERE user_id = $1
		    AND (activity_id = ANY($2::uuid[]) OR meal_id = ANY($3::uuid[]) OR weight_id = ANY($4::uuid[]))
		  ORDER BY created_at`,
		[userId, activityIds, mealIds, weightIds]
	);
	for (const row of rows) {
		const owner = row.activity_id ?? row.meal_id ?? row.weight_id;
		if (!owner) continue;
		const list = byRecord.get(owner) ?? [];
		list.push({
			id: row.id,
			instruction: row.instruction,
			changes: Array.isArray(row.changes) ? row.changes : [],
			created_at: row.created_at,
		});
		byRecord.set(owner, list);
	}
	return byRecord;
}
