import { describe, expect, it } from "vitest";
import {
	MEASURES,
	MEASURE_IDS,
	computeMeasure,
	daysBefore,
	emptyDayFacts,
	getMeasure,
	withinWindow,
	type DayFacts,
	type FactActivity,
	type FactHealthSample,
	type FactMeal,
	type MeasureId,
} from "./measures.js";

// Fixtures are built relative to TODAY so every window test reads the way the calendar does.
const TODAY = "2026-08-29";

function daysAgo(n: number): string {
	return new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

function facts(partial: Partial<DayFacts> = {}): DayFacts {
	return { ...emptyDayFacts(TODAY), ...partial };
}

function meal(date: string, values: Partial<FactMeal> = {}): FactMeal {
	return { date, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, ...values };
}

function activity(date: string, values: Partial<FactActivity> = {}): FactActivity {
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

function sample(date: string, kind: string, value: number): FactHealthSample {
	return { date, kind, value };
}

function compute(id: MeasureId, f: DayFacts, scope?: string): number | null {
	return MEASURES[id].compute({ facts: f, scope });
}

describe("date helpers", () => {
	it("counts whole calendar days and windows them inclusively", () => {
		expect(daysBefore(daysAgo(3), TODAY)).toBe(3);
		expect(daysBefore(TODAY, TODAY)).toBe(0);
		expect(withinWindow(TODAY, TODAY, 1)).toBe(true);
		expect(withinWindow(daysAgo(6), TODAY, 7)).toBe(true);
		expect(withinWindow(daysAgo(7), TODAY, 7)).toBe(false);
		// A row dated after the day being measured is out of every window.
		expect(withinWindow("2026-08-30", TODAY, 7)).toBe(false);
	});

	it("refuses a value that is not a calendar date", () => {
		expect(() => daysBefore("29/08/2026", TODAY)).toThrow(/YYYY-MM-DD/);
	});
});

describe("the catalog", () => {
	it("has one descriptor per id, keyed by its own id", () => {
		for (const id of MEASURE_IDS) {
			expect(MEASURES[id].id).toBe(id);
			expect(MEASURES[id].unit).not.toBe("");
			expect(MEASURES[id].windowDays).toBeGreaterThan(0);
		}
		expect(Object.keys(MEASURES).sort()).toEqual([...MEASURE_IDS].sort());
	});

	it("resolves ids and refuses unknown ones instead of throwing", () => {
		expect(getMeasure("body_weight")?.unit).toBe("lb");
		expect(getMeasure("body_fat_pct")).toBeUndefined();
		expect(computeMeasure("body_fat_pct", facts())).toBeNull();
	});

	it("returns null for every measure when nothing has been logged", () => {
		const empty = facts();
		for (const id of MEASURE_IDS) {
			// The weekly totals are honestly zero on an empty week; everything else is unknown.
			const zeroOnEmpty = ["weekly_sets", "weekly_cardio_min", "distance_mi"];
			const expected = zeroOnEmpty.includes(id) ? 0 : null;
			expect({ id, value: compute(id, empty, "shoulders") }).toEqual({ id, value: expected });
		}
	});
});

describe("body_weight", () => {
	it("averages the last seven days, counting each day once", () => {
		const value = compute(
			"body_weight",
			facts({
				weights: [
					{ date: TODAY, weight_lb: 180 },
					{ date: TODAY, weight_lb: 182 }, // same day: averaged to 181, not counted twice
					{ date: daysAgo(6), weight_lb: 185 },
					{ date: daysAgo(9), weight_lb: 200 }, // outside the window
				],
			})
		);
		expect(value).toBe(183); // (181 + 185) / 2
	});

	it("is null when there is no weigh-in in the window", () => {
		expect(compute("body_weight", facts({ weights: [{ date: daysAgo(8), weight_lb: 190 }] }))).toBeNull();
	});
});

describe("calorie_balance", () => {
	it("is TDEE plus what was earned minus what was eaten, so a deficit is positive", () => {
		const value = compute(
			"calorie_balance",
			facts({
				tdee: 2400,
				meals: [meal(TODAY, { kcal: 1800 }), meal(daysAgo(1), { kcal: 3000 })],
				activities: [activity(TODAY, { kcal: 300 }), activity(daysAgo(1), { kcal: 900 })],
			})
		);
		expect(value).toBe(900);
	});

	it("is null without a TDEE, rather than pretending the profile is complete", () => {
		expect(compute("calorie_balance", facts({ meals: [meal(TODAY, { kcal: 1800 })] }))).toBeNull();
	});
});

describe("protein_g and carbs_g", () => {
	it("sum the day's meals", () => {
		const f = facts({
			meals: [
				meal(TODAY, { protein_g: 40, carbs_g: 30 }),
				meal(TODAY, { protein_g: 25.5, carbs_g: 12 }),
				meal(daysAgo(1), { protein_g: 100, carbs_g: 100 }),
			],
		});
		expect(compute("protein_g", f)).toBe(65.5);
		expect(compute("carbs_g", f)).toBe(42);
	});

	it("is null on a day with no meals logged — an unlogged day is not a zero-protein day", () => {
		expect(compute("protein_g", facts({ meals: [meal(daysAgo(1), { protein_g: 90 })] }))).toBeNull();
	});
});

describe("weekly_sets", () => {
	const f = facts({
		activities: [
			activity(TODAY, { muscle_groups: ["chest", "triceps"], sets: 4 }),
			activity(daysAgo(3), { muscle_groups: ["Chest"], sets: 3 }),
			activity(daysAgo(8), { muscle_groups: ["chest"], sets: 5 }), // outside the week
			activity(daysAgo(1), { muscle_groups: ["lats"], sets: 4 }),
		],
	});

	it("sums the week's sets for one muscle group, case-insensitively", () => {
		expect(compute("weekly_sets", f, "chest")).toBe(7);
		expect(compute("weekly_sets", f, "lats")).toBe(4);
	});

	it("is zero for a muscle the week missed, and null without a scope", () => {
		expect(compute("weekly_sets", f, "hamstrings")).toBe(0);
		expect(compute("weekly_sets", f)).toBeNull();
	});
});

describe("exercise_load", () => {
	const f = facts({
		activities: [
			activity(daysAgo(20), { exercise: "Bench Press", load_lb: 175 }),
			activity(daysAgo(2), { exercise: "bench press", load_lb: 185 }),
			activity(daysAgo(1), { exercise: "Bench Press", load_lb: 180 }),
			activity(daysAgo(30), { exercise: "Bench Press", load_lb: 225 }), // older than four weeks
			activity(daysAgo(1), { exercise: "Back Squat", load_lb: 250 }),
		],
	});

	it("is the best load for that exercise in four weeks, matched by name case-insensitively", () => {
		expect(compute("exercise_load", f, "Bench Press")).toBe(185);
		expect(compute("exercise_load", f, "back squat")).toBe(250);
	});

	it("is null for an exercise not logged in the window, and without a scope", () => {
		expect(compute("exercise_load", f, "Deadlift")).toBeNull();
		expect(compute("exercise_load", f)).toBeNull();
	});
});

describe("weekly_cardio_min, distance_mi and pace", () => {
	const f = facts({
		activities: [
			activity(TODAY, { category: "cardio", duration_min: 30, distance_mi: 3 }),
			activity(daysAgo(2), { category: "cardio", duration_min: 60, distance_mi: 5 }),
			activity(daysAgo(2), { category: "strength", duration_min: 45 }), // not cardio
			activity(daysAgo(9), { category: "cardio", duration_min: 90, distance_mi: 9 }), // outside
		],
	});

	it("counts only cardio minutes inside the week", () => {
		expect(compute("weekly_cardio_min", f)).toBe(90);
	});

	it("totals the week's distance and derives pace from the totals", () => {
		expect(compute("distance_mi", f)).toBe(8);
		expect(compute("pace", f)).toBe(11.25); // 90 min / 8 mi
	});

	it("has no pace when nothing covered a distance", () => {
		const noDistance = facts({ activities: [activity(TODAY, { category: "cardio", duration_min: 40 })] });
		expect(compute("pace", noDistance)).toBeNull();
		expect(compute("distance_mi", noDistance)).toBe(0);
	});
});

describe("the Health-derived measures", () => {
	it("are null for a user with no samples — Health is optional and nothing may depend on it", () => {
		const logsOnly = facts({
			meals: [meal(TODAY, { kcal: 2000, protein_g: 120 })],
			activities: [activity(TODAY, { category: "cardio", duration_min: 40, kcal: 300 })],
			weights: [{ date: TODAY, weight_lb: 181 }],
		});
		for (const id of MEASURE_IDS.filter((m) => MEASURES[m].derivedFrom === "health")) {
			expect({ id, value: compute(id, logsOnly) }).toEqual({ id, value: null });
		}
	});

	it("sums the day's steps and ignores yesterday's", () => {
		const f = facts({
			healthSamples: [sample(TODAY, "steps", 4000), sample(TODAY, "steps", 2500), sample(daysAgo(1), "steps", 9000)],
		});
		expect(compute("steps", f)).toBe(6500);
	});

	it("takes resting heart rate from the day only", () => {
		expect(compute("resting_hr", facts({ healthSamples: [sample(TODAY, "resting_hr", 58)] }))).toBe(58);
		expect(compute("resting_hr", facts({ healthSamples: [sample(daysAgo(1), "resting_hr", 58)] }))).toBeNull();
	});

	it("takes the newest VO2 max within three months, since it is measured rarely", () => {
		const f = facts({
			healthSamples: [sample(daysAgo(40), "vo2_max", 41.2), sample(daysAgo(10), "vo2_max", 43.8)],
		});
		expect(compute("vo2", f)).toBe(43.8);
		expect(compute("vo2", facts({ healthSamples: [sample(daysAgo(120), "vo2_max", 43.8)] }))).toBeNull();
	});
});
