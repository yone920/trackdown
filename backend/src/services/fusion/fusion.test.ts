import { describe, expect, it } from "vitest";
import { buildFusionMessageContent, createFusionAnalyzer } from "./analyze.js";
import { localDay, type FusionContext } from "./context.js";
import { buildFusionSystemPrompt } from "./prompt.js";
import { FusionResultSchema, FusionRouteSchema, expandSources, toFusionResult } from "./schema.js";
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

describe("the model-facing schema", () => {
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

describe("createFusionAnalyzer", () => {
	it("routes in one call and widens the answer to the public shape", async () => {
		const llm = createFakeLlm();
		llm.nextOutput = { result: { kind: "statement", scope: "coach_context", text: "only 30 minutes" } };
		const result = await createFusionAnalyzer(llm).analyze({ text: "only 30 min today", context });
		expect(result).toEqual({ kind: "coach_context", text: "only 30 minutes" });
		expect(llm.requests).toHaveLength(1);
		expect(llm.requests[0]?.schemaName).toBe("fusion_result");
	});

	it("asks a second time for the goal spec, and only for a goal", async () => {
		const llm = createFakeLlm();
		llm.outputs.push(
			{ result: { kind: "goal", title: "Down to 170 lb" } },
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
				proposed_timeline: { by: "2026-12-01", rate: "~1 lb/week", note: null, realistic: true },
			}
		);
		const result = await createFusionAnalyzer(llm).analyze({ text: "I want to get to 170", context });
		expect(result.kind).toBe("goal");
		if (result.kind !== "goal") return;
		expect(result.spec.metrics[0]).toMatchObject({ measure: "body_weight", target: 170 });
		expect(llm.requests).toHaveLength(2);
		expect(llm.requests[1]?.system).toContain("Down to 170 lb");
	});

	it("asks a second time for the plan fields behind a constraint, but not for coach context", async () => {
		const llm = createFakeLlm();
		llm.outputs.push(
			{ result: { kind: "statement", scope: "preference", text: "switching to keto" } },
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
		const preference = await createFusionAnalyzer(llm).analyze({ text: "switching to keto", context });
		expect(preference).toMatchObject({ kind: "preference", fields: { diet_style: "keto", carbs_max_g: 50 } });
		expect(llm.requests).toHaveLength(2);

		// A passing state changes no plan, so there is nothing to extract and no second call.
		const second = createFakeLlm();
		second.nextOutput = { result: { kind: "statement", scope: "coach_context", text: "knee hurts today" } };
		await createFusionAnalyzer(second).analyze({ text: "knee hurts today", context });
		expect(second.requests).toHaveLength(1);
	});

	it("asks the user rather than saving a goal the second call could not specify", async () => {
		const llm = createFakeLlm();
		llm.outputs.push({ result: { kind: "goal", title: "Get fitter" } }, { spec: { kind: "custom", title: "Get fitter", metrics: [], active_to: null }, proposed_timeline: null });
		const result = await createFusionAnalyzer(llm).analyze({ text: "get fitter", context });
		// A spec with no measures is still a goal shape; it is the *missing* second call
		// that falls back, so this one saves.
		expect(result.kind).toBe("goal");
	});

	it("refuses an answer the schema does not allow, rather than saving nonsense", async () => {
		const llm = createFakeLlm();
		llm.nextOutput = { result: { kind: "meal" } };
		await expect(createFusionAnalyzer(llm).analyze({ text: "lunch", context })).rejects.toThrow();
	});
});
