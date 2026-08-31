import type pg from "pg";
import { z } from "zod";
import { CATEGORIES, type ExerciseCategory, type LoadDirection } from "../db/exercises.js";
import { CORRECTABLE_FIELDS, diffFields, recordCorrection } from "./corrections.js";
import { buildExerciseIndex } from "./exerciseMatch.js";
import { EXPERIENCE_LEVELS, ReferenceLoadSchema } from "./fusion/schema.js";

// Data access for the four user-owned tables. Every function takes the session's
// userId and scopes the SQL by it — this is what Supabase's RLS policies used to do.

// "movement" is the v1 name the shipped app still calls; 0004_v2.sql renamed the table to
// `activities` and gave it exercise/sets/reps/load columns. Keeping the alias here is what
// lets /api/entries/movement go on working until WP6 replaces those screens.
export const KINDS = { meals: "meals", movement: "activities" } as const;
export type Kind = keyof typeof KINDS;
export function isKind(value: string): value is Kind {
	return value in KINDS;
}

type Queryable = pg.Pool | pg.PoolClient;

const isoDate = z.string().datetime({ offset: true });
const macro = z.number().min(0).nullable();

export const ACTIVITY_SOURCES = ["manual", "fused", "health"] as const;
export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

// The v2 activity fields, accepted on the "movement" kind and ignored on "meals" (only
// `activities` has these columns). All optional: a v1 client that sends none is still
// writing a valid row.
const activityFields = {
	exercise: z.string().trim().min(1).max(120).nullable().optional(),
	// What it was done ON (migration 0012). Separate from the movement, and never used to
	// look one up: "cable stack" is not an exercise name.
	equipment: z.string().trim().min(1).max(80).nullable().optional(),
	category: z.enum(CATEGORIES).nullable().optional(),
	muscle_groups: z.array(z.string().trim().min(1).max(40)).max(12).nullable().optional(),
	sets: z.number().int().min(0).max(100).nullable().optional(),
	reps: z.number().int().min(0).max(1000).nullable().optional(),
	load_lb: z.number().min(0).max(2000).nullable().optional(),
	duration_min: z.number().int().min(0).max(1440).nullable().optional(),
	distance_mi: z.number().min(0).max(1000).nullable().optional(),
	source: z.enum(ACTIVITY_SOURCES).nullable().optional(),
	confidence: z.enum(CONFIDENCE_LEVELS).nullable().optional(),
};

export const RangeQuery = z.object({
	from: isoDate.optional(),
	to: isoDate.optional(),
	order: z.enum(["asc", "desc"]).default("desc"),
	limit: z.coerce.number().int().min(1).max(1000).optional(),
});
export type RangeQuery = z.infer<typeof RangeQuery>;

export const NewEntry = z.object({
	description: z.string().trim().min(1).max(500),
	kcal: z.number().int().min(0).default(0),
	protein_g: macro.optional(),
	carbs_g: macro.optional(),
	fat_g: macro.optional(),
	fiber_g: macro.optional(),
	logged_at: isoDate.optional(),
	...activityFields,
});
export type NewEntry = z.infer<typeof NewEntry>;

/**
 * What the user SAID to make this change, when the change came from telling rather than
 * from a screen (concept-v2 §Principles 7 — NO FORMS). Not a column: it is the instruction
 * behind the correction, and it is filed with the field-level diff in `record_corrections`
 * (migration 0015). Absent on any other write, and a patch carrying only this changes
 * nothing and records nothing.
 */
const correctionInstruction = z.string().trim().min(1).max(500);

export const EntryPatch = z
	.object({
		description: z.string().trim().min(1).max(500),
		kcal: z.number().int().min(0),
		protein_g: macro,
		carbs_g: macro,
		fat_g: macro,
		fiber_g: macro,
		logged_at: isoDate,
		...activityFields,
		correction_instruction: correctionInstruction,
	})
	.partial()
	.refine((patch) => Object.keys(patch).length > 0, { message: "Empty patch." });
export type EntryPatch = z.infer<typeof EntryPatch>;

export const NewWeight = z.object({
	weight_lb: z.number().positive().max(2000),
	logged_at: isoDate.optional(),
});
export type NewWeight = z.infer<typeof NewWeight>;

/** A correction to a weigh-in — the DayLog's edit card (docs/design-system.md §DayLog). */
export const WeightPatch = z
	.object({
		weight_lb: z.number().positive().max(2000),
		logged_at: isoDate,
		correction_instruction: correctionInstruction,
	})
	.partial()
	.refine((patch) => Object.keys(patch).length > 0, { message: "Empty patch." });
export type WeightPatch = z.infer<typeof WeightPatch>;

export const ProfilePatch = z
	.object({
		display_name: z.string().trim().max(100).nullable(),
		goal_weight_lb: z.number().positive().max(2000).nullable(),
		units: z.enum(["imperial", "metric"]),
		sex: z.enum(["male", "female"]).nullable(),
		birth_year: z.number().int().min(1900).max(2100).nullable(),
		height_cm: z.number().positive().max(300).nullable(),
		activity_level: z.enum(["sedentary", "light", "moderate", "active", "very_active"]).nullable(),
		goal_pace: z.enum(["gentle", "standard", "aggressive"]),
		pregnant_or_lactating: z.boolean(),
		health_concern: z.boolean(),
		disclaimer_acknowledged_at: isoDate.nullable(),
		daily_calorie_target: z.number().int().min(0).nullable(),
		deficit_kcal: z.number().int().min(0).nullable(),
		// The plan (0004_v2.sql), normally set by talking — concept-v2 §Goals and profile.
		// Editable here too, because "single-field tap to correct" is part of that screen.
		diet_style: z.string().trim().max(80).nullable(),
		protein_g: z.number().int().min(0).max(1000).nullable(),
		carbs_max_g: z.number().int().min(0).max(2000).nullable(),
		training_days: z.number().int().min(0).max(7).nullable(),
		/** How long a normal session is (migration 0014); null = never stated, not "sixty". */
		session_minutes: z.number().int().min(10).max(240).nullable(),
		environment: z.string().trim().max(80).nullable(),
		equipment: z.array(z.string().trim().min(1).max(60)).max(30),
		// A list edited on the Profile screen replaces the list; the spoken path appends
		// and dedupes instead (services/fusion/confirm.ts), because saying "bad left knee"
		// twice is one knee, and deleting a row is something only a tap can mean.
		constraints: z.array(z.string().trim().min(1).max(200)).max(30),
		preferences: z.array(z.string().trim().min(1).max(200)).max(30),
		eatback: z.enum(["none", "half", "all"]),
		// The training background (migration 0011): what the user brings with them, so a
		// cold start does not have to assume a beginner. Normally stated out loud through
		// the Log sheet; editable here for the same reason every other plan field is.
		experience: z.enum(EXPERIENCE_LEVELS).nullable(),
		background: z.string().trim().max(600).nullable(),
		reference_loads: z.array(ReferenceLoadSchema).max(20),
	})
	.partial()
	.refine((patch) => Object.keys(patch).length > 0, { message: "Empty patch." });
export type ProfilePatch = z.infer<typeof ProfilePatch>;

const MACRO_COLUMNS = ["protein_g", "carbs_g", "fat_g", "fiber_g"] as const;

// Written in this order by insertEntries; exercise_id is derived, never sent by a client.
const ACTIVITY_COLUMNS = [
	"exercise",
	"exercise_id",
	"equipment",
	"category",
	"muscle_groups",
	"sets",
	"reps",
	"load_lb",
	"duration_min",
	"distance_mi",
	"source",
	"confidence",
] as const;

/** Patchable activity columns: everything above except the derived exercise_id. */
const ACTIVITY_PATCH_COLUMNS = ACTIVITY_COLUMNS.filter((c) => c !== "exercise_id");

export interface CatalogMatch {
	id: string;
	name: string;
	category: ExerciseCategory;
	primary_muscles: string[];
	secondary_muscles: string[];
	aliases: string[];
	/** Which way its load points (migration 0013). See db/exercises.ts. */
	load_direction: LoadDirection;
}

/**
 * Resolves spoken exercise names to catalogue rows, by name or alias, case-insensitively —
 * "db bench" and "Dumbbell bench press" both find "Dumbbell Bench Press". Keyed by the
 * lower-cased name that was asked for. Unknown names are simply absent: the catalogue
 * normalises, it does not gate what the user is allowed to log.
 *
 * **It normalises spelling and nothing else.** A phrase carrying a qualifier the entry does
 * not carry — "assisted chin up" against Chin-Up — is refused rather than snapped to the
 * nearest name, and the caller keeps the user's own words with no `exercise_id`. That
 * decision lives in services/exerciseMatch.ts, with the field report that paid for it.
 *
 * The whole catalogue is read (a curated list in the low hundreds) because the match is
 * decided in TypeScript: expressing "every meaningful word is accounted for" in SQL would
 * be a worse version of the same code.
 */
export async function lookupExercises(
	db: Queryable,
	names: readonly (string | null | undefined)[]
): Promise<Map<string, CatalogMatch>> {
	const wanted = [
		...new Set(
			names
				.filter((n): n is string => typeof n === "string" && n.trim() !== "")
				.map((n) => n.trim().toLowerCase())
		),
	];
	const matches = new Map<string, CatalogMatch>();
	if (wanted.length === 0) return matches;

	const { rows } = await db.query<CatalogMatch>(
		`SELECT id, name, category, primary_muscles, secondary_muscles, aliases, load_direction
		   FROM exercise_catalog ORDER BY name`
	);
	const index = buildExerciseIndex(rows);
	for (const key of wanted) {
		const match = index.find(key);
		if (match) matches.set(key, match);
	}
	return matches;
}

function rangeSql(q: RangeQuery, params: unknown[], startIndex: number): string {
	const clauses: string[] = [];
	if (q.from) {
		params.push(q.from);
		clauses.push(`AND logged_at >= $${startIndex + params.length - 1}`);
	}
	if (q.to) {
		params.push(q.to);
		clauses.push(`AND logged_at < $${startIndex + params.length - 1}`);
	}
	return clauses.join(" ");
}

export async function listEntries(db: Queryable, userId: string, kind: Kind, q: RangeQuery) {
	const params: unknown[] = [userId];
	const range = rangeSql(q, params, 1);
	const limit = q.limit ? `LIMIT ${q.limit}` : "";
	const { rows } = await db.query(
		`SELECT * FROM ${KINDS[kind]} WHERE user_id = $1 ${range}
		 ORDER BY logged_at ${q.order === "asc" ? "ASC" : "DESC"} ${limit}`,
		params
	);
	return rows;
}

export async function getEntry(db: Queryable, userId: string, kind: Kind, id: string) {
	const { rows } = await db.query(`SELECT * FROM ${KINDS[kind]} WHERE user_id = $1 AND id = $2`, [
		userId,
		id,
	]);
	return rows[0] ?? null;
}

export async function insertEntries(db: Queryable, userId: string, kind: Kind, entries: NewEntry[]) {
	if (entries.length === 0) return [];
	const withMacros = kind === "meals";
	const withActivity = kind === "movement";
	// One catalogue lookup for the whole batch.
	const catalog: Map<string, CatalogMatch> = withActivity
		? await lookupExercises(db, entries.map((e) => e.exercise))
		: new Map();
	const columns = [
		"user_id",
		"description",
		"kcal",
		"logged_at",
		...(withMacros ? MACRO_COLUMNS : []),
		...(withActivity ? ACTIVITY_COLUMNS : []),
	];
	const params: unknown[] = [];
	const tuples = entries.map((e) => {
		const values: unknown[] = [userId, e.description, e.kcal, e.logged_at ?? new Date().toISOString()];
		if (withMacros) values.push(e.protein_g ?? null, e.carbs_g ?? null, e.fat_g ?? null, e.fiber_g ?? null);
		if (withActivity) {
			const match = e.exercise ? (catalog.get(e.exercise.trim().toLowerCase()) ?? null) : null;
			values.push(
				// Store the catalogue's spelling when we recognise the name, so the coach's
				// "last time you benched" matches across weeks of differently worded logs.
				match?.name ?? e.exercise ?? null,
				match?.id ?? null,
				e.equipment ?? null,
				e.category ?? match?.category ?? null,
				e.muscle_groups ?? match?.primary_muscles ?? null,
				e.sets ?? null,
				e.reps ?? null,
				e.load_lb ?? null,
				e.duration_min ?? null,
				e.distance_mi ?? null,
				// NOT NULL in the schema: a row with no stated source was typed by the user.
				e.source ?? "manual",
				e.confidence ?? null
			);
		}
		const placeholders = values.map((v) => {
			params.push(v);
			return `$${params.length}`;
		});
		return `(${placeholders.join(", ")})`;
	});
	const { rows } = await db.query(
		`INSERT INTO ${KINDS[kind]} (${columns.join(", ")}) VALUES ${tuples.join(", ")} RETURNING *`,
		params
	);
	return rows;
}

export async function updateEntry(db: Queryable, userId: string, kind: Kind, id: string, patch: EntryPatch) {
	const allowed: string[] =
		kind === "meals"
			? ["description", "kcal", "logged_at", ...MACRO_COLUMNS]
			: ["description", "kcal", "logged_at", ...ACTIVITY_PATCH_COLUMNS];
	// Read before writing only when there is a correction to file: this is the DayLog's
	// "tap → make a change" and not the hot path (migration 0015).
	const said = patch.correction_instruction;
	const before = said ? await getEntry(db, userId, kind, id) : null;
	const sets: string[] = [];
	const params: unknown[] = [userId, id];
	for (const [key, value] of Object.entries(patch)) {
		if (!allowed.includes(key)) continue;
		// source is NOT NULL; clearing it is not a correction anyone means to make.
		if (key === "source" && value === null) continue;
		// exercise is assigned below, together with the exercise_id it resolves to.
		if (kind === "movement" && key === "exercise") continue;
		params.push(value);
		sets.push(`${key} = $${params.length}`);
	}
	// Correcting the exercise re-points exercise_id (or clears it, when the new name is not
	// in the catalogue). category and muscle_groups are left as they are unless the patch
	// names them: an edit should change what was asked for and nothing else.
	if (kind === "movement" && patch.exercise !== undefined) {
		const match = patch.exercise
			? (await lookupExercises(db, [patch.exercise])).get(patch.exercise.trim().toLowerCase())
			: undefined;
		params.push(match?.name ?? patch.exercise ?? null);
		sets.push(`exercise = $${params.length}`);
		params.push(match?.id ?? null);
		sets.push(`exercise_id = $${params.length}`);
	}
	if (sets.length === 0) return getEntry(db, userId, kind, id);
	const { rows } = await db.query(
		`UPDATE ${KINDS[kind]} SET ${sets.join(", ")} WHERE user_id = $1 AND id = $2 RETURNING *`,
		params
	);
	const after = rows[0] ?? null;
	// The told change, kept beside the row it changed. Written after the update and only
	// for what actually moved — a correction that changed nothing is not history.
	if (said && before && after) {
		await recordCorrection(
			db,
			userId,
			kind === "meals" ? { mealId: id } : { activityId: id },
			said,
			diffFields(
				before as Record<string, unknown>,
				after as Record<string, unknown>,
				kind === "meals" ? CORRECTABLE_FIELDS.meal : CORRECTABLE_FIELDS.activity
			)
		);
	}
	return after;
}

export async function deleteEntry(db: Queryable, userId: string, kind: Kind, id: string): Promise<boolean> {
	const { rowCount } = await db.query(`DELETE FROM ${KINDS[kind]} WHERE user_id = $1 AND id = $2`, [userId, id]);
	return (rowCount ?? 0) > 0;
}

export async function listWeights(db: Queryable, userId: string, q: RangeQuery) {
	const params: unknown[] = [userId];
	const range = rangeSql(q, params, 1);
	const limit = q.limit ? `LIMIT ${q.limit}` : "";
	const { rows } = await db.query(
		`SELECT * FROM weight_logs WHERE user_id = $1 ${range}
		 ORDER BY logged_at ${q.order === "asc" ? "ASC" : "DESC"} ${limit}`,
		params
	);
	return rows;
}

export async function getWeight(db: Queryable, userId: string, id: string) {
	const { rows } = await db.query(`SELECT * FROM weight_logs WHERE user_id = $1 AND id = $2`, [userId, id]);
	return rows[0] ?? null;
}

export async function insertWeights(db: Queryable, userId: string, weights: NewWeight[]) {
	if (weights.length === 0) return [];
	const params: unknown[] = [];
	const tuples = weights.map((w) => {
		params.push(userId, w.weight_lb, w.logged_at ?? new Date().toISOString());
		const n = params.length;
		return `($${n - 2}, $${n - 1}, $${n})`;
	});
	const { rows } = await db.query(
		`INSERT INTO weight_logs (user_id, weight_lb, logged_at) VALUES ${tuples.join(", ")} RETURNING *`,
		params
	);
	return rows;
}

export async function updateWeight(db: Queryable, userId: string, id: string, patch: WeightPatch) {
	const sets: string[] = [];
	const params: unknown[] = [userId, id];
	const said = patch.correction_instruction;
	const before = said ? await getWeight(db, userId, id) : null;
	for (const [key, value] of Object.entries(patch)) {
		if (key !== "weight_lb" && key !== "logged_at") continue;
		params.push(value);
		sets.push(`${key} = $${params.length}`);
	}
	if (sets.length === 0) return getWeight(db, userId, id);
	const { rows } = await db.query(
		`UPDATE weight_logs SET ${sets.join(", ")} WHERE user_id = $1 AND id = $2 RETURNING *`,
		params
	);
	const after = rows[0] ?? null;
	if (said && before && after) {
		await recordCorrection(
			db,
			userId,
			{ weightId: id },
			said,
			diffFields(before as Record<string, unknown>, after as Record<string, unknown>, CORRECTABLE_FIELDS.weight)
		);
	}
	return after;
}

export async function deleteWeight(db: Queryable, userId: string, id: string): Promise<boolean> {
	const { rowCount } = await db.query(`DELETE FROM weight_logs WHERE user_id = $1 AND id = $2`, [userId, id]);
	return (rowCount ?? 0) > 0;
}

/** Profile row, created on first read if the signup hook somehow did not run. */
export async function getProfile(db: Queryable, userId: string) {
	const { rows } = await db.query(
		`INSERT INTO profiles (id) VALUES ($1) ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id RETURNING *`,
		[userId]
	);
	return rows[0];
}

/**
 * Merge a patch into the profile, dating every field it touches. concept-v2 §Goals and
 * profile: "each field with the date it was last stated, so the coach knows how old a plan
 * is" — which only works if every path that writes a field also stamps it. `stated_at` is
 * merged, never replaced, so patching one field does not erase the dates of the others.
 */
export async function updateProfile(db: Queryable, userId: string, patch: ProfilePatch) {
	await getProfile(db, userId);
	const sets: string[] = [];
	const params: unknown[] = [userId];
	const stated: Record<string, string> = {};
	const now = new Date().toISOString();
	for (const [key, value] of Object.entries(patch)) {
		// `reference_loads` is the one jsonb column here; pg would otherwise send the array
		// as a Postgres array literal, which jsonb refuses.
		const json = key === "reference_loads";
		params.push(json ? JSON.stringify(value) : value);
		sets.push(`${key} = $${params.length}${json ? "::jsonb" : ""}`);
		stated[key] = now;
	}
	params.push(JSON.stringify(stated));
	sets.push(`stated_at = stated_at || $${params.length}::jsonb`);
	const { rows } = await db.query(`UPDATE profiles SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
	return rows[0];
}
