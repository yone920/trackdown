import { addDays, daysBetween, type IsoDate } from "../localTime.js";
import { computeMeasure, getMeasure, type DayFacts } from "./measures.js";

// The proposed timeline (docs/concept-v2.md §Goals):
//
//   "Timelines are proposed, not required: safe rates (fat loss 0.5–1 %/week, a plate step
//    every 1–2 weeks, cardio +10 %/week) give a projected date the user can accept, change,
//    or drop. An unrealistic user date is kept alongside the projection and said so."
//
// This is arithmetic, so it is computed rather than generated (concept-v2 §Principles:
// "facts are computed, advice is generated"). The model's job on the goal path is to hear
// what the user wants and which measure it is about; how long that takes at a safe rate is
// not something to ask a language model to estimate — it is the same three formulas every
// time, and they have to agree with what the Goals screen and the coach say later.
//
// Everything here is pure: a spec plus a DayFacts in, a proposal out. No SQL, no clock —
// the caller passes `today`. That is what makes the whole thing unit-testable, and the
// reason the WP4 tests can walk every kind of goal through it in milliseconds.

export type GoalPace = "gentle" | "standard" | "aggressive";
export type GoalDirection = "decrease" | "increase" | "maintain" | "at_least" | "at_most";

export interface ProposalMetricSpec {
	measure: string;
	scope?: string | null;
	target?: number | null;
	unit?: string | null;
	/** How the measure should move. Absent is treated as a standing intention. */
	direction?: GoalDirection | string | null;
	rate?: string | null;
	/** The date the user asked for on this metric, when they named one. */
	by?: string | null;
}

export interface ProposalSpec {
	kind: string;
	title?: string;
	metrics: ProposalMetricSpec[];
	/** A stated window ("upper body for two months") — also a user-given end date. */
	active_to?: string | null;
}

export interface ProposalInput {
	spec: ProposalSpec;
	/** Current facts: the measure calculators read them for "where the user is now". */
	facts: DayFacts;
	/** The profile's pace. Fat loss and strength are projected at it; cardio is not. */
	pace?: GoalPace | null;
	/** The user's local date. Defaults to the facts' date. */
	today?: IsoDate;
}

export interface ProposalMetric {
	measure: string;
	scope: string | null;
	direction: string | null;
	target: number | null;
	unit: string | null;
	/** Where the user is now, through the measure catalog. null = nothing logged for it. */
	current: number | null;
	/** The safe change per week in the measure's own unit, for the first week. */
	safe_rate_per_week: number | null;
	/** The safe rate as a sentence fragment: "about 1.4 lb a week". */
	rate: string | null;
	/** Whole weeks at the safe rate; 0 when the target is already met. */
	weeks: number | null;
	projected_date: IsoDate | null;
	/** The user's own date for this metric, kept whether or not it is realistic. */
	stated_by: IsoDate | null;
	/** True when reaching the stated date would need a faster-than-safe rate. */
	unrealistic: boolean;
	note: string;
}

export interface GoalProposal {
	/** The safe-rate date for the goal as a whole — the slowest of its metrics. */
	projected_date: IsoDate | null;
	weeks: number | null;
	rate: string | null;
	note: string;
	/** The date the user named, if any. Kept alongside the projection, never overwritten. */
	by: IsoDate | null;
	unrealistic: boolean;
	/** True when the goal has no finish line at all (a standing intention). */
	standing: boolean;
	metrics: ProposalMetric[];
}

// ---------------------------------------------------------------------------
// Safe rates
// ---------------------------------------------------------------------------

/** Fat loss, % of body weight per week (concept-v2 §Goals: 0.5–1 %/week). */
const FAT_LOSS_PCT_PER_WEEK: Record<GoalPace, number> = { gentle: 0.005, standard: 0.0075, aggressive: 0.01 };

/**
 * Weight *gain*, % of body weight per week. concept-v2 names a safe rate for losing, not
 * for gaining; half the fat-loss band is the standard lean-gain guidance (roughly
 * 0.25–0.5 %/week), and going faster is how a muscle goal becomes a fat goal.
 */
const GAIN_PCT_PER_WEEK: Record<GoalPace, number> = { gentle: 0.0025, standard: 0.00375, aggressive: 0.005 };

/** The smallest plate step (concept-v2 §Coach progression rules: +5 lb, never more than one a week). */
export const PLATE_STEP_LB = 5;
/** Weeks per plate step: "a plate step every 1–2 weeks", read at the profile's pace. */
const WEEKS_PER_PLATE_STEP: Record<GoalPace, number> = { gentle: 2, standard: 1.5, aggressive: 1 };

/**
 * Cardio volume, +10 %/week — flat, not paced. concept-v2 gives one number for it, and it
 * is a load-management rule (the "10 % rule" for running volume), not an ambition dial.
 */
const CARDIO_GROWTH_PER_WEEK = 0.1;

/** Volume measures that grow by a percentage each week rather than a fixed step. */
const GROWTH_MEASURES: readonly string[] = ["weekly_cardio_min", "distance_mi", "steps", "weekly_sets"];

/** Half a week of slack, so a date that is off by a rounding is not called unrealistic. */
const UNREALISTIC_GRACE_WEEKS = 0.5;

const DEFAULT_PACE: GoalPace = "standard";

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/** Whole weeks, always at least one: "you will be there this week" is not a projection. */
function wholeWeeks(weeks: number): number {
	return Math.max(1, Math.ceil(weeks - 1e-9));
}

type Direction = GoalDirection | string | null | undefined;

function wants(direction: Direction): "down" | "up" | "hold" {
	if (direction === "decrease" || direction === "at_most") return "down";
	if (direction === "increase" || direction === "at_least") return "up";
	return "hold";
}

/** A finish line exists only for an outcome goal (concept-v2 §Goals: outcome vs standing). */
function hasFinishLine(direction: Direction): boolean {
	return direction === "decrease" || direction === "increase";
}

function metCurrent(current: number, target: number, direction: Direction): boolean {
	return wants(direction) === "down" ? current <= target : current >= target;
}

function isIsoDate(value: unknown): value is IsoDate {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

interface Projection {
	weeks: number;
	perWeek: number;
	rate: string;
}

/**
 * Weeks from `current` to `target` at the safe rate for this measure, plus the phrase that
 * describes the rate. null when the measure has no safe rate to project along — a protein
 * target is a daily habit, not a journey, and inventing a date for one would be a lie the
 * Goals screen then shows for months.
 */
function project(
	measure: string,
	current: number,
	target: number,
	direction: Direction,
	pace: GoalPace
): Projection | null {
	const unit = getMeasure(measure)?.unit ?? "";

	if (measure === "body_weight") {
		const pct = wants(direction) === "down" ? FAT_LOSS_PCT_PER_WEEK[pace] : GAIN_PCT_PER_WEEK[pace];
		// Compounding: the rate is a percentage of body weight, and the body weight moves.
		const ratio = target / current;
		const factor = wants(direction) === "down" ? 1 - pct : 1 + pct;
		const weeks = Math.log(ratio) / Math.log(factor);
		const perWeek = round1(current * pct);
		return { weeks, perWeek, rate: `about ${perWeek} lb a week (${round1(pct * 100)} % of body weight)` };
	}

	if (measure === "exercise_load") {
		const weeksPerStep = WEEKS_PER_PLATE_STEP[pace];
		const perWeek = PLATE_STEP_LB / weeksPerStep;
		const weeks = Math.abs(target - current) / perWeek;
		const rate =
			weeksPerStep === 1
				? `${PLATE_STEP_LB} lb a week`
				: `${PLATE_STEP_LB} lb every ${weeksPerStep === 2 ? "two weeks" : "week and a half"}`;
		return { weeks, perWeek, rate: `about ${rate}` };
	}

	if (GROWTH_MEASURES.includes(measure)) {
		// +10 %/week compounds, and compounding out of zero never arrives: a user with no
		// cardio logged gets no date until there is a week to grow from.
		if (current <= 0) return null;
		const factor = wants(direction) === "down" ? 1 - CARDIO_GROWTH_PER_WEEK : 1 + CARDIO_GROWTH_PER_WEEK;
		const weeks = Math.log(target / current) / Math.log(factor);
		const perWeek = round1(current * CARDIO_GROWTH_PER_WEEK);
		return {
			weeks,
			perWeek,
			rate: `about ${Math.round(CARDIO_GROWTH_PER_WEEK * 100)} % more each week (+${perWeek} ${unit} to start)`,
		};
	}

	return null;
}

function describeNoProjection(measure: string, direction: Direction): string {
	if (!hasFinishLine(direction)) return "A standing intention — it runs until you replace it.";
	const label = getMeasure(measure)?.label ?? measure;
	return `${label} is a daily target rather than a journey, so there is no date to project.`;
}

function proposeMetric(
	metric: ProposalMetricSpec,
	facts: DayFacts,
	pace: GoalPace,
	today: IsoDate
): ProposalMetric {
	const measure = metric.measure;
	const scope = metric.scope ?? null;
	const target = metric.target ?? null;
	const statedBy = isIsoDate(metric.by) ? metric.by : null;
	const current = computeMeasure(measure, facts, scope ?? undefined);
	const unit = metric.unit ?? getMeasure(measure)?.unit ?? null;

	const base: ProposalMetric = {
		measure,
		scope,
		direction: metric.direction ?? null,
		target,
		unit,
		current,
		safe_rate_per_week: null,
		rate: null,
		weeks: null,
		projected_date: null,
		stated_by: statedBy,
		unrealistic: false,
		note: "",
	};

	if (target == null || !hasFinishLine(metric.direction)) {
		return { ...base, note: describeNoProjection(measure, metric.direction) };
	}
	if (current == null) {
		const label = (getMeasure(measure)?.label ?? measure).toLowerCase();
		return { ...base, note: `Nothing logged for ${label} yet — log it once and I will project a date.` };
	}
	if (metCurrent(current, target, metric.direction)) {
		return {
			...base,
			weeks: 0,
			projected_date: today,
			note: `Already at ${target}${unit ? ` ${unit}` : ""} — mark it reached?`,
		};
	}

	const projection = project(measure, current, target, metric.direction, pace);
	if (!projection) {
		return { ...base, note: describeNoProjection(measure, metric.direction) };
	}

	const weeks = wholeWeeks(projection.weeks);
	const projectedDate = addDays(today, weeks * 7);

	// The user's date is never overwritten — it is kept beside the projection and the note
	// says what the safe pace would give instead (concept-v2 §Goals).
	let unrealistic = false;
	let note = `About ${weeks} week${weeks === 1 ? "" : "s"} at ${projection.rate} → ${projectedDate}.`;
	if (statedBy) {
		const statedWeeks = daysBetween(today, statedBy) / 7;
		if (statedWeeks <= 0) {
			unrealistic = true;
			note = `${statedBy} is not in the future. At ${projection.rate} you would get there around ${projectedDate}.`;
		} else if (projection.weeks > statedWeeks + UNREALISTIC_GRACE_WEEKS) {
			unrealistic = true;
			const needed = round1(Math.abs(target - current) / statedWeeks);
			const neededText = unit ? `${needed} ${unit}` : `${needed}`;
			note =
				`${statedBy} would need about ${neededText} a week — faster than ${projection.rate}. ` +
				`At a safe pace you would get there around ${projectedDate}.`;
		} else {
			note = `${statedBy} works: that is ${projection.rate} or slower. The safe-pace date is ${projectedDate}.`;
		}
	}

	return {
		...base,
		safe_rate_per_week: round1(projection.perWeek),
		rate: projection.rate,
		weeks,
		projected_date: projectedDate,
		unrealistic,
		note,
	};
}

/**
 * The goal's proposed timeline: every metric projected at its safe rate, and the goal
 * taking the slowest of them — a goal is reached when all of it is, not when the easiest
 * half is.
 */
export function proposeTimeline({ spec, facts, pace, today }: ProposalInput): GoalProposal {
	const day = today ?? facts.date;
	const metrics = spec.metrics.map((metric) => proposeMetric(metric, facts, pace ?? DEFAULT_PACE, day));

	// A goal-level date the user stated ("by December") applies to the whole goal even when
	// it was attached to one metric.
	const statedBy =
		(isIsoDate(spec.active_to) ? spec.active_to : null) ?? metrics.find((m) => m.stated_by)?.stated_by ?? null;

	const projected = metrics.filter((m) => m.projected_date != null && m.weeks != null);
	const slowest = projected.reduce<ProposalMetric | null>(
		(worst, metric) => (worst == null || (metric.weeks as number) > (worst.weeks as number) ? metric : worst),
		null
	);
	const standing = metrics.length > 0 && metrics.every((m) => !hasFinishLine(m.direction));

	if (!slowest) {
		const note = standing
			? "A standing intention — no finish line, so no date is proposed."
			: (metrics[0]?.note ?? "Nothing measurable to project a date from yet.");
		return {
			projected_date: null,
			weeks: null,
			rate: null,
			note,
			by: statedBy,
			unrealistic: metrics.some((m) => m.unrealistic),
			standing,
			metrics,
		};
	}

	const unrealistic = metrics.some((m) => m.unrealistic);
	return {
		projected_date: slowest.projected_date,
		weeks: slowest.weeks,
		rate: slowest.rate,
		note: slowest.note,
		by: statedBy,
		unrealistic,
		standing,
		metrics,
	};
}

/**
 * The proposal in the shape the fusion preview and the confirm card already speak
 * (`ProposedTimelineSchema`). `by` is the date the goal would actually end on: the user's
 * when they named one, the projection otherwise — which is what the confirm writes into
 * `goals.active_to`.
 */
export function toProposedTimeline(proposal: GoalProposal): {
	by: IsoDate | null;
	rate: string | null;
	note: string | null;
	realistic: boolean | null;
} {
	return {
		by: proposal.by ?? proposal.projected_date,
		rate: proposal.rate,
		note: proposal.note || null,
		realistic: proposal.by == null && proposal.projected_date == null ? null : !proposal.unrealistic,
	};
}

/** Scoped measures are meaningless without their scope — "sets this week" of *what*? */
export function validateMetrics(metrics: readonly ProposalMetricSpec[]): string | null {
	for (const metric of metrics) {
		const known = getMeasure(metric.measure);
		if (!known) {
			return `"${metric.measure}" is not a measure the app can compute.`;
		}
		if (known.scope && !metric.scope?.trim()) {
			return `${known.label} needs a ${known.scope} — say which one.`;
		}
	}
	return null;
}
