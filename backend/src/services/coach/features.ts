import { daysBefore, withinWindow, type DayFacts, type FactActivity, type IsoDate } from "../goals/measures.js";

// What the coach is told about the user, computed rather than remembered
// (docs/concept-v2.md §Principles 4: "facts are computed, advice is generated" — the
// coach's inputs are SQL, not LLM memory).
//
// Everything in this file is a pure function of a `DayFacts` window: the same 28 days the
// measure catalog reads, built once by services/day.ts. No SQL, no clock, no provider. That
// is what makes "why did it prescribe 140 lb" a question with an answer, and what lets the
// whole feature set be tested on fixtures.
//
// Three conventions carried over from services/goals/measures.ts, because the coach reads
// the same rows:
//   * null means "we do not know", never zero. A user who has not weighed themselves has
//     no trend; a user who has logged nothing has no adherence. Advice built on a zero the
//     user never reported is worse than advice that says "I cannot see enough yet".
//   * Dates are the user's local calendar dates. The caller applied the timezone once.
//   * Rows dated after `facts.date` are ignored, so a caller may hand over a wider slice.

/** The window every coach feature reads. The catalogue's longest measure uses the same. */
export const COACH_WINDOW_DAYS = 28;
/** "This week" for cardio, sets and adherence: the trailing seven days, today included. */
export const WEEK_DAYS = 7;
/** With no stated cardio target, the WHO's 150 min/week is the standing one (same as the verdict). */
export const DEFAULT_WEEKLY_CARDIO_MIN = 150;
/** A weigh-in older than this is one the nudge can ask for. */
export const WEIGH_IN_DUE_DAYS = 3;

/**
 * The muscle groups the coach reasons about, in the vocabulary of
 * `backend/data/exercises.json`. Listed rather than discovered so that a group nobody has
 * trained in four weeks is *visible* — "no pulling movement since Monday" is a sentence
 * about an absence, and an absence cannot be derived from the rows that exist.
 */
export const TRACKED_MUSCLES = [
	"chest",
	"back",
	"lats",
	"shoulders",
	"biceps",
	"triceps",
	"quads",
	"hamstrings",
	"glutes",
	"calves",
	"abs",
] as const;

export interface MuscleFeature {
	muscle: string;
	/** Days since this group was last trained; null when it is not in the window at all. */
	days_since: number | null;
	last_date: IsoDate | null;
	sets_7d: number;
	sets_28d: number;
	/** Trained inside 48 h, so not today's primary target (concept-v2 §Progression rules). */
	recent: boolean;
}

export interface ExerciseSession {
	date: IsoDate;
	load_lb: number | null;
	sets: number | null;
	reps: number | null;
	duration_min: number | null;
	confidence: "low" | "medium" | "high" | null;
}

export interface ExerciseFeature {
	/** The catalogue's spelling, as it was logged. */
	exercise: string;
	category: "cardio" | "strength" | "mobility" | "other" | null;
	muscle_groups: string[];
	/** Sessions in the window, newest first — one entry per day the exercise was logged. */
	sessions: ExerciseSession[];
	last: ExerciseSession;
	days_since: number;
	/** Heaviest load in four weeks — the same number `exercise_load` reports. */
	best_load_lb: number | null;
	/** "up" / "down" / "flat" against the oldest session in the window; "new" when there is one. */
	trend: "new" | "up" | "flat" | "down";
	/** Pounds between the oldest and newest session in the window; null with one session. */
	trend_lb: number | null;
}

export interface CardioFeature {
	minutes_this_week: number;
	minutes_last_week: number;
	/** The plan's or the goal's weekly minutes; the WHO default when nobody said. */
	weekly_target_min: number;
	/** Target − this week; 0 when the week is already there. */
	short_by_min: number;
	sessions_this_week: number;
	last_date: IsoDate | null;
	days_since: number | null;
}

export interface AdherenceWindow {
	days: number;
	/** Days inside the window with a meal, an activity or a weigh-in. */
	logged_days: number;
	/** Days with nothing at all — the gap the nudge is allowed to mention. */
	unlogged_days: IsoDate[];
	kcal_avg: number | null;
	kcal_target: number | null;
	/** eaten − target, averaged over the days that were logged. Positive = over. */
	kcal_delta_avg: number | null;
	protein_avg: number | null;
	protein_target: number | null;
	carbs_avg: number | null;
	carbs_max_g: number | null;
	training_days: number;
}

export interface WeightFeature {
	latest: number | null;
	latest_date: IsoDate | null;
	avg_7d: number | null;
	avg_7d_prev: number | null;
	/** Change in the 7-day average over a week, pounds. Negative = losing. */
	trend_per_week: number | null;
	days_since_weigh_in: number | null;
}

export interface DataQuality {
	/** Activities a model read and nobody has corrected, at low confidence. */
	low_confidence_items: { date: IsoDate; exercise: string; reason: string }[];
	/** Days in the last week with nothing logged at all. */
	unlogged_days: IsoDate[];
	/** True when the calorie target could not be computed — advice about eating is guesswork. */
	no_calorie_target: boolean;
	/** True when the user has not weighed themselves in WEIGH_IN_DUE_DAYS. */
	weigh_in_due: boolean;
	/** Meals with calories but no protein figure; the macro advice is thinner for them. */
	meals_missing_macros: number;
}

export interface CoachFeatures {
	date: IsoDate;
	/** Days since anything was logged as trained; null when nothing is in the window. */
	days_since_last_workout: number | null;
	last_workout_date: IsoDate | null;
	/** Distinct days with an activity, in the trailing week and the whole window. */
	sessions_this_week: number;
	sessions_last_week: number;
	sessions_in_window: number;
	/** Days per week the plan says, when the user has said. */
	training_days_target: number | null;
	muscles: MuscleFeature[];
	/** Groups with no entry in the window at all — trained never, as far as we can see. */
	untrained_muscles: string[];
	exercises: ExerciseFeature[];
	cardio: CardioFeature;
	adherence: { day1: AdherenceWindow; day3: AdherenceWindow; day7: AdherenceWindow };
	weight: WeightFeature;
	data_quality: DataQuality;
}

export interface CoachFeaturesInput {
	/** 28 days ending on the day being advised (services/day.ts builds it). */
	facts: DayFacts;
	/** Days per week the plan says. */
	trainingDaysTarget?: number | null;
	/** Weekly cardio minutes from the plan or a goal; the WHO default when absent. */
	cardioTargetMin?: number | null;
	/** What the day's eating is measured against (services/tdee.ts). */
	targets?: { kcal: number | null; protein_g: number | null; carbs_max_g: number | null } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(value: number, digits = 1): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function mean(values: readonly number[]): number | null {
	return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function normalise(name: string | null): string | null {
	const trimmed = name?.trim();
	return trimmed ? trimmed.toLowerCase() : null;
}

/** Everything in the window, oldest last — the coach never reads the future. */
function inWindow(facts: DayFacts, days = COACH_WINDOW_DAYS): FactActivity[] {
	return facts.activities.filter((activity) => withinWindow(activity.date, facts.date, days));
}

/**
 * A day the user trained. Any activity counts: a walk imported from Health is movement,
 * and the coach's gap rule is about the body, not about which button logged it.
 */
function trainingDates(activities: FactActivity[]): IsoDate[] {
	return [...new Set(activities.map((activity) => activity.date))].sort();
}

/** The days a window covers, oldest first, ending on `end`. */
function windowDates(end: IsoDate, days: number): IsoDate[] {
	const dates: IsoDate[] = [];
	for (let back = days - 1; back >= 0; back -= 1) {
		dates.push(new Date(Date.parse(`${end}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10));
	}
	return dates;
}

function hasMuscle(activity: FactActivity, muscle: string): boolean {
	return activity.muscle_groups.some((group) => group.trim().toLowerCase() === muscle);
}

/** Cardio, for every reader of this window — the coach's features and the training board. */
export function isCardio(activity: FactActivity): boolean {
	if (activity.category) return activity.category === "cardio";
	// Nothing said: minutes with no sets is cardio-shaped, which is the only honest guess.
	return activity.sets == null && (activity.duration_min ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// The features
// ---------------------------------------------------------------------------

export function muscleFeatures(facts: DayFacts): MuscleFeature[] {
	const window = inWindow(facts);
	const seen = new Set<string>();
	for (const activity of window) {
		for (const group of activity.muscle_groups) {
			const muscle = normalise(group);
			if (muscle) seen.add(muscle);
		}
	}
	const muscles = [...new Set<string>([...TRACKED_MUSCLES, ...seen])];

	return muscles
		.map((muscle) => {
			const trained = window.filter((activity) => hasMuscle(activity, muscle));
			const lastDate = trained.map((activity) => activity.date).sort().at(-1) ?? null;
			const sets = (days: number): number =>
				trained
					.filter((activity) => withinWindow(activity.date, facts.date, days))
					.reduce((total, activity) => total + (activity.sets ?? 0), 0);
			const daysSince = lastDate == null ? null : daysBefore(lastDate, facts.date);
			return {
				muscle,
				days_since: daysSince,
				last_date: lastDate,
				sets_7d: sets(WEEK_DAYS),
				sets_28d: sets(COACH_WINDOW_DAYS),
				// 48 h means yesterday and today — a group trained yesterday is still recovering.
				recent: daysSince != null && daysSince <= 1,
			};
		})
		.sort((a, b) => {
			// Longest untrained first: that is the order the coach reads them in.
			if (a.days_since == null && b.days_since == null) return a.muscle.localeCompare(b.muscle);
			if (a.days_since == null) return -1;
			if (b.days_since == null) return 1;
			return b.days_since - a.days_since || a.muscle.localeCompare(b.muscle);
		});
}

/**
 * One entry per exercise the user has actually done in four weeks, each with the history
 * the progression rules step from. Sessions are per *day*: three logged sets of bench in
 * one visit are one session at the heaviest load, because that is what "same load in two
 * consecutive workouts" counts.
 */
export function exerciseFeatures(facts: DayFacts): ExerciseFeature[] {
	const window = inWindow(facts).filter((activity) => normalise(activity.exercise) != null);
	const byExercise = new Map<string, FactActivity[]>();
	for (const activity of window) {
		const key = normalise(activity.exercise) as string;
		byExercise.set(key, [...(byExercise.get(key) ?? []), activity]);
	}

	const features: ExerciseFeature[] = [];
	for (const rows of byExercise.values()) {
		const dates = [...new Set(rows.map((row) => row.date))].sort().reverse();
		const sessions: ExerciseSession[] = dates.map((date) => {
			const onDay = rows.filter((row) => row.date === date);
			const loads = onDay.map((row) => row.load_lb).filter((load): load is number => load != null);
			// The day's top set is what a load progression is about; sets and reps come from
			// the row that carried it, so "3 × 8 at 135" stays one prescription.
			const top =
				loads.length === 0
					? onDay[0]
					: onDay.find((row) => row.load_lb === Math.max(...loads));
			return {
				date,
				load_lb: loads.length === 0 ? null : Math.max(...loads),
				sets: onDay.reduce<number | null>(
					(total, row) => (row.sets == null ? total : (total ?? 0) + row.sets),
					null
				),
				reps: top?.reps ?? null,
				duration_min: onDay.reduce<number | null>(
					(total, row) => (row.duration_min == null ? total : (total ?? 0) + row.duration_min),
					null
				),
				confidence: top?.confidence ?? null,
			};
		});

		const last = sessions[0] as ExerciseSession;
		const oldest = sessions.at(-1) as ExerciseSession;
		const loads = sessions.map((session) => session.load_lb).filter((load): load is number => load != null);
		const trendLb =
			sessions.length < 2 || last.load_lb == null || oldest.load_lb == null
				? null
				: round(last.load_lb - oldest.load_lb);
		const sample = rows.at(-1) as FactActivity;

		features.push({
			exercise: sample.exercise as string,
			category: sample.category,
			muscle_groups: [...new Set(rows.flatMap((row) => row.muscle_groups))],
			sessions,
			last,
			days_since: daysBefore(last.date, facts.date),
			best_load_lb: loads.length === 0 ? null : round(Math.max(...loads)),
			trend: sessions.length < 2 ? "new" : trendLb == null ? "flat" : trendLb > 0 ? "up" : trendLb < 0 ? "down" : "flat",
			trend_lb: trendLb,
		});
	}

	// Most recent first, so a prompt truncated for length keeps what matters.
	return features.sort((a, b) => a.days_since - b.days_since || a.exercise.localeCompare(b.exercise));
}

export function cardioFeature(facts: DayFacts, weeklyTargetMin: number | null | undefined): CardioFeature {
	const window = inWindow(facts).filter(isCardio);
	const minutes = (from: number, days: number): number =>
		window
			.filter((activity) => {
				const back = daysBefore(activity.date, facts.date);
				return back >= from && back < from + days;
			})
			.reduce((total, activity) => total + (activity.duration_min ?? 0), 0);

	const thisWeek = Math.round(minutes(0, WEEK_DAYS));
	const target = weeklyTargetMin ?? DEFAULT_WEEKLY_CARDIO_MIN;
	const lastDate = window.map((activity) => activity.date).sort().at(-1) ?? null;

	return {
		minutes_this_week: thisWeek,
		minutes_last_week: Math.round(minutes(WEEK_DAYS, WEEK_DAYS)),
		weekly_target_min: target,
		short_by_min: Math.max(0, target - thisWeek),
		sessions_this_week: new Set(
			window.filter((a) => withinWindow(a.date, facts.date, WEEK_DAYS)).map((a) => a.date)
		).size,
		last_date: lastDate,
		days_since: lastDate == null ? null : daysBefore(lastDate, facts.date),
	};
}

export function adherenceWindow(input: CoachFeaturesInput, days: number): AdherenceWindow {
	const { facts } = input;
	const dates = windowDates(facts.date, days);
	const meals = facts.meals.filter((meal) => dates.includes(meal.date));
	const activities = facts.activities.filter((activity) => dates.includes(activity.date));
	const weights = facts.weights.filter((weight) => dates.includes(weight.date));

	const loggedDates = new Set<IsoDate>([
		...meals.map((meal) => meal.date),
		...activities.map((activity) => activity.date),
		...weights.map((weight) => weight.date),
	]);

	// Per day, so a three-meal day and a one-meal day are not averaged as six meals.
	const perDay = (key: "kcal" | "protein_g" | "carbs_g"): number[] =>
		[...new Set(meals.map((meal) => meal.date))].map((date) =>
			meals.filter((meal) => meal.date === date).reduce((total, meal) => total + (meal[key] ?? 0), 0)
		);

	const kcal = perDay("kcal");
	const kcalAvg = mean(kcal);
	const kcalTarget = input.targets?.kcal ?? null;

	return {
		days,
		logged_days: loggedDates.size,
		unlogged_days: dates.filter((date) => !loggedDates.has(date)),
		kcal_avg: kcalAvg == null ? null : Math.round(kcalAvg),
		kcal_target: kcalTarget,
		kcal_delta_avg: kcalAvg == null || kcalTarget == null ? null : Math.round(kcalAvg - kcalTarget),
		protein_avg: mean(perDay("protein_g")) == null ? null : Math.round(mean(perDay("protein_g")) as number),
		protein_target: input.targets?.protein_g ?? null,
		carbs_avg: mean(perDay("carbs_g")) == null ? null : Math.round(mean(perDay("carbs_g")) as number),
		carbs_max_g: input.targets?.carbs_max_g ?? null,
		training_days: new Set(activities.map((activity) => activity.date)).size,
	};
}

export function weightFeature(facts: DayFacts): WeightFeature {
	const window = facts.weights.filter((weight) => withinWindow(weight.date, facts.date, COACH_WINDOW_DAYS));
	const sorted = [...window].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const latest = sorted.at(-1) ?? null;

	// One weigh-in a day, so a chatty morning cannot outvote the rest of the week — the
	// same smoothing services/goals/measures.ts applies to `body_weight`.
	const averageEndingOn = (end: IsoDate): number | null => {
		const byDay = new Map<IsoDate, number[]>();
		for (const weight of sorted) {
			if (!withinWindow(weight.date, end, WEEK_DAYS)) continue;
			byDay.set(weight.date, [...(byDay.get(weight.date) ?? []), weight.weight_lb]);
		}
		const dailyMeans = [...byDay.values()].map((values) => mean(values) as number);
		const average = mean(dailyMeans);
		return average == null ? null : round(average);
	};

	const avg = averageEndingOn(facts.date);
	const previous = averageEndingOn(windowDates(facts.date, 8)[0] as IsoDate);

	return {
		latest: latest?.weight_lb ?? null,
		latest_date: latest?.date ?? null,
		avg_7d: avg,
		avg_7d_prev: previous,
		trend_per_week: avg == null || previous == null ? null : round(avg - previous),
		days_since_weigh_in: latest == null ? null : daysBefore(latest.date, facts.date),
	};
}

export function dataQuality(input: CoachFeaturesInput, week: AdherenceWindow, weight: WeightFeature): DataQuality {
	const { facts } = input;
	const lowConfidence = inWindow(facts, WEEK_DAYS)
		.filter((activity) => activity.confidence === "low")
		.map((activity) => ({
			date: activity.date,
			exercise: activity.exercise ?? "an activity",
			reason: activity.source === "fused" ? "read from a photo, never confirmed" : "logged at low confidence",
		}));

	const mealsMissingMacros = facts.meals.filter(
		(meal) => withinWindow(meal.date, facts.date, WEEK_DAYS) && meal.kcal != null && meal.protein_g == null
	).length;

	return {
		low_confidence_items: lowConfidence,
		unlogged_days: week.unlogged_days,
		no_calorie_target: (input.targets?.kcal ?? null) == null,
		weigh_in_due: weight.days_since_weigh_in == null || weight.days_since_weigh_in >= WEIGH_IN_DUE_DAYS,
		meals_missing_macros: mealsMissingMacros,
	};
}

/** Everything above, in one pass. This is what the prompt and the rules both read. */
export function computeFeatures(input: CoachFeaturesInput): CoachFeatures {
	const { facts } = input;
	const window = inWindow(facts);
	const dates = trainingDates(window);
	const lastWorkout = dates.at(-1) ?? null;

	const sessionsIn = (from: number, days: number): number =>
		dates.filter((date) => {
			const back = daysBefore(date, facts.date);
			return back >= from && back < from + days;
		}).length;

	const muscles = muscleFeatures(facts);
	const day7 = adherenceWindow(input, WEEK_DAYS);
	const weight = weightFeature(facts);

	return {
		date: facts.date,
		days_since_last_workout: lastWorkout == null ? null : daysBefore(lastWorkout, facts.date),
		last_workout_date: lastWorkout,
		sessions_this_week: sessionsIn(0, WEEK_DAYS),
		sessions_last_week: sessionsIn(WEEK_DAYS, WEEK_DAYS),
		sessions_in_window: dates.length,
		training_days_target: input.trainingDaysTarget ?? null,
		muscles,
		untrained_muscles: muscles.filter((muscle) => muscle.days_since == null).map((muscle) => muscle.muscle),
		exercises: exerciseFeatures(facts),
		cardio: cardioFeature(facts, input.cardioTargetMin),
		adherence: {
			day1: adherenceWindow(input, 1),
			day3: adherenceWindow(input, 3),
			day7,
		},
		weight,
		data_quality: dataQuality(input, day7, weight),
	};
}
