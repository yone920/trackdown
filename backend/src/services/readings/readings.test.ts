import { z } from "zod";
import { describe, expect, it } from "vitest";
import { buildDaySheet, buildInShortPrompt, buildRightNowPrompt } from "./prompt.js";
import { dayInputsHash } from "./readings.js";
import { InShortSchema, RightNowSchema } from "./schema.js";
import type { DayView } from "../day.js";

// The readings, without a provider and without a database: the two schemas, the sheet the
// model is given, and the cache key. The generation itself is covered end to end in
// app.test.ts over the fake LlmPort.

/**
 * The ceiling WP2 measured the hard way: Anthropic compiles a structured-output schema into
 * a decoding grammar and refuses one much past this, on Haiku and Sonnet alike (see the
 * note at the top of services/fusion/schema.ts). A reading is two sentences and a button —
 * it has no business anywhere near the limit, and this test is what keeps a future field
 * from finding out in production.
 */
const GRAMMAR_CEILING_BYTES = 4500;
const READING_BUDGET_BYTES = 1500;

function schemaBytes(schema: z.ZodType): number {
	return Buffer.byteLength(JSON.stringify(z.toJSONSchema(schema)), "utf8");
}

describe("the reading schemas", () => {
	it("stay far under the provider's grammar limit", () => {
		for (const [name, schema] of [
			["right_now", RightNowSchema],
			["in_short", InShortSchema],
		] as const) {
			const bytes = schemaBytes(schema);
			expect({ name, overBudget: bytes > READING_BUDGET_BYTES }).toEqual({ name, overBudget: false });
			expect(bytes).toBeLessThan(GRAMMAR_CEILING_BYTES);
		}
	});

	it("accepts a well-formed reading and refuses an unknown action kind", () => {
		const good = {
			text: "You are 620 kcal short of your allowance with dinner still open.",
			next_action: { label: "Log dinner", kind: "log_meal", hint: "Dinner is the only slot left" },
			actions: [{ label: "Ask the coach", kind: "coach" }],
		};
		expect(RightNowSchema.parse(good).next_action.kind).toBe("log_meal");
		expect(RightNowSchema.safeParse({ ...good, next_action: { label: "Sleep", kind: "nap", hint: null } }).success).toBe(
			false
		);
		// Every optional fact is nullable, never absent — both providers want the key there.
		expect(RightNowSchema.safeParse({ ...good, next_action: { label: "Log dinner", kind: "log_meal" } }).success).toBe(
			false
		);
		expect(InShortSchema.safeParse({ text: "" }).success).toBe(false);
	});
});

/** A day with one gym block, two meals and a weigh-in — enough for the sheet to be real. */
function view(overrides: Partial<DayView> = {}): DayView {
	const base: DayView = {
		date: "2026-08-29",
		tz_offset_min: 0,
		is_today: true,
		closed_at: null,
		day_number: 12,
		items: {
			meals: [
				{
					id: "m1",
					logged_at: "2026-08-29T07:30:00.000Z",
					description: "eggs and toast",
					slot: "breakfast",
					stated_slot: null,
					kcal: 480,
					protein_g: 32,
					carbs_g: 40,
					fat_g: 20,
					fiber_g: 4,
					evidence: [],
				},
			],
			activities: [
				{
					id: "a1",
					logged_at: "2026-08-29T17:10:00.000Z",
					description: "3 × 8 bench at 135 lb",
					exercise: "Bench Press",
					exercise_id: null,
					equipment: null,
					category: "strength",
					muscle_groups: ["chest"],
					sets: 3,
					reps: 8,
					load_lb: 135,
					duration_min: null,
					distance_mi: null,
					kcal: 120,
					source: "manual",
					confidence: "high",
					block_id: "block-a1",
					delta_vs_last: {
						text: "+5 lb",
						direction: "up",
						field: "load_lb",
						load_lb: 5,
						sets: 0,
						reps: 0,
						previous: { logged_at: "2026-08-22T17:00:00.000Z", load_lb: 130, sets: 3, reps: 8 },
					},
					evidence: [],
				},
			],
			weights: [{ id: "w1", logged_at: "2026-08-29T06:40:00.000Z", weight_lb: 182.4, source: "manual" }],
		},
		blocks: [
			{
				id: "block-a1",
				title: "Chest",
				start: "2026-08-29T17:10:00.000Z",
				end: "2026-08-29T17:55:00.000Z",
				minutes: 45,
				kcal: 120,
				kcal_from_health: false,
				kcal_estimated: false,
				exercise_count: 1,
				activity_ids: ["a1"],
				muscle_groups: ["chest"],
				category: "strength",
				health: null,
			},
		],
		eaten: 480,
		earned: 120,
		target: 2260,
		allowance: 2320,
		remaining: 1840,
		eatback: "half",
		tdee: 2828,
		balance: 2468,
		status: "on_track",
		over_by: null,
		macros: {
			protein_g: { eaten: 32, target: 159, note: "under" },
			carbs_g: { eaten: 40, target: 265, note: "on target" },
			fat_g: { eaten: 20, target: 63, note: "under" },
			fiber_g: { eaten: 4, target: 32, note: "under" },
		},
		weight: { day: 182.4, avg_7d: 183.1, trend_per_week: -0.7 },
		muscle_groups: ["chest"],
		muscle_summary: [{ muscle: "chest", sets: 3, exercises: ["Bench Press"] }],
		health: { active_energy: null, steps: null },
		eating_pattern: "One meal, at 7:30 am — all 480 kcal of the day.",
		arc: [],
		expected: [{ kind: "meal", slot: "dinner", label: "Dinner", at_minutes: 1140 }],
		verdict: "served",
		verdict_words: "Served your goal",
		verdict_why: "Ate inside the allowance (+2,468 kcal).",
		goal: {
			id: "g1",
			kind: "lose_fat",
			title: "Down to 170 lb",
			metrics: [],
			priority: 1,
			status: "active",
			active_from: "2026-08-01",
			active_to: null,
		},
		goal_involves_calories: true,
		summary_line: "Chest · 480 kcal in 1 meal · 120 earned · 182.4 lb",
		facts: { date: "2026-08-29", tdee: 2828, meals: [], activities: [], weights: [], healthSamples: [] },
	};
	return { ...base, ...overrides };
}

describe("the day sheet the model is given", () => {
	it("carries the computed day and nothing raw", () => {
		const sheet = buildDaySheet(view());
		expect(sheet).toContain("DAY 12 — 2026-08-29 (today, still running)");
		expect(sheet).toContain("Goal: Down to 170 lb (lose_fat)");
		expect(sheet).toContain("Eaten: 480 kcal");
		expect(sheet).toContain("Allowance (target + eat-back): 2,320 kcal");
		expect(sheet).toContain("Chest — 5:10 pm to 5:55 pm, 1 exercise, 120 kcal");
		expect(sheet).toContain("vs last time: +5 lb");
		expect(sheet).toContain("protein: 32 g of 159 g (under)");
		expect(sheet).toContain("7-day average: 183.1 lb");
		expect(sheet).toContain("EXPECTED BUT NOT LOGGED\nDinner (meal)");
		// No database ids anywhere: the model is given facts, not rows.
		expect(sheet).not.toContain("block-a1");
		expect(sheet).not.toContain("m1");
	});

	it("says a Health workout measured the same minutes rather than adding one", () => {
		const withHealth = view();
		const block = withHealth.blocks[0]!;
		const sheet = buildDaySheet({
			...withHealth,
			blocks: [
				{
					...block,
					health: {
						external_id: "hk-1",
						name: "Traditional Strength Training",
						start_at: block.start,
						end_at: block.end,
						kcal: 430,
						duration_min: 45,
						distance_mi: null,
					},
				},
			],
		});
		expect(sheet).toContain("(Health measured the same minutes)");
	});

	it("describes a closed day in the past and asks for no next action", () => {
		const closed = buildInShortPrompt(view({ is_today: false, closed_at: "2026-08-30T07:00:00.000Z" }));
		expect(closed).toContain("(closed)");
		expect(closed).toContain("past tense");
		expect(closed).toContain("This is a record, not a nudge.");
		expect(closed).not.toContain("EXPECTED BUT NOT LOGGED");
	});

	it("tells the live prompt what time it is for the user", () => {
		expect(buildRightNowPrompt(view(), "6:40 pm")).toContain("It is 6:40 pm on 2026-08-29 in the user's timezone.");
	});

	it("says there is no judgement when there is no goal", () => {
		expect(buildDaySheet(view({ goal: null }))).toContain("none set — no judgement, just the facts");
	});
});

describe("the inputs hash", () => {
	it("does not change because time passed", () => {
		expect(dayInputsHash(view())).toBe(dayInputsHash(view({ arc: [{ kind: "now", label: "Now", at: 900, instant: "x" }] })));
	});

	it("changes when something was logged", () => {
		const before = dayInputsHash(view());
		const after = dayInputsHash(view({ eaten: 1180, remaining: 1140 }));
		expect(after).not.toBe(before);
	});

	it("changes when the day stops expecting something", () => {
		expect(dayInputsHash(view({ expected: [] }))).not.toBe(dayInputsHash(view()));
	});
});
