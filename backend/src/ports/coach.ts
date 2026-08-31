import type { CoachFeatures } from "../services/coach/features.js";
import type { CoachGoal, CoachRules } from "../services/coach/rules.js";
import type { CoachBriefOutput } from "../services/coach/schema.js";

// The coach (docs/build-plan.md §Architecture: "CoachPort: brief(inputs) → Brief (default
// impl composes LlmPort)").
//
// It is its own port rather than a call site of LlmPort because the brief is a *decision*
// the app makes, not a model call it happens to run: a rules-only coach, a cheaper model
// for the free tier, or a hosted service later are all swaps behind this interface, and
// none of them should touch a route. The default implementation is
// adapters/coach/llm.ts, which composes LlmPort with the prompt and schema from
// services/coach/.
//
// The types below are the domain's, defined in services/coach/ where the pure code lives,
// and imported here as types only — the same way ports/llm.ts imports zod. A port may name
// the shapes it carries; what it may not do is import an SDK.

/** The plan the user has stated, as the coach reads it (docs/concept-v2.md §Coach — Inputs). */
/** The gym (or spare room) the user trains in, and the kit seen there so far. */
export interface CoachPlace {
	name: string;
	kind: string;
	/** Machines and movements observed there, most used first. */
	equipment: string[];
}

export interface CoachPlan {
	goal_pace: string | null;
	diet_style: string | null;
	/** Days per week the user says they train. */
	training_days: number | null;
	environment: string | null;
	equipment: string[];
	/** Injuries and exercises to avoid. Never overridden by anything computed. */
	constraints: string[];
	preferences: string[];
	eatback: string;
	/**
	 * The training background the user stated (migration 0011). Without it a cold start
	 * has no way to tell a first-timer from a three-year lifter, and used to assume the
	 * first. `reference_loads` reach the prompt as prescriptions, not as prose.
	 */
	experience: string | null;
	background: string | null;
	/**
	 * Where they train and what has actually been seen there (migration 0012). Not a claim
	 * about what the room contains — it is what this user has used, accrued one workout at a
	 * time — which is why the prompt says "prefer these", never "only these". Null until
	 * they name a place, which is most accounts.
	 */
	place: CoachPlace | null;
	units: "lb";
	targets: {
		kcal: number | null;
		protein_g: number | null;
		carbs_max_g: number | null;
		fat_g: number | null;
		/** True when the profile excludes the user from deficit advice (age, BMI, pregnancy). */
		tracking_only: boolean;
	};
}

/** What has happened on the day the user is asking about, so far. */
export interface CoachToday {
	eaten: number;
	earned: number;
	target: number | null;
	allowance: number | null;
	remaining: number | null;
	protein_g: number | null;
	status: string;
	/** Block titles logged today — "already trained" is the first thing the answer turns on. */
	trained: string[];
}

export interface CoachBriefInputs {
	/** The user's local calendar date the brief is for. */
	date: string;
	/** Their local clock when they asked ("6:40 pm") — a brief at 6 am is not one at 9 pm. */
	local_time: string;
	/** Active goals in priority order; the first one is the brief's main focus. */
	goals: CoachGoal[];
	plan: CoachPlan;
	features: CoachFeatures;
	rules: CoachRules;
	today: CoachToday;
	/**
	 * What the user said when they asked, plus anything the fusion pipeline classified as
	 * `coach_context` today ("only 30 minutes", "knee hurts"). It shapes the answer; it
	 * never overrides the history (concept-v2 §Output).
	 */
	context: string | null;
}

/** What the model produced, with the deterministic parts already merged in. */
export type Brief = CoachBriefOutput;

/**
 * "Make it 8 exercises", "switch to legs", "I feel like chest". A revision is not a new
 * question with extra context: the user is looking at an answer and wants *that answer*
 * changed, so the model is handed today's brief and told what to do to it, and returns the
 * whole revised brief rather than a patch. Everything the instruction does not touch is
 * expected back unchanged.
 */
export interface BriefRevision {
	/** What the user asked for, in their own words. */
	instruction: string;
	/** The brief they are looking at — today's current answer. */
	current: Brief;
}

export interface CoachPort {
	/** Which model this instance calls — stored on the brief and shown in the app. */
	readonly model: string;
	/**
	 * One brief. Throws if the provider returned nothing usable, so a caller never has to
	 * render half an answer — including a training day with an empty Do list, which parses
	 * but is not an answer (services/coach/schema.ts §assertUsableBrief).
	 */
	brief(inputs: CoachBriefInputs, revision?: BriefRevision): Promise<Brief>;
}
