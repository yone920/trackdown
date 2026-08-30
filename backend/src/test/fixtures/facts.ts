import {
	emptyDayFacts,
	type DayFacts,
	type FactActivity,
	type FactHealthSample,
	type FactMeal,
	type FactWeight,
} from "../../services/goals/measures.js";

// Fixture builders for the measure calculators' input. WP1's measures.test.ts grew its own
// copies of these; WP4's proposal and detection tests need the same shapes, and three
// hand-rolled `activity()` helpers is three chances for one of them to drift from the type.

/** Every fixture is dated relative to this, so a window test reads like a calendar. */
export const TODAY = "2026-08-29";

export function daysAgo(days: number, from: string = TODAY): string {
	return new Date(Date.parse(`${from}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

export function facts(partial: Partial<DayFacts> = {}): DayFacts {
	return { ...emptyDayFacts(TODAY), ...partial };
}

export function meal(date: string, values: Partial<FactMeal> = {}): FactMeal {
	return { date, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, ...values };
}

export function activity(date: string, values: Partial<FactActivity> = {}): FactActivity {
	return {
		date,
		exercise: null,
		category: null,
		muscle_groups: [],
		sets: null,
		reps: null,
		load_lb: null,
		duration_min: null,
		distance_mi: null,
		kcal: null,
		...values,
	};
}

export function weight(date: string, weight_lb: number): FactWeight {
	return { date, weight_lb };
}

export function sample(date: string, kind: string, value: number): FactHealthSample {
	return { date, kind, value };
}

/** One weigh-in a day, walking from `start` by `perDay` pounds — a clean trend to test on. */
export function weightTrend(days: number, start: number, perDay: number, end: string = TODAY): FactWeight[] {
	return Array.from({ length: days }, (_, i) => {
		const back = days - 1 - i;
		return { date: daysAgo(back, end), weight_lb: Math.round((start + perDay * i) * 10) / 10 };
	});
}
