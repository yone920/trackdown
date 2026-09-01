import { describe, expect, it } from "vitest";
import {
	FIBER_BAND,
	PROTEIN_PER_LB,
	outliersOf,
	summarise,
	type EatingDay,
	type EatingTargets,
} from "./features.js";

// The eating week is arithmetic, and this is where that is held to. Facts are computed,
// advice is generated (concept-v2 §Principles 4) — the paragraph on the Eat page is handed
// these numbers, so if these are wrong the paragraph is confidently wrong.

const day = (over: Partial<EatingDay> = {}): EatingDay => ({
	date: "2026-09-01",
	kcal: 2000,
	protein_g: 150,
	carbs_g: 140,
	fat_g: 70,
	fiber_g: 28,
	meals: 3,
	...over,
});

const targets = (over: Partial<EatingTargets> = {}): EatingTargets => ({
	protein_g: 160,
	carbs_max_g: 150,
	fat_g: null,
	fiber_g: null,
	weight_lb: 212,
	losing: true,
	...over,
});

describe("the rolling window", () => {
	it("averages over the days that had a meal, never over the blanks", () => {
		// A day the user never opened the app is not a day they ate no protein. Averaging a
		// blank in would drag every number toward a lie that flatters nobody.
		const week = summarise(
			[
				day({ date: "2026-08-30", protein_g: 100 }),
				day({ date: "2026-08-31", protein_g: 0, kcal: 0, meals: 0 }),
				day({ date: "2026-09-01", protein_g: 200 }),
			],
			targets(),
		);
		expect(week.days_logged).toBe(2);
		expect(week.protein.avg_per_day).toBe(150);
		expect(week.days.map((d) => d.date)).toEqual(["2026-08-30", "2026-09-01"]);
	});

	it("says nothing rather than zero when the week is empty", () => {
		const week = summarise([], targets());
		expect(week.days_logged).toBe(0);
		expect(week.avg_kcal).toBeNull();
		expect(week.protein.avg_per_day).toBeNull();
		expect(week.fiber.avg_per_day).toBeNull();
		expect(week.outliers).toEqual([]);
	});

	it("keeps one decimal and no more", () => {
		const week = summarise([day({ protein_g: 100 }), day({ date: "2026-09-02", protein_g: 133 })], targets());
		expect(week.protein.avg_per_day).toBe(116.5);
	});
});

describe("what each average is measured against", () => {
	it("uses the protein the user stated, and says it was stated", () => {
		const week = summarise([day()], targets({ protein_g: 160 }));
		expect(week.protein).toMatchObject({ target: 160, source: "stated", direction: "at_least" });
	});

	it("derives protein from body weight when nobody has stated one", () => {
		// 0.7 g/lb is the floor worth defending for muscle retention in a deficit.
		const week = summarise([day()], targets({ protein_g: null, weight_lb: 212 }));
		expect(week.protein.target).toBe(Math.round(212 * PROTEIN_PER_LB.low));
		expect(week.protein.source).toBe("derived");
	});

	it("says nothing at all when there is neither a stated protein target nor a weight", () => {
		const week = summarise([day()], targets({ protein_g: null, weight_lb: null }));
		expect(week.protein).toMatchObject({ target: null, source: "none" });
	});

	it("reads the carb aim as a ceiling, not a floor", () => {
		const week = summarise([day()], targets({ carbs_max_g: 150 }));
		expect(week.carbs).toMatchObject({ target: 150, direction: "at_most", source: "stated" });
	});

	it("stands the fibre guideline in, and admits it is standing in", () => {
		const week = summarise([day()], targets({ fiber_g: null }));
		expect(week.fiber).toMatchObject({ target: FIBER_BAND.low, source: "guideline", direction: "at_least" });
		// A stated one wins, and stops being a guideline.
		expect(summarise([day()], targets({ fiber_g: 40 })).fiber).toMatchObject({ target: 40, source: "stated" });
	});
});

describe("what stood out about the last logged day", () => {
	it("names carbs that ran over the stated aim", () => {
		const notes = outliersOf([day({ carbs_g: 210 })], targets({ carbs_max_g: 150 }));
		expect(notes.join(" ")).toContain("60 g over your carb aim");
	});

	it("names protein that came in well under the mark", () => {
		const notes = outliersOf([day({ protein_g: 90 })], targets({ protein_g: 160 }));
		expect(notes.join(" ")).toMatch(/protein came in at 90 g/);
	});

	it("names a day that was nearly fibre-free, but not a day that merely missed the band", () => {
		expect(outliersOf([day({ fiber_g: 8 })], targets()).join(" ")).toContain("8 g of fibre");
		// 20 g is under the 25 g guideline and is not worth a complaint.
		expect(outliersOf([day({ fiber_g: 20 })], targets()).join(" ")).not.toContain("fibre");
	});

	it("is silent about an unremarkable day", () => {
		// A page that always has a complaint on it is a page people stop reading.
		expect(outliersOf([day()], targets())).toEqual([]);
	});

	it("is silent when nothing has been logged at all", () => {
		expect(outliersOf([], targets())).toEqual([]);
	});

	it("reads the LAST logged day, not the worst one", () => {
		const notes = outliersOf(
			[day({ date: "2026-08-30", carbs_g: 400 }), day({ date: "2026-09-01", carbs_g: 100 })],
			targets({ carbs_max_g: 150 }),
		);
		expect(notes).toEqual([]);
	});
});
