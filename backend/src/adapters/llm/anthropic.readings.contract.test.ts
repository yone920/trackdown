import { describe, expect, it } from "vitest";
import { config } from "../../config/index.js";
import { buildDossierPrompt, buildRightNowPrompt } from "../../services/readings/prompt.js";
import {
	DOSSIER_SCHEMA_NAME,
	DossierSchema,
	IN_SHORT_SCHEMA_NAME,
	InShortSchema,
	RIGHT_NOW_SCHEMA_NAME,
	RightNowSchema,
} from "../../services/readings/schema.js";
import { dayViewFixture } from "../../test/fixtures/dayView.js";
import { dossierInputsFixture } from "../../test/fixtures/dossier.js";
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

OPEN SLOTS (nothing logged here yet — a fact about the log, not something the user owes)
Dinner (meal)`;

/**
 * The phrasings this app does not use about a person's own log (concept-v2 §Principles 8,
 * user decision 2026-08-31). Shared by the day reading and the dossier, because "nothing is
 * owed" is one rule and two prompts are held to it.
 */
const OBLIGATION_PHRASES = [
	"is due",
	"are due",
	"expected",
	"still need",
	"still needs",
	"you should log",
	"don't forget",
	"remember to",
	"missing",
	"owe",
];

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
		// Dinner is the slot with nothing in it, so the action should be about eating.
		expect(["log_meal", "coach", "workout", "weigh_in"]).toContain(answer.next_action.kind);
		expect(answer.actions.length).toBeLessThanOrEqual(3);
	}, 90_000);

	// The VOICE rule that is a product law rather than a style note: the app logs what
	// happened and never tells the user what they owe (user decision 2026-08-31). A prompt
	// can say so and a model can still say "dinner is due", so this asks the real one, on
	// the real prompt — the hand-written sheet above would prove nothing about the wording.
	it("writes the day with no obligation in it", async () => {
		const answer = await coach().parseStructured({
			system: buildRightNowPrompt(dayViewFixture(), "6:40 pm"),
			schema: RightNowSchema,
			schemaName: RIGHT_NOW_SCHEMA_NAME,
			maxTokens: 400,
			messages: [{ role: "user", content: "Write the Right now reading for the day above." }],
		});

		const said = `${answer.text} ${answer.next_action.label} ${answer.next_action.hint ?? ""} ${answer.actions
			.map((action) => action.label)
			.join(" ")}`.toLowerCase();
		for (const forbidden of OBLIGATION_PHRASES) {
			expect({ forbidden, said }).toMatchObject({ forbidden, said: expect.not.stringContaining(forbidden) });
		}
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

// The dossier (migration 0017). Two paragraphs of prose about a person, and every rule it
// is held to is a wording rule — which is exactly the kind that a prompt can state, a
// reviewer can approve, and a model can then quietly ignore. So it is asked for real, on
// the real prompt, over the real sheet.
describe.skipIf(!apiKey)("anthropic dossier (contract)", () => {
	it("writes two paragraphs of prose and asks rather than scolds", async () => {
		const inputs = dossierInputsFixture();
		const answer = await coach().parseStructured({
			system: buildDossierPrompt(inputs),
			schema: DossierSchema,
			schemaName: DOSSIER_SCHEMA_NAME,
			maxTokens: 500,
			messages: [{ role: "user", content: "Write the two paragraphs for the person above." }],
		});

		// Two paragraphs, and they are paragraphs: each one is prose, not a list wearing a
		// field name. A model that answers in bullets has answered the wrong question.
		for (const [name, text] of [
			["known", answer.known],
			["missing", answer.missing],
		] as const) {
			expect({ name, empty: text.trim().length === 0 }).toEqual({ name, empty: false });
			for (const bullet of ["\n-", "\n•", "\n*", "\n1.", "\n2."]) {
				expect({ name, bullet, text }).toMatchObject({ name, bullet, text: expect.not.stringContaining(bullet) });
			}
		}

		// Nothing in either paragraph reads as a debt the user has run up.
		const said = `${answer.known} ${answer.missing}`.toLowerCase();
		for (const forbidden of OBLIGATION_PHRASES) {
			expect({ forbidden, said }).toMatchObject({ forbidden, said: expect.not.stringContaining(forbidden) });
		}
		// And "you haven't told me" is the specific shape this prompt was written against.
		for (const scold of ["haven't told me", "have not told me", "you failed", "you never"]) {
			expect({ scold, said }).toMatchObject({ scold, said: expect.not.stringContaining(scold) });
		}

		// The second paragraph is an invitation: it asks for something and says what it buys.
		expect(answer.missing.toLowerCase()).toMatch(/tell me|let me know|say|name|share|if you/);

		// And the first one is about THIS person: the sheet's own facts, not a horoscope.
		expect(answer.known.toLowerCase()).toMatch(/four|4|new millennium|bench|week/);
	}, 90_000);
});
