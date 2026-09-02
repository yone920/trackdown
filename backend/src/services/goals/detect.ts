import { addDays, type IsoDate } from "../localTime.js";
import { computeMeasure, getMeasure, withinWindow, type DayFacts } from "./measures.js";
import { PLATE_STEP_LB, type GoalDirection } from "./proposal.js";
import type { GoalRow } from "./verdict.js";

// Reached and stalled detection (docs/concept-v2.md §Goals).
//
//   "Done when the measure says so (smoothed: 7-day-average weight at/under target for a
//    week; a lift logged at target twice; weekly minutes hit two weeks running) — the coach
//    then asks 'Mark it done? What's next?'. Never auto-closed, never invented."
//
// Two words carry the whole design:
//
//   * **smoothed.** One weigh-in under target is water, one heavy single is a good day.
//     Every rule here asks for the thing to hold — seven days, twice, two weeks — so that
//     a goal is not congratulated and then un-congratulated tomorrow.
//   * **candidate.** Nothing in this file closes a goal. It sets `reached_candidate_at`
//     and the coach (WP5) turns that into a question the user answers. A goal the app
//     closed by itself is a goal the user never got to finish.
//
// Stalling is the same shape from the other side: "a stalled outcome goal (no movement for
// 3 weeks) becomes the coach's nudge with an offer to adjust". Also a candidate, also
// never a status change.
//
// Pure, like the rest of services/goals/: a goal and a DayFacts in, a verdict out. The
// facts' 28-day window is exactly what the longest rule needs (a weekly measure two weeks
// running, each week itself a 7-day window, plus the 7-day smoothing on weight).

/** Days the 7-day weight average must sit at/past the target (concept-v2: "for a week"). */
export const WEIGHT_HOLD_DAYS = 7;

/**
 * What a held weight has to rest on, beyond the average itself: three weigh-ins on separate
 * days, spanning at least three days. One reading cannot close a goal, and neither can three
 * taken in the same hour (user decision 2026-09-02).
 */
export const MIN_WEIGH_INS = 3;
export const MIN_WEIGH_IN_SPAN_DAYS = 3;
/** Separate days a lift must be logged at target ("a lift logged at target twice"). */
export const LIFT_HITS_REQUIRED = 2;
/** Consecutive weeks a weekly volume must hit its target. */
export const WEEKLY_HITS_REQUIRED = 2;
/** No movement for this long is a stall (concept-v2 §Goals: three weeks). */
export const STALL_DAYS = 21;

/** Below this, a measure has not moved — it has wobbled. Per measure, in its own unit. */
const MOVEMENT_EPSILON: Record<string, number> = {
	body_weight: 0.5,
	exercise_load: PLATE_STEP_LB,
};
/** For everything else, a move of less than this share of where it started is noise. */
const RELATIVE_MOVEMENT_EPSILON = 0.05;

const GROWTH_MEASURES: readonly string[] = ["weekly_cardio_min", "distance_mi", "steps", "weekly_sets"];

export interface MetricDetection {
	measure: string;
	scope: string | null;
	target: number | null;
	current: number | null;
	/** A standing intention: no finish line, so neither reached nor stalled applies. */
	standing: boolean;
	/** True when this metric's own rule says it is done. */
	reached: boolean;
	/** True when this metric has not moved toward its target in three weeks. */
	stalled: boolean;
	/** One clause for the coach's prompt: "7-day average 169.4 lb, under 170 for 7 days". */
	why: string;
}

export interface GoalDetection {
	reached: boolean;
	/** Why, in one line — what the coach says when it asks "mark it done?". */
	reached_why: string | null;
	stalled: boolean;
	/** The day the goal stopped moving; null when it has not stalled. */
	stalled_since: IsoDate | null;
	metrics: MetricDetection[];
}

/** Only an outcome goal has a finish line to reach (concept-v2 §Goals: outcome vs standing). */
function hasFinishLine(direction: GoalDirection | string | null | undefined): boolean {
	return direction === "decrease" || direction === "increase";
}

function wantsDown(direction: string | null | undefined): boolean {
	return direction === "decrease" || direction === "at_most";
}

function met(value: number, target: number, direction: string | null | undefined): boolean {
	return wantsDown(direction) ? value <= target : value >= target;
}

/** The measure's value on a day `back` days before the facts' own date. */
function valueOn(facts: DayFacts, measure: string, scope: string | null, back: number): number | null {
	return computeMeasure(measure, { ...facts, date: addDays(facts.date, -back) }, scope ?? undefined);
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * The 7-day average at/past target on every one of the last seven days. A day with no
 * average at all (nobody weighed themselves that week) breaks the run: we do not know the
 * goal held, and guessing that it did is how a goal gets closed on no evidence.
 */
function weightHeld(facts: DayFacts, target: number, direction: string): { reached: boolean; why: string } {
	const values: (number | null)[] = [];
	for (let back = 0; back < WEIGHT_HOLD_DAYS; back += 1) values.push(valueOn(facts, "body_weight", null, back));
	const today = values[0];
	if (today == null) return { reached: false, why: "No weigh-in in the last week." };

	// **The average is not evidence on its own.** A seven-day mean of ONE reading is that
	// reading wearing a statistic's clothes, and every one of the seven windows can contain
	// the same lone number — so `values.every(...)` passes on a single weigh-in (field
	// report 2026-09-02: a 110 lb reading took the goal card to "Reached").
	//
	// So the run also has to rest on real evidence: several readings, on separate days,
	// spread across the window. A goal is closed once and it congratulates somebody when it
	// is; that is worth three weigh-ins.
	const evidence = weighInEvidence(facts);
	if (evidence.days < MIN_WEIGH_INS || evidence.spanDays < MIN_WEIGH_IN_SPAN_DAYS) {
		return {
			reached: false,
			why: `Only ${evidence.days} weigh-in${evidence.days === 1 ? "" : "s"} in the last week — not enough to call it held.`,
		};
	}

	const held = values.every((value) => value != null && met(value, target, direction));
	return {
		reached: held,
		why: held
			? `7-day average ${round1(today)} lb, ${wantsDown(direction) ? "at or under" : "at or over"} ${target} for ${WEIGHT_HOLD_DAYS} days across ${evidence.days} weigh-ins.`
			: `7-day average ${round1(today)} lb against ${target}.`,
	};
}

/**
 * How much the last week's weigh-ins actually amount to: how many separate DAYS carry one,
 * and how many days the earliest and latest are apart.
 *
 * Days rather than readings, because three readings on one morning are one morning — and a
 * span, because three consecutive days at the end of a fortnight away is a different claim
 * from three spread across the week.
 */
export function weighInEvidence(facts: DayFacts): { days: number; spanDays: number } {
	const dates = [
		...new Set(
			facts.weights
				.filter((weight) => withinWindow(weight.date, facts.date, WEIGHT_HOLD_DAYS))
				.map((weight) => weight.date)
		),
	].sort();
	if (dates.length === 0) return { days: 0, spanDays: 0 };
	const first = Date.parse(`${dates[0]}T00:00:00Z`);
	const last = Date.parse(`${dates[dates.length - 1]}T00:00:00Z`);
	return { days: dates.length, spanDays: Math.round((last - first) / 86_400_000) + 1 };
}

/**
 * The lift logged at target on two separate days. Counted from the activities themselves
 * rather than through `exercise_load`, which answers "the best in four weeks" — one number,
 * and one number cannot say "twice".
 */
function liftHits(facts: DayFacts, scope: string | null, target: number): { reached: boolean; why: string } {
	const window = getMeasure("exercise_load")?.windowDays ?? 28;
	const wanted = scope?.trim().toLowerCase() ?? "";
	const days = new Set(
		facts.activities
			.filter(
				(activity) =>
					withinWindow(activity.date, facts.date, window) &&
					activity.load_lb != null &&
					activity.load_lb >= target &&
					(wanted === "" || activity.exercise?.trim().toLowerCase() === wanted)
			)
			.map((activity) => activity.date)
	);
	const hits = days.size;
	return {
		reached: hits >= LIFT_HITS_REQUIRED,
		why:
			hits >= LIFT_HITS_REQUIRED
				? `${scope ?? "That lift"} logged at ${target} lb on ${hits} separate days.`
				: `${scope ?? "That lift"} at ${target} lb on ${hits} of ${LIFT_HITS_REQUIRED} days.`,
	};
}

/** The weekly total at target this week and the week before — "two weeks running". */
function weeklyHits(
	facts: DayFacts,
	measure: string,
	scope: string | null,
	target: number,
	direction: string
): { reached: boolean; why: string } {
	const weeks: (number | null)[] = [];
	for (let i = 0; i < WEEKLY_HITS_REQUIRED; i += 1) weeks.push(valueOn(facts, measure, scope, i * 7));
	const unit = getMeasure(measure)?.unit ?? "";
	const hit = weeks.every((value) => value != null && met(value, target, direction));
	const thisWeek = weeks[0];
	return {
		reached: hit,
		why: hit
			? `${round1(thisWeek as number)} ${unit} against ${target}, ${WEEKLY_HITS_REQUIRED} weeks running.`
			: `${thisWeek == null ? "nothing" : round1(thisWeek)} ${unit} this week against ${target}.`,
	};
}

function detectMetric(
	metric: { measure: string; scope?: string | null; target?: number | null; direction?: string | null },
	facts: DayFacts
): MetricDetection {
	const scope = metric.scope ?? null;
	const target = metric.target ?? null;
	const direction = metric.direction ?? null;
	const current = computeMeasure(metric.measure, facts, scope ?? undefined);
	const base: MetricDetection = {
		measure: metric.measure,
		scope,
		target,
		current,
		standing: target == null || !hasFinishLine(direction),
		reached: false,
		stalled: false,
		why: "",
	};

	if (base.standing || target == null || !hasFinishLine(direction)) {
		// A standing intention is never "reached" and never "stalled": it has no finish
		// line to arrive at and no distance left to cover.
		return { ...base, why: "A standing intention — nothing to reach." };
	}

	const rule =
		metric.measure === "body_weight"
			? weightHeld(facts, target, direction as string)
			: metric.measure === "exercise_load"
				? liftHits(facts, scope, target)
				: GROWTH_MEASURES.includes(metric.measure)
					? weeklyHits(facts, metric.measure, scope, target, direction as string)
					: current == null
						? { reached: false, why: "Nothing logged for it yet." }
						: // Anything else with a finish line is read straight, unsmoothed —
							// there is no history rule for it, so the single reading is all we have.
							{
								reached: met(current, target, direction),
								why: `${round1(current)} against ${target}.`,
							};

	const stall = detectStall(facts, metric.measure, scope, target, direction as string);
	return { ...base, reached: rule.reached, stalled: !rule.reached && stall, why: rule.why };
}

/** No movement toward the target across three weeks — with "movement" sized per measure. */
function detectStall(
	facts: DayFacts,
	measure: string,
	scope: string | null,
	target: number,
	direction: string
): boolean {
	const now = computeMeasure(measure, facts, scope ?? undefined);
	const before = valueOn(facts, measure, scope, STALL_DAYS);
	// Unknown is not stalled. A user with no data has a logging problem, not a plan
	// problem, and the day's own reading is already saying so.
	if (now == null || before == null) return false;
	if (met(now, target, direction)) return false;

	const towardTarget = wantsDown(direction) ? before - now : now - before;
	const epsilon = MOVEMENT_EPSILON[measure] ?? Math.abs(before) * RELATIVE_MOVEMENT_EPSILON;
	return towardTarget < epsilon;
}

export interface DetectableGoal {
	kind?: GoalRow["kind"] | string;
	metrics: { measure: string; scope?: string | null; target?: number | null; direction?: string | null }[];
	/** Where the goal starts; a stall cannot predate it. */
	active_from?: IsoDate | null;
}

/**
 * Has this goal been reached, and has it stopped moving? Both are candidates the coach
 * turns into a question — neither changes the goal's status (concept-v2 §Goals: "never
 * auto-closed, never invented").
 */
export function detectReached(goal: DetectableGoal, facts: DayFacts): GoalDetection {
	const metrics = goal.metrics.map((metric) => detectMetric(metric, facts));
	const outcomes = metrics.filter((metric) => !metric.standing);

	// All of it, not the easiest half: a goal with two numbers in it is reached when both are.
	const reached = outcomes.length > 0 && outcomes.every((metric) => metric.reached);
	const stalledMetrics = outcomes.filter((metric) => metric.stalled);
	const stalled = !reached && stalledMetrics.length > 0;

	let stalledSince: IsoDate | null = null;
	if (stalled) {
		const since = addDays(facts.date, -STALL_DAYS);
		// A goal set last week cannot have been stalled for three: the stall starts at the
		// goal, at the earliest.
		stalledSince = goal.active_from && goal.active_from > since ? goal.active_from : since;
	}

	return {
		reached,
		reached_why: reached ? outcomes.map((metric) => metric.why).join(" ") : null,
		stalled,
		stalled_since: stalledSince,
		metrics,
	};
}
