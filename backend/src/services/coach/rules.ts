import { DEFAULT_LOAD_DIRECTION, type LoadDirection } from "../../db/exercises.js";
import type { ReferenceLoad } from "../fusion/schema.js";
import { sameMovement } from "./completion.js";
import type { CoachFeatures, CoverageEntry, ExerciseFeature, ExerciseSession, MuscleFeature } from "./features.js";

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

export type PrescriptionRule =
	| "new"
	| "hold"
	| "step_up"
	| "step_down"
	| "ease_back"
	| "restart"
	| "cardio"
	/** From a load the user *stated* rather than one this log has seen — see below. */
	| "reference";

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
	/** Null for a `reference` prescription: this log has never seen the exercise done. */
	days_since: number | null;
	/**
	 * What `load_lb` MEANS (migration 0013). On "assistance" it is the help the machine
	 * gives, so the same rules run with the sign flipped: progress is less of it. The
	 * prompt is told, because a coach that says "up to 60 lb" on an assisted chin-up has
	 * told the user to get worse at it.
	 */
	load_direction: LoadDirection;
}

/**
 * The training background the user stated (migration 0011). Everything here is a claim,
 * not a measurement — which is exactly why it is worth having: without it a first brief
 * has to treat a three-year lifter as a beginner.
 */
export interface TrainingBackground {
	experience: string | null;
	background: string | null;
	reference_loads: ReferenceLoad[];
}

/** Sets for a stated load: they gave a weight and maybe reps, never a set count. */
export const REFERENCE_SETS = 3;

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

/**
 * How long a normal session is, when nobody has said (migration 0014). An hour: the number
 * every gym programme in print assumes, and the only defensible guess.
 */
export const DEFAULT_SESSION_MINUTES = 60;
/** Below this there is no session to size — a warm-up and one movement. */
export const MIN_SESSION_MINUTES = 10;
export const MAX_SESSION_MINUTES = 240;

/**
 * The session's shape, from its minutes (user decision 2026-08-31: "brief sizing scales
 * with the effective minutes — as prompt rules plus a deterministic cap").
 *
 * Both halves matter. The prompt is *told* the minutes and the shape, because a model that
 * knows it has twenty-five minutes writes a different session than one told "keep it short".
 * And the cap is applied afterwards in code, because a model asked for four exercises will
 * occasionally answer with seven and the user with twenty-five minutes is the one who pays.
 *
 * The arithmetic, stated once so it can be argued with: about eight working minutes per
 * exercise (sets, rest and the walk to the rack), five minutes of warm-up, and the finisher
 * off the end. That gives roughly 5 exercises at an hour, which is what the prompt has
 * always asked for — so the default changes nobody's brief.
 */
export const MINUTES_PER_EXERCISE = 8;
const WARM_UP_MINUTES = 5;

export interface SessionSizing {
	/** The minutes this session is being built for. */
	minutes: number;
	/** True when the user said so; false when this is the default. */
	stated: boolean;
	/** The hard ceiling on the Do list. Applied in code as well as asked for. */
	max_exercises: number;
	/** What the prompt asks for — one under the cap, so there is room to be generous. */
	target_exercises: number;
	/** How many stretch/mobility items close the session. 0 when there is no room. */
	finisher_items: number;
	text: string;
}

/** Everything above, from a number of minutes. Pure, and the only place the maths lives. */
export function sessionSizing(minutes: number | null, stated: boolean): SessionSizing {
	const effective = Math.min(
		MAX_SESSION_MINUTES,
		Math.max(MIN_SESSION_MINUTES, Math.round(minutes ?? DEFAULT_SESSION_MINUTES))
	);
	// The finisher takes its share off the top before the exercises are counted, so a short
	// session does not lose a movement to the stretching and then get stretching anyway.
	const finisherItems = effective < 25 ? 2 : effective < 45 ? 3 : 4;
	const finisherMinutes = finisherItems;
	const working = Math.max(MINUTES_PER_EXERCISE, effective - WARM_UP_MINUTES - finisherMinutes);
	const target = Math.max(2, Math.min(8, Math.floor(working / MINUTES_PER_EXERCISE)));
	// One over the ask: the cap exists to stop a session nobody has time for, not to refuse
	// a sixth movement the model had a reason for.
	const cap = Math.min(10, target + 1);

	return {
		minutes: effective,
		stated,
		max_exercises: cap,
		target_exercises: target,
		finisher_items: finisherItems,
		text: `SESSION LENGTH: ${effective} minutes${
			stated ? " (the user said so)" : " (nobody has said, so this is the standing hour)"
		}. That is room for about ${target} exercise${target === 1 ? "" : "s"} — never more than ${cap} — plus ${finisherItems} short stretch or mobility items to close. If the user's context names a different length today, use THAT and re-size to it. Fewer, harder movements beat a list nobody can finish.`,
	};
}

/**
 * The rotation's debts (user decision 2026-08-31 — the coverage ledger). Everything the
 * ledger says is overdue, longest first, with the instruction that makes it binding: within
 * the recovery constraints, today retires the largest debts it can.
 */
export function coverageRule(coverage: readonly CoverageEntry[], avoidPrimary: readonly string[]): string | null {
	if (coverage.length === 0) return null;
	const debts = coverage.filter((entry) => entry.overdue);
	const line = (entry: CoverageEntry): string =>
		entry.days_since == null
			? `${entry.label}: never served in four weeks`
			: `${entry.label}: ${entry.days_since} day${entry.days_since === 1 ? "" : "s"} unserved (${entry.sets_14d} ${entry.unit} in 14d, ${entry.sets_28d} in 28d)`;

	if (debts.length === 0) {
		return `COVERAGE: nothing is overdue — every muscle on the ledger has been served inside two weeks. Keep the rotation moving; the least recently served are ${coverage
			.slice(0, 3)
			.map((entry) => entry.label)
			.join(", ")}.`;
	}

	const recovering =
		avoidPrimary.length > 0
			? ` Anything on the 48-hour list (${avoidPrimary.join(", ")}) waits its turn — a debt is not a reason to train a muscle that is still recovering.`
			: "";
	return `COVERAGE DEBTS (the rotation owes these — longest first):\n${debts
		.map((entry) => `- ${line(entry)}`)
		.join(
			"\n"
		)}\nRETIRE THE LARGEST DEBTS YOU CAN TODAY, within the recovery constraints. Over two to four weeks every entry on this ledger gets served; a muscle that keeps losing to the day's theme is how a programme quietly stops covering the body.${recovering}`;
}

/**
 * Variety, and the one introduction a plan is allowed (user decision 2026-08-31). Written
 * as a rule rather than left to the model's taste, because "include some bodyweight work"
 * and "at most one new thing" are both constraints the user stated.
 */
/**
 * How much appetite the user has stated for new work — read from their OWN words.
 *
 * User report 2026-09-03: "I was hoping to start working out new stuff; feels the same as
 * working out on my own", alongside a preference typed into the app asking for variety and
 * for new exercises. One introduction per plan is the right default for somebody who has
 * said nothing; it is the wrong answer for somebody who has just asked, in writing, to be
 * shown new movements.
 *
 * Deterministic and conservative: it reads the stated background, which is the field their
 * sentence lands in, and it only moves off the default when the words are unambiguous. A
 * stated preference for routine lowers nothing below the default — one introduction is
 * already the floor — but it is recognised so the prompt can stop offering.
 */
export type VarietyAppetite = "wants" | "steady" | "default";

const WANTS_VARIETY =
	/\bvariety\b|\brotate\b|\brotation\b|mix (it |things )?up|new (exercises|movements|stuff|things)|different (exercises|movements)|something new|keep me interested|\bbored\b/i;
const WANTS_ROUTINE =
	/keep it simple|same routine|stick to (the|my)|no surprises|don'?t change|nothing new/i;

export function varietyAppetite(background: TrainingBackground = NO_BACKGROUND): VarietyAppetite {
	const said = [background.background, background.experience].filter(Boolean).join(" ");
	if (!said.trim()) return "default";
	// Routine wins a tie: a user who says both is asking for care, not for novelty.
	if (WANTS_ROUTINE.test(said)) return "steady";
	if (WANTS_VARIETY.test(said)) return "wants";
	return "default";
}

/**
 * How many never-logged movements one plan may introduce.
 *
 * One is the standing rule (user decision 2026-08-31 §B8) and stays the default. A stated
 * appetite for new work raises it — still capped, because a session that is mostly movements
 * the user has never done is a session they cannot load with any confidence.
 */
export const MAX_NEW_PER_PLAN = { default: 1, steady: 1, wants: 3 } as const;

export function varietyRule(candidates: readonly string[], appetite: VarietyAppetite = "default"): string {
	const allowance = MAX_NEW_PER_PLAN[appetite];
	const introduction =
		candidates.length === 0
			? "There is nothing in the catalogue this user has not already logged, so introduce nothing: set is_new false on every exercise."
			: appetite === "wants"
				? `This user has ASKED to be shown new movements. Include UP TO ${allowance} exercises they have never logged — two is a good answer on most days — chosen from this list and from nowhere else: ${candidates.join(
						", "
					)}. Set is_new true on each one and put the reason in its note in one line ("your calves have had nothing in three weeks"). Every other exercise has is_new false. Never introduce more than ${allowance}: a session built mostly of movements they have never done is one they cannot load with any confidence.`
				: `You may include AT MOST ONE exercise the user has never logged. Choose it from this list and from nowhere else — ${candidates.join(
						", "
					)} — set is_new true on exactly that one, and put the reason in its note in one line ("your calves have had nothing in three weeks"). Every other exercise has is_new false. Introducing nothing is a perfectly good answer; introducing two is not.`;
	return `VARIETY AND INTRODUCTIONS
- Rotate the movements, not just the muscles. A session that is the same five lifts every week is how a plan stops being read.
- Bodyweight work belongs in the rotation on its own merits — push-ups, chin-ups, dips, planks, lunges, glute bridges — not only as a fallback when equipment is missing.
- ${introduction}
- Close a training day with the short stretch or mobility finisher (the number of items is in SESSION LENGTH), targeting the muscles TODAY actually trained. A rest day has no finisher.`;
}

export type NudgeActionKind = "mark_reached" | "adjust_goal" | "weigh_in" | "close_items" | "tell_background";

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
	/** How long today's session is and what fits in it (migration 0014). */
	sizing: SessionSizing;
	prescriptions: Prescription[];
	/**
	 * Movements taken off today's menu because their PRIMARY muscle is still recovering
	 * (§recoveringExercises). Computed once: the prompt's statement is written from this
	 * list and the model's answer is enforced against the same one, so the request and the
	 * rule cannot drift apart.
	 */
	off_menu: { exercise: string; muscle: string }[];
	/**
	 * How many never-logged movements this plan may introduce — 1 unless the user has said
	 * they want to be shown new work (§varietyAppetite). Asked for in the prompt and capped
	 * here, the same way the plan's size is.
	 */
	max_new: number;
	nudge: NudgeSelection;
	/** Every rule above as a line the prompt can print. Order is the order they are read in. */
	statements: string[];
}

export interface BuildRulesInput {
	features: CoachFeatures;
	goals: CoachGoal[];
	/** Equipment per exercise from the catalogue, keyed by lower-cased name. */
	equipment?: Record<string, string[]>;
	/** `load_direction` per exercise from the catalogue, keyed the same way (migration 0013). */
	loadDirection?: Record<string, LoadDirection>;
	/**
	 * What each movement is primarily for, keyed the same way. The recovery rule reads it to
	 * take a movement off today's menu when its primary muscle is still recovering
	 * (§recoveringExercises).
	 */
	primaryMuscle?: Record<string, string>;
	/** What the user said they bring with them, when they have said anything. */
	background?: TrainingBackground;
	/** The profile's stated session length; null falls back to DEFAULT_SESSION_MINUTES. */
	sessionMinutes?: number | null;
	/** Catalogue names this user has never logged — the pool an introduction is drawn from. */
	introductionCandidates?: readonly string[];
}

const NO_BACKGROUND: TrainingBackground = { experience: null, background: null, reference_loads: [] };

/**
 * True when this user is a cold start we know nothing about: nothing logged in four weeks
 * and nothing stated either. That is the one case where the coach has to guess, and the
 * honest answer is to prescribe carefully and ask — not to assume a beginner, which is
 * what "no history" used to be silently read as.
 */
export function needsBackground(features: CoachFeatures, background: TrainingBackground): boolean {
	return (
		features.exercises.length === 0 &&
		!background.experience &&
		!background.background &&
		background.reference_loads.length === 0
	);
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

/** Which way this exercise's load points; anything the catalogue has not said is resistance. */
export function directionFor(exercise: string, directions?: Record<string, LoadDirection>): LoadDirection {
	return directions?.[exercise.trim().toLowerCase()] ?? DEFAULT_LOAD_DIRECTION;
}

/**
 * The two moves every progression rule is made of, with the one sign that matters in them.
 *
 * On a barbell, harder is more weight. On an assisted machine the number is the help, so
 * harder is *less* of it — and the floor is 0, which is the whole point: no help left is a
 * bodyweight chin-up, which is where an assisted chin-up is trying to get to. A resistance
 * load never goes below one step, because an empty bar is not a prescription.
 */
function harder(load: number, step: number, direction: LoadDirection): number {
	return direction === "assistance" ? Math.max(0, load - step) : load + step;
}

function easier(load: number, step: number, direction: LoadDirection): number {
	return direction === "assistance" ? load + step : Math.max(step, load - step);
}

/** "55 lb" on a barbell; "55 lb of assistance" on a machine that is helping. */
function say(load: number | null, direction: LoadDirection): string {
	if (load == null) return direction === "assistance" ? "the assistance" : "the load";
	return direction === "assistance" ? `${load} lb of assistance` : `${load} lb`;
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

/**
 * Days since the load last got HARDER; null when it never has in the window. On an
 * assisted machine that is the number going down, which is why the direction has to reach
 * this far: "never more than one step a week" is a rule about progress, not about a sign.
 */
function daysSinceLastStep(feature: ExerciseFeature, direction: LoadDirection): number | null {
	const sessions = feature.sessions; // newest first
	const progressed = (newer: number, older: number): boolean =>
		direction === "assistance" ? newer < older : newer > older;
	for (let i = 0; i < sessions.length - 1; i += 1) {
		const newer = sessions[i] as ExerciseSession;
		const older = sessions[i + 1] as ExerciseSession;
		if (newer.load_lb != null && older.load_lb != null && progressed(newer.load_lb, older.load_lb)) {
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
					? // Never "rest, then" — that is a verdict on work already done, and it is
						// the bug this wording exists to prevent (user decision 2026-08-31 §A2).
						// See the NEVER A RETROACTIVE REST rule in services/coach/prompt.ts.
						// Written as a directive rather than as advice because the live model
						// read the gentler version, agreed with it, and still answered "rest".
						"Already trained today. Name what was done and build the plan around it: anything you add is a COMPLEMENT to that session. workout.type MUST NOT be \"rest\" and the Do list MUST NOT be empty — a ten-minute stretch of what was trained, an easy walk, or two mobility drills is a complete answer. Say \"nothing more strenuous today\" in the prose if that is the truth, never by emptying the list."
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

/**
 * The next cardio session's minutes: the week's shortfall, capped at one safe step on the
 * last session (+10 %), floored so that nothing shorter than a walk is ever "prescribed".
 * Null when the week is already at its target — there is nothing to step toward.
 *
 * One function, two callers, for the same reason `prescribeLoads` has two: the brief says
 * how long today's cardio should be and the training board says it on the row for the
 * machine it is about (services/training/board.ts). If they ever disagreed it would be a
 * bug in here rather than a difference of opinion between two screens.
 *
 * Rounded to the minute. `cardioRule` rounds its own answer to the nearest five afterwards,
 * because a session plan is written in fives and a row about one treadmill is not: "22 min
 * next" is the step the +10 % actually asks for, and rounding it to 20 is the progression
 * quietly not happening.
 *
 * **`shortByMin` is EQUIVALENT minutes** (services/coach/cardioIntensity.ts) and the answer
 * is WALL-CLOCK minutes, which is why the multiplier divides: twenty equivalent minutes are
 * paid off by twenty moderate minutes or by ten hard ones, and prescribing twenty minutes of
 * running against a twenty-minute debt would be asking for twice the work the week is short.
 * A caller with no opinion about the intensity passes nothing and gets the moderate answer,
 * which is what this number always meant.
 */
export function cardioNextMinutes(shortByMin: number, lastMinutes: number | null, multiplier = 1): number | null {
	if (shortByMin <= 0) return null;
	const factor = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
	const ceiling = lastMinutes == null ? DEFAULT_CARDIO_MINUTES : Math.ceil(lastMinutes * CARDIO_GROWTH);
	return Math.max(MIN_CARDIO_MINUTES, Math.min(Math.round(shortByMin / factor), ceiling));
}

/** "Cardio prescribed by weekly minutes vs the plan, not by yesterday." */
/**
 * How many cardio sessions running on one modality is a rut rather than a routine.
 *
 * Two is a preference; three in a row is the treadmill (user report 2026-09-03: "cardio is
 * stuck on incline treadmill"). Only consulted when the user has ASKED for variety —
 * following the history is the right default for everybody else, and always was.
 */
export const CARDIO_RUT_SESSIONS = 3;

/**
 * The cardio the user has actually been doing, most recent first, one entry per session.
 *
 * Equivalent minutes already normalise the credit across modalities
 * (services/coach/cardioIntensity.ts), so rotating costs the week nothing: twenty hard
 * minutes on a rower is worth the same as twenty hard minutes on a treadmill. That is what
 * makes this rule safe to state as strongly as it is.
 */
export function recentCardioModalities(features: CoachFeatures, limit = CARDIO_RUT_SESSIONS): string[] {
	// SESSIONS, not exercises: `features.exercises` holds one entry per movement with its
	// sessions inside it, so three treadmill walks are one entry — and a rut counted off
	// entries can never reach three, which is how the first version of this rule silently
	// never fired.
	return features.exercises
		.filter((exercise) => exercise.category === "cardio")
		.flatMap((exercise) => exercise.sessions.map((session) => ({ name: exercise.exercise, date: session.date })))
		.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
		.slice(0, limit)
		.map((session) => session.name);
}

/**
 * "You have done the same one three times running and you asked for variety, so pick
 * another." Null when the user has not asked, or when there is no rut to name.
 */
export function cardioRotationRule(
	features: CoachFeatures,
	appetite: VarietyAppetite,
	candidates: readonly string[] = []
): string | null {
	if (appetite !== "wants") return null;
	const recent = recentCardioModalities(features);
	if (recent.length < CARDIO_RUT_SESSIONS) return null;
	// Every recent session on one modality, by the log's own matcher so "Treadmill Run" and
	// "treadmill run" are one thing.
	const [first, ...rest] = recent as [string, ...string[]];
	if (!rest.every((name) => sameMovement(first, name))) return null;

	const alternatives = candidates.filter((name) => !sameMovement(first, name)).slice(0, 6);
	return `CARDIO ROTATION — the last ${recent.length} cardio sessions were all ${first}, and this user has asked for variety. Prescribe a DIFFERENT modality today${
		alternatives.length > 0 ? `: ${alternatives.join(", ")} are all available` : ""
	}. Equivalent minutes already price the modalities against each other, so the week's target is unaffected by the swap — do not prescribe ${first} again today unless the user asked for it in as many words.`;
}

export function cardioRule(features: CoachFeatures): CardioRule {
	const { cardio } = features;
	// The week in the currency the target is actually in, with the arithmetic beside it so
	// nobody has to take "50 of 150" on faith when 65 minutes were logged.
	const week = `${cardio.equiv_minutes_this_week} of ${cardio.weekly_target_min} equivalent min this week${
		cardio.equiv_text ? ` (${cardio.equiv_text})` : ""
	}`;
	if (cardio.short_by_min <= 0) {
		return {
			minutes_today: null,
			text: `Cardio: ${week} — the week is already there, so cardio is optional today.`,
		};
	}
	const base = features.exercises.find((exercise) => exercise.category === "cardio")?.last.duration_min ?? null;
	// One session's safe step: +10 % on what they last did, and never the whole shortfall
	// at once if that would be a jump (concept-v2's cardio rate). Priced at moderate, because
	// the brief cannot know yet how hard the user will choose to go.
	const step = cardioNextMinutes(cardio.short_by_min, base) as number;
	const minutes = Math.max(MIN_CARDIO_MINUTES, round5(step));
	const alternative = cardio.alternatives_text ? ` The whole shortfall is ${cardio.alternatives_text}.` : "";
	return {
		minutes_today: minutes,
		text: `Cardio: ${week}, ${cardio.short_by_min} short. If today includes cardio, prescribe ${minutes} moderate min — the shortfall capped at one safe step (+10 % on the last session). Vigorous work counts double and light work counts half, so the same prescription may be offered in those terms instead.${alternative}`,
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
 *
 * And, since the training-background fix: an exercise with **no logged history but a
 * stated reference load** ("I bench 165 for 3×5") is prescribed from the reference under
 * the same rules. A statement is not a measurement, so the moment the exercise has real
 * sessions behind it the log wins and the reference is not looked at again.
 */
export function prescribeLoads(
	features: CoachFeatures,
	{
		equipment,
		loadDirection,
		gap,
		referenceLoads = [],
	}: {
		equipment?: Record<string, string[]>;
		/** Catalogue `load_direction` per exercise, keyed by lower-cased name (migration 0013). */
		loadDirection?: Record<string, LoadDirection>;
		gap?: GapRule;
		referenceLoads?: readonly ReferenceLoad[];
	} = {}
): Prescription[] {
	const resolvedGap = gap ?? gapRule(features.days_since_last_workout);
	const gapLevel = resolvedGap.level;

	const logged = features.exercises.map((feature) => {
		const direction = directionFor(feature.exercise, loadDirection);
		const base = {
			exercise: feature.exercise,
			muscle_groups: feature.muscle_groups,
			days_since: feature.days_since,
			load_direction: direction,
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
				load_lb: easier(current, step, direction),
				sets: sets == null ? null : Math.max(2, sets - 1),
				reps,
				minutes: null,
				rule: "restart" as const,
				why:
					direction === "assistance"
						? `Coming back after ${feature.days_since} days: one step MORE help than the ${current} lb last logged, a set fewer.`
						: `Coming back after ${feature.days_since} days: one step under the ${current} lb last logged, a set fewer.`,
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
				why:
					direction === "assistance"
						? `Easing back in after ${gap?.days ?? features.days_since_last_workout} days: same ${say(current, direction)}, one set fewer.`
						: `Easing back in after ${gap?.days ?? features.days_since_last_workout} days: same ${current ?? "load"} lb, one set fewer.`,
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
				load_lb: easier(current, step, direction),
				sets,
				reps,
				minutes: null,
				rule: "step_down" as const,
				why:
					direction === "assistance"
						? `Two sessions short of ${scheme.reps ?? "target"} reps at ${say(current, direction)} — one step MORE help and build it back.`
						: `Two sessions short of ${scheme.reps ?? "target"} reps at ${current} lb — drop one step and build it back.`,
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
				why: `Last session came up short of ${scheme.reps ?? "target"} reps — same ${
					direction === "assistance" ? "assistance" : "load"
				} again.`,
			};
		}

		const sinceStep = daysSinceLastStep(feature, direction);
		const steppedThisWeek = sinceStep != null && sinceStep < MIN_DAYS_BETWEEN_STEPS;

		if (hits >= SESSIONS_AT_TARGET_BEFORE_STEP && current != null && !steppedThisWeek) {
			const next = harder(current, step, direction);
			return {
				...base,
				load_lb: next,
				sets,
				reps,
				minutes: null,
				rule: "step_up" as const,
				why:
					direction === "assistance"
						? `${hits} sessions at ${scheme.sets ?? "all"} × ${scheme.reps ?? "target"} with ${say(current, direction)} — one step LESS help, ${next} lb. Progress here is the number coming down.`
						: `${hits} sessions at ${scheme.sets ?? "all"} × ${scheme.reps ?? "target"} with ${current} lb — up one step to ${next} lb.`,
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
				? direction === "assistance"
					? `The assistance came down ${sinceStep} days ago — never more than one step a week, so hold ${say(current, direction)}.`
					: // `say` rather than an inline "lb": a band movement carries no load at all, and
						// "hold the load lb" is what the template said about one before the band pack
						// went in (2026-09-02). Null is a real state here — the Plank has always had it.
						`The load went up ${sinceStep} days ago — never more than one step a week, so hold ${say(current, direction)}.`
				: direction === "assistance"
					? `${hits} of ${SESSIONS_AT_TARGET_BEFORE_STEP} sessions at target reps — hold ${say(current, direction)} until it is two.`
					: `${hits} of ${SESSIONS_AT_TARGET_BEFORE_STEP} sessions at target reps — hold ${say(current, direction)} until it is two.`,
		};
	});

	return [...logged, ...prescribeFromReferences(logged, referenceLoads, resolvedGap, equipment, loadDirection)];
}

/**
 * The movements that are off today's menu because what they are FOR is still recovering
 * (user field report 2026-09-03).
 *
 * The screenshot: yesterday was a pull day — deadlift 3×10 at 115, good mornings, all
 * completed. This morning's plan targeted quads, glutes, shoulders and abs, and prescribed
 * **deadlift and good morning again**, under 24 hours later. The recovery rule was working
 * exactly as written and exactly as uselessly: it gated the day's stated TARGETS, and said
 * nothing about which exercises could serve them. A plan can name any targets it likes and
 * still be a hamstring session.
 *
 * So the rule extends to the exercises. An exercise whose **primary** muscle was trained
 * inside 48 hours is off the menu, whatever target it would nominally serve. Secondary
 * overlap stays allowed and always will — nobody squats without hamstrings, and a rule that
 * banned incidental involvement would ban training.
 *
 * The primary comes from the catalogue's own ordering, with the log's first muscle group as
 * the fallback for a movement the catalogue has never heard of. A movement with neither is
 * not blocked: silence is not evidence.
 */
export function recoveringExercises(
	features: CoachFeatures,
	recovery: RecoveryRule,
	primaryMuscle: Record<string, string> = {}
): { exercise: string; muscle: string }[] {
	const avoid = new Set(recovery.avoid_primary.map((muscle) => muscle.trim().toLowerCase()));
	if (avoid.size === 0) return [];

	return features.exercises.flatMap((exercise) => {
		const key = exercise.exercise.trim().toLowerCase();
		const primary = (primaryMuscle[key] ?? exercise.muscle_groups[0] ?? "").trim().toLowerCase();
		return primary && avoid.has(primary) ? [{ exercise: exercise.exercise, muscle: primary }] : [];
	});
}

/** The line the prompt prints about them, and the reason it names each one. */
export function recoveringExercisesStatement(blocked: readonly { exercise: string; muscle: string }[]): string | null {
	if (blocked.length === 0) return null;
	return `OFF THE MENU TODAY — trained inside 48 hours, so these movements are not available whatever today's targets are: ${blocked
		.map((item) => `${item.exercise} (${item.muscle})`)
		.join(", ")}. Do not prescribe them, do not substitute a near-identical movement for the same primary muscle, and do not work around this by renaming them. Muscles they hit as SECONDARY work are fine.`;
}

/**
 * The stated loads, for the exercises the log has nothing on. Two deliberate choices:
 *
 *   * A restart steps the reference down only when the gap is a *measured* one. On a brand
 *     new account `days_since_last_workout` is null and `gapRule` calls that a restart —
 *     but "we have never seen you train" is not "you stopped training", and taking a plate
 *     off a load the user told us they lift today is the beginner assumption this whole
 *     change exists to remove.
 *   * A stated load never carries a set count, because nobody says one the same way twice.
 *     Three sets is the plain starting scheme and the `why` says so.
 */
function prescribeFromReferences(
	logged: readonly Prescription[],
	references: readonly ReferenceLoad[],
	gap: GapRule,
	equipment?: Record<string, string[]>,
	loadDirection?: Record<string, LoadDirection>
): Prescription[] {
	if (references.length === 0) return [];
	const known = new Set(logged.map((item) => item.exercise.trim().toLowerCase()));
	const out: Prescription[] = [];

	for (const reference of references) {
		const key = reference.exercise.trim().toLowerCase();
		if (known.has(key)) continue;
		known.add(key);

		const stated = reference.load_lb;
		const easing = gap.level === "restart" && gap.days != null;
		const step = stepFor(reference.exercise, stated, equipment);
		const direction = directionFor(reference.exercise, loadDirection);
		out.push({
			exercise: reference.exercise,
			muscle_groups: [],
			load_lb: easing ? easier(stated, step, direction) : stated,
			sets: easing ? Math.max(2, REFERENCE_SETS - 1) : REFERENCE_SETS,
			reps: reference.reps,
			minutes: null,
			rule: "reference",
			why: easing
				? `Stated, not logged: ${say(stated, direction)}${reference.reps ? ` for ${reference.reps}` : ""}. Coming back after ${gap.days} days, so one step ${
						direction === "assistance" ? "more help" : "under it"
					} and a set fewer.`
				: `Stated, not logged: the user says they lift ${say(stated, direction)}${reference.reps ? ` for ${reference.reps}` : ""}. Start there and let the log take over.`,
			days_since: null,
			load_direction: direction,
		});
	}
	return out;
}

/**
 * The one nudge (concept-v2 §Output: "the single most useful thing"). WP4's
 * `reached_candidate_at` and `stalled_since` come first when they are set — a goal the user
 * has actually met is the most useful thing anyone could say — and the action is what the
 * app can do about it. The sentence itself is the model's; the button is not.
 */
export function selectNudge(
	features: CoachFeatures,
	goals: readonly CoachGoal[],
	background: TrainingBackground = NO_BACKGROUND
): NudgeSelection {
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

	// Before any of the log-quality nudges: with nothing logged they would all fire, and
	// "you have not logged anything" is a worse thing to say to a new user than "tell me
	// where you are starting from" — which is also the one answer that improves every
	// brief after it (concept-v2 §Coach — the single most useful thing).
	if (needsBackground(features, background)) {
		return {
			action: { kind: "tell_background", goal_id: null, label: "Tell me your background" },
			subject:
				"Nothing is logged yet and the user has not said what they bring with them. Ask for their training background in one sentence — how long they have trained and what they lift now (\"three years, I bench 165 for 3×5\") — and say plainly that it is what stops the first sessions being pitched at a beginner.",
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

export function buildRules({
	features,
	goals,
	equipment,
	loadDirection,
	primaryMuscle,
	background = NO_BACKGROUND,
	sessionMinutes = null,
	introductionCandidates = [],
}: BuildRulesInput): CoachRules {
	const gap = gapRule(features.days_since_last_workout);
	const recovery = recoveryRule(features.muscles);
	const cardio = cardioRule(features);
	const sizing = sessionSizing(sessionMinutes, sessionMinutes != null);
	const blocked = recoveringExercises(features, recovery, primaryMuscle ?? {});
	const blockedNames = new Set(blocked.map((item) => item.exercise.trim().toLowerCase()));
	// The menu is filtered, not merely discouraged: an exercise the model cannot see the
	// numbers for is one it is far less likely to reach for, and the statement below says
	// out loud why it is missing. Enforcement after the answer lives in coach.ts.
	const prescriptions = prescribeLoads(features, {
		...(equipment ? { equipment } : {}),
		...(loadDirection ? { loadDirection } : {}),
		gap,
		referenceLoads: background.reference_loads,
	}).filter((item) => !blockedNames.has(item.exercise.trim().toLowerCase()));
	const appetite = varietyAppetite(background);
	const nudge = selectNudge(features, goals, background);

	const statements = [
		gap.text,
		recovery.text,
		recoveringExercisesStatement(blocked),
		cardio.text,
		sizing.text,
		coverageRule(features.coverage ?? [], recovery.avoid_primary),
		cardioRotationRule(features, appetite, introductionCandidates),
		varietyRule(introductionCandidates, appetite),
		`Sessions: ${features.sessions_this_week} in the last 7 days${
			features.training_days_target ? ` against a plan of ${features.training_days_target}/week` : ""
		}.`,
		"Loads, sets and reps are prescribed below and are not yours to change: copy them exactly for any exercise you choose from the list. An exercise that is not on the list has no history, so give it no load — describe it and let the user pick the weight.",
		assistanceStatement(prescriptions),
		backgroundStatement(features, background),
		`Nudge: ${nudge.subject}`,
	].filter((line): line is string => line !== null);

	return { gap, recovery, cardio, sizing, prescriptions, off_menu: blocked, max_new: MAX_NEW_PER_PLAN[appetite], nudge, statements };
}

/**
 * The one line the model needs when an assisted machine is in today's list. Only printed
 * when there is one, because a rule about a case that is not in front of it is a rule it
 * can misapply.
 */
function assistanceStatement(prescriptions: readonly Prescription[]): string | null {
	const assisted = prescriptions.filter((item) => item.load_direction === "assistance");
	if (assisted.length === 0) return null;
	return `ASSISTED MACHINES — ${assisted
		.map((item) => item.exercise)
		.join(", ")}: the load on these is the HELP the machine gives, not resistance. More pounds is EASIER, and getting stronger means the number goes DOWN towards a bodyweight rep. Say it that way ("50 lb of assistance, one plate less help than last time"); never call it "lighter" or congratulate a bigger number, and never tell the user to add weight to one.`;
}

/**
 * What the coach is allowed to assume about a user it has no logs for. Three cases, and
 * the middle one is the point of the whole change: "nothing logged" used to mean "treat
 * them as a beginner", and it never did mean that.
 */
function backgroundStatement(features: CoachFeatures, background: TrainingBackground): string | null {
	if (features.exercises.length > 0) return null;
	if (needsBackground(features, background)) {
		return "Nothing has ever been logged and this user has said nothing about their training background, so you do not know whether they are new to this. Do NOT assume a beginner and do not assume an athlete: prescribe a short, cautious first session with no loads, tell them to pick a weight they can control for the reps, and say in one clause that you are starting carefully because you do not know their background yet.";
	}
	const stated = [
		background.experience ? `they describe themselves as ${background.experience}` : null,
		background.background ? `in their words: "${background.background}"` : null,
		background.reference_loads.length > 0
			? `they state they currently lift ${background.reference_loads
					.map((load) => `${load.exercise} ${load.load_lb} lb${load.reps ? ` × ${load.reps}` : ""}`)
					.join(", ")}`
			: null,
	].filter(Boolean);
	return `Nothing is logged yet, but this user told you where they are starting from — ${stated.join("; ")}. Pitch the session at that, not at a beginner. The stated loads are in PRESCRIBED LOADS below; they are a claim rather than a measurement, so use them as given and let the first real sessions correct them.`;
}
