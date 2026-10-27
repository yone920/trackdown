import type pg from "pg";
import { DEFAULT_LOAD_DIRECTION, type LoadDirection } from "../../db/exercises.js";
import { muscleByKey, type CandidateExercise } from "../recommendation/index.js";
import type { PriorLoad } from "./rules.js";

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

/**
 * Every catalogue exercise for a set of muscle tokens — not filtered to "never logged"
 * the way `introductionCandidates` below is. This is the pool `services/recommendation`'s
 * `eligiblePool()` filters down by rotation, equipment, and media; the query's job is only
 * to say what exists for the muscle at all, with the two facts that filter needs.
 */
export async function catalogCandidatesFor(db: Queryable, tokens: readonly string[]): Promise<CandidateExercise[]> {
	if (tokens.length === 0) return [];
	const { rows } = await db.query<{ name: string; equipment: string[] | null; media_count: number | null }>(
		`SELECT name, equipment, media_count
		   FROM exercise_catalog
		  WHERE category IN ('strength', 'cardio')
		    AND primary_muscles && $1::text[]`,
		[tokens]
	);
	return rows.map((row) => ({
		name: row.name,
		hasMedia: (row.media_count ?? 0) > 0,
		equipment: (row.equipment ?? []).map((item) => item.trim().toLowerCase()),
	}));
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
	// Ledger keys ("upper_back", "abs") back into the catalogue's own tags, via the registry.
	const tokens = [...new Set(muscles.flatMap((key) => muscleByKey(key)?.tokens ?? []))];

	const { rows } = await db.query<{ name: string }>(
		`SELECT c.name
		   FROM exercise_catalog c
		  WHERE c.category IN ('strength', 'cardio')
		    AND NOT EXISTS (
		          SELECT 1 FROM activities a
		           WHERE a.user_id = $1
		             AND (
		                   a.exercise_id = c.id
		                OR lower(a.exercise) = lower(c.name)
		                -- Rows written before the catalogue resolved names, or under a
		                -- wording the catalogue lists as an alias ("lat pull down").
		                OR lower(a.exercise) = ANY (ARRAY(SELECT lower(alias) FROM unnest(c.aliases) AS alias))
		             )
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

/** How far back a prior load is looked for. Older than this is a different lifter. */
export const PRIOR_LOAD_DAYS = 730;
/** One per exercise, newest first — more than this is not a returning lifter's menu. */
export const MAX_PRIOR_LOADS = 40;

/**
 * The last loaded session of each exercise this user has ever logged, newest first
 * (services/coach/rules.ts §PriorLoad). The feature window is four weeks; a lifter back
 * from a month off has nothing in it, and without this the restart rule — "one step lighter
 * than the last logged load" — had no load to step down from. Only rows with a load count:
 * a bodyweight or cardio session has no number to come back to.
 *
 * Within an exercise the top set of its newest day wins (heaviest, then latest), the same
 * reading services/training/history.ts gives the Progress tab. Names are grouped
 * case-insensitively; the stored spelling of the newest row is the one returned.
 */
export async function priorLoads(
	db: Queryable,
	userId: string,
	{ now = new Date(), limit = MAX_PRIOR_LOADS }: { now?: Date; limit?: number } = {}
): Promise<PriorLoad[]> {
	const { rows } = await db.query<{
		exercise: string;
		load_lb: string | number;
		sets: number | null;
		reps: number | null;
		logged_at: string | Date;
	}>(
		`WITH ranked AS (
		   SELECT exercise, load_lb, sets, reps, logged_at,
		          row_number() OVER (
		            PARTITION BY lower(exercise)
		            ORDER BY (logged_at AT TIME ZONE 'UTC')::date DESC, load_lb DESC, logged_at DESC
		          ) AS rn
		     FROM activities
		    WHERE user_id = $1
		      AND exercise IS NOT NULL
		      AND load_lb IS NOT NULL
		      AND logged_at >= $2::timestamptz - make_interval(days => $3)
		 )
		 SELECT exercise, load_lb, sets, reps, logged_at
		   FROM ranked
		  WHERE rn = 1
		  ORDER BY logged_at DESC
		  LIMIT $4`,
		[userId, now.toISOString(), PRIOR_LOAD_DAYS, limit]
	);
	const DAY_MS = 86_400_000;
	return rows.map((row) => ({
		exercise: row.exercise,
		load_lb: Number(row.load_lb),
		sets: row.sets,
		reps: row.reps,
		days_since: Math.max(0, Math.floor((now.getTime() - new Date(row.logged_at).getTime()) / DAY_MS)),
	}));
}
