import { describe, expect, it } from "vitest";
import { config } from "../../config/index.js";
import type { CoachBriefInputs } from "../../ports/coach.js";
import { computeFeatures } from "../../services/coach/features.js";
import { buildRules } from "../../services/coach/rules.js";
import { activity, daysAgo, facts, meal, TODAY, weight } from "../../test/fixtures/facts.js";
import { createAnthropicLlm } from "../llm/anthropic.js";
import { createLlmCoach } from "./llm.js";

// The brief against the real model, on the model the coach really runs on.
//
// Two things only a real provider can prove, and both have burned this codebase before:
//
//   1. **The grammar compiles.** A structured-output schema is compiled into a decoding
//      grammar and one that is too big is refused at request time, not at review time (WP2's
//      8.9 KB fusion union — see services/fusion/schema.ts). rules.test.ts pins the size of
//      CoachBriefSchema; this pins that Anthropic accepts it.
//   2. **The model copies the prescribed numbers rather than inventing its own.** That is
//      the whole architecture of services/coach/rules.ts, and it is a claim about a model's
//      behaviour, which no fake can test.
//
// Skipped without a key, so `npm test` stays green on a fresh clone. The key comes through
// config like everywhere else and is never printed.

const apiKey = config.anthropic.apiKey;

// Built lazily: an SDK client constructed with an empty key throws, which would fail the
// file instead of skipping it.
const coach = () =>
	createLlmCoach(
		createAnthropicLlm({
			apiKey,
			model: config.llm.defaultModels.anthropic.coach,
			workspaceId: config.anthropic.workspaceId,
		})
	);

/** A user four days out from a push session, mid fat-loss goal, with a bad knee. */
function inputs(): CoachBriefInputs {
	const lift = (date: string, exercise: string, load: number, muscles: string[], reps = 8) =>
		activity(date, {
			exercise,
			category: "strength" as const,
			muscle_groups: muscles,
			sets: 3,
			reps,
			load_lb: load,
			confidence: "high" as const,
		});

	const dayFacts = facts({
		activities: [
			lift(daysAgo(4), "Bench Press", 135, ["chest", "triceps"]),
			lift(daysAgo(4), "Overhead Press", 65, ["shoulders"]),
			lift(daysAgo(11), "Bench Press", 135, ["chest", "triceps"]),
			lift(daysAgo(11), "Lat Pulldown", 110, ["back", "lats"], 10),
		],
		meals: [meal(TODAY, { kcal: 620, protein_g: 42, carbs_g: 48 }), meal(daysAgo(1), { kcal: 2380, protein_g: 150, carbs_g: 300 })],
		weights: [weight(TODAY, 193.4), weight(daysAgo(3), 194.2), weight(daysAgo(6), 195)],
		tdee: 2817,
	});

	const features = computeFeatures({
		facts: dayFacts,
		trainingDaysTarget: 4,
		targets: { kcal: 2254, protein_g: 160, carbs_max_g: 250 },
	});
	const goals = [
		{
			id: "goal-1",
			kind: "lose_fat",
			title: "Down to 170 lb",
			priority: 1,
			metrics: [{ measure: "body_weight", target: 170, unit: "lb", direction: "decrease" }],
			reached_candidate_at: null,
			stalled_since: null,
			progress_percent: 0.06,
		},
	];
	const rules = buildRules({ features, goals });

	return {
		date: TODAY,
		local_time: "5:40 pm",
		goals,
		plan: {
			goal_pace: "standard",
			diet_style: "higher protein",
			training_days: 4,
			environment: "gym",
			equipment: ["barbell", "dumbbell", "machine"],
			constraints: ["bad left knee — no deep squats or lunges"],
			preferences: ["prefers free weights"],
			eatback: "half",
			units: "lb",
			targets: { kcal: 2254, protein_g: 160, carbs_max_g: 250, fat_g: 63, tracking_only: false },
		},
		features,
		rules,
		today: { eaten: 620, earned: 0, target: 2254, allowance: 2254, remaining: 1634, protein_g: 42, status: "on_track", trained: [] },
		context: "only about 40 minutes today",
	};
}

describe.skipIf(!apiKey)("anthropic coach brief (contract)", () => {
	it("compiles the brief grammar and copies the prescribed loads rather than inventing them", async () => {
		const request = inputs();
		const brief = await coach().brief(request);

		expect(brief.headline.length).toBeGreaterThan(3);
		expect(["strength", "cardio", "rest", "mixed"]).toContain(brief.workout.type);
		expect(brief.workout.exercises.length).toBeLessThanOrEqual(6);
		expect(brief.nutrition.ideas.length).toBeLessThanOrEqual(3);

		// Every exercise it picked from the prescription list carries that prescription's
		// numbers. This is the claim the whole rules module exists to make true.
		const prescribed = new Map(
			request.rules.prescriptions.map((item) => [item.exercise.trim().toLowerCase(), item])
		);
		for (const exercise of brief.workout.exercises) {
			const match = prescribed.get(exercise.name.trim().toLowerCase());
			if (!match) continue;
			expect({ name: exercise.name, load: exercise.load_lb }).toEqual({ name: exercise.name, load: match.load_lb });
			if (match.sets != null) expect(exercise.sets).toBe(match.sets);
		}

		// The eating numbers are the ones it was given, not ones it worked out.
		expect(brief.nutrition.kcal).toBe(2254);
		expect(brief.nutrition.protein_g).toBe(160);
	}, 120_000);
});
