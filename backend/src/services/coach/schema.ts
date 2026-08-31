import { z } from "zod";

// The brief's output schema (docs/build-plan.md §WP5; docs/design-system.md §Coach — title
// sentence, why, the Do list with load × sets × reps, Eat, One thing).
//
// SIZE IS PART OF THE CONTRACT, exactly as it is for the readings. Anthropic compiles a
// structured-output schema into a decoding grammar and refuses one much past ~4.5 KB (the
// finding that reshaped WP2's fusion union — see the note at the top of
// services/fusion/schema.ts). This schema is the biggest generated shape in the app, so
// coach.test.ts pins its size and an adapter contract test proves the provider accepts it.
// Every field below earns its bytes:
//
//   * `headline` and `why` are the two lines at the top of the Coach screen.
//   * `workout.exercises[]` is the Do list. The *numbers* in it are copied from
//     services/coach/rules.ts — the model picks the movements and the order, not the load
//     (concept-v2 §Progression rules: deterministic, fed to the model as constraints).
//   * `nutrition` is the Eat card. `kcal` and `protein_g` are given to the model in the
//     prompt too; they are asked for again so the card is self-contained for the app.
//   * `nudge` is the One thing. The *action* behind it is chosen by rules.ts and attached
//     after the call — a button that does something is not a thing to generate.

export const COACH_BRIEF_SCHEMA_NAME = "coach_brief";

export const WORKOUT_TYPES = ["strength", "cardio", "rest", "mixed"] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

const BriefExerciseSchema = z.object({
	/** The exercise's catalogue name, as it appears in the prescriptions. */
	name: z.string().trim().min(1),
	/** Copied from the prescription. Null for cardio and bodyweight work. */
	load_lb: z.number().min(0).max(2000).nullable(),
	sets: z.number().int().min(1).max(12).nullable(),
	reps: z.number().int().min(1).max(100).nullable(),
	/** Cardio and holds. Null for a lift. */
	minutes: z.number().int().min(1).max(300).nullable(),
	/** One short clause: why this movement, or how to run it. */
	note: z.string().trim().nullable(),
});

// Free text carries no maximum: the model occasionally runs a clause long, and a length cap
// here fails the whole brief AFTER generation (the caps do not reach the decoding grammar).
// clampBrief() below trims instead — a long note is a trim, never an error.
const clamp = (value: string, max: number) => (value.length > max ? value.slice(0, max - 1).trimEnd() + "\u2026" : value);

export function clampBrief<T extends {
	headline: string; why: string; nudge: string;
	workout: { targets: string[]; exercises: { name: string; note: string | null }[] };
	nutrition: { ideas: string[]; why: string };
}>(brief: T): T {
	brief.headline = clamp(brief.headline, 140);
	brief.why = clamp(brief.why, 600);
	brief.nudge = clamp(brief.nudge, 280);
	brief.workout.targets = brief.workout.targets.map((t) => clamp(t, 40));
	for (const ex of brief.workout.exercises) {
		ex.name = clamp(ex.name, 80);
		if (ex.note) ex.note = clamp(ex.note, 160);
	}
	brief.nutrition.ideas = brief.nutrition.ideas.map((i) => clamp(i, 100));
	brief.nutrition.why = clamp(brief.nutrition.why, 400);
	return brief;
}

export const CoachBriefSchema = z.object({
	/** The title sentence: "Push day — shoulders and back". */
	headline: z.string().trim().min(1),
	/** Two or three sentences of reasoning from the facts given. */
	why: z.string().trim().min(1),
	workout: z.object({
		type: z.enum(WORKOUT_TYPES),
		/** Muscle groups or "cardio"/"recovery" — what today is for. */
		targets: z.array(z.string().trim().min(1)).max(4),
		/**
		 * 4–6 on a training day; empty on a rest day. The ceiling is 10 rather than 6
		 * because a revision can ask for more ("make it 8 exercises") and a cap the user
		 * can ask past is a cap the model has to disobey or return nothing against — which
		 * is how a regenerate came back with an empty Do list. A bound on an array costs no
		 * grammar bytes, so raising it costs nothing the contract test can see.
		 */
		exercises: z.array(BriefExerciseSchema).max(10),
	}),
	nutrition: z.object({
		kcal: z.number().int().min(0).max(10000),
		protein_g: z.number().int().min(0).max(500),
		carbs_max_g: z.number().int().min(0).max(1000).nullable(),
		/** Two or three meals that fit the diet style. */
		ideas: z.array(z.string().trim().min(1)).max(3),
		why: z.string().trim().min(1),
	}),
	/** The single most useful thing, in one sentence. */
	nudge: z.string().trim().min(1),
});

export type CoachBriefOutput = z.infer<typeof CoachBriefSchema>;

/**
 * A brief that says today is a training day and then lists nothing to do. It parses — the
 * schema allows an empty array, because a rest day needs one — and it is useless: the
 * Coach screen renders a headline, a paragraph of reasoning and an empty Do list, which is
 * what the user saw when they asked for eight exercises and got a blank page.
 *
 * It is caught in two places on purpose. The adapter throws it so the retry it already has
 * covers this as well as a malformed sample; services/coach/coach.ts checks again before
 * writing, because a brief nobody can act on must never become the day's standing answer —
 * once stored, every plain ask for the rest of the day replays it.
 */
export class UnusableBriefError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnusableBriefError";
	}
}

/** The one thing a parsed brief can still get wrong. Returns the brief, for chaining. */
export function assertUsableBrief<T extends { workout: { type: string; exercises: unknown[] } }>(brief: T): T {
	if (brief.workout.type !== "rest" && brief.workout.exercises.length === 0) {
		throw new UnusableBriefError(`the model called today a ${brief.workout.type} day and listed no exercises`);
	}
	return brief;
}
