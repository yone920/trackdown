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
			place: null,
			constraints: ["bad left knee — no deep squats or lunges"],
			preferences: ["prefers free weights"],
			eatback: "half",
			experience: null,
			background: null,
			session_minutes: rules.sizing.minutes,
			session_minutes_stated: rules.sizing.stated,
			units: "lb",
			targets: { kcal: 2254, protein_g: 160, carbs_max_g: 250, fat_g: 63, tracking_only: false },
		},
		features,
		rules,
		today: {
			eaten: 620,
			earned: 0,
			target: 2254,
			allowance: 2254,
			remaining: 1634,
			protein_g: 42,
			protein_target_g: 160,
			status: "on_track",
			trained: [],
			logged: [],
		},
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

	// The revision path, against the real model. Two claims a fake cannot make: the model
	// can actually count past the old ceiling of six when it is asked to, and it returns a
	// WHOLE brief rather than a patch — a revision that dropped the nutrition card or came
	// back with an empty Do list is the failure this whole fix is about.
	it("revises the brief it is handed, up to the number of exercises the user asked for", async () => {
		const request = inputs();
		const current = await coach().brief(request);

		const revised = await coach().revise(request, {
			instruction: "give me 7-8 workouts",
			current,
			// The free-text box: nobody pressed a button, so the model reads the sentence.
			mode: null,
		});

		// A count is a change to what the session IS, not an addition to it.
		expect(revised.revision_mode).toBe("rewrite");
		expect(revised.workout.type).not.toBe("rest");
		expect(revised.workout.exercises.length).toBeGreaterThanOrEqual(7);
		expect(revised.workout.exercises.length).toBeLessThanOrEqual(10);
		// The rest of the brief came back filled in, not dropped.
		expect(revised.headline.length).toBeGreaterThan(3);
		expect(revised.why.length).toBeGreaterThan(3);
		expect(revised.nutrition.kcal).toBe(2254);
		expect(revised.nudge.length).toBeGreaterThan(3);
		// And the constraint still binds: the knee does not stop mattering because the
		// user asked for a longer session.
		expect(revised.workout.exercises.map((exercise) => exercise.name.toLowerCase()).join(" ")).not.toMatch(
			/deep squat|lunge/
		);
	}, 180_000);

	// "Switch to legs" is the other shape of revision: not more of the same, a different
	// session. The Do list has to be rebuilt around it rather than appended to.
	it("rebuilds the session around a different body part when asked", async () => {
		const request = inputs();
		const current = await coach().brief(request);
		const revised = await coach().revise(request, { instruction: "switch to legs", current, mode: null });

		expect(revised.revision_mode).toBe("rewrite");
		expect(revised.workout.exercises.length).toBeGreaterThan(0);
		expect(`${revised.headline} ${revised.workout.targets.join(" ")}`.toLowerCase()).toMatch(
			/leg|quad|hamstring|glute|calf|lower/
		);
	}, 180_000);

	// The other half of the mode, and the one the whole field report is about: an ADD-ON
	// appends. Only the model can tell "add core" from "switch to legs", and no fake can
	// prove it can.
	it("adds to the plan rather than rebuilding it when the instruction is an add-on", async () => {
		const request = inputs();
		const current = await coach().brief(request);
		const revised = await coach().revise(request, { instruction: "add core", current, mode: null });

		expect(revised.revision_mode).toBe("append");
		// Only the NEW items come back on an append — the plan above is kept for it.
		expect(revised.workout.exercises.length).toBeGreaterThan(0);
		expect(revised.workout.exercises.length).toBeLessThanOrEqual(4);
		const names = revised.workout.exercises.map((exercise) => exercise.name.toLowerCase());
		expect(names.join(" ")).toMatch(/plank|crunch|ab|core|leg raise|dead bug|hollow|russian|sit.?up|oblique/);
		// And it does not simply hand back the session it was given.
		const before = new Set(current.workout.exercises.map((exercise) => exercise.name.toLowerCase()));
		expect(names.every((name) => before.has(name))).toBe(false);
	}, 180_000);

	// The field report, reproduced: asked mid-workout, after lats were already logged this
	// morning. The old prompt answered "Rest today · 0 MOVES" and replaced the plan.
	it("never calls today rest because the user already trained, and never returns an empty plan", async () => {
		const request = inputs();
		const trained = {
			...request,
			local_time: "11:20 am",
			today: {
				...request.today,
				earned: 264,
				trained: ["Morning session"],
				logged: [
					{ exercise: "Lat Pulldown", exercise_id: null, sets: 4, category: "strength" },
					{ exercise: "Seated Cable Row", exercise_id: null, sets: 3, category: "strength" },
					{ exercise: "Assisted Chin-Up", exercise_id: null, sets: 3, category: "strength" },
				],
			},
			context: null,
		};

		const brief = await coach().brief(trained);

		expect(brief.workout.type).not.toBe("rest");
		expect(brief.workout.exercises.length).toBeGreaterThan(0);
		// It says what was done rather than passing a verdict on the day.
		expect(`${brief.headline} ${brief.why}`.toLowerCase()).toMatch(/lat|pulldown|row|chin|back|pull|this morning|already/);
		expect(brief.headline.toLowerCase()).not.toMatch(/^rest\b|rest day/);
	}, 180_000);
});
