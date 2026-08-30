import type pg from "pg";
import { localDay } from "../localTime.js";
import type { FusionKind } from "./schema.js";

// Everything the fusion prompt is told about the user before it reads their photo.
// Gathered with SQL, never remembered by the model (docs/concept-v2.md §Principles:
// "facts are computed, advice is generated").
//
// Why each piece is here:
//   * today's items    — "same machine as before, 45 this time" has to resolve.
//   * the vocabulary   — the catalogue plus what this user actually says, so names stay
//                        consistent across weeks and the coach's "no pulling since
//                        Monday" is answerable.
//   * active goals     — a log is judged against them later; the model should not invent
//                        a second goal when the user restates one they already have.
//   * units            — pounds, always (docs/agent-brief.md §Units).

type Queryable = pg.Pool | pg.PoolClient;

// The local-day arithmetic moved to services/localTime.ts in WP3 (the day model, the close
// job and the week all need it). Re-exported so this module's callers did not have to move.
export { localDay, type LocalDay } from "../localTime.js";

/** Catalogue names cost prompt tokens; four aliases each is enough to resolve gym slang. */
const MAX_ALIASES_PER_EXERCISE = 4;
const RECENT_EXERCISE_DAYS = 90;
const MAX_RECENT_EXERCISES = 40;

export interface TodayActivity {
	exercise: string | null;
	description: string;
	sets: number | null;
	reps: number | null;
	load_lb: number | null;
	duration_min: number | null;
	kcal: number | null;
	logged_at: string;
}

export interface TodayMeal {
	description: string;
	kcal: number | null;
	protein_g: number | null;
	logged_at: string;
}

export interface ActiveGoal {
	id: string;
	kind: string;
	title: string;
	priority: number;
	metrics: unknown;
}

export interface FusionContext {
	/** The user's local calendar date and clock time — day boundaries are their midnight. */
	localDate: string;
	localTime: string;
	tzOffsetMin: number;
	units: "lb";
	todayActivities: TodayActivity[];
	todayMeals: TodayMeal[];
	todayWeights: number[];
	/** Exercise names this user has actually logged, most recent first. */
	recentExercises: string[];
	catalog: { name: string; aliases: string[] }[];
	goals: ActiveGoal[];
	/** What the app thinks the user was doing ("meal", "goal"); a hint, never an order. */
	kindHint: FusionKind | null;
}

export interface BuildContextOptions {
	/** The phone's clock, when it sent one; otherwise the server's. */
	clientTime?: Date;
	tzOffsetMin?: number;
	kindHint?: FusionKind | null;
}

export async function buildFusionContext(
	db: Queryable,
	userId: string,
	{ clientTime, tzOffsetMin = 0, kindHint = null }: BuildContextOptions = {}
): Promise<FusionContext> {
	const day = localDay(clientTime ?? new Date(), tzOffsetMin);
	const range = [day.startUtc.toISOString(), day.endUtc.toISOString()];

	// Sequential: these may share one transaction client, which cannot run queries
	// concurrently. Five small indexed reads — the model call dwarfs them.
	const activities = await db.query<TodayActivity>(
		`SELECT exercise, description, sets, reps, load_lb, duration_min, kcal, logged_at
		   FROM activities WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3
		   ORDER BY logged_at`,
		[userId, ...range]
	);
	const meals = await db.query<TodayMeal>(
		`SELECT description, kcal, protein_g, logged_at
		   FROM meals WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3
		   ORDER BY logged_at`,
		[userId, ...range]
	);
	const weights = await db.query<{ weight_lb: number }>(
		`SELECT weight_lb FROM weight_logs WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3
		   ORDER BY logged_at`,
		[userId, ...range]
	);
	const recent = await db.query<{ exercise: string }>(
		`SELECT exercise FROM activities
		  WHERE user_id = $1 AND exercise IS NOT NULL
		    AND logged_at > NOW() - make_interval(days => $2)
		  GROUP BY exercise ORDER BY MAX(logged_at) DESC LIMIT $3`,
		[userId, RECENT_EXERCISE_DAYS, MAX_RECENT_EXERCISES]
	);
	const catalog = await db.query<{ name: string; aliases: string[] }>(
		`SELECT name, aliases FROM exercise_catalog ORDER BY name`
	);
	const goals = await db.query<ActiveGoal>(
		`SELECT id, kind, title, metrics, priority FROM goals
		  WHERE user_id = $1 AND status = 'active'
		  ORDER BY priority, active_from DESC LIMIT 5`,
		[userId]
	);

	return {
		localDate: day.date,
		localTime: day.time,
		tzOffsetMin,
		units: "lb",
		todayActivities: activities.rows,
		todayMeals: meals.rows,
		todayWeights: weights.rows.map((row) => row.weight_lb),
		recentExercises: recent.rows.map((row) => row.exercise),
		catalog: catalog.rows.map((row) => ({
			name: row.name,
			aliases: row.aliases.slice(0, MAX_ALIASES_PER_EXERCISE),
		})),
		goals: goals.rows,
		kindHint,
	};
}
