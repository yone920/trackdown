import type { Brief, CoachBriefInputs, CoachPort } from "../../ports/coach.js";
import { CoachBriefSchema } from "../../services/coach/schema.js";

// The fake CoachPort the integration tests run on. Like the LlmPort fake, it validates
// through the real schema: a fake that can return a shape no model could produce hides
// bugs instead of finding them.

export interface FakeCoach extends CoachPort {
	/** Handed back by the next `brief()` call, after the real schema validates it. */
	nextBrief: unknown;
	/** Answers for a sequence of calls, oldest first; falls back to `nextBrief`. */
	readonly briefs: unknown[];
	/** Every set of inputs the code under test built, oldest first. */
	readonly inputs: CoachBriefInputs[];
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
			{ name: "Lat Pulldown", load_lb: 110, sets: 3, reps: 10, minutes: null, note: "Hold the load until ten is clean." },
			{ name: "Overhead Press", load_lb: 65, sets: 3, reps: 8, minutes: null, note: null },
		],
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

export function createFakeCoach(model = "fake-coach"): FakeCoach {
	const inputs: CoachBriefInputs[] = [];
	const briefs: unknown[] = [];
	const fake: FakeCoach = {
		model,
		nextBrief: SAMPLE_BRIEF,
		briefs,
		inputs,
		failNext: null,
		async brief(request) {
			inputs.push(request);
			if (fake.failNext) {
				const error = fake.failNext;
				fake.failNext = null;
				throw error;
			}
			return CoachBriefSchema.parse(briefs.length > 0 ? briefs.shift() : fake.nextBrief);
		},
	};
	return fake;
}
