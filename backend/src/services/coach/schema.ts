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
	name: z.string().trim().min(1).max(60),
	/** Copied from the prescription. Null for cardio and bodyweight work. */
	load_lb: z.number().min(0).max(2000).nullable(),
	sets: z.number().int().min(1).max(12).nullable(),
	reps: z.number().int().min(1).max(100).nullable(),
	/** Cardio and holds. Null for a lift. */
	minutes: z.number().int().min(1).max(300).nullable(),
	/** One short clause: why this movement, or how to run it. */
	note: z.string().trim().max(120).nullable(),
});

export const CoachBriefSchema = z.object({
	/** The title sentence: "Push day — shoulders and back". */
	headline: z.string().trim().min(1).max(120),
	/** Two or three sentences of reasoning from the facts given. */
	why: z.string().trim().min(1).max(500),
	workout: z.object({
		type: z.enum(WORKOUT_TYPES),
		/** Muscle groups or "cardio"/"recovery" — what today is for. */
		targets: z.array(z.string().trim().min(1).max(30)).max(4),
		/** 4–6 on a training day; empty on a rest day. */
		exercises: z.array(BriefExerciseSchema).max(6),
	}),
	nutrition: z.object({
		kcal: z.number().int().min(0).max(10000),
		protein_g: z.number().int().min(0).max(500),
		carbs_max_g: z.number().int().min(0).max(1000).nullable(),
		/** Two or three meals that fit the diet style. */
		ideas: z.array(z.string().trim().min(1).max(80)).max(3),
		why: z.string().trim().min(1).max(300),
	}),
	/** The single most useful thing, in one sentence. */
	nudge: z.string().trim().min(1).max(240),
});

export type CoachBriefOutput = z.infer<typeof CoachBriefSchema>;
