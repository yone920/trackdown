import type { FusionResult } from "./schema.js";

// The macro arithmetic gate (docs/CHANGELOG-v2.md §Field fixes — a lunch that read 398 g of
// carbs). Deterministic, post-parse, meals only.
//
// The field case, verbatim: a spoken lunch (tuna, two eggs, a quarter onion, a chilli, two
// cups of vegetables, two tablespoons of olive oil, "four slices of this bread") with photos
// of the bread bag's nutrition label and the tuna can's. It came back kcal 918, protein 67,
// **carbs 398**, fat 35 — and HIGH confidence. 4×67 + 4×398 + 9×35 ≈ 2,175, which is not
// 918 by a factor of two: the reading is internally inconsistent, and almost certainly the
// label's whole-loaf carbohydrate figure rather than four slices of it.
//
// No prompt catches this reliably, because the model has no reason to do the multiplication
// it would take to notice — and it had already decided it was sure. Arithmetic is arithmetic,
// so it is checked in code, on every meal, at analyze and at revise:
//
//   implied = 4·protein + 4·carbs + 9·fat        against the kcal the model stated
//
// The tolerance is deliberately generous — 25 % or 150 kcal, whichever is larger. The Atwater
// factors are round numbers, fibre yields about 2 kcal/g rather than 4 (so `implied` runs
// high on a high-fibre plate), alcohol yields 7 and is in none of the three (so `implied`
// runs low on a night out), and portion estimates are estimates. This gate is not a
// nutritionist. It is looking for the reading that is wrong by a factor, and 918 vs 2,175
// clears any honest tolerance by a mile.

/** Grams of protein, carbohydrate and fat as kcal. The Atwater factors, rounded. */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

/** The looser of the two tolerances always wins: a small meal gets the flat one. */
export const TOLERANCE_FRACTION = 0.25;
export const TOLERANCE_FLOOR_KCAL = 150;

export interface MacroReading {
	kcal: number | null;
	protein_g: number | null;
	carbs_g: number | null;
	fat_g: number | null;
}

export interface MacroCheck {
	/** False only when the check ran AND the numbers disagreed by more than the tolerance. */
	ok: boolean;
	/** False when there was nothing to check — a meal with no kcal, or a missing macro. */
	checked: boolean;
	stated_kcal: number | null;
	implied_kcal: number | null;
	/** |implied − stated|, or 0 when nothing was checked. */
	diff: number;
	/** What the difference had to stay under. */
	tolerance: number;
}

const SKIPPED: MacroCheck = {
	ok: true,
	checked: false,
	stated_kcal: null,
	implied_kcal: null,
	diff: 0,
	tolerance: 0,
};

/**
 * The kcal the macros add up to, or null when one of the three was not read.
 *
 * A missing macro is not a zero: a plate with protein and carbs but no fat figure would
 * imply far fewer calories than it has, and failing that reading would be the gate inventing
 * a disagreement out of a blank. Nothing is checked unless all three are there.
 */
export function impliedKcal(reading: MacroReading): number | null {
	const { protein_g, carbs_g, fat_g } = reading;
	if (protein_g === null || carbs_g === null || fat_g === null) return null;
	return protein_g * KCAL_PER_G.protein + carbs_g * KCAL_PER_G.carbs + fat_g * KCAL_PER_G.fat;
}

/** What the difference is allowed to be, for a meal of this size. */
export function toleranceFor(statedKcal: number): number {
	return Math.max(TOLERANCE_FLOOR_KCAL, Math.abs(statedKcal) * TOLERANCE_FRACTION);
}

/**
 * Does the meal add up? A reading with nothing to check passes: the gate's job is to catch
 * a contradiction, not to demand macros nobody gave.
 *
 * The comparison is `diff > tolerance`, so a difference exactly at the tolerance passes —
 * a gate that fires on its own boundary is a gate nobody can reason about.
 */
export function checkMacros(reading: MacroReading): MacroCheck {
	const stated = reading.kcal;
	const implied = impliedKcal(reading);
	if (stated === null || implied === null) return SKIPPED;
	const diff = Math.abs(implied - stated);
	const tolerance = toleranceFor(stated);
	return {
		ok: diff <= tolerance,
		checked: true,
		stated_kcal: stated,
		implied_kcal: Math.round(implied),
		diff: Math.round(diff),
		tolerance: Math.round(tolerance),
	};
}

/** The gate over a public result. Anything that is not a meal has nothing to check. */
export function checkMeal(result: FusionResult): MacroCheck {
	if (result.kind !== "meal") return SKIPPED;
	return checkMacros(result);
}

/**
 * The discrepancy in the model's own terms, for the one automatic re-ask. It names both
 * numbers and the likeliest cause, because "these do not add up" with no hypothesis is an
 * instruction to guess again rather than to check something.
 */
export function discrepancyLine(check: MacroCheck): string {
	return (
		`Your macros imply about ${check.implied_kcal} kcal (4 × protein + 4 × carbs + 9 × fat) ` +
		`but you said ${check.stated_kcal} kcal. Those cannot both be right.`
	);
}
