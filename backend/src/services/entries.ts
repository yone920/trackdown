import type pg from "pg";
import { z } from "zod";

// Data access for the four user-owned tables. Every function takes the session's
// userId and scopes the SQL by it — this is what Supabase's RLS policies used to do.

export const KINDS = { meals: "meals", movement: "calorie_expenditure" } as const;
export type Kind = keyof typeof KINDS;
export function isKind(value: string): value is Kind {
	return value in KINDS;
}

type Queryable = pg.Pool | pg.PoolClient;

const isoDate = z.string().datetime({ offset: true });
const macro = z.number().min(0).nullable();

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
});
export type NewEntry = z.infer<typeof NewEntry>;

export const EntryPatch = z
	.object({
		description: z.string().trim().min(1).max(500),
		kcal: z.number().int().min(0),
		protein_g: macro,
		carbs_g: macro,
		fat_g: macro,
		fiber_g: macro,
		logged_at: isoDate,
	})
	.partial()
	.refine((patch) => Object.keys(patch).length > 0, { message: "Empty patch." });
export type EntryPatch = z.infer<typeof EntryPatch>;

export const NewWeight = z.object({
	weight_lb: z.number().positive().max(2000),
	logged_at: isoDate.optional(),
});
export type NewWeight = z.infer<typeof NewWeight>;

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
	})
	.partial()
	.refine((patch) => Object.keys(patch).length > 0, { message: "Empty patch." });
export type ProfilePatch = z.infer<typeof ProfilePatch>;

const MACRO_COLUMNS = ["protein_g", "carbs_g", "fat_g", "fiber_g"] as const;

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
	const columns = ["user_id", "description", "kcal", "logged_at", ...(withMacros ? MACRO_COLUMNS : [])];
	const params: unknown[] = [];
	const tuples = entries.map((e) => {
		const values: unknown[] = [userId, e.description, e.kcal, e.logged_at ?? new Date().toISOString()];
		if (withMacros) values.push(e.protein_g ?? null, e.carbs_g ?? null, e.fat_g ?? null, e.fiber_g ?? null);
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
	const allowed = kind === "meals" ? ["description", "kcal", "logged_at", ...MACRO_COLUMNS] : ["description", "kcal", "logged_at"];
	const sets: string[] = [];
	const params: unknown[] = [userId, id];
	for (const [key, value] of Object.entries(patch)) {
		if (!allowed.includes(key)) continue;
		params.push(value);
		sets.push(`${key} = $${params.length}`);
	}
	if (sets.length === 0) return getEntry(db, userId, kind, id);
	const { rows } = await db.query(
		`UPDATE ${KINDS[kind]} SET ${sets.join(", ")} WHERE user_id = $1 AND id = $2 RETURNING *`,
		params
	);
	return rows[0] ?? null;
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

export async function updateProfile(db: Queryable, userId: string, patch: ProfilePatch) {
	await getProfile(db, userId);
	const sets: string[] = [];
	const params: unknown[] = [userId];
	for (const [key, value] of Object.entries(patch)) {
		params.push(value);
		sets.push(`${key} = $${params.length}`);
	}
	const { rows } = await db.query(`UPDATE profiles SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, params);
	return rows[0];
}
