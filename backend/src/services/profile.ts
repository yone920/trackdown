import type pg from "pg";
import { boundsOf, localDay, type IsoDate } from "./localTime.js";
import { computeDayTargets, type DayTargets, type GoalPace, type TargetSource, type TdeeProfile } from "./tdee.js";
import { getProfile } from "./entries.js";
import { currentPlaceSummary, type PlaceSummary } from "./places.js";

// The plan, and what it works out to (docs/build-plan.md §WP4; concept-v2 §Goals and
// profile — "the Profile screen renders the plan organised … each field with the date it
// was last stated").
//
// `GET /api/profile` returns the row *and* the numbers derived from it: TDEE, what to eat
// today, the macros. The app used to compute those itself from `lib/tdee.ts`; two
// implementations of "what should I eat" is how the phone and the server start disagreeing
// about the same day, so the server answers and the app renders (WP6 deletes the app-side
// copy).

type Queryable = pg.Pool | pg.PoolClient;

/** The profile columns the calorie model reads, plus the plan fields it does not. */
export interface PlanProfile extends TdeeProfile {
	eatback: string;
	goal_pace: GoalPace | null;
}

export interface ProfileTargets extends DayTargets {
	profile: PlanProfile | null;
	/** The most recent weigh-in on or before the day — the body the TDEE is computed for. */
	weight_lb: number | null;
}

/**
 * The derived targets for one user on one day. `weightLb` comes from their last weigh-in:
 * the target moves with the body it is for, and without one there is no TDEE at all
 * (`daily_calorie_target` is then the fallback, stated or defaulted — services/tdee.ts).
 */
export async function loadTargets(
	db: Queryable,
	userId: string,
	date: IsoDate,
	tzOffsetMin: number
): Promise<ProfileTargets> {
	const { startUtc, endUtc } = boundsOf(date, tzOffsetMin);
	const profile =
		(
			await db.query<PlanProfile>(
				`SELECT sex, birth_year, height_cm, activity_level, goal_pace, goal_weight_lb,
				        pregnant_or_lactating, health_concern, daily_calorie_target, protein_g,
				        carbs_max_g, eatback, stated_at
				   FROM profiles WHERE id = $1`,
				[userId]
			)
		).rows[0] ?? null;

	const weight =
		(
			await db.query<{ weight_lb: number }>(
				`SELECT weight_lb FROM weight_logs WHERE user_id = $1 AND logged_at < $2
				  ORDER BY logged_at DESC LIMIT 1`,
				[userId, endUtc.toISOString()]
			)
		).rows[0]?.weight_lb ?? null;

	return { ...computeDayTargets(profile, weight, startUtc), profile, weight_lb: weight };
}

export interface ProfileView {
	/** Every column of `profiles`, as the shipped app already reads it. */
	[column: string]: unknown;
	/**
	 * Where they train now and how much has been seen there (migration 0012) — the Goals
	 * screen's "New Millennium · 14 machines seen". Null until they name a place, which is
	 * the state most accounts are in.
	 */
	place: PlaceSummary | null;
	targets: {
		/** Maintenance calories. null when the profile cannot produce one. */
		tdee: number | null;
		/** What to eat today: TDEE − the pace's deficit, floored. */
		eat_target: number | null;
		/** eat_target − TDEE; negative is a deficit. */
		deficit: number | null;
		safe_floor: number | null;
		protein_g: number | null;
		carbs_g: number | null;
		fat_g: number | null;
		fiber_g: number | null;
		/**
		 * Provenance, not arithmetic: "derived" from the TDEE inputs, "stated" because the
		 * user said a number, "default" because the column's DEFAULT is all there is, or
		 * "none" when there is no target at all (services/tdee.ts §TargetSource).
		 */
		source: TargetSource;
		/** True when the profile excludes the user from deficit advice (age, BMI, pregnancy). */
		tracking_only: boolean;
		/** How much of what they earn the ring lets them eat back. */
		eatback: string;
		/** The weight the numbers above were computed for, and the day they are for. */
		weight_lb: number | null;
		date: IsoDate;
	};
}

/** The profile as `GET /api/profile` returns it: the row, plus what it works out to. */
export async function profileView(
	db: Queryable,
	userId: string,
	{ tzOffsetMin = 0, now = new Date() }: { tzOffsetMin?: number; now?: Date } = {}
): Promise<ProfileView> {
	const profile = (await getProfile(db, userId)) as Record<string, unknown>;
	const date = localDay(now, tzOffsetMin).date;
	const targets = await loadTargets(db, userId, date, tzOffsetMin);
	return {
		...profile,
		place: await currentPlaceSummary(db, userId),
		targets: {
			tdee: targets.tdee,
			eat_target: targets.target,
			deficit: targets.deficit,
			safe_floor: targets.safeFloor,
			protein_g: targets.macros?.protein_g ?? null,
			carbs_g: targets.macros?.carbs_g ?? null,
			fat_g: targets.macros?.fat_g ?? null,
			fiber_g: targets.macros?.fiber_g ?? null,
			source: targets.source,
			tracking_only: targets.trackingOnly,
			eatback: (profile.eatback as string) ?? "half",
			weight_lb: targets.weight_lb,
			date,
		},
	};
}
