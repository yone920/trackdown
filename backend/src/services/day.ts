import type pg from "pg";
import {
	addDays,
	boundsOf,
	daysBetween,
	localDateOf,
	localDay,
	localMinutesOf,
	type IsoDate,
} from "./localTime.js";
import { attachHealthWorkouts, buildBlocks, healthWorkoutAsActivity } from "./day/blocks.js";
import { withDeltas, type DeltaVsLast } from "./day/deltas.js";
import { buildArc, eatingPattern, expectedItems, slotForMinutes, type ArcEvent, type ExpectedItem } from "./day/narrative.js";
import type { Block, DayActivity, DayMeal, DayWeight, HealthWorkout, MealSlot } from "./day/types.js";
import { computeMeasure, type DayFacts, type FactActivity, type FactHealthSample, type FactMeal, type FactWeight } from "./goals/measures.js";
import { goalInvolvesCalories, judgeDay, verdictWords, type DayStatus, type GoalRow, type Verdict } from "./goals/verdict.js";
import { computeDayTargets, type DayTargets, type TdeeProfile } from "./tdee.js";

// The day model (docs/build-plan.md §WP3). One function answers "what happened on this
// day, and was it any good" — for the live Today screen, the closed Day screen, the week
// strip, the Days list, the close job and (WP5) the coach. They are the same question, and
// asking it in six places is how six screens start disagreeing about the same afternoon.
//
// Everything here is computed from the rows on every read. `daily_summaries` is the frozen
// record the week and the Days list read (and the coach's history), written once when the
// day closes — not a cache this function consults. So correcting yesterday's lunch shows
// up in the day view immediately, and the closed record stays what was true at close.
//
// Day boundaries are the user's local midnight throughout: the client sends its offset and
// every window is built from it (services/localTime.ts).

type Queryable = pg.Pool | pg.PoolClient;

/** The trailing window the measure calculators may read (the longest is exercise_load's). */
const FACTS_WINDOW_DAYS = 28;

/** Over the allowance by less than this is rounding, not a failure. */
export const OVER_TOLERANCE_KCAL = 100;
/** Below this share of the allowance is under-eating, which is a caution of its own. */
export const UNDER_FRACTION = 0.75;
/**
 * A live day is not called under-fed at lunchtime. Before this hour, a day that is short
 * is simply a day that is not finished; after it, the shortfall is real.
 */
export const UNDER_JUDGED_FROM_MINUTES = 20 * 60;

const EATBACK_FRACTION = { none: 0, half: 0.5, all: 1 } as const;
export type Eatback = keyof typeof EATBACK_FRACTION;

/** A stored photo, as a row that owns it lists it. The bytes come from GET /api/evidence/:id. */
export interface EvidencePhoto {
	id: string;
	kind: string;
	mime: string | null;
	width: number | null;
	height: number | null;
}

export interface DayItemActivity extends DayActivity {
	/** The block this activity was clustered into; null for a standalone Health item. */
	block_id: string | null;
	delta_vs_last: DeltaVsLast | null;
	/** Photos logged with this exercise — the thumbnail row on Today and Day. */
	evidence: EvidencePhoto[];
}

export interface DayItemMeal extends DayMeal {
	evidence: EvidencePhoto[];
}

export interface MacroLine {
	eaten: number | null;
	target: number | null;
	/** "under" / "over" / "on target" / null when there is no target to be either side of. */
	note: "under" | "over" | "on target" | null;
}

export interface DayWeightSummary {
	/** The day's own weigh-in (the mean, if there were several). */
	day: number | null;
	/** The 7-day average, each day counted once (services/goals/measures.ts). */
	avg_7d: number | null;
	/** Change in the 7-day average over the previous week, pounds. Negative = losing. */
	trend_per_week: number | null;
}

export interface MuscleSummary {
	muscle: string;
	sets: number;
	exercises: string[];
}

export interface DayView {
	date: IsoDate;
	tz_offset_min: number;
	/** True while this is the user's current local day. */
	is_today: boolean;
	/** When the day was closed into `daily_summaries`; null while it is open. */
	closed_at: string | null;
	/** "Day N" — counted from the user's first log, or their sign-up when they have none. */
	day_number: number;

	items: {
		meals: DayItemMeal[];
		activities: DayItemActivity[];
		weights: DayWeight[];
	};
	blocks: Block[];

	eaten: number;
	earned: number;
	/** TDEE − the goal pace's deficit. null when the profile cannot produce one. */
	target: number | null;
	/** target + eatback × earned — what the ring is drawn against. */
	allowance: number | null;
	/** allowance − eaten, the ring's "left". */
	remaining: number | null;
	eatback: Eatback;
	tdee: number | null;
	/** TDEE + earned − eaten. Positive is a deficit (concept-v2 §Calories). */
	balance: number | null;
	status: DayStatus;
	/** How far over the allowance, when over. */
	over_by: number | null;

	macros: { protein_g: MacroLine; carbs_g: MacroLine; fat_g: MacroLine; fiber_g: MacroLine };
	weight: DayWeightSummary;
	muscle_groups: string[];
	muscle_summary: MuscleSummary[];
	/** Health's own daily figures. Never added to `earned` — see the note on `earned` below. */
	health: { active_energy: number | null; steps: number | null };

	eating_pattern: string | null;
	arc: ArcEvent[];
	expected: ExpectedItem[];

	verdict: Verdict;
	verdict_words: string;
	verdict_why: string;
	goal: GoalRow | null;
	/** True when the active goal is one the calorie status actually speaks to. */
	goal_involves_calories: boolean;

	/** One line for the Days list: what the day was, without opening it. */
	summary_line: string;
	/** The facts every measure calculator reads — handed to the coach and the readings. */
	facts: DayFacts;
}

export interface ComputeDayOptions {
	userId: string;
	/** The local calendar date to compute, `YYYY-MM-DD`. */
	date: IsoDate;
	/** Minutes to add to UTC for the user's local time. */
	tzOffsetMin: number;
	/** "Now", for deciding whether this is the live day. Defaults to the server clock. */
	now?: Date;
}

interface MealRow {
	id: string;
	logged_at: string;
	description: string;
	meal_type: MealSlot | null;
	kcal: number;
	protein_g: number | null;
	carbs_g: number | null;
	fat_g: number | null;
	fiber_g: number | null;
}

interface ActivityRow {
	id: string;
	logged_at: string;
	description: string;
	exercise: string | null;
	category: DayActivity["category"];
	muscle_groups: string[] | null;
	sets: number | null;
	reps: number | null;
	load_lb: number | null;
	duration_min: number | null;
	distance_mi: number | null;
	kcal: number | null;
	source: DayActivity["source"];
	confidence: DayActivity["confidence"];
	external_id: string | null;
}

interface WeightRow {
	id: string;
	logged_at: string;
	weight_lb: number;
}

interface HealthRow {
	kind: string;
	external_id: string;
	start_at: string;
	end_at: string | null;
	value: number | null;
	unit: string | null;
	raw: Record<string, unknown> | null;
}

function toActivity(row: ActivityRow): DayActivity {
	return {
		id: row.id,
		logged_at: row.logged_at,
		description: row.description,
		exercise: row.exercise,
		category: row.category,
		muscle_groups: row.muscle_groups ?? [],
		sets: row.sets,
		reps: row.reps,
		load_lb: row.load_lb,
		duration_min: row.duration_min,
		distance_mi: row.distance_mi,
		kcal: row.kcal ?? 0,
		source: row.source,
		confidence: row.confidence,
		external_id: row.external_id,
	};
}

function toMeal(row: MealRow, tzOffsetMin: number): DayMeal {
	return {
		id: row.id,
		logged_at: row.logged_at,
		description: row.description,
		slot: row.meal_type ?? slotForMinutes(localMinutesOf(row.logged_at, tzOffsetMin)),
		stated_slot: row.meal_type,
		kcal: row.kcal,
		protein_g: row.protein_g,
		carbs_g: row.carbs_g,
		fat_g: row.fat_g,
		fiber_g: row.fiber_g,
	};
}

/**
 * A Health `workout` sample as the merge rules see it. The sample's own numbers are
 * preferred, with `raw` filling in the name and the distance a platform put there.
 */
function toHealthWorkout(row: HealthRow): HealthWorkout {
	const raw = row.raw ?? {};
	const minutes =
		numberOrNull(raw.duration_min) ??
		(row.end_at ? Math.round((Date.parse(row.end_at) - Date.parse(row.start_at)) / 60_000) : null);
	return {
		external_id: row.external_id,
		name: typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name.trim() : "Workout",
		start_at: row.start_at,
		end_at: row.end_at,
		// `value` is the sample's active energy in kcal; a workout with no energy is still a workout.
		kcal: row.value == null ? numberOrNull(raw.kcal) : Math.round(row.value),
		duration_min: minutes,
		distance_mi: numberOrNull(raw.distance_mi),
	};
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** An activities row a Health sync already materialised, as a workout for the merge. */
function activityAsHealthWorkout(activity: DayActivity): HealthWorkout {
	return {
		external_id: activity.external_id ?? null,
		name: activity.exercise ?? activity.description,
		start_at: activity.logged_at,
		end_at:
			activity.duration_min == null
				? null
				: new Date(Date.parse(activity.logged_at) + activity.duration_min * 60_000).toISOString(),
		kcal: activity.kcal,
		duration_min: activity.duration_min,
		distance_mi: activity.distance_mi,
		activity_id: activity.id,
	};
}

export function eatbackFraction(eatback: Eatback): number {
	return EATBACK_FRACTION[eatback] ?? 0.5;
}

export interface StatusInput {
	eaten: number;
	allowance: number | null;
	safeFloor: number | null;
	/** Whether the day is still running, and how far into it we are locally. */
	live: boolean;
	localMinutes: number;
	/** No goal about calories means no calorie judgement at all. */
	judged: boolean;
}

/**
 * `on_track | over | under | none` (docs/build-plan.md §WP3). `none` is the honest answer
 * whenever there is nothing to judge against: no allowance, or a goal the calorie number
 * says nothing about (a strength goal is not served by eating less).
 */
export function computeStatus({ eaten, allowance, safeFloor, live, localMinutes, judged }: StatusInput): DayStatus {
	if (!judged || allowance == null) return "none";
	if (eaten > allowance + OVER_TOLERANCE_KCAL) return "over";

	const short = eaten < allowance * UNDER_FRACTION || (safeFloor != null && eaten > 0 && eaten < safeFloor);
	// Before the evening, a day that is short is a day that is not over yet.
	if (short && (!live || localMinutes >= UNDER_JUDGED_FROM_MINUTES)) return "under";
	return "on_track";
}

function macroLine(eaten: number | null, target: number | null, kind: "max" | "target"): MacroLine {
	if (target == null || target <= 0) return { eaten, target: null, note: null };
	if (eaten == null) return { eaten: null, target, note: null };
	const ratio = eaten / target;
	if (kind === "max") return { eaten, target, note: ratio > 1.05 ? "over" : "on target" };
	return { eaten, target, note: ratio < 0.9 ? "under" : ratio > 1.15 ? "over" : "on target" };
}

/** Sum of a macro across the day's meals; null when nothing was logged (never zero). */
function macroTotal(meals: DayMeal[], key: "protein_g" | "carbs_g" | "fat_g" | "fiber_g"): number | null {
	if (meals.length === 0) return null;
	return Math.round(meals.reduce((total, meal) => total + (meal[key] ?? 0), 0) * 10) / 10;
}

function muscleSummary(activities: DayActivity[]): MuscleSummary[] {
	const groups = new Map<string, { sets: number; exercises: Set<string> }>();
	for (const activity of activities) {
		for (const raw of activity.muscle_groups) {
			const muscle = raw.trim().toLowerCase();
			if (!muscle) continue;
			const entry = groups.get(muscle) ?? { sets: 0, exercises: new Set<string>() };
			entry.sets += activity.sets ?? 0;
			entry.exercises.add(activity.exercise ?? activity.description);
			groups.set(muscle, entry);
		}
	}
	return [...groups.entries()]
		.map(([muscle, entry]) => ({ muscle, sets: entry.sets, exercises: [...entry.exercises] }))
		.sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle));
}

/** The Days-list one-liner: what the day was, in the fewest words that are still true. */
export function summaryLine(view: {
	blocks: Block[];
	meals: DayMeal[];
	eaten: number;
	earned: number;
	weight: DayWeightSummary;
}): string {
	const parts: string[] = [];
	if (view.blocks.length > 0) {
		const titles = view.blocks.map((block) => block.title);
		parts.push(titles.length <= 2 ? titles.join(" + ") : `${titles[0]} +${titles.length - 1} more`);
	}
	if (view.meals.length > 0) {
		parts.push(`${view.eaten.toLocaleString("en-US")} kcal in ${view.meals.length} meal${view.meals.length === 1 ? "" : "s"}`);
	}
	if (view.earned > 0) parts.push(`${view.earned.toLocaleString("en-US")} earned`);
	if (view.weight.day != null) parts.push(`${view.weight.day} lb`);
	return parts.length > 0 ? parts.join(" · ") : "Nothing logged";
}

export async function computeDay(db: Queryable, options: ComputeDayOptions): Promise<DayView> {
	const { userId, date, tzOffsetMin } = options;
	const now = options.now ?? new Date();
	const today = localDay(now, tzOffsetMin);
	const isToday = today.date === date;
	const { startUtc, endUtc } = boundsOf(date, tzOffsetMin);
	const windowStart = boundsOf(addDays(date, -(FACTS_WINDOW_DAYS - 1)), tzOffsetMin).startUtc;

	// Sequential rather than concurrent: `db` may be one transaction client, which cannot
	// run queries in parallel. These are small indexed reads.
	const profile = (
		await db.query<TdeeProfile & { eatback: Eatback; training_days: number | null }>(
			`SELECT sex, birth_year, height_cm, activity_level, goal_pace, goal_weight_lb,
			        pregnant_or_lactating, health_concern, daily_calorie_target, protein_g,
			        carbs_max_g, eatback, training_days
			   FROM profiles WHERE id = $1`,
			[userId]
		)
	).rows[0] ?? null;

	// The goal active on *that* date — not today's goal. A goal set tomorrow must not
	// retroactively judge yesterday, and a goal that has since been reached or dropped
	// still judges the days it was live for (concept-v2 §Goals: "every closed day is
	// judged against the goal active that day").
	//
	// The window is the whole filter, and WP4 is what makes that safe: every status change
	// writes `active_to` (services/goals/store.ts), so a goal dropped today judges up to
	// today and no further. WP3 had to exclude dropped goals outright, because nothing
	// recorded when they were dropped.
	const goal =
		(
			await db.query<GoalRow>(
				`SELECT id, kind, title, metrics, priority, status, active_from, active_to
				   FROM goals
				  WHERE user_id = $1
				    AND active_from <= $2::date AND (active_to IS NULL OR active_to >= $2::date)
				  ORDER BY priority, active_from DESC LIMIT 1`,
				[userId, date]
			)
		).rows[0] ?? null;

	const window = [windowStart.toISOString(), endUtc.toISOString()];
	const mealRows = (
		await db.query<MealRow>(
			`SELECT id, logged_at, description, meal_type, kcal, protein_g, carbs_g, fat_g, fiber_g
			   FROM meals WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3 ORDER BY logged_at`,
			[userId, ...window]
		)
	).rows;
	const activityRows = (
		await db.query<ActivityRow>(
			`SELECT id, logged_at, description, exercise, category, muscle_groups, sets, reps, load_lb,
			        duration_min, distance_mi, kcal, source, confidence, external_id
			   FROM activities WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3 ORDER BY logged_at`,
			[userId, ...window]
		)
	).rows;
	const weightRows = (
		await db.query<WeightRow>(
			`SELECT id, logged_at, weight_lb FROM weight_logs
			  WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3 ORDER BY logged_at`,
			[userId, ...window]
		)
	).rows;
	const healthRows = (
		await db.query<HealthRow>(
			`SELECT kind, external_id, start_at, end_at, value, unit, raw FROM health_samples
			  WHERE user_id = $1 AND start_at >= $2 AND start_at < $3 ORDER BY start_at`,
			[userId, ...window]
		)
	).rows;

	// --- the day itself -------------------------------------------------------------
	const inDay = <T extends { logged_at: string }>(rows: T[]): T[] =>
		rows.filter((row) => localDateOf(row.logged_at, tzOffsetMin) === date);

	const meals = inDay(mealRows).map((row) => toMeal(row, tzOffsetMin));
	const dayActivities = inDay(activityRows).map(toActivity);
	const weights: DayWeight[] = inDay(weightRows).map((row) => ({
		id: row.id,
		logged_at: row.logged_at,
		weight_lb: row.weight_lb,
		source: "manual",
	}));

	const dayHealth = healthRows.filter((row) => localDateOf(row.start_at, tzOffsetMin) === date);
	const materialised = new Set(
		dayActivities.filter((a) => a.source === "health" && a.external_id).map((a) => a.external_id as string)
	);
	const healthWorkouts: HealthWorkout[] = [
		// A sync that already wrote an activities row wins: it is the editable record the
		// user sees, and counting its sample too is the double count the rules exist for.
		...dayActivities.filter((a) => a.source === "health").map(activityAsHealthWorkout),
		...dayHealth
			.filter((row) => row.kind === "workout" && !materialised.has(row.external_id))
			.map(toHealthWorkout),
	];

	// Body-mass samples are weigh-ins on a day that has none of its own (concept-v2
	// §Health: "body mass samples become weight logs"). A day the user weighed themselves
	// on keeps their number — the scale they chose to read is the one they meant.
	if (weights.length === 0) {
		for (const row of dayHealth) {
			if (row.kind !== "body_mass" || row.value == null) continue;
			weights.push({ id: null, logged_at: row.start_at, weight_lb: Math.round(row.value * 10) / 10, source: "health" });
		}
	}

	const blocksWithoutHealth = buildBlocks(dayActivities);
	const { blocks, standalone } = attachHealthWorkouts(blocksWithoutHealth, healthWorkouts);
	const standaloneActivities = standalone.map(healthWorkoutAsActivity);

	// --- deltas ---------------------------------------------------------------------
	const exerciseNames = [
		...new Set(dayActivities.map((a) => a.exercise?.trim().toLowerCase()).filter((n): n is string => Boolean(n))),
	];
	const history: DayActivity[] =
		exerciseNames.length === 0
			? []
			: (
					await db.query<ActivityRow>(
						`SELECT DISTINCT ON (lower(exercise)) id, logged_at, description, exercise, category,
						        muscle_groups, sets, reps, load_lb, duration_min, distance_mi, kcal, source,
						        confidence, external_id
						   FROM activities
						  WHERE user_id = $1 AND logged_at < $2 AND lower(exercise) = ANY($3::text[])
						  ORDER BY lower(exercise), logged_at DESC`,
						[userId, startUtc.toISOString(), exerciseNames]
					)
				).rows.map(toActivity);

	const blockOf = new Map<string, string>();
	for (const block of blocks) for (const id of block.activity_ids) blockOf.set(id, block.id);

	// Evidence is attached below; until then these are the activities with their block and delta.
	const items: (DayActivity & { block_id: string | null; delta_vs_last: DeltaVsLast | null })[] = [
		...withDeltas(dayActivities, history).map(({ activity, delta_vs_last }) => ({
			...activity,
			block_id: activity.id ? (blockOf.get(activity.id) ?? null) : null,
			delta_vs_last,
		})),
		// Standalone Health items are shown with a badge and have nothing to compare to:
		// "a walk" is not the same walk as last Tuesday's.
		...standaloneActivities.map((activity) => ({ ...activity, block_id: null, delta_vs_last: null })),
	].sort((a, b) => Date.parse(a.logged_at) - Date.parse(b.logged_at));

	// The photos each row was logged with. One query for the day, because a thumbnail row
	// under an exercise is part of the design (docs/design-system.md §Day) and N+1 of them
	// is not. The bytes themselves are only ever served by GET /api/evidence/:id.
	const photosByActivity = new Map<string, EvidencePhoto[]>();
	const photosByMeal = new Map<string, EvidencePhoto[]>();
	const ownerActivityIds = items.map((item) => item.id).filter((id): id is string => id !== null);
	const ownerMealIds = meals.map((meal) => meal.id);
	if (ownerActivityIds.length > 0 || ownerMealIds.length > 0) {
		const { rows: evidenceRows } = await db.query<EvidencePhoto & { activity_id: string | null; meal_id: string | null }>(
			`SELECT id, kind, mime, width, height, activity_id, meal_id
			   FROM evidence
			  WHERE user_id = $1 AND kind = 'photo'
			    AND (activity_id = ANY($2::uuid[]) OR meal_id = ANY($3::uuid[]))
			  ORDER BY created_at`,
			[userId, ownerActivityIds, ownerMealIds]
		);
		for (const row of evidenceRows) {
			const photo: EvidencePhoto = { id: row.id, kind: row.kind, mime: row.mime, width: row.width, height: row.height };
			const bucket = row.activity_id ? photosByActivity : row.meal_id ? photosByMeal : null;
			const key = row.activity_id ?? row.meal_id;
			if (!bucket || !key) continue;
			bucket.set(key, [...(bucket.get(key) ?? []), photo]);
		}
	}
	const activityItems: DayItemActivity[] = items.map((item) => ({
		...item,
		evidence: item.id ? (photosByActivity.get(item.id) ?? []) : [],
	}));
	const mealItems: DayItemMeal[] = meals.map((meal) => ({
		...meal,
		evidence: photosByMeal.get(meal.id) ?? [],
	}));

	// --- the calorie model ----------------------------------------------------------
	const eaten = meals.reduce((total, meal) => total + meal.kcal, 0);
	// Blocks already carry the overlap rules' answer (a Health workout attached to a block
	// fills in its calories rather than adding a second figure); standalone Health items
	// are the only activities counted outside a block. Daily active energy is deliberately
	// NOT added: it is the baseline the TDEE already accounts for.
	const earned =
		blocks.reduce((total, block) => total + block.kcal, 0) +
		standaloneActivities.reduce((total, activity) => total + activity.kcal, 0);

	const dayWeight = weights.length === 0 ? null : round1(mean(weights.map((w) => w.weight_lb)));
	const lastKnownWeight =
		dayWeight ??
		(weightRows.filter((row) => Date.parse(row.logged_at) < endUtc.getTime()).at(-1)?.weight_lb ?? null);
	const targets: DayTargets = computeDayTargets(profile, lastKnownWeight, startUtc);
	const eatback: Eatback = profile?.eatback ?? "half";
	const allowance =
		targets.target == null ? null : Math.round(targets.target + eatbackFraction(eatback) * earned);

	const judged = goalInvolvesCalories(goal);
	const status = computeStatus({
		eaten,
		allowance,
		safeFloor: targets.safeFloor,
		live: isToday,
		localMinutes: isToday ? localMinutesOf(now, tzOffsetMin) : 24 * 60,
		judged,
	});

	// --- facts for the measure catalog ----------------------------------------------
	const facts = buildFacts({ date, tzOffsetMin, tdee: targets.tdee, mealRows, activityRows, weightRows, healthRows });

	// --- weight trend ---------------------------------------------------------------
	const avg7 = computeMeasure("body_weight", facts);
	const previousWeek = computeMeasure("body_weight", { ...facts, date: addDays(date, -7) });
	const weight: DayWeightSummary = {
		day: dayWeight,
		avg_7d: avg7,
		trend_per_week: avg7 == null || previousWeek == null ? null : round1(avg7 - previousWeek),
	};

	// --- verdict --------------------------------------------------------------------
	const logged = meals.length > 0 || items.length > 0 || weights.length > 0;
	const trainedToday = items.length > 0;
	const yesterday = addDays(date, -1);
	const trainedYesterday = facts.activities.some((a) => a.date === yesterday);
	const sessionDates = new Set(
		facts.activities.filter((a) => daysBetween(a.date, date) >= 0 && daysBetween(a.date, date) < 7).map((a) => a.date)
	);
	const verdictResult = judgeDay({
		goal,
		facts,
		status,
		logged,
		proteinTarget: targets.macros?.protein_g ?? null,
		trainedToday,
		trainedYesterday,
		sessionsLast7: sessionDates.size,
		trainingDaysTarget: profile?.training_days ?? null,
	});

	const overBy = allowance == null ? null : Math.max(0, eaten - allowance);
	const expected = expectedItems({ tzOffsetMin, meals, weights, now: isToday ? now.toISOString() : null });
	const arc = buildArc({
		date,
		tzOffsetMin,
		meals,
		activities: items,
		weights,
		blocks,
		expected,
		now: isToday ? now.toISOString() : null,
	});

	const closedAt = (
		await db.query<{ closed_at: string | null }>(
			`SELECT closed_at FROM daily_summaries WHERE user_id = $1 AND date = $2::date`,
			[userId, date]
		)
	).rows[0]?.closed_at ?? null;

	return {
		date,
		tz_offset_min: tzOffsetMin,
		is_today: isToday,
		closed_at: closedAt,
		day_number: await dayNumber(db, userId, date, tzOffsetMin),

		items: { meals: mealItems, activities: activityItems, weights },
		blocks,

		eaten,
		earned,
		target: targets.target,
		allowance,
		remaining: allowance == null ? null : allowance - eaten,
		eatback,
		tdee: targets.tdee,
		balance: targets.tdee == null ? null : Math.round(targets.tdee + earned - eaten),
		status,
		over_by: overBy && overBy > 0 ? overBy : null,

		macros: {
			protein_g: macroLine(macroTotal(meals, "protein_g"), targets.macros?.protein_g ?? null, "target"),
			carbs_g: macroLine(macroTotal(meals, "carbs_g"), targets.macros?.carbs_g ?? null, "max"),
			fat_g: macroLine(macroTotal(meals, "fat_g"), targets.macros?.fat_g ?? null, "target"),
			fiber_g: macroLine(macroTotal(meals, "fiber_g"), targets.macros?.fiber_g ?? null, "target"),
		},
		weight,
		muscle_groups: muscleSummary(dayActivities).map((entry) => entry.muscle),
		muscle_summary: muscleSummary(dayActivities),
		health: {
			active_energy: sumHealth(dayHealth, "active_energy"),
			steps: sumHealth(dayHealth, "steps"),
		},

		eating_pattern: eatingPattern(meals, tzOffsetMin),
		arc,
		expected,

		verdict: verdictResult.verdict,
		verdict_words: verdictWords(verdictResult.verdict, status, overBy),
		verdict_why: verdictResult.why,
		goal,
		goal_involves_calories: judged,

		summary_line: summaryLine({ blocks, meals, eaten, earned, weight }),
		facts,
	};
}

function sumHealth(rows: HealthRow[], kind: string): number | null {
	const matching = rows.filter((row) => row.kind === kind && row.value != null);
	return matching.length === 0 ? null : Math.round(matching.reduce((total, row) => total + (row.value as number), 0));
}

function mean(values: number[]): number {
	return values.reduce((a, b) => a + b, 0) / values.length;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

interface FactsInput {
	date: IsoDate;
	tzOffsetMin: number;
	tdee: number | null;
	mealRows: MealRow[];
	activityRows: ActivityRow[];
	weightRows: WeightRow[];
	healthRows: HealthRow[];
}

/**
 * The 28-day window every measure calculator reads, with each row reduced to the *local*
 * date it happened on. The calculators are pure and know nothing about timezones; this is
 * where the user's midnight is applied, once.
 */
export function buildFacts({ date, tzOffsetMin, tdee, mealRows, activityRows, weightRows, healthRows }: FactsInput): DayFacts {
	const on = (instant: string) => localDateOf(instant, tzOffsetMin);
	const meals: FactMeal[] = mealRows.map((row) => ({
		date: on(row.logged_at),
		kcal: row.kcal,
		protein_g: row.protein_g,
		carbs_g: row.carbs_g,
		fat_g: row.fat_g,
		fiber_g: row.fiber_g,
	}));
	const activities: FactActivity[] = activityRows.map((row) => ({
		date: on(row.logged_at),
		exercise: row.exercise,
		category: row.category,
		muscle_groups: row.muscle_groups ?? [],
		sets: row.sets,
		reps: row.reps,
		load_lb: row.load_lb,
		duration_min: row.duration_min,
		distance_mi: row.distance_mi,
		kcal: row.kcal,
		// Not read by any measure; the coach's data-quality flags are what these are for.
		source: row.source,
		confidence: row.confidence,
	}));
	const weights: FactWeight[] = weightRows.map((row) => ({ date: on(row.logged_at), weight_lb: row.weight_lb }));
	const healthSamples: FactHealthSample[] = healthRows.map((row) => ({
		date: on(row.start_at),
		kind: row.kind,
		value: row.value,
		unit: row.unit,
	}));
	return { date, tdee, meals, activities, weights, healthSamples };
}

/**
 * The first day the user ever logged anything — where "Day N" counts from. An account
 * created in March and first used in July is on day 1 in July, not day 130.
 */
export async function firstActiveDate(db: Queryable, userId: string, tzOffsetMin: number): Promise<IsoDate> {
	const { rows } = await db.query<{ first: string | null; created: string }>(
		`SELECT (
			SELECT MIN(logged_at) FROM (
				SELECT MIN(logged_at) AS logged_at FROM meals WHERE user_id = $1
				UNION ALL SELECT MIN(logged_at) FROM activities WHERE user_id = $1
				UNION ALL SELECT MIN(logged_at) FROM weight_logs WHERE user_id = $1
			) firsts
		) AS first, "createdAt" AS created FROM "user" WHERE id = $1`,
		[userId]
	);
	const row = rows[0];
	// No user row is impossible behind requireUser; today is the only sane fallback.
	if (!row) return localDateOf(new Date(), tzOffsetMin);
	return localDateOf(row.first ?? row.created, tzOffsetMin);
}

/** "Day N" — the header on Today and the number on a Days row. */
export function dayNumberFrom(firstDate: IsoDate, date: IsoDate): number {
	return Math.max(1, daysBetween(firstDate, date) + 1);
}

export async function dayNumber(db: Queryable, userId: string, date: IsoDate, tzOffsetMin: number): Promise<number> {
	return dayNumberFrom(await firstActiveDate(db, userId, tzOffsetMin), date);
}
