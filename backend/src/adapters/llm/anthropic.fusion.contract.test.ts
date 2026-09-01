import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { config } from "../../config/index.js";
import { createFusionAnalyzer } from "../../services/fusion/analyze.js";
import { checkMeal } from "../../services/fusion/arithmetic.js";
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
		{ name: "Treadmill Run", aliases: ["treadmill", "run"], category: "cardio", primary_muscles: [] },
		{ name: "Dumbbell Bench Press", aliases: ["db bench"], category: "strength", primary_muscles: ["chest"] },
		{ name: "Chest-Supported Row", aliases: ["chest supported row", "incline bench row", "seal row"], category: "strength", primary_muscles: ["back"] },
	],
	goals: [],
	kindHint: null,
	clarify: null,
};

/**
 * A nutrition label, generated rather than photographed, so no binary fixture has to live
 * in the repo. Two columns — per slice and per package — which is the whole trap: 20 × 15 g
 * of carbohydrate is 300 g, and four slices is 60.
 */
function labelImage(): Promise<Buffer> {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="360">
	<rect width="520" height="360" fill="white"/>
	<g font-family="Helvetica" font-size="20" fill="black">
		<text x="20" y="40" font-size="26" font-weight="bold">Nutrition Facts</text>
		<text x="20" y="72">Serving size: 1 slice (45 g)</text>
		<text x="20" y="100">Servings per package: 20</text>
		<text x="20" y="140" font-weight="bold">Per slice</text>
		<text x="300" y="140" font-weight="bold">Per package</text>
		<text x="20" y="176">Calories 80</text><text x="300" y="176">1600</text>
		<text x="20" y="210">Total Fat 1 g</text><text x="300" y="210">20 g</text>
		<text x="20" y="244">Total Carbohydrate 15 g</text><text x="300" y="244">300 g</text>
		<text x="20" y="278">Dietary Fiber 2 g</text><text x="300" y="278">40 g</text>
		<text x="20" y="312">Protein 3 g</text><text x="300" y="312">60 g</text>
	</g>
</svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}

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

	// The drop-set fix, against the real model (field report 2026-09-01: "4 sets of 10 at
	// 85, the last two at 70" was saved as a 4-set item PLUS a 2-set item — six sets when
	// four were done). A load change splits the item; the split has to SUM to what was said.
	it("splits a load change into parts that sum, never a total plus a partial", async () => {
		const { results } = await analyzer().analyze({
			text: "chest press machine, I did 4 sets of 10 reps at 85 lbs, the last two sets I reduced the load to 70",
			context,
		});

		const activities = results.find((part) => part.kind === "activities");
		expect(activities).toBeTruthy();
		if (activities?.kind !== "activities") return;
		const presses = activities.items.filter((item) => /chest press/i.test(item.exercise ?? ""));
		expect(presses).toHaveLength(2);
		const totalSets = presses.reduce((sum, item) => sum + (item.sets ?? 0), 0);
		expect(totalSets).toBe(4);
		const loads = presses.map((item) => item.load_lb).sort((a, b) => (a ?? 0) - (b ?? 0));
		expect(loads[0]).toBeCloseTo(70, 0);
		expect(loads[1]).toBeCloseTo(85, 0);
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

	// The field report this whole branch exists for. Said twice over, in circles, by someone
	// who does not know the name of the machine they just used. The contract is not that the
	// model guesses right — it is that it guesses AT ALL, and asks nothing.
	it("logs a movement the user could not name, with no question and no missing numbers", async () => {
		const said =
			"I don't know what it is called but it is something is inclined, but I lay down on my " +
			"tummy on my tummy and I pulled it up to my chest from down up down up. I don't know " +
			"what that mission is called kind of inclined, but I laid up I lay on my tummy and " +
			"using my BOSS hand pull it up to my chest. I don't know what that exercise what that " +
			"machine is called but I did three reps of three sets of 12 rep at 45 pound.";
		const { results } = await analyzer().analyze({ text: said, context });

		// One workout. Not a question, and not a question hiding beside a workout.
		expect(results).toHaveLength(1);
		expect(results[0]!.kind).toBe("activities");
		if (results[0]!.kind !== "activities") return;
		const item = results[0]!.items[0]!;
		// The numbers the user WAS sure of survive being unsure about everything else.
		expect(item.sets).toBe(3);
		expect(item.reps).toBe(12);
		expect(item.load_lb).toBeCloseTo(45, 0);
		// Something is named — the catalogue movement if it got there, their words if not.
		expect(item.exercise ?? "").not.toBe("");
		// And it says it was a guess rather than asking to be told.
		expect(["low", "medium"]).toContain(item.confidence);
	}, 90_000);

	// The machine as its own field, on the routing schema — the one field this branch had to
	// buy, and the reason `photo_fields` was hoisted out of the union to pay for it.
	it("keeps the machine apart from the movement", async () => {
		const { results } = await analyzer().analyze({
			text: "did 3 sets of 12 at 45 pounds on the chest-supported row machine",
			context,
		});
		expect(results[0]!.kind).toBe("activities");
		if (results[0]!.kind !== "activities") return;
		const item = results[0]!.items[0]!;
		expect((item.equipment ?? "").toLowerCase()).toContain("machine");
		// The movement is the movement; the machine is not smuggled into its name.
		expect((item.exercise ?? "").toLowerCase()).not.toContain("machine");
	}, 90_000);

	// The place the equipment memory hangs off (migration 0012).
	it("reads the name of the gym out of a statement about where they train", async () => {
		const { results } = await analyzer().analyze({ text: "my gym is New Millennium", context });
		const statement = results.find((part) => part.kind === "preference" || part.kind === "constraint");
		expect(statement).toBeTruthy();
		if (!statement || (statement.kind !== "preference" && statement.kind !== "constraint")) return;
		expect(statement.fields?.place_name ?? "").toMatch(/new millennium/i);
		expect(statement.fields?.place_kind).toBe("gym");
	}, 90_000);

	// "Make a change" (concept-v2 §Principles 7 — NO FORMS). The user is looking at what was
	// understood and says what is wrong with it. Two things this proves that a fake cannot:
	// the model actually applies the instruction to the part it was handed, and — the part
	// that matters — it leaves everything the user did NOT mention exactly as it was. A
	// revision that quietly re-estimates the numbers beside the one it changed is worse than
	// a form.
	it("applies a told change to a workout and leaves the rest of it alone", async () => {
		const pending = {
			kind: "activities" as const,
			items: [
				{
					exercise: "Chest-Supported Row",
					equipment: "chest-supported row machine",
					description: "3 × 12 chest-supported row at 45 lb",
					category: "strength" as const,
					muscle_groups: ["back"],
					sets: 3,
					reps: 12,
					load_lb: 45,
					duration_min: null,
					distance_mi: null,
					kcal: 120,
					confidence: "low" as const,
					sources: null,
					refine: null,
				},
			],
		};
		const [revised] = await analyzer().revise({
			results: [pending],
			instruction: "reps were 4 and it was 50 pounds",
			context,
		});

		expect(revised!.kind).toBe("activities");
		if (revised!.kind !== "activities") return;
		const item = revised!.items[0]!;
		// The two facts they corrected.
		expect(item.reps).toBe(4);
		expect(item.load_lb).toBeCloseTo(50, 0);
		// And the one they did not: three sets is still three sets, on the same movement,
		// on the same machine.
		expect(item.sets).toBe(3);
		expect((item.exercise ?? "").toLowerCase()).toContain("row");
		expect((item.equipment ?? "").toLowerCase()).toContain("machine");
		// The muscle groups the detail call is never asked for survive the round trip.
		expect(item.muscle_groups).toEqual(["back"]);
	}, 90_000);

	// The other half of the same contract, on a different kind: a meal's slot is a fact the
	// user can only ever change by saying so.
	it("moves a meal to the sitting the user says it was", async () => {
		const [revised] = await analyzer().revise({
			results: [
				{
					kind: "meal",
					description: "chicken, rice and broccoli",
					meal_type: "dinner",
					kcal: 620,
					protein_g: 45,
					carbs_g: 60,
					fat_g: 18,
					fiber_g: 6,
					items: [],
					confidence: "medium",
					sources: null,
					consistency: null,
				},
			],
			instruction: "that meal was lunch not dinner",
			context,
		});

		expect(revised!.kind).toBe("meal");
		if (revised!.kind !== "meal") return;
		expect(revised!.meal_type).toBe("lunch");
		// Everything else is untouched: the instruction was about the slot, not the plate.
		expect(revised!.kcal).toBe(620);
		expect(revised!.description.toLowerCase()).toContain("chicken");
	}, 90_000);

	// ── The meal-accuracy field case, against the real model ──────────────────────────
	//
	// Reported 2026-08-31: a spoken lunch with photographs of the bread bag's label and the
	// tuna can's came back kcal 918, protein 67, **carbs 398**, fat 35 — and HIGH. The macros
	// imply about 2,175 kcal. It is the label's whole-loaf carbohydrate figure, taken for
	// four slices of it, asserted with confidence.
	//
	// The contract is NOT that the model prices this lunch correctly — nobody can, from those
	// words. It is the honesty guarantee the arithmetic gate exists to make: whatever comes
	// back either adds up, or it says so and is not called high confidence.
	it("never returns a meal that is both internally inconsistent and confident", async () => {
		const { results } = await analyzer().analyze({
			text:
				"for lunch I had a can of tuna, two eggs, a quarter of an onion, one chilli, two cups of " +
				"vegetables, two tablespoons of olive oil, and four slices of this bread",
			context,
		});

		const meal = results.find((part) => part.kind === "meal");
		expect(meal?.kind).toBe("meal");
		if (meal?.kind !== "meal") return;

		const check = checkMeal(meal);
		if (check.ok) {
			// The common case: it adds up, and there is nothing to say about it.
			expect(meal.consistency).toBeNull();
		} else {
			// The gate ran, re-asked, and could not reconcile it — so it says so, in the two
			// places the user can see: the chip and the line under the plate.
			expect(meal.confidence).toBe("low");
			expect(meal.consistency?.outcome).toBe("flagged");
		}
		// Either way the lunch is logged. Refusing to save what somebody ate is the failure
		// "always log" exists to prevent.
		expect(meal.kcal).toBeGreaterThan(0);
	}, 120_000);

	// The photo-binding rules, on the evidence that produced the bug: a nutrition label is a
	// PER-SERVING table, and the user said how many servings they had.
	it("prices a nutrition label by the servings stated, not by the package", async () => {
		const label = await labelImage();
		const { results, photoParts } = await analyzer().analyze({
			text: "I ate four slices of this bread",
			photos: [{ mediaType: "image/png", base64: label.toString("base64") }],
			context,
		});

		// The label is evidence ABOUT the bread they mentioned; it does not log itself.
		expect(results).toHaveLength(1);
		expect(photoParts).toEqual([0]);
		const meal = results[0]!;
		expect(meal.kind).toBe("meal");
		if (meal.kind !== "meal") return;

		// Four slices at 15 g is 60 g. The whole loaf is 300 g, and that is the answer this
		// rule exists to keep out of the record; anything under half the loaf is the model
		// having read the per-serving column.
		expect(meal.carbs_g ?? 0).toBeLessThan(150);
		expect(meal.carbs_g ?? 0).toBeGreaterThan(20);
		// And whatever it decided, it adds up or it says it does not.
		if (!checkMeal(meal).ok) expect(meal.confidence).toBe("low");
	}, 120_000);

	// The clarify round: the question is remembered, so "yes" resolves instead of looping.
	it("resolves a bare answer against the question it was asked", async () => {
		const { results } = await analyzer().analyze({
			text: "yes",
			context: {
				...context,
				clarify: { original_text: "did the thing on the treadmill", question: "Was that a treadmill run?" },
			},
		});
		expect(results).toHaveLength(1);
		expect(results[0]!.kind).toBe("activities");
	}, 90_000);
});
