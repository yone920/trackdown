import { computeMeasure, type DayFacts, type MeasureId } from "./measures.js";

// The day's verdict (docs/concept-v2.md §The two day views: "verdict vs the goal active
// that day"; docs/design-system.md §Day: "Served your goal" / "Over by N" / "Not logged").
//
// Three rules hold the whole thing up:
//   * There is no verdict without a goal. With none, the app shows no judgement colours at
//     all (concept-v2 §Goals) — `none`, not a quiet pass.
//   * An unlogged day is `unlogged`, never `missed`. We do not know what happened; saying
//     the user failed because they did not type is the fastest way to lose them.
//   * Which question gets asked depends on what the goal is *about*. A fat-loss day is
//     judged on calories, a muscle day on protein and whether they trained, an endurance
//     day on the week's cardio pace. Judging every goal on calories is how a strength app
//     tells someone who ate to grow that they failed.
//
// The verdict for a *past* day is written once at close and never revised, so a goal set
// tomorrow cannot retroactively fail yesterday.

export type Verdict = "served" | "missed" | "unlogged" | "none";
export type DayStatus = "on_track" | "over" | "under" | "none";

export interface GoalMetricRow {
	measure: string;
	scope?: string | null;
	target?: number | null;
	unit?: string | null;
	direction?: "decrease" | "increase" | "maintain" | "at_least" | "at_most" | null;
	rate?: string | null;
	by?: string | null;
}

export interface GoalRow {
	id: string;
	kind: "lose_fat" | "gain_muscle" | "build_strength" | "improve_endurance" | "maintain" | "custom";
	title: string;
	metrics: GoalMetricRow[];
	priority: number;
	status: string;
	active_from: string;
	active_to: string | null;
}

/**
 * The measures whose number is a calorie number. A goal built on one of these — or a
 * fat-loss / maintenance goal, which are about calories whatever they list — is what makes
 * the day's calorie `status` meaningful; without one, `status` is `none` and the ring has
 * no colour (concept-v2 §Calories: the week is the unit, and only when it is the point).
 */
const CALORIE_MEASURES: readonly MeasureId[] = ["calorie_balance", "body_weight"];

export function goalInvolvesCalories(goal: GoalRow | null): boolean {
	if (!goal) return false;
	if (goal.kind === "lose_fat" || goal.kind === "maintain") return true;
	return goal.metrics.some((metric) => (CALORIE_MEASURES as readonly string[]).includes(metric.measure));
}

/** Protein counts as met a little under target — 5 g is a chicken thigh, not a failure. */
const PROTEIN_TOLERANCE = 0.9;
/** Cardio is judged on the week's pace, not the day's: 90 % of the weekly target is on pace. */
const CARDIO_PACE_TOLERANCE = 0.9;
/** With no stated cardio target, the WHO's 150 min/week is the standing one. */
const DEFAULT_WEEKLY_CARDIO_MIN = 150;

export interface VerdictInput {
	/** The goal active on the day being judged, highest priority first. null = no goal. */
	goal: GoalRow | null;
	/** Everything the measure calculators may read, ending on the day. */
	facts: DayFacts;
	/** The day's calorie status; `none` when there is no target to compare against. */
	status: DayStatus;
	/** Did anything at all get logged — a meal, an activity, a weigh-in? */
	logged: boolean;
	/** The day's protein target in grams, from the profile or the recommendation. */
	proteinTarget: number | null;
	trainedToday: boolean;
	trainedYesterday: boolean;
	/** Sessions in the trailing 7 days, for the rest-day rule. */
	sessionsLast7: number;
	/** Days per week the plan says, when the user has said. */
	trainingDaysTarget: number | null;
}

export interface VerdictResult {
	verdict: Verdict;
	/** One clause, for the Days list and the reading prompt: "1,980 eaten of 2,260". */
	why: string;
}

export function judgeDay(input: VerdictInput): VerdictResult {
	const { goal, logged } = input;
	if (!goal) return { verdict: "none", why: "No goal was active that day." };
	if (!logged) return { verdict: "unlogged", why: "Nothing was logged." };

	switch (goal.kind) {
		case "lose_fat":
		case "maintain":
			return judgeCalories(input);
		case "gain_muscle":
		case "build_strength":
			return judgeTraining(input);
		case "improve_endurance":
			return judgeEndurance(input);
		default:
			return judgeCustom(input);
	}
}

function judgeCalories({ status, facts }: VerdictInput): VerdictResult {
	const balance = computeMeasure("calorie_balance", facts);
	const deficit = balance == null ? "" : ` (${balance >= 0 ? "−" : "+"}${Math.abs(Math.round(balance))} kcal)`;
	switch (status) {
		case "on_track":
			return { verdict: "served", why: `Ate inside the allowance${deficit}.` };
		case "under":
			// A deficit day served a fat-loss goal even when it undershot. The status line
			// still says "under-eating" — that is a caution about health, not a verdict on
			// the goal, and conflating them would mark a light day as a failure.
			return { verdict: "served", why: `Ate well under the allowance${deficit}.` };
		case "over":
			return { verdict: "missed", why: `Ate over the allowance${deficit}.` };
		default:
			return { verdict: "none", why: "No calorie target for that day." };
	}
}

function judgeTraining(input: VerdictInput): VerdictResult {
	const protein = computeMeasure("protein_g", input.facts);
	const target = input.proteinTarget;
	const proteinOk = target == null ? protein != null : protein != null && protein >= target * PROTEIN_TOLERANCE;

	// The rest-day rule: a day off is part of building muscle. It only counts as one when
	// the week around it actually has training in it — otherwise every empty day would
	// pass as a rest day.
	const restDayOk =
		input.trainedYesterday ||
		(input.trainingDaysTarget != null && input.sessionsLast7 >= input.trainingDaysTarget);
	const trainingOk = input.trainedToday || restDayOk;

	const proteinText =
		protein == null
			? "no protein logged"
			: `${Math.round(protein)} g protein${target == null ? "" : ` of ${Math.round(target)}`}`;
	const trainingText = input.trainedToday ? "trained" : restDayOk ? "rest day" : "no training";

	return proteinOk && trainingOk
		? { verdict: "served", why: `${proteinText}, ${trainingText}.` }
		: { verdict: "missed", why: `${proteinText}, ${trainingText}.` };
}

function judgeEndurance(input: VerdictInput): VerdictResult {
	const weekly = computeMeasure("weekly_cardio_min", input.facts) ?? 0;
	const stated = input.goal?.metrics.find((m) => m.measure === "weekly_cardio_min")?.target;
	const target = stated ?? DEFAULT_WEEKLY_CARDIO_MIN;
	const onPace = weekly >= target * CARDIO_PACE_TOLERANCE;
	return {
		verdict: onPace ? "served" : "missed",
		why: `${Math.round(weekly)} of ${Math.round(target)} cardio minutes this week.`,
	};
}

/**
 * A custom goal is judged on its own first metric, if that metric is something the app can
 * both compute and compare. When it is not — a goal with no target, or a direction that
 * only makes sense over months — there is no honest verdict, and `none` says so.
 */
function judgeCustom(input: VerdictInput): VerdictResult {
	const metric = input.goal?.metrics[0];
	if (!metric || metric.target == null || !metric.direction) {
		return { verdict: "none", why: "That goal has no measurable daily target." };
	}
	const value = computeMeasure(metric.measure, input.facts, metric.scope ?? undefined);
	if (value == null) return { verdict: "unlogged", why: `No ${metric.measure} logged.` };

	const met =
		metric.direction === "decrease" || metric.direction === "at_most"
			? value <= metric.target
			: metric.direction === "increase" || metric.direction === "at_least"
				? value >= metric.target
				: Math.abs(value - metric.target) <= Math.abs(metric.target) * 0.05;
	const unit = metric.unit ? ` ${metric.unit}` : "";
	return {
		verdict: met ? "served" : "missed",
		why: `${metric.measure} ${Math.round(value * 10) / 10}${unit} against ${metric.target}${unit}.`,
	};
}

/** The words the Day screen puts under the check circle. */
export function verdictWords(verdict: Verdict, status: DayStatus, over: number | null): string {
	switch (verdict) {
		case "served":
			return "Served your goal";
		case "missed":
			return status === "over" && over != null ? `Over by ${Math.round(over).toLocaleString("en-US")}` : "Missed your goal";
		case "unlogged":
			return "Not logged";
		default:
			return status === "none" ? "Logged" : "No goal set";
	}
}
