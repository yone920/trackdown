import type pg from "pg";
import { DEFAULT_LOAD_DIRECTION, type LoadDirection } from "../../db/exercises.js";
import { LEDGER_MUSCLES } from "./features.js";

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
	/**
	 * What each movement is mostly FOR, by lower-cased name — the catalogue's first primary
	 * muscle, which is its own ordering and not ours to reinterpret.
	 *
	 * The recovery rule needs it. A muscle trained inside 48 hours is not today's primary
	 * target, and until 2026-09-03 that gated only the day's stated targets: the plan could
	 * name quads and glutes and then prescribe a deadlift, which is a hamstring and
	 * lower-back movement done the morning after a deadlift session (user field report).
	 * Secondary overlap stays allowed — nobody squats without hamstrings — so it is the
	 * PRIMARY that decides (services/coach/rules.ts §recoveringExercises).
	 */
	primaryMuscle: Record<string, string>;
}

export const EMPTY_CATALOG_FACTS: CatalogFacts = { equipment: {}, loadDirection: {}, primaryMuscle: {} };

/** Equipment and load direction for a set of exercise names, keyed by lower-cased name. */
export async function catalogFactsFor(db: Queryable, names: readonly string[]): Promise<CatalogFacts> {
	const wanted = [...new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))];
	if (wanted.length === 0) return { equipment: {}, loadDirection: {}, primaryMuscle: {} };

	const { rows } = await db.query<{
		name: string;
		equipment: string[] | null;
		load_direction: LoadDirection;
		primary_muscles: string[] | null;
	}>(
		`SELECT name, equipment, load_direction, primary_muscles FROM exercise_catalog WHERE lower(name) = ANY($1::text[])`,
		[wanted]
	);
	return {
		equipment: Object.fromEntries(rows.map((row) => [row.name.trim().toLowerCase(), row.equipment ?? []])),
		loadDirection: Object.fromEntries(
			rows.map((row) => [row.name.trim().toLowerCase(), row.load_direction ?? DEFAULT_LOAD_DIRECTION])
		),
		// The FIRST primary muscle: the catalogue lists them in its own order and that order
		// is the answer to "what is this movement for" (lib/progress-sections.ts uses the
		// same rule to group the lifts board). A row with none contributes nothing, and the
		// caller falls back to what the log itself recorded.
		primaryMuscle: Object.fromEntries(
			rows
				.filter((row) => (row.primary_muscles ?? []).length > 0)
				.map((row) => [row.name.trim().toLowerCase(), (row.primary_muscles as string[])[0] as string])
		),
	};
}

/** How many names the prompt is offered to introduce from. Ten is a choice; forty is a list. */
export const MAX_INTRODUCTION_CANDIDATES = 10;

/**
 * Catalogue entries this user has NEVER logged — the pool a plan's one introduction is drawn
 * from (user decision 2026-08-31: "each plan may include at most one exercise the user has
 * never logged, chosen from the catalogue, prefer entries with media").
 *
 * Three preferences, in order, and each is there for a reason:
 *
 *   1. **Never logged, all time.** Not "not in four weeks" — an exercise someone did in
 *      January is not new to them, and calling it new is the app claiming to know less than
 *      it does. Matched on `exercise_id` and on the name, since a row may carry either.
 *   2. **A muscle the ledger says is owed**, when any is. An introduction is a variety
 *      device; pointing it at a debt makes it a coverage device as well.
 *   3. **Entries with photographs first.** The app draws a "new to you" chip that opens the
 *      exercise sheet, and a sheet with two pictures and numbered steps is the difference
 *      between an introduction and a name the user has to go and google.
 *
 * `mobility` and `other` are excluded: the finisher covers stretching, and "Other Activity"
 * is not a movement anybody is introduced to.
 */
export async function introductionCandidates(
	db: Queryable,
	userId: string,
	{ muscles = [], limit = MAX_INTRODUCTION_CANDIDATES }: { muscles?: readonly string[]; limit?: number } = {}
): Promise<string[]> {
	// Ledger keys ("upper_back", "core") back into the catalogue's own tags.
	const tokens = [
		...new Set(
			muscles.flatMap((key) => LEDGER_MUSCLES.find((entry) => entry.key === key)?.tokens ?? [])
		),
	];

	const { rows } = await db.query<{ name: string }>(
		`SELECT c.name
		   FROM exercise_catalog c
		  WHERE c.category IN ('strength', 'cardio')
		    AND NOT EXISTS (
		          SELECT 1 FROM activities a
		           WHERE a.user_id = $1
		             AND (a.exercise_id = c.id OR lower(a.exercise) = lower(c.name))
		        )
		  ORDER BY
		    -- A debt first, when there is one; then something we can show a picture of.
		    (CASE WHEN $2::text[] = '{}'::text[] THEN 0
		          WHEN c.primary_muscles && $2::text[] THEN 0 ELSE 1 END),
		    (CASE WHEN c.media_count > 0 THEN 0 ELSE 1 END),
		    c.name
		  LIMIT $3`,
		[userId, tokens, limit]
	);
	return rows.map((row) => row.name);
}
