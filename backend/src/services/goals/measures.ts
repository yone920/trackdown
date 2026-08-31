// The measure catalog (docs/concept-v2.md §Goals): the finite list of things a goal is
// allowed to be about, because they are the things the app can actually compute from logs
// and Health. A goal's `metrics` jsonb names a measure id from here; Today, Progress and
// the day verdict read the number through this module.
//
// Rules that make this file safe to trust:
//   * Every calculator is pure — it reads a DayFacts and returns a number or null. No SQL,
//     no clock, no LLM. WP3/WP4 build the DayFacts from the database and call in here.
//   * null means "no data", never zero. A day with nothing logged must not read as a day
//     with nothing eaten, or every unlogged day would judge as a perfect one.
//   * Health-derived measures (steps, resting_hr, vo2) return null whenever the user has no
//     samples — the app works identically with Health off, so nothing may depend on them.
//   * Adding a measure is one descriptor here plus one widget in the app. Nothing else.

/** A calendar date in the user's local timezone, `YYYY-MM-DD`. */
export type IsoDate = string;

export type ActivityCategory = "cardio" | "strength" | "mobility" | "other";

export interface FactMeal {
	date: IsoDate;
	kcal: number | null;
	protein_g: number | null;
	carbs_g: number | null;
	fat_g: number | null;
	fiber_g: number | null;
}

export interface FactActivity {
	date: IsoDate;
	exercise: string | null;
	category: ActivityCategory | null;
	muscle_groups: string[];
	sets: number | null;
	reps: number | null;
	load_lb: number | null;
	duration_min: number | null;
	distance_mi: number | null;
	kcal: number | null;
	/**
	 * How the row was produced and how sure the reading was. No measure calculator reads
	 * either — they are here for WP5's coach, which discounts low-confidence data and
	 * surfaces it as a nudge (concept-v2 §Principles: "confidence is stored, and the coach
	 * discounts low-confidence data"). Optional so every existing fixture stays valid.
	 */
	source?: "manual" | "fused" | "health" | null;
	confidence?: "low" | "medium" | "high" | null;
}

export interface FactWeight {
	date: IsoDate;
	weight_lb: number;
}

/** One imported Health sample, already reduced to a local date and a number. */
export interface FactHealthSample {
	date: IsoDate;
	kind: string;
	value: number | null;
	unit?: string | null;
}

/**
 * Everything the calculators may read: the day being measured plus a trailing window of
 * history. Callers should supply at least the last 28 days (the longest window any measure
 * uses); rows dated after `date` are ignored rather than trusted, so a caller that hands
 * over a wider slice still gets the same answer.
 */
export interface DayFacts {
	date: IsoDate;
	/** Maintenance calories for the day, from the profile. null when the profile is incomplete. */
	tdee: number | null;
	meals: FactMeal[];
	activities: FactActivity[];
	weights: FactWeight[];
	healthSamples: FactHealthSample[];
}

export function emptyDayFacts(date: IsoDate, tdee: number | null = null): DayFacts {
	return { date, tdee, meals: [], activities: [], weights: [], healthSamples: [] };
}

// ---------------------------------------------------------------------------
// Date helpers. Dates are local calendar strings, so they are compared as strings
// and differenced through UTC midnight — never through the server's timezone.
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function toUtcMs(date: IsoDate): number {
	if (!DATE_PATTERN.test(date)) throw new Error(`Expected a YYYY-MM-DD date, got "${date}"`);
	const ms = Date.parse(`${date}T00:00:00Z`);
	if (Number.isNaN(ms)) throw new Error(`Not a real date: "${date}"`);
	return ms;
}

/** Whole days from `date` back to `end`; negative when `date` is in the future. */
export function daysBefore(date: IsoDate, end: IsoDate): number {
	return Math.round((toUtcMs(end) - toUtcMs(date)) / MS_PER_DAY);
}

/** True for the `days` calendar days ending on `end`, inclusive. days = 1 is `end` itself. */
export function withinWindow(date: IsoDate, end: IsoDate, days: number): boolean {
	const diff = daysBefore(date, end);
	return diff >= 0 && diff < days;
}

function round(value: number, digits = 2): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function sum(values: readonly (number | null | undefined)[]): number {
	return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function mean(values: readonly number[]): number | null {
	return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function sameName(a: string | null, b: string | undefined): boolean {
	return a != null && b != null && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function hasMuscle(activity: FactActivity, muscle: string): boolean {
	const wanted = muscle.trim().toLowerCase();
	return activity.muscle_groups.some((group) => group.trim().toLowerCase() === wanted);
}

/** Health samples of one kind on or before the day, newest date first. */
function healthSamples(facts: DayFacts, kind: string, windowDays: number): FactHealthSample[] {
	return facts.healthSamples
		.filter((s) => s.kind === kind && s.value != null && withinWindow(s.date, facts.date, windowDays))
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** The most recent day's samples, averaged — for readings taken now and then, not daily. */
function latestHealthValue(facts: DayFacts, kind: string, windowDays: number): number | null {
	const samples = healthSamples(facts, kind, windowDays);
	const newest = samples[0];
	if (!newest) return null;
	return mean(samples.filter((s) => s.date === newest.date).map((s) => s.value as number));
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export const MEASURE_IDS = [
	"body_weight",
	"calorie_balance",
	"protein_g",
	"carbs_g",
	"weekly_sets",
	"exercise_load",
	"weekly_cardio_min",
	"distance_mi",
	"pace",
	"steps",
	"resting_hr",
	"vo2",
] as const;

export type MeasureId = (typeof MEASURE_IDS)[number];

export interface MeasureContext {
	facts: DayFacts;
	/**
	 * The muscle group or exercise name a scoped measure is about ("shoulders",
	 * "Bench Press"). Scoped measures return null without it.
	 */
	scope?: string;
}

export interface Measure {
	id: MeasureId;
	/** Short human label; the app's widget titles it. */
	label: string;
	/** Unit of the returned number, for display and for a goal's `unit` field. */
	unit: string;
	scope?: "muscle" | "exercise";
	/**
	 * True when the scope is a narrowing rather than a requirement: the measure computes
	 * something meaningful without one. "12 sets of chest a week" and "18 sets a week"
	 * are both goals; "best load" of nothing is not.
	 */
	scopeOptional?: boolean;
	/** The label to use when a `scopeOptional` measure is asked for without a scope. */
	unscopedLabel?: string;
	/** Calendar days ending on facts.date that the calculator reads. */
	windowDays: number;
	/** "health" measures return null for a user with no Health samples. */
	derivedFrom: "logs" | "health";
	compute(ctx: MeasureContext): number | null;
}

function define(measure: Measure): Measure {
	return measure;
}

export const MEASURES: Record<MeasureId, Measure> = {
	// Trend, not a single reading: one weigh-in is mostly water. Days with several
	// weigh-ins count once, so a chatty morning cannot outvote the rest of the week.
	body_weight: define({
		id: "body_weight",
		label: "Body weight",
		unit: "lb",
		windowDays: 7,
		derivedFrom: "logs",
		compute({ facts }) {
			const byDay = new Map<IsoDate, number[]>();
			for (const w of facts.weights) {
				if (!withinWindow(w.date, facts.date, 7)) continue;
				const day = byDay.get(w.date) ?? [];
				day.push(w.weight_lb);
				byDay.set(w.date, day);
			}
			const dailyMeans = [...byDay.values()].map((values) => mean(values) as number);
			const average = mean(dailyMeans);
			return average == null ? null : round(average, 1);
		},
	}),

	// Positive = a deficit, matching concept-v2 §Calories ("Σ(TDEE + earned − eaten)").
	// Needs a TDEE, so it is null until the profile has sex/height/age/activity.
	calorie_balance: define({
		id: "calorie_balance",
		label: "Calorie balance",
		unit: "kcal",
		windowDays: 1,
		derivedFrom: "logs",
		compute({ facts }) {
			if (facts.tdee == null) return null;
			const eaten = sum(facts.meals.filter((m) => m.date === facts.date).map((m) => m.kcal));
			const earned = sum(facts.activities.filter((a) => a.date === facts.date).map((a) => a.kcal));
			return round(facts.tdee + earned - eaten, 0);
		},
	}),

	protein_g: define({
		id: "protein_g",
		label: "Protein",
		unit: "g",
		windowDays: 1,
		derivedFrom: "logs",
		compute({ facts }) {
			return macroForDay(facts, "protein_g");
		},
	}),

	carbs_g: define({
		id: "carbs_g",
		label: "Carbs",
		unit: "g",
		windowDays: 1,
		derivedFrom: "logs",
		compute({ facts }) {
			return macroForDay(facts, "carbs_g");
		},
	}),

	// Weekly volume — for one muscle group when a scope is given (the number behind "no
	// pulling since Monday"), and for the whole body when none is. "A complete body workout
	// through the week" is a real goal and the app can count it; refusing it because nobody
	// named a muscle was a bug, not a rule.
	//
	// Zero, not null, when the week has logs but none that count: that is the fact.
	weekly_sets: define({
		id: "weekly_sets",
		label: "Weekly sets",
		unit: "sets",
		scope: "muscle",
		scopeOptional: true,
		unscopedLabel: "Weekly sets, whole body",
		windowDays: 7,
		derivedFrom: "logs",
		compute({ facts, scope }) {
			const week = facts.activities.filter(
				(a) => withinWindow(a.date, facts.date, 7) && (!scope || hasMuscle(a, scope))
			);
			return sum(week.map((a) => a.sets));
		},
	}),

	// Best load for one exercise in four weeks — what "bench 185" is checked against, and
	// what the progression rules step up from. null until the exercise appears in the window.
	exercise_load: define({
		id: "exercise_load",
		label: "Best load",
		unit: "lb",
		scope: "exercise",
		windowDays: 28,
		derivedFrom: "logs",
		compute({ facts, scope }) {
			if (!scope) return null;
			const loads = facts.activities
				.filter((a) => withinWindow(a.date, facts.date, 28) && sameName(a.exercise, scope) && a.load_lb != null)
				.map((a) => a.load_lb as number);
			return loads.length === 0 ? null : round(Math.max(...loads), 1);
		},
	}),

	weekly_cardio_min: define({
		id: "weekly_cardio_min",
		label: "Cardio this week",
		unit: "min",
		windowDays: 7,
		derivedFrom: "logs",
		compute({ facts }) {
			const week = facts.activities.filter((a) => withinWindow(a.date, facts.date, 7) && a.category === "cardio");
			return round(sum(week.map((a) => a.duration_min)), 0);
		},
	}),

	distance_mi: define({
		id: "distance_mi",
		label: "Distance this week",
		unit: "mi",
		windowDays: 7,
		derivedFrom: "logs",
		compute({ facts }) {
			const week = facts.activities.filter((a) => withinWindow(a.date, facts.date, 7));
			return round(sum(week.map((a) => a.distance_mi)), 2);
		},
	}),

	// Minutes per mile over the week's distance work — total time over total distance, so a
	// long slow walk cannot be averaged away by a short fast run. null with no distance.
	pace: define({
		id: "pace",
		label: "Pace",
		unit: "min/mi",
		windowDays: 7,
		derivedFrom: "logs",
		compute({ facts }) {
			const paced = facts.activities.filter(
				(a) => withinWindow(a.date, facts.date, 7) && a.distance_mi != null && a.distance_mi > 0 && a.duration_min != null
			);
			const miles = sum(paced.map((a) => a.distance_mi));
			if (miles <= 0) return null;
			return round(sum(paced.map((a) => a.duration_min)) / miles, 2);
		},
	}),

	steps: define({
		id: "steps",
		label: "Steps",
		unit: "steps",
		windowDays: 1,
		derivedFrom: "health",
		compute({ facts }) {
			const today = healthSamples(facts, "steps", 1);
			return today.length === 0 ? null : round(sum(today.map((s) => s.value)), 0);
		},
	}),

	resting_hr: define({
		id: "resting_hr",
		label: "Resting heart rate",
		unit: "bpm",
		windowDays: 1,
		derivedFrom: "health",
		compute({ facts }) {
			const value = latestHealthValue(facts, "resting_hr", 1);
			return value == null ? null : round(value, 0);
		},
	}),

	// VO2 max is estimated every few weeks, not daily, so the latest reading inside three
	// months is the current one.
	vo2: define({
		id: "vo2",
		label: "VO₂ max",
		unit: "ml/kg/min",
		windowDays: 90,
		derivedFrom: "health",
		compute({ facts }) {
			const value = latestHealthValue(facts, "vo2_max", 90);
			return value == null ? null : round(value, 1);
		},
	}),
};

/**
 * Grams of one macro eaten on the day. null when nothing was logged: an unlogged day is
 * not a zero-protein day, and the verdict for it is "unlogged", not "missed".
 */
function macroForDay(facts: DayFacts, key: "protein_g" | "carbs_g"): number | null {
	const today = facts.meals.filter((m) => m.date === facts.date);
	if (today.length === 0) return null;
	return round(sum(today.map((m) => m[key])), 1);
}

export function isMeasureId(value: string): value is MeasureId {
	return (MEASURE_IDS as readonly string[]).includes(value);
}

export function getMeasure(id: string): Measure | undefined {
	return isMeasureId(id) ? MEASURES[id] : undefined;
}

/**
 * What to call a measure as it is actually being used. A measure whose scope is optional
 * reads differently without one — "Weekly sets" of nothing in particular is "Weekly sets,
 * whole body" — and the proposal note, the goals list and the app all want the same words.
 */
export function measureLabel(id: string, scope?: string | null): string {
	const measure = getMeasure(id);
	if (!measure) return id;
	if (measure.unscopedLabel && !scope?.trim()) return measure.unscopedLabel;
	return measure.label;
}

/** Convenience wrapper: unknown ids and missing scopes both give null rather than throwing. */
export function computeMeasure(id: string, facts: DayFacts, scope?: string): number | null {
	return getMeasure(id)?.compute({ facts, scope }) ?? null;
}
