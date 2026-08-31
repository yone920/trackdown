import type pg from "pg";
import { DEFAULT_LOAD_DIRECTION, type LoadDirection } from "../../db/exercises.js";

// The two catalogue facts the progression reads, in one place because two callers now read
// them: the coach (services/coach/coach.ts) and the training board
// (services/training/board.ts). One query, because they are one row.
//
//   * `equipment` — so a stack steps by percentage rather than by plate.
//   * `load_direction` — so an assisted machine progresses *downwards* (migration 0013).
//
// Extracted from coach.ts unchanged when the board was built: the board's next step has to
// be the coach's next step, and two lookups that could disagree is the first way that stops
// being true.

type Queryable = pg.Pool | pg.PoolClient;

export interface CatalogFacts {
	equipment: Record<string, string[]>;
	loadDirection: Record<string, LoadDirection>;
}

export const EMPTY_CATALOG_FACTS: CatalogFacts = { equipment: {}, loadDirection: {} };

/** Equipment and load direction for a set of exercise names, keyed by lower-cased name. */
export async function catalogFactsFor(db: Queryable, names: readonly string[]): Promise<CatalogFacts> {
	const wanted = [...new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))];
	if (wanted.length === 0) return { equipment: {}, loadDirection: {} };

	const { rows } = await db.query<{ name: string; equipment: string[] | null; load_direction: LoadDirection }>(
		`SELECT name, equipment, load_direction FROM exercise_catalog WHERE lower(name) = ANY($1::text[])`,
		[wanted]
	);
	return {
		equipment: Object.fromEntries(rows.map((row) => [row.name.trim().toLowerCase(), row.equipment ?? []])),
		loadDirection: Object.fromEntries(
			rows.map((row) => [row.name.trim().toLowerCase(), row.load_direction ?? DEFAULT_LOAD_DIRECTION])
		),
	};
}
