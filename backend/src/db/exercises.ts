import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

// The exercise catalogue: the shared vocabulary of the fusion prompt ("db bench" →
// "Dumbbell Bench Press") and the coach ("no pulling movement since Monday").
//
// backend/data/exercises.json is the source of truth; this seeder upserts it by name, so
// running it twice changes nothing and editing the JSON is how the catalogue grows. It is
// run by `npm run db:migrate` after the migrations, by `npm run db:seed-exercises` on its
// own, and by the test database helper.

export const CATEGORIES = ["cardio", "strength", "mobility", "other"] as const;
export type ExerciseCategory = (typeof CATEGORIES)[number];

/**
 * Which way the number on the stack points (migration 0013). On almost everything the load
 * is what you are lifting: more of it is harder. On an assisted machine it is the help the
 * machine gives, so more of it is *easier* and progress is the number coming down. The
 * coach's progression and the day's delta both read this; it is a fact about the movement,
 * which is why it lives in the catalogue and not on the log.
 */
export const LOAD_DIRECTIONS = ["resistance", "assistance"] as const;
export type LoadDirection = (typeof LOAD_DIRECTIONS)[number];
export const DEFAULT_LOAD_DIRECTION: LoadDirection = "resistance";

export interface CatalogExercise {
	name: string;
	aliases: string[];
	category: ExerciseCategory;
	primary_muscles: string[];
	secondary_muscles: string[];
	equipment: string[];
	load_direction: LoadDirection;
}

export const EXERCISES_FILE = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../data/exercises.json"
);

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Reads and validates data/exercises.json. Throws with the offending entry's index. */
export async function loadExerciseCatalog(file: string = EXERCISES_FILE): Promise<CatalogExercise[]> {
	const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
	if (!Array.isArray(parsed)) throw new Error(`${file}: expected a JSON array of exercises`);

	const seen = new Set<string>();
	return parsed.map((entry, index) => {
		const where = `${file}[${index}]`;
		if (typeof entry !== "object" || entry === null) throw new Error(`${where}: not an object`);
		const e = entry as Record<string, unknown>;
		if (typeof e.name !== "string" || e.name.trim() === "") throw new Error(`${where}: missing name`);
		if (!CATEGORIES.includes(e.category as ExerciseCategory)) {
			throw new Error(`${where} (${e.name}): category must be one of ${CATEGORIES.join(", ")}`);
		}
		for (const key of ["aliases", "primary_muscles", "secondary_muscles", "equipment"] as const) {
			if (!isStringArray(e[key])) throw new Error(`${where} (${e.name}): ${key} must be an array of strings`);
		}
		// Optional, and absent on all but a handful: a load that is resistance is the rule,
		// so the JSON only says so when it is not.
		if (e.load_direction !== undefined && !LOAD_DIRECTIONS.includes(e.load_direction as LoadDirection)) {
			throw new Error(`${where} (${e.name}): load_direction must be one of ${LOAD_DIRECTIONS.join(", ")}`);
		}
		const key = e.name.trim().toLowerCase();
		if (seen.has(key)) throw new Error(`${where}: duplicate name "${e.name}"`);
		seen.add(key);
		return {
			name: e.name.trim(),
			// Aliases are matched lower-cased, so normalise once here rather than in every query.
			aliases: (e.aliases as string[]).map((alias) => alias.trim().toLowerCase()),
			category: e.category as ExerciseCategory,
			primary_muscles: e.primary_muscles as string[],
			secondary_muscles: e.secondary_muscles as string[],
			equipment: e.equipment as string[],
			load_direction: (e.load_direction as LoadDirection | undefined) ?? DEFAULT_LOAD_DIRECTION,
		};
	});
}

export interface SeedReport {
	inserted: number;
	updated: number;
	total: number;
}

/**
 * Idempotent upsert by name. Rows the JSON no longer lists are left alone — an activity
 * may still reference one, and dropping catalogue entries is not a migration's job.
 */
export async function seedExercises(
	client: pg.Client | pg.PoolClient | pg.Pool,
	exercises?: CatalogExercise[]
): Promise<SeedReport> {
	const catalog = exercises ?? (await loadExerciseCatalog());
	if (catalog.length === 0) return { inserted: 0, updated: 0, total: 0 };

	// One jsonb payload rather than parallel arrays: text[] columns of different lengths
	// cannot travel as a rectangular multidimensional array.
	const { rows } = await client.query<{ inserted: boolean }>(
		`INSERT INTO exercise_catalog (name, aliases, category, primary_muscles, secondary_muscles, equipment, load_direction)
		 SELECT
			e->>'name',
			ARRAY(SELECT jsonb_array_elements_text(e->'aliases')),
			e->>'category',
			ARRAY(SELECT jsonb_array_elements_text(e->'primary_muscles')),
			ARRAY(SELECT jsonb_array_elements_text(e->'secondary_muscles')),
			ARRAY(SELECT jsonb_array_elements_text(e->'equipment')),
			COALESCE(e->>'load_direction', 'resistance')
		 FROM jsonb_array_elements($1::jsonb) AS e
		 ON CONFLICT (name) DO UPDATE SET
			aliases = EXCLUDED.aliases,
			category = EXCLUDED.category,
			primary_muscles = EXCLUDED.primary_muscles,
			secondary_muscles = EXCLUDED.secondary_muscles,
			equipment = EXCLUDED.equipment,
			load_direction = EXCLUDED.load_direction,
			updated_at = NOW()
		 RETURNING (xmax = 0) AS inserted`,
		[JSON.stringify(catalog)]
	);

	const inserted = rows.filter((row) => row.inserted).length;
	return { inserted, updated: rows.length - inserted, total: catalog.length };
}
