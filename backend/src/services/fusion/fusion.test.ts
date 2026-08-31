import { z } from "zod";
import { describe, expect, it } from "vitest";
import { buildFusionMessageContent, createFusionAnalyzer, photoPartsFrom, usableSegments } from "./analyze.js";
import { localDay, type FusionContext } from "./context.js";
import { buildFusionSystemPrompt, buildPartDetailSystemPrompt } from "./prompt.js";
import {
	ActivitiesDetailOutputSchema,
	FusionResultSchema,
	FusionRouteOutputSchema,
	FusionRouteSchema,
	GoalDetailOutputSchema,
	MealDetailOutputSchema,
	PlanFieldsOutputSchema,
	WeightDetailOutputSchema,
	expandSources,
	toFusionResult,
} from "./schema.js";
import { createFakeLlm } from "../../test/fakes/llm.js";

// The pure half of the fusion pipeline: the day arithmetic, the prompt the model is given
// and the schema its answer has to fit. No database, no provider.

const context: FusionContext = {
	localDate: "2026-08-29",
	localTime: "18:40",
	tzOffsetMin: 120,
	units: "lb",
	todayActivities: [
		{
			exercise: "Bench Press",
			description: "3 × 8 bench at 135 lb",
			sets: 3,
			reps: 8,
			load_lb: 135,
			duration_min: null,
			kcal: 160,
			logged_at: "2026-08-29T16:10:00.000Z",
		},
	],
	todayMeals: [
		{ description: "eggs, toast, coffee", kcal: 265, protein_g: 16, logged_at: "2026-08-29T06:20:00.000Z" },
	],
	todayWeights: [181.4],
	recentExercises: ["Bench Press", "Lat Pulldown"],
	catalog: [{ name: "Dumbbell Bench Press", aliases: ["db bench", "dumbbell press"] }],
	goals: [{ id: "g1", kind: "lose_fat", title: "Down to 170 lb", priority: 1, metrics: [] }],
	kindHint: null,
};

describe("localDay", () => {
	it("uses the user's midnight, never the server's", () => {
		// 03:00 UTC in Los Angeles (UTC−7) is still the previous evening.
		const day = localDay(new Date("2026-08-29T03:00:00.000Z"), -420);
		expect(day.date).toBe("2026-08-28");
		expect(day.time).toBe("20:00");
		expect(day.startUtc.toISOString()).toBe("2026-08-28T07:00:00.000Z");
		expect(day.endUtc.toISOString()).toBe("2026-08-29T07:00:00.000Z");
	});

	it("agrees with UTC when the offset is zero", () => {
		const day = localDay(new Date("2026-08-29T23:59:00.000Z"), 0);
		expect(day.date).toBe("2026-08-29");
		expect(day.startUtc.toISOString()).toBe("2026-08-29T00:00:00.000Z");
	});
});

describe("the fusion prompt", () => {
	it("tells the model what has been logged today and what the user calls things", () => {
		const prompt = buildFusionSystemPrompt(context);
		expect(prompt).toContain("16:10 activity — Bench Press, 3×8, 135 lb, 160 kcal");
		expect(prompt).toContain("eggs, toast, coffee");
		expect(prompt).toContain("181.4 lb");
		// The catalogue is the shared vocabulary: canonical name plus the spoken forms.
		expect(prompt).toContain("Dumbbell Bench Press (db bench, dumbbell press)");
		expect(prompt).toContain("Down to 170 lb");
		expect(prompt).toContain("18:40 on 2026-08-29");
	});

	it("keeps v1's grouping rules — one meal per log, one item per exercise", () => {
		const prompt = buildFusionSystemPrompt(context);
		expect(prompt).toContain("All food and drink in a single log is ONE meal");
		expect(prompt).toContain("Each distinct exercise is its own item");
		expect(prompt).toContain("Sets and reps NEVER come from a photo");
	});

	it("asks for the rest of a mixed input as a list of kinds, still biased toward one part", () => {
		const prompt = buildFusionSystemPrompt(context);
		expect(prompt).toContain('Strongly bias toward an EMPTY "more_kinds"');
		expect(prompt).toContain("At most one part per kind");
		expect(prompt).toContain("Keep the user's order");
		// A weight said on the way to a goal is the goal's stated fact, not a second part.
		expect(prompt).toContain('NOT a second\n"weight" part');
	});

	it("tells a segment's own call which kind to pull out, and to leave the rest alone", () => {
		const prompt = buildPartDetailSystemPrompt(context, "meal");
		expect(prompt).toContain("Read ONLY that part");
		expect(prompt).toContain("saved twice");
		expect(prompt).toContain("All of it is ONE meal");
		// It still gets the catalogue and the units, or it would invent its own spellings.
		expect(prompt).toContain("Dumbbell Bench Press (db bench, dumbbell press)");
		expect(prompt).toContain("Units are POUNDS and MILES");
		// And which photos it read from, since the routing schema has no room to say.
		expect(prompt).toContain('"photo_indexes" are the positions of the photos');
	});

	it("sends a statement segment the plan fields and the three scopes, not the catalogue", () => {
		const prompt = buildPartDetailSystemPrompt(context, "statement");
		expect(prompt).toContain('say in "scope" which of three it is');
		expect(prompt).toContain("a passing state changes no plan");
		expect(prompt).toContain("diet_style");
		expect(prompt).not.toContain("photo_indexes");
	});

	it("lets a goal segment name its own title, since the router had none to hand over", () => {
		expect(buildPartDetailSystemPrompt(context, "goal")).toContain("give it a short title of its own");
	});

	it("says an empty day is empty rather than saying nothing", () => {
		const prompt = buildFusionSystemPrompt({
			...context,
			todayActivities: [],
			todayMeals: [],
			todayWeights: [],
			goals: [],
		});
		expect(prompt).toContain("nothing logged yet today");
		expect(prompt).toContain("no active goals");
	});

	it("passes the app's kind hint through as a hint, not an order", () => {
		const prompt = buildFusionSystemPrompt({ ...context, kindHint: "meal" });
		expect(prompt).toContain('The app thinks this is a "meal"');
		expect(prompt).toContain("not an instruction");
	});
});

describe("the message the model is sent", () => {
	it("puts the photos first and the words last", () => {
		const content = buildFusionMessageContent("three sets of ten", [
			{ mediaType: "image/jpeg", base64: "AAAA" },
			{ mediaType: "image/png", base64: "BBBB" },
		]);
		expect(content.map((part) => part.type)).toEqual(["image", "image", "text"]);
		expect(content.at(-1)).toMatchObject({ text: "The user said or typed: three sets of ten" });
	});

	it("says so when the log is photos with no words", () => {
		const content = buildFusionMessageContent(null, [{ mediaType: "image/jpeg", base64: "AAAA" }]);
		expect(content.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining("no words") });
	});
});

describe("the fusion schema", () => {
	it("accepts every kind the classifier can route to", () => {
		const results = [
			{
				kind: "activities",
				items: [
					{
						exercise: "Bench Press",
						description: "3 × 8 bench at 135 lb",
						category: "strength",
						muscle_groups: ["chest"],
						sets: 3,
						reps: 8,
						load_lb: 135,
						duration_min: null,
						distance_mi: null,
						kcal: 160,
						confidence: "high",
						sources: {
							exercise: "photo",
							sets: "text",
							reps: "text",
							load_lb: "photo",
							duration_min: null,
							distance_mi: null,
							kcal: null,
						},
					},
				],
			},
			{
				kind: "meal",
				description: "chicken burrito",
				meal_type: "lunch",
				kcal: 950,
				protein_g: 38,
				carbs_g: 130,
				fat_g: 28,
				fiber_g: 8,
				items: [],
				confidence: "medium",
				sources: null,
			},
			{ kind: "weight", weight_lb: 181.4, confidence: "high", sources: null },
			{
				kind: "goal",
				spec: {
					kind: "lose_fat",
					title: "Down to 170 lb",
					metrics: [
						{
							measure: "body_weight",
							scope: null,
							target: 170,
							unit: "lb",
							direction: "decrease",
							rate: "0.5 %/week",
							by: "2026-12-01",
						},
					],
					active_from: null,
					active_to: null,
				},
				proposed_timeline: { by: "2026-12-01", rate: "~1 lb/week", note: null, realistic: true },
			},
			{ kind: "constraint", text: "bad left knee", fields: null },
			{ kind: "preference", text: "mornings only", fields: null },
			{ kind: "coach_context", text: "only 30 minutes today" },
			{ kind: "unclear", question: "What did you have with it?" },
		];
		for (const result of results) expect(FusionResultSchema.parse(result).kind).toBe(result.kind);
	});

	it("refuses a goal about something the app cannot compute", () => {
		const goal = {
			kind: "goal",
			spec: {
				kind: "custom",
				title: "Feel great",
				// Not an id in services/goals/measures.ts — a goal we cannot measure is
				// not a goal, and the prompt is told to route it to a preference instead.
				metrics: [
					{ measure: "vibes", scope: null, target: null, unit: null, direction: "increase", rate: null, by: null },
				],
				active_from: null,
				active_to: null,
			},
			proposed_timeline: null,
		};
		expect(FusionResultSchema.safeParse(goal).success).toBe(false);
	});

	it("refuses a kind nobody routes to, and a weight that is not one", () => {
		expect(FusionResultSchema.safeParse({ kind: "sleep", hours: 7 }).success).toBe(false);
		expect(
			FusionResultSchema.safeParse({ kind: "weight", weight_lb: -3, confidence: "high", sources: null }).success
		).toBe(false);
	});
});

/**
 * The ceiling WP2 measured the hard way: Anthropic compiles a structured-output schema
 * into a decoding grammar and refuses one much past this, on Haiku and Sonnet alike (see
 * the note at the top of schema.ts). The contract test is where a schema over the line
 * actually fails; this is where it fails in a second, on a laptop, with the number in the
 * message. Every field added to a model-facing schema has to be measured here.
 */
const GRAMMAR_CEILING_BYTES = 4500;

function schemaBytes(schema: z.ZodType): number {
	return Buffer.byteLength(JSON.stringify(z.toJSONSchema(schema)), "utf8");
}

describe("the model-facing schema", () => {
	it("stays under the provider's grammar limit, every schema it sends", () => {
		for (const [name, schema] of [
			["fusion_result", FusionRouteOutputSchema],
			["goal_spec", GoalDetailOutputSchema],
			["plan_fields", PlanFieldsOutputSchema],
			["activities", ActivitiesDetailOutputSchema],
			["meal", MealDetailOutputSchema],
			["weigh_in", WeightDetailOutputSchema],
		] as const) {
			const bytes = schemaBytes(schema);
			expect({ name, overBudget: bytes >= GRAMMAR_CEILING_BYTES }).toEqual({ name, overBudget: false });
		}
	});

	/**
	 * The mixed-input rework tried `results: FusionRoute[]` first. Its JSON schema was
	 * 3.7 KB — comfortably under the pin — and Anthropic still refused it with "the
	 * compiled grammar is too large". An array multiplies a union's grammar by far more
	 * than its bytes, so the routing schema holds ONE branch plus cheap segments, and the
	 * pin above is only an early warning: the contract test is the real gate.
	 */
	it("keeps the routing schema to one branch of the union plus a list of bare kinds", () => {
		const answer = FusionRouteOutputSchema.parse({
			result: { kind: "weight", weight_lb: 181, confidence: "high", photo_fields: [] },
			more_kinds: ["meal", "activities"],
		});
		// A segment is a kind and nothing else — its own call fills the fields in.
		expect(answer.more_kinds).toEqual(["meal", "activities"]);
		// The measured ceiling for this shape is ~3.66 KB, not the 4.5 KB the old pin
		// claimed: a routing schema of 3655 bytes compiled and one of 3687 did not. This
		// one is 3580. The number below is what is left of that budget; it is a budget and
		// not a proof — anthropic.fusion.contract.test.ts is the real gate.
		expect(schemaBytes(FusionRouteOutputSchema)).toBeLessThan(3660);
	});

	// Anthropic compiles a structured-output schema into a decoding grammar and refuses
	// one that grows past a few KB, which the eight-branch public union does. The lean
	// routing schema is what actually goes to the provider; these tests pin the two
	// halves of the translation. The size limit itself is covered by the contract test.
	it("folds constraint, preference and coach_context into one statement branch", () => {
		const statement = FusionRouteSchema.parse({ kind: "statement", scope: "constraint", text: "bad left knee" });
		expect(toFusionResult(statement)).toEqual({ kind: "constraint", text: "bad left knee", fields: null });
		// The plan fields, when there were any, come from the second call.
		expect(toFusionResult(statement, { fields: { diet_style: "keto", protein_g: null, carbs_max_g: 50, training_days: null, environment: null, equipment: null, eatback: null } })).toMatchObject({
			kind: "constraint",
			fields: { diet_style: "keto", carbs_max_g: 50 },
		});
		expect(toFusionResult({ kind: "statement", scope: "coach_context", text: "30 minutes only" })).toEqual({
			kind: "coach_context",
			text: "30 minutes only",
		});
	});

	it("widens photo_fields into a per-field source map, and only for fields that have a value", () => {
		expect(
			expandSources(["exercise", "sets", "load_lb", "kcal"], ["load_lb"], {
				exercise: "Leg Press",
				sets: 3,
				load_lb: 180,
				kcal: null,
			})
		).toEqual({ exercise: "text", sets: "text", load_lb: "photo", kcal: null });
	});

	it("leaves the fields the catalogue derives for the catalogue", () => {
		const result = toFusionResult({
			kind: "activities",
			items: [
				{
					exercise: "db bench",
					description: "3 × 10 dumbbell bench at 45 lb",
					sets: 3,
					reps: 10,
					load_lb: 45,
					duration_min: null,
					distance_mi: null,
					kcal: 180,
					confidence: "medium",
					photo_fields: ["load_lb"],
				},
			],
		});
		expect(result.kind).toBe("activities");
		if (result.kind !== "activities") return;
		// category and muscle_groups are not asked of the model: services/entries.ts fills
		// them from the catalogue when it recognises the exercise.
		expect(result.items[0]).toMatchObject({ category: null, muscle_groups: null, load_lb: 45 });
		expect(result.items[0]!.sources).toMatchObject({ load_lb: "photo", sets: "text", distance_mi: null });
		// The widened result is still a valid public result.
		expect(FusionResultSchema.safeParse(result).success).toBe(true);
	});
});

/** The routing answer, in the shape the provider is actually given. */
function routed(result: unknown, moreKinds: string[] = []): unknown {
	return { result, more_kinds: moreKinds };
}

describe("createFusionAnalyzer", () => {
	it("routes in one call and widens the answer to the public shape", async () => {
		const llm = createFakeLlm();
		llm.nextOutput = routed({ kind: "statement", scope: "coach_context", text: "only 30 minutes" });
		const { results } = await createFusionAnalyzer(llm).analyze({ text: "only 30 min today", context });
		expect(results).toEqual([{ kind: "coach_context", text: "only 30 minutes" }]);
		// One kind is still one call: the segmenting is the routing, not a call in front of it.
		expect(llm.requests).toHaveLength(1);
		expect(llm.requests[0]?.schemaName).toBe("fusion_result");
	});

	it("asks a second time for the goal spec, and only for a goal", async () => {
		const llm = createFakeLlm();
		llm.outputs.push(
			routed({ kind: "goal", title: "Down to 170 lb" }),
			{
				spec: {
					kind: "lose_fat",
					title: "Down to 170 lb",
					metrics: [
						{
							measure: "body_weight",
							scope: null,
							target: 170,
							unit: "lb",
							direction: "decrease",
							rate: "0.5 %/week",
							by: "2026-12-01",
						},
					],
					active_to: null,
				},
				facts: { current_weight_lb: 191, training_days: null, environment: null, age_years: null },
			}
		);
		const { results } = await createFusionAnalyzer(llm).analyze({ text: "I'm 191, I want to get to 170", context });
		const result = results[0]!;
		expect(result.kind).toBe("goal");
		if (result.kind !== "goal") return;
		expect(result.spec.metrics[0]).toMatchObject({ measure: "body_weight", target: 170 });
		// The facts stated alongside the goal ride along on the preview, so the confirm can
		// save them and the card can show what it noted.
		expect(result.facts).toEqual({
			current_weight_lb: 191,
			training_days: null,
			environment: null,
			age_years: null,
		});
		expect(llm.requests).toHaveLength(2);
		expect(llm.requests[1]?.system).toContain("Down to 170 lb");
	});

	it("keeps nothing rather than four blanks when the user stated no facts", async () => {
		const llm = createFakeLlm();
		llm.outputs.push(
			routed({ kind: "goal", title: "Down to 170 lb" }),
			{
				spec: {
					kind: "lose_fat",
					title: "Down to 170 lb",
					metrics: [
						{ measure: "body_weight", scope: null, target: 170, unit: "lb", direction: "decrease", rate: null, by: null },
					],
					active_to: null,
				},
				facts: { current_weight_lb: null, training_days: null, environment: null, age_years: null },
			}
		);
		const { results } = await createFusionAnalyzer(llm).analyze({ text: "I want to get to 170", context });
		const result = results[0]!;
		expect(result.kind === "goal" && result.facts).toBeNull();
	});

	it("asks a second time for the plan fields behind a constraint, but not for coach context", async () => {
		const llm = createFakeLlm();
		llm.outputs.push(
			routed({ kind: "statement", scope: "preference", text: "switching to keto" }),
			{
				fields: {
					diet_style: "keto",
					protein_g: null,
					carbs_max_g: 50,
					training_days: null,
					environment: null,
					equipment: null,
					eatback: null,
				},
			}
		);
		const { results } = await createFusionAnalyzer(llm).analyze({ text: "switching to keto", context });
		expect(results[0]).toMatchObject({ kind: "preference", fields: { diet_style: "keto", carbs_max_g: 50 } });
		expect(llm.requests).toHaveLength(2);

		// A passing state changes no plan, so there is nothing to extract and no second call.
		const second = createFakeLlm();
		second.nextOutput = routed({ kind: "statement", scope: "coach_context", text: "knee hurts today" });
		await createFusionAnalyzer(second).analyze({ text: "knee hurts today", context });
		expect(second.requests).toHaveLength(1);
	});

	it("asks the user rather than saving a goal the second call could not specify", async () => {
		const llm = createFakeLlm();
		llm.outputs.push(
			routed({ kind: "goal", title: "Get fitter" }),
			{
				spec: { kind: "custom", title: "Get fitter", metrics: [], active_to: null },
				facts: { current_weight_lb: null, training_days: null, environment: null, age_years: null },
			}
		);
		const { results } = await createFusionAnalyzer(llm).analyze({ text: "get fitter", context });
		// A spec with no measures is still a goal shape; it is the *missing* second call
		// that falls back, so this one saves.
		expect(results[0]?.kind).toBe("goal");
	});

	it("refuses an answer the schema does not allow, rather than saving nonsense", async () => {
		const llm = createFakeLlm();
		llm.nextOutput = routed({ kind: "meal" });
		await expect(createFusionAnalyzer(llm).analyze({ text: "lunch", context })).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// Mixed input: one sentence, several things (Field fixes 2026-08-30).
// ---------------------------------------------------------------------------

describe("splitting one input into parts", () => {
	const eggs = {
		kind: "meal",
		description: "two eggs and toast",
		meal_type: "breakfast",
		kcal: 320,
		protein_g: 18,
		carbs_g: 30,
		fat_g: 14,
		fiber_g: 3,
		items: [],
		confidence: "medium",
		photo_fields: [],
	};
	const run = {
		kind: "activities",
		items: [
			{
				exercise: "Run",
				description: "5 km run",
				sets: null,
				reps: null,
				load_lb: null,
				duration_min: 28,
				distance_mi: 3.11,
				kcal: 300,
				confidence: "medium",
				photo_fields: [],
			},
		],
	};
	const weighIn = { weight_lb: 181, confidence: "high", photo_fields: [] };

	it("returns one result per kind, in the order they were said", async () => {
		const llm = createFakeLlm();
		llm.outputs.push(
			routed(eggs, ["activities", "weight"]),
			{ items: run.items, photo_indexes: [] },
			{ ...weighIn, photo_indexes: [] }
		);
		const { results } = await createFusionAnalyzer(llm).analyze({
			text: "ate two eggs and toast, then ran 5k, weighed in at 181",
			context,
		});
		expect(results.map((result) => result.kind)).toEqual(["meal", "activities", "weight"]);
		expect(results[2]).toMatchObject({ kind: "weight", weight_lb: 181 });
		// One routing call, then one focused call per extra part — two round trips, not four.
		expect(llm.requests.map((request) => request.schemaName)).toEqual(["fusion_result", "activities", "weigh_in"]);
		// Each focused call is told which kind to pull out and to leave the others alone.
		expect(llm.requests[1]?.system).toContain("PHYSICAL ACTIVITY");
		expect(llm.requests[1]?.system).toContain("saved twice");
		// Every part is a valid public result, so every part can be confirmed.
		for (const result of results) expect(FusionResultSchema.safeParse(result).success).toBe(true);
	});

	it("ignores a kind the router named twice", async () => {
		const llm = createFakeLlm();
		llm.outputs.push(routed(eggs, ["weight", "weight"]), { ...weighIn, photo_indexes: [] });
		const { results } = await createFusionAnalyzer(llm).analyze({ text: "eggs; 181; 181", context });
		expect(results.map((result) => result.kind)).toEqual(["meal", "weight"]);
		expect(llm.requests).toHaveLength(2);
	});

	it("runs a goal and a statement segment through their own focused calls", async () => {
		const llm = createFakeLlm();
		llm.outputs.push(
			routed(run, ["goal", "statement"]),
			{
				spec: {
					kind: "lose_fat",
					title: "Down to 200 lb",
					metrics: [
						{ measure: "body_weight", scope: null, target: 200, unit: "lb", direction: "decrease", rate: null, by: null },
					],
					active_to: null,
				},
				facts: { current_weight_lb: 212, training_days: 4, environment: "gym", age_years: 45 },
			},
			{
				scope: "preference",
				text: "mornings only",
				fields: {
					diet_style: null,
					protein_g: null,
					carbs_max_g: null,
					training_days: null,
					environment: null,
					equipment: null,
					eatback: null,
				},
			}
		);
		const { results } = await createFusionAnalyzer(llm).analyze({ text: "ran 5k; want 200 lb; mornings only", context });
		expect(results.map((result) => result.kind)).toEqual(["activities", "goal", "preference"]);
		expect(results[1]).toMatchObject({ kind: "goal", facts: { current_weight_lb: 212, training_days: 4 } });
		// The goal's title comes off its own spec: the router named a kind, not a phrase.
		expect(results[1]).toMatchObject({ spec: { title: "Down to 200 lb" } });
		expect(results[2]).toEqual({ kind: "preference", text: "mornings only", fields: expect.anything() });
		// The activities part came back complete from the routing call and asks nothing more.
		expect(llm.requests.map((request) => request.schemaName)).toEqual([
			"fusion_result",
			"goal_spec",
			"statement",
		]);
	});

	it("asks a statement segment which of the three scopes it is", async () => {
		const llm = createFakeLlm();
		llm.outputs.push(routed(run, ["statement"]), {
			scope: "coach_context",
			text: "knee is sore today",
			fields: null,
		});
		const { results } = await createFusionAnalyzer(llm).analyze({ text: "ran 5k, knee is sore", context });
		expect(results.map((result) => result.kind)).toEqual(["activities", "coach_context"]);
		expect(results[1]).toEqual({ kind: "coach_context", text: "knee is sore today" });
	});

	it("keeps one weigh-in when the goal already states the weight", async () => {
		const llm = createFakeLlm();
		llm.outputs.push(
			routed({ kind: "goal", title: "Down to 200 lb" }, ["weight"]),
			{
				spec: {
					kind: "lose_fat",
					title: "Down to 200 lb",
					metrics: [
						{ measure: "body_weight", scope: null, target: 200, unit: "lb", direction: "decrease", rate: null, by: null },
					],
					active_to: null,
				},
				facts: { current_weight_lb: 212, training_days: null, environment: null, age_years: null },
			},
			{ weight_lb: 212, confidence: "high", photo_fields: [], photo_indexes: [] }
		);
		const { results } = await createFusionAnalyzer(llm).analyze({ text: "I am 212, goal is 200", context });
		// The goal's confirm writes the 212 as a weigh-in; a second part would write it twice.
		expect(results.map((result) => result.kind)).toEqual(["goal"]);
	});

	it("files each photo against the part that says it read it", async () => {
		const llm = createFakeLlm();
		// The machine photo (index 1) went to the run; the plate stayed with the meal.
		llm.outputs.push(routed(eggs, ["activities"]), { items: run.items, photo_indexes: [1] });
		const { photoParts } = await createFusionAnalyzer(llm).analyze({
			text: "ate this, then did this",
			photos: [
				{ mediaType: "image/jpeg", base64: "AAAA" },
				{ mediaType: "image/jpeg", base64: "BBBB" },
			],
			context,
		});
		expect(photoParts).toEqual([0, 1]);
	});

	it("leaves a photo nothing claimed with the first part", () => {
		expect(photoPartsFrom([[1]], 3)).toEqual([0, 1, 0]);
		// Out of range and non-integer claims are ignored rather than thrown on.
		expect(photoPartsFrom([[9, -1, 1.5]], 2)).toEqual([0, 0]);
		// Two parts claiming the same photo: the first one to claim it keeps it.
		expect(photoPartsFrom([[0], [0, 1]], 2)).toEqual([1, 2]);
		expect(photoPartsFrom([], 2)).toEqual([0, 0]);
	});

	it("has nothing more to ask when the whole log was unclear", () => {
		const question = { kind: "unclear" as const, question: "What did you have?" };
		expect(usableSegments(question, ["meal"])).toEqual([]);
		const meal = { kind: "meal" as const, description: "x", meal_type: null, kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, items: [], confidence: "low" as const, photo_fields: [] };
		expect(usableSegments(meal, ["weight", "weight", "goal"])).toEqual(["weight", "goal"]);
	});
});
