import type pg from "pg";
import { getProfile } from "./entries.js";
import { currentPlaceSummary, type PlaceSummary } from "./places.js";

// The plan (docs/build-plan.md §WP4; concept-v2 §Goals and profile — "the Profile screen
// renders the plan organised … each field with the date it was last stated").
//
// This used to also compute the day's calorie/macro targets (TDEE, what to eat today) —
// removed along with meal logging, since there is no more "calories eaten" to budget
// against. `goal_pace` survives: goals/proposal.ts uses it to pace every goal's projected
// timeline (body-weight goals, exercise_load plate steps, …), not just a calorie deficit.

type Queryable = pg.Pool | pg.PoolClient;

export type GoalPace = "gentle" | "standard" | "aggressive";

/** The profile's stated goal pace, for goals/proposal.ts's timeline projections. */
export async function loadGoalPace(db: Queryable, userId: string): Promise<GoalPace | null> {
	const { rows } = await db.query<{ goal_pace: GoalPace | null }>(`SELECT goal_pace FROM profiles WHERE id = $1`, [
		userId,
	]);
	return rows[0]?.goal_pace ?? null;
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
}

/** The profile as `GET /api/profile` returns it. */
export async function profileView(db: Queryable, userId: string): Promise<ProfileView> {
	const profile = (await getProfile(db, userId)) as Record<string, unknown>;
	return {
		...profile,
		place: await currentPlaceSummary(db, userId),
	};
}
