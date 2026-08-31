import { describe, expect, it } from "vitest";
import {
	TOLERANCE_FLOOR_KCAL,
	checkMacros,
	checkMeal,
	discrepancyLine,
	impliedKcal,
	toleranceFor,
} from "./arithmetic.js";
import type { FusionResult } from "./schema.js";

// The arithmetic gate, on its own. Pure: no model, no database, no prompt.

/**
 * THE FIELD CASE, as it came off the phone on 2026-08-31.
 *
 * Spoken: tuna, two eggs, a quarter of an onion, a chilli, two cups of vegetables, two
 * tablespoons of olive oil, "four slices of this bread" — with photographs of the bread
 * bag's nutrition label and the tuna can's.
 *
 * Answered: 918 kcal, 67 g protein, **398 g carbohydrate**, 35 g fat. Marked HIGH.
 *
 * 4 × 67 + 4 × 398 + 9 × 35 = 2,175. The two halves of that answer cannot both be true, and
 * the carbohydrate figure is a whole loaf rather than four slices of one.
 */
export const FIELD_MEAL = {
	kind: "meal" as const,
	description: "tuna, eggs, onion, chilli, vegetables, olive oil and four slices of bread",
	meal_type: "lunch" as const,
	kcal: 918,
	protein_g: 67,
	carbs_g: 398,
	fat_g: 35,
	fiber_g: 12,
	items: [],
	confidence: "high" as const,
	sources: null,
	consistency: null,
} satisfies Extract<FusionResult, { kind: "meal" }>;

describe("impliedKcal", () => {
	it("is 4 protein + 4 carbs + 9 fat", () => {
		expect(impliedKcal({ kcal: null, protein_g: 10, carbs_g: 20, fat_g: 5 })).toBe(40 + 80 + 45);
	});

	it("is null when one of the three was never read", () => {
		// A blank is not a zero: treating it as one would invent a disagreement out of a
		// macro nobody gave, and fail a perfectly honest reading.
		expect(impliedKcal({ kcal: 500, protein_g: 30, carbs_g: 40, fat_g: null })).toBeNull();
		expect(impliedKcal({ kcal: 500, protein_g: null, carbs_g: 40, fat_g: 10 })).toBeNull();
		expect(impliedKcal({ kcal: 500, protein_g: 30, carbs_g: null, fat_g: 10 })).toBeNull();
	});
});

describe("toleranceFor", () => {
	it("is a quarter of the meal, or 150 kcal, whichever is larger", () => {
		// A small meal gets the flat floor; a big one gets the fraction.
		expect(toleranceFor(200)).toBe(TOLERANCE_FLOOR_KCAL);
		expect(toleranceFor(600)).toBe(TOLERANCE_FLOOR_KCAL);
		expect(toleranceFor(601)).toBeCloseTo(150.25, 2);
		expect(toleranceFor(2000)).toBe(500);
	});
});

describe("checkMacros", () => {
	it("catches the field case", () => {
		const check = checkMeal(FIELD_MEAL);
		expect(check.checked).toBe(true);
		expect(check.ok).toBe(false);
		expect(check.stated_kcal).toBe(918);
		expect(check.implied_kcal).toBe(2175);
		expect(check.diff).toBe(1257);
		// 25 % of 918 beats the 150 floor, and 1,257 clears it several times over.
		expect(check.tolerance).toBe(230);
	});

	it("passes a plate that adds up, fibre and rounding included", () => {
		// 45 × 4 + 60 × 4 + 18 × 9 = 582 against a stated 620.
		expect(
			checkMacros({ kcal: 620, protein_g: 45, carbs_g: 60, fat_g: 18 })
		).toMatchObject({ ok: true, checked: true, implied_kcal: 582 });
	});

	it("passes a reading exactly at the tolerance and fails one a calorie past it", () => {
		// 400 kcal stated, so the floor applies: 150 either way.
		const at = checkMacros({ kcal: 400, protein_g: 0, carbs_g: 0, fat_g: 550 / 9 });
		expect(at.implied_kcal).toBe(550);
		expect(at.ok).toBe(true);
		const past = checkMacros({ kcal: 400, protein_g: 0, carbs_g: 0, fat_g: 551 / 9 });
		expect(past.ok).toBe(false);
	});

	it("is symmetric: macros far UNDER the calories fail too", () => {
		// The alcohol shape — 7 kcal a gram, in none of the three. Generous, not blind.
		expect(checkMacros({ kcal: 1200, protein_g: 10, carbs_g: 10, fat_g: 10 }).ok).toBe(false);
		// And a beer's worth of it, on a small meal, is inside the floor.
		expect(checkMacros({ kcal: 300, protein_g: 5, carbs_g: 20, fat_g: 6 }).ok).toBe(true);
	});

	it("checks nothing when there is nothing to check", () => {
		// No calories, no macros, or only some of them: the gate has no opinion, and an
		// unchecked reading is never a failed one.
		expect(checkMacros({ kcal: null, protein_g: 20, carbs_g: 20, fat_g: 20 })).toMatchObject({
			ok: true,
			checked: false,
		});
		expect(checkMacros({ kcal: 700, protein_g: null, carbs_g: null, fat_g: null })).toMatchObject({
			ok: true,
			checked: false,
		});
		expect(checkMacros({ kcal: 918, protein_g: 67, carbs_g: null, fat_g: 35 }).checked).toBe(false);
	});

	it("has no opinion about anything that is not a meal", () => {
		expect(checkMeal({ kind: "weight", weight_lb: 181, confidence: "high", sources: null }).checked).toBe(false);
		expect(checkMeal({ kind: "unclear", question: "Which machine?" }).checked).toBe(false);
	});
});

describe("discrepancyLine", () => {
	it("names both numbers, so the re-ask has something to check rather than to guess", () => {
		const line = discrepancyLine(checkMeal(FIELD_MEAL));
		expect(line).toContain("2175");
		expect(line).toContain("918");
		expect(line.toLowerCase()).toContain("protein");
	});
});
