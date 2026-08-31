import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { config } from "../../config/index.js";
import { createFusionAnalyzer } from "../../services/fusion/analyze.js";
import type { FusionContext } from "../../services/fusion/context.js";
import { createAnthropicLlm } from "./anthropic.js";

// The one WP2 test that talks to a real provider. The fakes prove the routing and the
// saving; only this proves that the fusion schema — a discriminated union with nested
// objects and per-field source maps — actually survives the round trip through
// `messages.parse` + `zodOutputFormat`, with an image in the message.
//
// It is also the only place the grammar ceiling is real. The byte pin in fusion.test.ts
// under-predicts it badly: a routing schema of 3.7 KB was refused here while one of 4.2 KB
// with a different shape was accepted, so any change to a model-facing schema has to be
// run against this file before it is believed.
//
// Skipped without a key, so `npm test` stays green on a fresh clone. The key is read
// through config like everywhere else and is never printed.

const apiKey = config.anthropic.apiKey;

// Built lazily: an SDK client with an empty key throws at construction, which would fail
// the file instead of skipping it.
const analyzer = () =>
	createFusionAnalyzer(
		createAnthropicLlm({
			apiKey,
			model: config.llm.defaultModels.anthropic.fusion,
			workspaceId: config.anthropic.workspaceId,
		})
	);

const context: FusionContext = {
	localDate: "2026-08-29",
	localTime: "18:40",
	tzOffsetMin: 0,
	units: "lb",
	todayActivities: [],
	todayMeals: [],
	todayWeights: [],
	recentExercises: [],
	catalog: [
		{ name: "Treadmill Run", aliases: ["treadmill", "run"] },
		{ name: "Dumbbell Bench Press", aliases: ["db bench"] },
	],
	goals: [],
	kindHint: null,
};

/** A tiny generated image, so no binary fixture has to live in the repo. */
function tinyImage(): Promise<Buffer> {
	return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 30, g: 30, b: 30 } } })
		.jpeg()
		.toBuffer();
}

describe.skipIf(!apiKey)("anthropic fusion (contract)", () => {
	it("routes a photo plus words to activities, in pounds and miles", async () => {
		const photo = await tinyImage();
		const { results, photoParts } = await analyzer().analyze({
			text: "photo of the treadmill I was on — I ran 2 miles in 18 minutes",
			photos: [{ mediaType: "image/jpeg", base64: photo.toString("base64") }],
			context,
		});

		// One kind said once is still one part.
		expect(results).toHaveLength(1);
		expect(photoParts).toEqual([0]);
		const result = results[0]!;
		expect(result.kind).toBe("activities");
		if (result.kind !== "activities") return;
		expect(result.items.length).toBeGreaterThan(0);
		const item = result.items[0]!;
		expect(item.distance_mi).toBeCloseTo(2, 1);
		expect(item.duration_min).toBe(18);
		// Sets and reps never come from a run, and never from a photo.
		expect(item.sets).toBeNull();
		// The lean photo_fields array is widened back into the per-field source map. Which
		// side the model attributes a fact to is its judgement, not something to pin; that
		// the map arrives populated for the fields that have values is the contract.
		expect(item.sources).not.toBeNull();
		expect(["photo", "text"]).toContain(item.sources?.distance_mi);
		expect(item.sources?.sets).toBeNull();
	}, 90_000);

	it("routes a stated target to a goal with a measure the app can compute", async () => {
		const { results } = await analyzer().analyze({
			text: "I want to get down to 170 pounds by December, I'm 191 now",
			context,
		});

		// The 191 is the goal's stated fact, not a second part: one goal, one result.
		expect(results).toHaveLength(1);
		const result = results[0]!;
		expect(result.kind).toBe("goal");
		if (result.kind !== "goal") return;
		expect(result.spec.metrics[0]?.measure).toBe("body_weight");
		expect(result.spec.metrics[0]?.target).toBeCloseTo(170, 0);
		expect(result.spec.metrics[0]?.direction).toBe("decrease");
		// The user's own date is captured on the metric; the projection is the app's job
		// (services/goals/proposal.ts), so the analyzer leaves proposed_timeline null.
		expect(result.spec.metrics[0]?.by ?? "").toMatch(/^\d{4}-12-\d{2}$/);
		expect(result.proposed_timeline).toBeNull();
	}, 90_000);

	// The field report, verbatim. Two things it proves against the real model that a fake
	// cannot: the extended goal_spec schema still compiles into a decoding grammar, and the
	// facts stated around a goal come back separated from the goal's own numbers.
	it("captures the facts stated alongside a goal, and scopes whole-body sets to nothing", async () => {
		const { results } = await analyzer().analyze({
			text:
				"Currently I am 212 lbs, my goal is to go down to 200 lbs. come up with reasonable time to " +
				"achieve that. I work out 4 days a week. At the same time I want to build body mascle. I am " +
				"45 read old. I go to gym to workout. I want a complete body workout through out the week.",
			context,
		});

		// Everything in this sentence is about the goal, so it stays one part — the facts
		// ride on it and the confirm writes the 212 as a weigh-in and the rest to the profile.
		const result = results.find((part) => part.kind === "goal") ?? results[0]!;
		expect(result.kind).toBe("goal");
		if (result.kind !== "goal") return;
		const weight = result.spec.metrics.find((metric) => metric.measure === "body_weight");
		expect(weight?.target).toBeCloseTo(200, 0);
		// The 212 is a fact about them, not the goal's target.
		expect(result.facts?.current_weight_lb).toBeCloseTo(212, 0);
		expect(result.facts?.training_days).toBe(4);
		expect(result.facts?.environment).toBe("gym");
		expect(result.facts?.age_years).toBe(45);
		// "A complete body workout through the week" has no one muscle to name, and that is
		// now a goal rather than a validation error.
		const sets = result.spec.metrics.find((metric) => metric.measure === "weekly_sets");
		if (sets) expect(sets.scope).toBeNull();
	}, 90_000);

	// The mixed-input fix, against the real model. A fake can prove the pipeline carries
	// three parts; only this proves the model actually splits the sentence into three, and
	// that the array-of-results grammar still compiles.
	it("splits one sentence into a meal, an activity and a weigh-in", async () => {
		const { results } = await analyzer().analyze({
			text: "ate two eggs and toast, then ran 5k, weighed in at 181",
			context,
		});

		const kinds = results.map((result) => result.kind);
		expect(kinds).toContain("meal");
		expect(kinds).toContain("activities");
		expect(kinds).toContain("weight");
		// In the order they were said, so the stacked cards read like the sentence.
		expect(kinds.indexOf("meal")).toBeLessThan(kinds.indexOf("weight"));

		const weight = results.find((result) => result.kind === "weight");
		expect(weight?.kind === "weight" && weight.weight_lb).toBeCloseTo(181, 0);
		// 5 km in miles, never the metric number.
		const activity = results.find((result) => result.kind === "activities");
		if (activity?.kind === "activities") expect(activity.items[0]?.distance_mi).toBeCloseTo(3.11, 1);
	}, 90_000);

	// A single-kind log must still come back as ONE part, however many exercises are in it:
	// the grouping rules are what keep three lifts from becoming three cards.
	it("keeps a workout with three exercises as one part", async () => {
		const { results } = await analyzer().analyze({
			text: "bench press 3 sets of 8 at 135, then lat pulldown 3 by 12 at 90, then a 10 minute bike",
			context,
		});

		expect(results).toHaveLength(1);
		expect(results[0]?.kind).toBe("activities");
		if (results[0]?.kind !== "activities") return;
		expect(results[0].items.length).toBeGreaterThanOrEqual(3);
	}, 90_000);

	// The training-background fix, against the real model. The extended plan-fields schema
	// (964 → 1570 bytes) has to compile, and the model has to tell a load the user lifts
	// NOW apart from a load they want to reach — which is a goal, not a reference.
	it("reads a training background and a stated load out of one sentence", async () => {
		const { results } = await analyzer().analyze({
			text: "I've been lifting three years, I bench 165 for 3x5",
			context,
		});

		const statement = results.find((part) => part.kind === "preference" || part.kind === "constraint");
		expect(statement).toBeTruthy();
		if (!statement || (statement.kind !== "preference" && statement.kind !== "constraint")) return;
		expect(statement.fields?.experience).toBe("intermediate");
		expect(statement.fields?.background ?? "").toMatch(/three years/i);
		const loads = statement.fields?.reference_loads ?? [];
		expect(loads).toHaveLength(1);
		expect(loads[0]?.exercise.toLowerCase()).toContain("bench");
		expect(loads[0]?.load_lb).toBeCloseTo(165, 0);
		expect(loads[0]?.reps).toBe(5);
		// It is a statement about how they train, not a workout they did today.
		expect(results.some((part) => part.kind === "activities")).toBe(false);
	}, 90_000);

	it("assigns the photo to the part it belongs to", async () => {
		const photo = await tinyImage();
		const { results, photoParts } = await analyzer().analyze({
			text: "this is the treadmill display — 2 miles in 18 minutes. I also had a chicken burrito for lunch.",
			photos: [{ mediaType: "image/jpeg", base64: photo.toString("base64") }],
			context,
		});

		expect(results.length).toBeGreaterThan(1);
		expect(photoParts).toHaveLength(1);
		// The display belongs to the run, not to the burrito.
		expect(results[photoParts[0]!]?.kind).toBe("activities");
	}, 90_000);
});
