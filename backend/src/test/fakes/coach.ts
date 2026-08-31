import type { Brief, BriefRevision, CoachBriefInputs, CoachPort, RevisedBrief } from "../../ports/coach.js";
import { CoachBriefSchema, CoachRevisionSchema } from "../../services/coach/schema.js";

// The fake CoachPort the integration tests run on. Like the LlmPort fake, it validates
// through the real schema: a fake that can return a shape no model could produce hides
// bugs instead of finding them.

export interface FakeCoach extends CoachPort {
	/** Handed back by the next `brief()` call, after the real schema validates it. */
	nextBrief: unknown;
	/** Answers for a sequence of calls, oldest first; falls back to `nextBrief`. */
	readonly briefs: unknown[];
	/**
	 * Answers for a sequence of `revise()` calls. Validated against the REVISION schema, so
	 * a fixture that forgets `revision_mode` fails here rather than being quietly treated as
	 * a rewrite — which is exactly the bug the mode exists to prevent.
	 */
	readonly revisedBriefs: unknown[];
	/** Every set of inputs the code under test built, oldest first. */
	readonly inputs: CoachBriefInputs[];
	/** The revision each call carried, aligned with `inputs`; undefined for a plain ask. */
	readonly revisions: (BriefRevision | undefined)[];
	/** Set to make the next call throw — the provider-outage path. */
	failNext: Error | null;
}

/** A brief that satisfies the schema, for tests that do not care what it says. */
export const SAMPLE_BRIEF: Brief = {
	headline: "Pull day: back and shoulders",
	why: "Back and shoulders are five days since their last session while legs were trained yesterday. You are two sessions into the week against a plan of four.",
	workout: {
		type: "strength",
		targets: ["back", "shoulders"],
		exercises: [
			{ name: "Lat Pulldown", load_lb: 110, sets: 3, reps: 10, minutes: null, note: "Hold the load until ten is clean.", is_new: false },
			{ name: "Overhead Press", load_lb: 65, sets: 3, reps: 8, minutes: null, note: null, is_new: false },
		],
		finisher: [{ name: "Doorway Chest Stretch", minutes: 2, note: "Both sides." }],
	},
	nutrition: {
		kcal: 2254,
		protein_g: 160,
		carbs_max_g: 250,
		ideas: ["Greek yoghurt and berries", "Chicken, rice and greens"],
		why: "Yesterday ran 60 g over your carb target, so keep today's starch to one meal.",
	},
	nudge: "Weigh in tomorrow morning — the last reading is four days old.",
};

/** The same brief as a rewrite: what a revision looks like when it replaces the session. */
export const SAMPLE_REWRITE: RevisedBrief = { ...SAMPLE_BRIEF, revision_mode: "rewrite" };

export function createFakeCoach(model = "fake-coach"): FakeCoach {
	const inputs: CoachBriefInputs[] = [];
	const revisions: (BriefRevision | undefined)[] = [];
	const briefs: unknown[] = [];
	const revisedBriefs: unknown[] = [];
	const failIfAsked = () => {
		if (fake.failNext) {
			const error = fake.failNext;
			fake.failNext = null;
			throw error;
		}
	};
	const fake: FakeCoach = {
		model,
		nextBrief: SAMPLE_BRIEF,
		briefs,
		revisedBriefs,
		inputs,
		revisions,
		failNext: null,
		async brief(request) {
			inputs.push(request);
			revisions.push(undefined);
			failIfAsked();
			// Validated against the real schema and nothing more. A training day with an
			// empty Do list parses, which is the whole reason services/coach/coach.ts has
			// to check for one — a fake that refused it would hide that.
			return CoachBriefSchema.parse(briefs.length > 0 ? briefs.shift() : fake.nextBrief);
		},
		async revise(request, revision) {
			inputs.push(request);
			revisions.push(revision);
			failIfAsked();
			return CoachRevisionSchema.parse(
				revisedBriefs.length > 0
					? revisedBriefs.shift()
					: briefs.length > 0
						? { ...(briefs.shift() as object), revision_mode: "rewrite" }
						: { ...(fake.nextBrief as object), revision_mode: "rewrite" }
			);
		},
	};
	return fake;
}
