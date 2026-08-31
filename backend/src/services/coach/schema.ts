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
	/**
	 * The one movement in this plan the user has never logged, when there is one (user
	 * decision 2026-08-31 — variety and introductions). At most one per plan, chosen from
	 * the catalogue, and the reason goes in `note`. The app draws a "new to you" chip that
	 * opens the exercise sheet, so an introduction is never a name with nothing behind it.
	 *
	 * The count is enforced after the call as well as asked for in the prompt: a model that
	 * marks four is corrected rather than believed (services/coach/coach.ts).
	 */
	is_new: z.boolean(),
});

/**
 * The stretch / mobility close (user decision 2026-08-31). Two to four items on a training
 * day, scaled with the session's minutes, targeting what the day actually trained.
 *
 * Its own array rather than more rows in `exercises` because the two lists answer different
 * questions: the Do list is the session and is what completion is measured against; this is
 * how it ends. Measured — the grammar this adds is about 300 JSON-schema bytes and the
 * contract test compiles it (rules.test.ts pins the total).
 */
const BriefFinisherSchema = z.object({
	name: z.string().trim().min(1),
	/** How long to hold or move for. Null when it is a rep count in the note instead. */
	minutes: z.number().int().min(1).max(30).nullable(),
	/** One short clause — which muscle it is for, or how to run it. */
	note: z.string().trim().nullable(),
});

// Free text carries no maximum: the model occasionally runs a clause long, and a length cap
// here fails the whole brief AFTER generation (the caps do not reach the decoding grammar).
// clampBrief() below trims instead — a long note is a trim, never an error.
const clamp = (value: string, max: number) => (value.length > max ? value.slice(0, max - 1).trimEnd() + "\u2026" : value);

export function clampBrief<T extends {
	headline: string; why: string; nudge: string;
	workout: { targets: string[]; exercises: { name: string; note: string | null }[]; finisher?: { name: string; note: string | null }[] };
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
	for (const item of brief.workout.finisher ?? []) {
		item.name = clamp(item.name, 80);
		if (item.note) item.note = clamp(item.note, 160);
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
		/**
		 * 2–4 stretch or mobility items on a training day, scaled with the session's
		 * minutes; empty on a rest day and empty when there is no room for one. Never part
		 * of `assertUsableBrief`: a finisher is how a session ends, not whether it exists.
		 */
		finisher: z.array(BriefFinisherSchema).max(4),
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

export const REVISION_MODES = ["append", "rewrite"] as const;
export type RevisionMode = (typeof REVISION_MODES)[number];

/**
 * What a *revision* returns: the same brief, plus which of the two things the user asked
 * for (user decision 2026-08-31 — "add-ons append").
 *
 *   * `append` — "give me another half hour", "add core", "throw in some abs". The plan on
 *     screen stands and these items go under it. `workout.exercises` holds ONLY the new
 *     ones; the service concatenates them onto the brief being revised and stamps them with
 *     the local time they were added, which is what the app's "added 2:05p" divider draws.
 *   * `rewrite` — "switch to legs", "make it 8 exercises", "harder". The whole Do list is
 *     rebuilt and `workout.exercises` is the complete new one, exactly as it was before
 *     this field existed.
 *
 * The model decides which it is, because only the model has read the sentence. It is on a
 * revision-only schema rather than on `CoachBriefSchema` so a plain brief's grammar does
 * not pay for a field that could never apply to it.
 */
export const COACH_REVISION_SCHEMA_NAME = "coach_brief_revision";

export const CoachRevisionSchema = z.object({
	/**
	 * "append" when the instruction ADDS to the session in front of the user and leaves the
	 * rest of it standing; "rewrite" when it changes what the session IS.
	 *
	 * **First in the object, and that is load-bearing.** Structured output is decoded in
	 * schema order, so a field at the end is decided after the whole answer has been
	 * written — and a model that has just written a complete replacement session says
	 * "rewrite", because by then it is telling the truth. Measured against the live model:
	 * "add core" came back as a rewrite with the flag last and as an append with it first,
	 * on identical prompts. Deciding before answering is the point.
	 */
	revision_mode: z.enum(REVISION_MODES),
	...CoachBriefSchema.shape,
});

export type CoachRevisionOutput = z.infer<typeof CoachRevisionSchema>;

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

/**
 * A rest verdict on a day that has already been trained (user decision 2026-08-31 §A2).
 *
 * The prompt forbids it in as many words, twice, and the live model still wrote
 * `type: "rest"` with an empty list for a user who had logged four sets of pulldowns that
 * morning — reasoning, not unreasonably, that a second lat session would be overtraining.
 * The reasoning was fine; the *shape* of the answer was the bug, because on this screen it
 * reads as "today was a rest day" and it replaces a plan the user is halfway through.
 *
 * So it is also enforced here, where no amount of persuasion is involved:
 *
 *   * A rest day with something in it is a mislabelled complement — the exercises are the
 *     answer, so the label is corrected to `mixed` and the brief is kept. Nothing the user
 *     can see is lost by relabelling a list that is already right.
 *   * A rest day with NOTHING in it, on a day that has been trained, is thrown: the caller
 *     asks once more, and falls back to the standing plan rather than storing a blank page
 *     as the day's answer.
 */
export function resolveRestAfterTraining<T extends { workout: { type: string; exercises: unknown[] } }>(
	brief: T,
	{ trainedToday }: { trainedToday: boolean }
): T {
	if (!trainedToday || brief.workout.type !== "rest") return brief;
	if (brief.workout.exercises.length === 0) {
		throw new UnusableBriefError("the model called today a rest day after the user had already trained, and listed nothing to do");
	}
	return { ...brief, workout: { ...brief.workout, type: "mixed" } };
}

/**
 * The same guarantee for an append: "add core" that adds nothing is not an answer either,
 * and unlike a rewrite it cannot be spotted by looking at the merged result — the plan is
 * still full of the exercises that were already there.
 */
export function assertUsableRevision<T extends { revision_mode: RevisionMode; workout: { type: string; exercises: unknown[] } }>(
	answer: T
): T {
	if (answer.revision_mode === "append" && answer.workout.exercises.length === 0) {
		throw new UnusableBriefError("the model said it was adding to the plan and added nothing");
	}
	return answer.revision_mode === "append" ? answer : assertUsableBrief(answer);
}
