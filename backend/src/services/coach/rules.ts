import type { CoachFeatures, ExerciseFeature, ExerciseSession, MuscleFeature } from "./features.js";

// The coach's deterministic half (docs/concept-v2.md §Progression rules: "deterministic,
// fed to the model as constraints").
//
// The split this file exists to enforce: **the model chooses exercises and reasons; it does
// not invent numbers.** Which load, how many sets, how many reps, how many minutes and
// whether today is a light day are all computed here from what the user actually lifted,
// handed to the prompt as data, and copied into the brief. Ask a language model for "the
// next sensible weight" and it will give a different answer on Tuesday than it gave on
// Monday for the same history — which is exactly the thing a progression must never do.
//
// Everything is pure: features in, rules out. No SQL, no clock, no provider.

/** The smallest plate step (docs/concept-v2.md: "+2.5 kg / +5 lb"). Pounds are the unit. */
export const PLATE_STEP_LB = 5;
/** Machines move in stack increments, so a percentage is the honest step for them. */
export const MACHINE_STEP_FRACTION = 0.05;
/** Equipment that steps by percentage rather than by plate. */
const STACK_EQUIPMENT = new Set(["machine", "smith_machine", "cable"]);

/** Sessions at target reps needed before the load goes up ("in two consecutive workouts"). */
export const SESSIONS_AT_TARGET_BEFORE_STEP = 2;
/** "never more than one step per week." */
export const MIN_DAYS_BETWEEN_STEPS = 7;
/** A gap of this many days eases back in; below it nothing changes. */
export const EASE_BACK_AFTER_DAYS = 3;
/** A gap of this many days is a restart, not a resumption. */
export const RESTART_AFTER_DAYS = 14;
/** A muscle group trained inside this many days is not today's primary target. */
export const RECOVERY_DAYS = 2;
/** The safe weekly growth for cardio volume (the same +10 %/week as goal proposals). */
export const CARDIO_GROWTH = 1.1;
/** Nobody is prescribed less than this; a five-minute walk is not a session. */
const MIN_CARDIO_MINUTES = 10;
/** With no history at all, the first cardio prescription. */
const DEFAULT_CARDIO_MINUTES = 30;

export type GapLevel = "none" | "fresh" | "ease_back" | "restart";

export interface GapRule {
	days: number | null;
	level: GapLevel;
	/** One line for the prompt, and the "why" the brief can quote. */
	text: string;
}

export type PrescriptionRule = "new" | "hold" | "step_up" | "step_down" | "ease_back" | "restart" | "cardio";

export interface Prescription {
	exercise: string;
	muscle_groups: string[];
	load_lb: number | null;
	sets: number | null;
	reps: number | null;
	minutes: number | null;
	rule: PrescriptionRule;
	/** Why this number and not another — the sentence the coach may reuse verbatim. */
	why: string;
	days_since: number;
}

export interface RecoveryRule {
	/** Trained inside RECOVERY_DAYS — allowed as an accessory, never today's headline. */
	avoid_primary: string[];
	/** Longest since trained, freshest first — the natural targets for today. */
	prefer_primary: string[];
	text: string;
}

export interface CardioRule {
	minutes_today: number | null;
	text: string;
}

export type NudgeActionKind = "mark_reached" | "adjust_goal" | "weigh_in" | "close_items";

export interface NudgeAction {
	kind: NudgeActionKind;
	/** The goal the action is about, for mark_reached and adjust_goal. */
	goal_id: string | null;
	/** What the button says. The sentence around it is the model's. */
	label: string;
}

export interface NudgeSelection {
	action: NudgeAction | null;
	/** What the nudge must be about, in one line. The model writes the sentence. */
	subject: string;
}

/** The goal fields the rules read — a lean view of services/goals/store.ts's record. */
export interface CoachGoal {
	id: string;
	kind: string;
	title: string;
	priority: number;
	metrics: { measure: string; scope?: string | null; target?: number | null; unit?: string | null; direction?: string | null; by?: string | null }[];
	reached_candidate_at: string | null;
	stalled_since: string | null;
	/** From services/goals/detect.ts, when the caller computed it. */
	reached_why?: string | null;
	/** 0–1, the slowest metric's progress. */
	progress_percent?: number | null;
}

export interface CoachRules {
	gap: GapRule;
	recovery: RecoveryRule;
	cardio: CardioRule;
	prescriptions: Prescription[];
	nudge: NudgeSelection;
	/** Every rule above as a line the prompt can print. Order is the order they are read in. */
	statements: string[];
}

export interface BuildRulesInput {
	features: CoachFeatures;
	goals: CoachGoal[];
	/** Equipment per exercise from the catalogue, keyed by lower-cased name. */
	equipment?: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function round5(value: number): number {
	return Math.round(value / 5) * 5;
}

/** The plate step for one exercise: 5 lb, or 5 % of the load on a stack. */
export function stepFor(exercise: string, load: number | null, equipment?: Record<string, string[]>): number {
	const kit = equipment?.[exercise.trim().toLowerCase()] ?? [];
	if (load != null && kit.some((item) => STACK_EQUIPMENT.has(item))) {
		return Math.max(PLATE_STEP_LB, round5(load * MACHINE_STEP_FRACTION));
	}
	return PLATE_STEP_LB;
}

/**
 * The rep scheme the user is working to: the best sets × reps they have actually completed
 * **at the load they are on now**. Taken from their own logs rather than from a number in
 * the code, so it is honest for someone doing fives and someone doing twelves.
 *
 * Best rather than typical, and at the current load rather than across the window, for one
 * reason each: an average would drift *down* every time the user had a bad day, quietly
 * moving the finish line to wherever they happened to land; and a set of twelve at a
 * warm-up weight is not a target for the working weight. A target they have already proved
 * once is the only one a progression can honestly wait for.
 */
export function targetScheme(sessions: readonly ExerciseSession[]): { sets: number | null; reps: number | null } {
	const current = sessions[0]?.load_lb ?? null;
	const atCurrent = sessions.filter((session) => session.load_lb === current);
	const pool = atCurrent.length > 0 ? atCurrent : sessions;
	const best = (values: (number | null)[]): number | null => {
		const numbers = values.filter((value): value is number => value != null);
		return numbers.length === 0 ? null : Math.max(...numbers);
	};
	return { sets: best(pool.map((s) => s.sets)), reps: best(pool.map((s) => s.reps)) };
}

/** A session that hit the scheme on every set, with a reading we trust. */
function hitTarget(session: ExerciseSession, scheme: { sets: number | null; reps: number | null }): boolean {
	if (session.confidence === "low") return false;
	if (scheme.reps != null && (session.reps == null || session.reps < scheme.reps)) return false;
	if (scheme.sets != null && (session.sets == null || session.sets < scheme.sets)) return false;
	return true;
}

/** Days since the load last went up; null when it never has in the window. */
function daysSinceLastStep(feature: ExerciseFeature): number | null {
	const sessions = feature.sessions; // newest first
	for (let i = 0; i < sessions.length - 1; i += 1) {
		const newer = sessions[i] as ExerciseSession;
		const older = sessions[i + 1] as ExerciseSession;
		if (newer.load_lb != null && older.load_lb != null && newer.load_lb > older.load_lb) {
			return feature.days_since + (i === 0 ? 0 : daysBetweenSessions(sessions, 0, i));
		}
	}
	return null;
}

function daysBetweenSessions(sessions: readonly ExerciseSession[], from: number, to: number): number {
	const a = sessions[from]?.date;
	const b = sessions[to]?.date;
	if (!a || !b) return 0;
	return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

/**
 * concept-v2 §Coach: "After a 3–4 day gap the coach says so and eases back in … after two
 * weeks or more it treats the return as a restart rather than resuming yesterday's
 * progression. It never scolds about the gap — it just plans from where you actually are."
 */
export function gapRule(daysSinceLastWorkout: number | null): GapRule {
	if (daysSinceLastWorkout == null) {
		return {
			days: null,
			level: "restart",
			text: "Nothing trained in the last four weeks. Treat today as a first session: familiar movements, conservative loads, stop short of failure.",
		};
	}
	if (daysSinceLastWorkout >= RESTART_AFTER_DAYS) {
		return {
			days: daysSinceLastWorkout,
			level: "restart",
			text: `${daysSinceLastWorkout} days since the last session. This is a restart, not a resumption: one step lighter than the last logged load, a set fewer, full range. Do not mention the gap as a failing.`,
		};
	}
	if (daysSinceLastWorkout >= EASE_BACK_AFTER_DAYS) {
		return {
			days: daysSinceLastWorkout,
			level: "ease_back",
			text: `${daysSinceLastWorkout} days since the last session. Ease back in: familiar movements, loads held rather than raised, a set fewer than usual. Say so plainly, without scolding.`,
		};
	}
	if (daysSinceLastWorkout <= 1) {
		return {
			days: daysSinceLastWorkout,
			level: "fresh",
			text:
				daysSinceLastWorkout === 0
					? "Already trained today. Anything prescribed is in addition to that — consider mobility, cardio or rest."
					: "Trained yesterday. Yesterday's muscle groups are still recovering.",
		};
	}
	return { days: daysSinceLastWorkout, level: "none", text: `${daysSinceLastWorkout} days since the last session — normal spacing.` };
}

/** "A muscle group trained within 48 h is not the day's primary target." */
export function recoveryRule(muscles: readonly MuscleFeature[]): RecoveryRule {
	const avoid = muscles.filter((muscle) => muscle.days_since != null && muscle.days_since < RECOVERY_DAYS);
	// muscleFeatures() already sorts longest-untrained first.
	const prefer = muscles.filter((muscle) => muscle.days_since == null || muscle.days_since >= RECOVERY_DAYS).slice(0, 4);

	const parts: string[] = [];
	if (avoid.length > 0) {
		parts.push(
			`Trained inside 48 hours and therefore not today's primary target: ${avoid
				.map((muscle) => `${muscle.muscle} (${muscle.days_since === 0 ? "today" : "yesterday"})`)
				.join(", ")}.`
		);
	}
	if (prefer.length > 0) {
		parts.push(
			`Longest since trained: ${prefer
				.map((muscle) => `${muscle.muscle} (${muscle.days_since == null ? "not in four weeks" : `${muscle.days_since} days`})`)
				.join(", ")}.`
		);
	}

	return {
		avoid_primary: avoid.map((muscle) => muscle.muscle),
		prefer_primary: prefer.map((muscle) => muscle.muscle),
		text: parts.join(" ") || "No training history to recover from.",
	};
}

/** "Cardio prescribed by weekly minutes vs the plan, not by yesterday." */
export function cardioRule(features: CoachFeatures): CardioRule {
	const { cardio } = features;
	if (cardio.short_by_min <= 0) {
		return {
			minutes_today: null,
			text: `Cardio: ${cardio.minutes_this_week} of ${cardio.weekly_target_min} min this week — the week is already there, so cardio is optional today.`,
		};
	}
	const base = features.exercises.find((exercise) => exercise.category === "cardio")?.last.duration_min ?? null;
	// One session's safe step: +10 % on what they last did, and never the whole shortfall
	// at once if that would be a jump (concept-v2's cardio rate).
	const ceiling = base == null ? DEFAULT_CARDIO_MINUTES : Math.max(MIN_CARDIO_MINUTES, round5(base * CARDIO_GROWTH));
	const minutes = Math.max(MIN_CARDIO_MINUTES, Math.min(round5(cardio.short_by_min), ceiling));
	return {
		minutes_today: minutes,
		text: `Cardio: ${cardio.minutes_this_week} of ${cardio.weekly_target_min} min this week, ${cardio.short_by_min} short. If today includes cardio, prescribe ${minutes} min — the shortfall capped at one safe step (+10 % on the last session).`,
	};
}

/**
 * The concrete load × sets × reps for every exercise the user has history for. This is the
 * function that means the model never has to pick a number.
 *
 * The rules, in the order they are applied (concept-v2 §Progression rules):
 *   1. A restart-length gap drops a step and a set; an ease-back gap holds the load.
 *   2. A new exercise is prescribed exactly what the user reported the first time.
 *   3. A session that missed the scheme (or was read at low confidence) holds; two in a row
 *      drops one step. Never punishes.
 *   4. Target reps on every set in two consecutive sessions steps up by one plate — unless
 *      the load already went up inside the last week.
 *   5. Otherwise: same load.
 */
export function prescribeLoads(
	features: CoachFeatures,
	{ equipment, gap }: { equipment?: Record<string, string[]>; gap?: GapRule } = {}
): Prescription[] {
	const gapLevel = (gap ?? gapRule(features.days_since_last_workout)).level;

	return features.exercises.map((feature) => {
		const base = {
			exercise: feature.exercise,
			muscle_groups: feature.muscle_groups,
			days_since: feature.days_since,
		};

		if (feature.category === "cardio") {
			const minutes = feature.last.duration_min;
			return {
				...base,
				load_lb: null,
				sets: null,
				reps: null,
				minutes,
				rule: "cardio" as const,
				why: `Last done ${feature.days_since} days ago${minutes ? ` for ${minutes} min` : ""}; cardio volume follows the week, not the session.`,
			};
		}

		const scheme = targetScheme(feature.sessions);
		const current = feature.last.load_lb;
		const step = stepFor(feature.exercise, current, equipment);
		const sets = scheme.sets ?? feature.last.sets;
		const reps = scheme.reps ?? feature.last.reps;

		if (gapLevel === "restart" && current != null) {
			return {
				...base,
				load_lb: Math.max(step, current - step),
				sets: sets == null ? null : Math.max(2, sets - 1),
				reps,
				minutes: null,
				rule: "restart" as const,
				why: `Coming back after ${feature.days_since} days: one step under the ${current} lb last logged, a set fewer.`,
			};
		}

		if (feature.sessions.length === 1) {
			return {
				...base,
				load_lb: current,
				sets: feature.last.sets,
				reps: feature.last.reps,
				minutes: null,
				rule: "new" as const,
				why: "First time on record — repeat what was logged before changing anything.",
			};
		}

		if (gapLevel === "ease_back") {
			return {
				...base,
				load_lb: current,
				sets: sets == null ? null : Math.max(2, sets - 1),
				reps,
				minutes: null,
				rule: "ease_back" as const,
				why: `Easing back in after ${gap?.days ?? features.days_since_last_workout} days: same ${current ?? "load"} lb, one set fewer.`,
			};
		}

		// Sessions at the load they are on now, newest first, stopping at the first one
		// that was lighter — that is what "consecutive" means for a progression.
		const atCurrent: ExerciseSession[] = [];
		for (const session of feature.sessions) {
			if (session.load_lb !== current) break;
			atCurrent.push(session);
		}
		const hits = atCurrent.filter((session) => hitTarget(session, scheme)).length;
		const missedLast = atCurrent.length > 0 && !hitTarget(atCurrent[0] as ExerciseSession, scheme);
		const missedTwice = missedLast && atCurrent.length > 1 && !hitTarget(atCurrent[1] as ExerciseSession, scheme);

		if (missedTwice && current != null) {
			return {
				...base,
				load_lb: Math.max(step, current - step),
				sets,
				reps,
				minutes: null,
				rule: "step_down" as const,
				why: `Two sessions short of ${scheme.reps ?? "target"} reps at ${current} lb — drop one step and build it back.`,
			};
		}

		if (missedLast) {
			return {
				...base,
				load_lb: current,
				sets,
				reps,
				minutes: null,
				rule: "hold" as const,
				why: `Last session came up short of ${scheme.reps ?? "target"} reps — same load again.`,
			};
		}

		const sinceStep = daysSinceLastStep(feature);
		const steppedThisWeek = sinceStep != null && sinceStep < MIN_DAYS_BETWEEN_STEPS;

		if (hits >= SESSIONS_AT_TARGET_BEFORE_STEP && current != null && !steppedThisWeek) {
			return {
				...base,
				load_lb: current + step,
				sets,
				reps,
				minutes: null,
				rule: "step_up" as const,
				why: `${hits} sessions at ${scheme.sets ?? "all"} × ${scheme.reps ?? "target"} with ${current} lb — up one step to ${current + step} lb.`,
			};
		}

		return {
			...base,
			load_lb: current,
			sets,
			reps,
			minutes: null,
			rule: "hold" as const,
			why: steppedThisWeek
				? `The load went up ${sinceStep} days ago — never more than one step a week, so hold ${current ?? "it"} lb.`
				: `${hits} of ${SESSIONS_AT_TARGET_BEFORE_STEP} sessions at target reps — hold ${current ?? "the load"} lb until it is two.`,
		};
	});
}

/**
 * The one nudge (concept-v2 §Output: "the single most useful thing"). WP4's
 * `reached_candidate_at` and `stalled_since` come first when they are set — a goal the user
 * has actually met is the most useful thing anyone could say — and the action is what the
 * app can do about it. The sentence itself is the model's; the button is not.
 */
export function selectNudge(features: CoachFeatures, goals: readonly CoachGoal[]): NudgeSelection {
	const byPriority = [...goals].sort((a, b) => a.priority - b.priority);

	const reached = byPriority.find((goal) => goal.reached_candidate_at != null);
	if (reached) {
		return {
			action: { kind: "mark_reached", goal_id: reached.id, label: "Mark it done" },
			subject: `The goal "${reached.title}" looks reached${reached.reached_why ? `: ${reached.reached_why}` : ""} Ask whether to mark it done and what comes next. Never say it is closed — only the user closes a goal.`,
		};
	}

	const stalled = byPriority.find((goal) => goal.stalled_since != null);
	if (stalled) {
		return {
			action: { kind: "adjust_goal", goal_id: stalled.id, label: "Adjust the goal" },
			subject: `The goal "${stalled.title}" has not moved since ${stalled.stalled_since}. Offer to adjust it — a different pace, a different date, or a different measure. Do not imply the user failed.`,
		};
	}

	if (features.data_quality.low_confidence_items.length > 0) {
		const item = features.data_quality.low_confidence_items[0];
		return {
			action: { kind: "close_items", goal_id: null, label: "Check the log" },
			subject: `${features.data_quality.low_confidence_items.length} item(s) this week are low confidence (e.g. ${item?.exercise} on ${item?.date} — ${item?.reason}). Ask the user to confirm them so the numbers can be trusted.`,
		};
	}

	if (features.data_quality.weigh_in_due) {
		const days = features.weight.days_since_weigh_in;
		return {
			action: { kind: "weigh_in", goal_id: null, label: "Weigh in" },
			subject:
				days == null
					? "No weigh-in on record at all, so there is no weight trend to advise from. Ask for one."
					: `The last weigh-in was ${days} days ago. Ask for one — the trend is what the plan is steered by.`,
		};
	}

	if (features.data_quality.unlogged_days.length > 0) {
		return {
			action: { kind: "close_items", goal_id: null, label: "Fill in the gaps" },
			subject: `${features.data_quality.unlogged_days.length} of the last 7 days have nothing logged. Say what that costs the advice, without scolding.`,
		};
	}

	// Nothing needs an action: the nudge is still the single most useful sentence, it just
	// has no button behind it.
	return { action: null, subject: "No outstanding action. Make the nudge the one thing that would most improve the next week." };
}

export function buildRules({ features, goals, equipment }: BuildRulesInput): CoachRules {
	const gap = gapRule(features.days_since_last_workout);
	const recovery = recoveryRule(features.muscles);
	const cardio = cardioRule(features);
	const prescriptions = prescribeLoads(features, { ...(equipment ? { equipment } : {}), gap });
	const nudge = selectNudge(features, goals);

	const statements = [
		gap.text,
		recovery.text,
		cardio.text,
		`Sessions: ${features.sessions_this_week} in the last 7 days${
			features.training_days_target ? ` against a plan of ${features.training_days_target}/week` : ""
		}.`,
		"Loads, sets and reps are prescribed below and are not yours to change: copy them exactly for any exercise you choose from the list. An exercise that is not on the list has no history, so give it no load — describe it and let the user pick the weight.",
		`Nudge: ${nudge.subject}`,
	];

	return { gap, recovery, cardio, prescriptions, nudge, statements };
}
