import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
	PROMPT_FINGERPRINT,
	buildDaySheet,
	buildDossierPrompt,
	buildDossierSheet,
	buildEatingDirectionPrompt,
	buildInShortPrompt,
	buildRightNowPrompt,
	type EatingDirectionSheet,
} from "./prompt.js";
import { dossierInputsHash } from "./dossier.js";
import { dayInputsHash, eatingInputsHash } from "./readings.js";
import { DossierSchema, EatingDirectionSchema, InShortSchema, RightNowSchema } from "./schema.js";
import { dayViewFixture as view } from "../../test/fixtures/dayView.js";
import { dossierInputsFixture } from "../../test/fixtures/dossier.js";
import { summarise, type EatingDay, type EatingTargets } from "../eating/features.js";

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
			["dossier", DossierSchema],
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

	/**
	 * The field case this exists for: the prompt was told never to say "left to log" and the
	 * reading already in the table went on saying it, because the *day* had not changed.
	 *
	 * The pin is deliberate. Editing either prompt changes this value and fails this test,
	 * which is the moment to notice that the edit rewrites every cached reading once —
	 * one model call per active day, and worth it, but not a thing to do by accident.
	 */
	it("is bound to what the prompt currently says", () => {
		// Bumped 2026-09-01 when the Eat page's direction prompt joined the fingerprint, and
		// again when that prompt was told the open day is not in its numbers.
		expect(PROMPT_FINGERPRINT).toBe("6b5cd166");
		expect(dayInputsHash(view())).toMatch(/^[0-9a-f]{32}$/);
	});
});

describe("the dossier prompt", () => {
	it("asks for two paragraphs of prose and forbids every shape of list", () => {
		const prompt = buildDossierPrompt(dossierInputsFixture());
		expect(prompt).toContain("EXACTLY TWO PARAGRAPHS");
		expect(prompt).toContain("No headings, no bullet points");
		expect(prompt).toContain("no lists of any kind");
	});

	it("makes the second paragraph an invitation with the benefit attached", () => {
		const prompt = buildDossierPrompt(dossierInputsFixture());
		expect(prompt).toContain("INVITATION WITH");
		expect(prompt).toContain("THE BENEFIT ATTACHED");
		// The three phrasings that read as a reprimand, quoted as things not to write.
		expect(prompt).toContain(`"You haven't told me how long your sessions are."`);
		expect(prompt).toContain(`"Your profile is missing a`);
		// And the shape that is wanted, beside them.
		expect(prompt).toContain("I can size each plan to fit it");
		expect(prompt).toContain("never an apology");
	});

	it("carries the VOICE rules the other two readings are held to", () => {
		const prompt = buildDossierPrompt(dossierInputsFixture());
		expect(prompt).toContain("Never scold.");
		expect(prompt).toContain("NOTHING IS OWED");
		expect(prompt).toContain("INVENT NOTHING");
	});
});

describe("the dossier sheet the model is given", () => {
	it("separates what the user said from what the log measured", () => {
		const sheet = buildDossierSheet(dossierInputsFixture());
		// Stated, with the date a human said it.
		expect(sheet).toContain("Days a week [stated 2026-08-14]: 4");
		expect(sheet).toContain("Diet style [stated 2026-08-14]: higher protein");
		expect(sheet).toContain("Their gym: New Millennium (gym), 14 machines seen there");
		expect(sheet).toContain("Constraints: bad left knee — no deep lunges");
		// Measured, under its own heading.
		expect(sheet).toContain("WHAT THE LOG SHOWS — the last 28 days, measured, not stated");
		expect(sheet).toContain("Bench Press — 4 sessions, last at 145 lb, +10 lb over the window");
		expect(sheet).toContain("Sessions this week: 3");
		expect(sheet).toContain("7-day average: 210.4 lb");
	});

	it("says which numbers were chosen by the user and which are standing in", () => {
		const sheet = buildDossierSheet(dossierInputsFixture());
		// A derived target is not a stated one, and the sheet says so in the model's terms.
		expect(sheet).toContain("worked out from their stats, not stated");
		// And the cardio guideline is named as a guideline — the `daily_calorie_target` lesson.
		expect(sheet).toContain("the standard guideline, NOT something they said");
	});

	it("names what nobody has said by leaving it off, rather than printing a blank", () => {
		const sheet = buildDossierSheet(dossierInputsFixture());
		// Session length was never stated: no row, no "null", nothing to mistake for a fact.
		expect(sheet).not.toContain("Session length");
		expect(sheet).not.toContain("null");
		expect(sheet).not.toContain("undefined");
	});

	it("carries the goal in the user's own words and counts what came before it", () => {
		const sheet = buildDossierSheet(dossierInputsFixture());
		expect(sheet).toContain("Down to 195 lb (lose_fat) — since 2026-08-14, by 2026-12-01, 11% of the way");
		expect(sheet).toContain("1 finished before these.");
	});

	it("says so plainly when there is no goal at all", () => {
		const sheet = buildDossierSheet(dossierInputsFixture({ goals: [], goal_history: 0 }));
		expect(sheet).toContain("GOALS\nNone active.");
	});

	it("carries no database ids — facts, not rows", () => {
		const sheet = buildDossierSheet(dossierInputsFixture());
		expect(sheet).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
	});
});

describe("the dossier's cache key", () => {
	it("is stable for the same person read twice", () => {
		expect(dossierInputsHash(dossierInputsFixture())).toBe(dossierInputsHash(dossierInputsFixture()));
		expect(dossierInputsHash(dossierInputsFixture())).toMatch(/^[0-9a-f]{32}$/);
	});

	it("moves when a plan field, a goal or the training does", () => {
		const base = dossierInputsHash(dossierInputsFixture());
		const stated = dossierInputsFixture();
		expect(
			dossierInputsHash({ ...stated, plan: { ...stated.plan, session_minutes: 45 } })
		).not.toBe(base);
		expect(dossierInputsHash(dossierInputsFixture({ goals: [] }))).not.toBe(base);
		expect(dossierInputsHash(dossierInputsFixture({ goal_history: 4 }))).not.toBe(base);
	});
});

// ── the Eat page's written layer ─────────────────────────────────────────────────────
// A READING, not a brief: cached per day against the week's own inputs hash, so opening the
// page when nothing has moved costs nothing. And nutrient direction only — the user was
// plain that a dish is not what they want (user decision 2026-09-01).

function eatingSheet(over: Partial<EatingDirectionSheet> = {}): EatingDirectionSheet {
	const days: EatingDay[] = [
		{ date: "2026-08-31", kcal: 2100, protein_g: 120, carbs_g: 190, fat_g: 80, fiber_g: 14, meals: 3 },
		{ date: "2026-09-01", kcal: 1950, protein_g: 130, carbs_g: 175, fat_g: 70, fiber_g: 18, meals: 3 },
	];
	const targets: EatingTargets = {
		protein_g: 160,
		carbs_max_g: 150,
		fat_g: null,
		fiber_g: null,
		weight_lb: 212,
		losing: true,
	};
	return {
		week: summarise(days, targets),
		goal: "Get to 170 lb",
		weight_lb: 212,
		diet_style: "lower carb",
		preferences: ["mornings only"],
		constraints: [],
		...over,
	};
}

describe("the eating direction schema", () => {
	it("is one short paragraph and nothing else", () => {
		expect(schemaBytes(EatingDirectionSchema)).toBeLessThan(READING_BUDGET_BYTES);
		expect(schemaBytes(EatingDirectionSchema)).toBeLessThan(GRAMMAR_CEILING_BYTES);
		expect(EatingDirectionSchema.safeParse({ text: "Push protein up." }).success).toBe(true);
		// A meal plan cannot fit, and that is the ceiling doing its job.
		expect(EatingDirectionSchema.safeParse({ text: "x".repeat(700) }).success).toBe(false);
	});
});

describe("the eating direction prompt", () => {
	it("forbids dishes in as many words, because that is the line it must not cross", () => {
		const prompt = buildEatingDirectionPrompt(eatingSheet());
		expect(prompt).toContain("NEVER PRESCRIBE A DISH");
		expect(prompt).toContain("general direction of nutrients");
	});

	it("hands over the computed week, and says where each target came from", () => {
		const prompt = buildEatingDirectionPrompt(eatingSheet());
		expect(prompt).toContain("Closed days with food logged in the last 7 (today is NOT counted): 2");
		expect(prompt).toContain("Protein: 125 g/day average · aim at least 160 g (stated)");
		expect(prompt).toContain("Carbohydrate: 182.5 g/day average · aim at most 150 g (stated)");
		// Nobody states a fibre target; the guideline stands in and admits it.
		expect(prompt).toContain("(guideline)");
	});

	it("carries what the user has said about how they eat, as constraints", () => {
		const prompt = buildEatingDirectionPrompt(eatingSheet({ diet_style: "keto", preferences: ["no dairy"] }));
		expect(prompt).toContain("Diet style: keto");
		expect(prompt).toContain("no dairy");
	});

	it("says nothing about training — another page has that", () => {
		expect(buildEatingDirectionPrompt(eatingSheet())).toContain("Say nothing about training");
	});

	it("is told the open day is not in its numbers, in as many words", () => {
		// Field report 2026-09-01: the page judged a half-lived day in the past tense. The
		// arithmetic no longer includes it, and the prompt is told so as well — a model
		// handed only closed days can still write "today came in at" if nobody says not to.
		const prompt = buildEatingDirectionPrompt(eatingSheet());
		expect(prompt).toContain("today is not in them");
		expect(prompt).toContain("Never write about today in the past tense");
	});

	it("leaves out a macro nobody has any days for", () => {
		const empty = eatingSheet({ week: summarise([], { protein_g: null, carbs_max_g: null, fat_g: null, fiber_g: null, weight_lb: null, losing: false }) });
		const prompt = buildEatingDirectionPrompt(empty);
		expect(prompt).toContain("Closed days with food logged in the last 7 (today is NOT counted): 0");
		expect(prompt).not.toContain("g/day average");
	});
});

describe("the eating direction's cache key", () => {
	it("holds still while the same week is read again", () => {
		expect(eatingInputsHash(eatingSheet())).toBe(eatingInputsHash(eatingSheet()));
	});

	it("moves when the numbers under it move", () => {
		const other = eatingSheet();
		other.week.protein.avg_per_day = 180;
		expect(eatingInputsHash(other)).not.toBe(eatingInputsHash(eatingSheet()));
	});

	it("moves when a target is set, because the advice is measured against it", () => {
		const other = eatingSheet();
		other.week.carbs.target = 120;
		expect(eatingInputsHash(other)).not.toBe(eatingInputsHash(eatingSheet()));
	});

	it("moves when the user says something new about how they eat", () => {
		expect(eatingInputsHash(eatingSheet({ diet_style: "keto" }))).not.toBe(eatingInputsHash(eatingSheet()));
		expect(eatingInputsHash(eatingSheet({ preferences: ["no dairy"] }))).not.toBe(eatingInputsHash(eatingSheet()));
	});
});
