import { z } from "zod";
import { describe, expect, it } from "vitest";
import { buildDaySheet, buildInShortPrompt, buildRightNowPrompt } from "./prompt.js";
import { dayInputsHash } from "./readings.js";
import { InShortSchema, RightNowSchema } from "./schema.js";
import { dayViewFixture as view } from "../../test/fixtures/dayView.js";

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
		// No database ids anywhere: the model is given facts, not rows.
		expect(sheet).not.toContain("block-a1");
		expect(sheet).not.toContain("m1");
	});

	it("names the empty slots as open, not as something owed", () => {
		const sheet = buildDaySheet(view());
		expect(sheet).toContain("Dinner (meal)");
		expect(sheet).toContain("not something the user owes");
		// The old heading is the framing this app dropped (user decision 2026-08-31).
		expect(sheet).not.toContain("EXPECTED BUT NOT LOGGED");
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
		expect(closed).not.toContain("OPEN SLOTS");
	});

	it("forbids obligation phrasing in both prompts and still allows the arithmetic", () => {
		for (const prompt of [buildRightNowPrompt(view(), "6:40 pm"), buildInShortPrompt(view())]) {
			expect(prompt).toContain("NOTHING IS OWED");
			// The three phrasings the field report named, quoted as things not to write.
			expect(prompt).toContain('Never write that a meal is "due" or "expected"');
			expect(prompt).toContain('"still needs to"');
			expect(prompt).toContain('"missing"');
			// And the closer that is still welcome, because it is arithmetic.
			expect(prompt).toContain("would close today's targets");
		}
	});

	it("makes the next-action chip a shortcut rather than a reminder", () => {
		const prompt = buildRightNowPrompt(view(), "6:40 pm");
		expect(prompt).toContain("a shortcut to a screen, not a reminder");
		expect(prompt).toContain("The chip's label is a place, not an order");
		// The instruction that used to point the model at "what the day is waiting for".
		expect(prompt).not.toContain("what the day is actually waiting for");
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

	it("changes when a slot stops being empty", () => {
		expect(dayInputsHash(view({ expected: [] }))).not.toBe(dayInputsHash(view()));
	});
});
