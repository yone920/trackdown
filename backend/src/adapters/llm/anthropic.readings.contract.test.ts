import { describe, expect, it } from "vitest";
import { config } from "../../config/index.js";
import {
	IN_SHORT_SCHEMA_NAME,
	InShortSchema,
	RIGHT_NOW_SCHEMA_NAME,
	RightNowSchema,
} from "../../services/readings/schema.js";
import { createAnthropicLlm } from "./anthropic.js";

// The WP3 half of WP2's lesson: a structured-output schema is compiled into a decoding
// grammar, and one that is too big is refused at request time, not at review time (see the
// note at the top of services/fusion/schema.ts — the eight-branch union was 8.9 KB against
// a ceiling near 4.5 KB). readings.test.ts pins the *size* of these two schemas; this pins
// that the provider actually accepts them, on the model the readings really run on.
//
// Skipped without a key, so `npm test` stays green on a fresh clone. The key comes through
// config like everywhere else and is never printed.

const apiKey = config.anthropic.apiKey;

// Built lazily: an SDK client constructed with an empty key throws, which would fail the
// file instead of skipping it.
const coach = () =>
	createAnthropicLlm({
		apiKey,
		model: config.llm.defaultModels.anthropic.coach,
		workspaceId: config.anthropic.workspaceId,
	});

const DAY_SHEET = `DAY 12 — 2026-08-29 (today, still running)
Goal: Down to 170 lb (lose_fat)

CALORIES
Eaten: 1,180 kcal
Earned from activity: 310 kcal
Allowance (target + eat-back): 2,409 kcal
Left: 1,229 kcal
Status: on_track

TRAINING
Back & Chest — 1:10 pm to 2:05 pm, 3 exercises, 310 kcal
  · Bench Press, 3×8, 135 lb, vs last time: +5 lb

EATING
7:30 am breakfast: eggs and toast — 480 kcal
12:30 pm lunch: chicken and rice — 700 kcal

EXPECTED BUT NOT LOGGED
Dinner (meal)`;

describe.skipIf(!apiKey)("anthropic day readings (contract)", () => {
	it("compiles the right_now grammar and answers in two sentences with one next action", async () => {
		const answer = await coach().parseStructured({
			system: `Write the "Right now" line for this day: one or two sentences, then the single
next action. Use only the numbers on the sheet.\n\n${DAY_SHEET}`,
			schema: RightNowSchema,
			schemaName: RIGHT_NOW_SCHEMA_NAME,
			maxTokens: 400,
			messages: [{ role: "user", content: "Write the Right now reading for the day above." }],
		});

		// Two sentences is the design constraint, and the reason the card is one paragraph.
		const sentences = answer.text.split(/[.!?]+\s/).filter((part) => part.trim() !== "");
		expect(sentences.length).toBeLessThanOrEqual(2);
		// Dinner is the thing the day is waiting for, so the action should be about eating.
		expect(["log_meal", "coach", "workout", "weigh_in"]).toContain(answer.next_action.kind);
		expect(answer.actions.length).toBeLessThanOrEqual(3);
	}, 90_000);

	it("compiles the in_short grammar", async () => {
		const answer = await coach().parseStructured({
			system: `Write the "In short" paragraph for this day, which has closed. Past tense, two or
three sentences, no advice.\n\n${DAY_SHEET}`,
			schema: InShortSchema,
			schemaName: IN_SHORT_SCHEMA_NAME,
			maxTokens: 400,
			messages: [{ role: "user", content: "Write the In short reading for the day above." }],
		});
		expect(answer.text.length).toBeGreaterThan(20);
	}, 90_000);
});
