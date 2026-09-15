import { describe, expect, it } from "vitest";
import {
	alternativesText,
	classifyCardio,
	equivalentMinutes,
	equivalentText,
	INTENSITY_MULTIPLIER,
	paceApplies,
	shortLabel,
} from "./cardioIntensity.js";

// What a cardio minute is worth. Everything here is pure and deterministic on purpose: the
// multiplier moves a number the coach prescribes from, so the same sentence has to produce
// the same answer next March.

const intensityOf = (input: Parameters<typeof classifyCardio>[0]) => classifyCardio(input).intensity;

describe("classifying by name", () => {
	it("reads a run, an interval session and a rower as vigorous", () => {
		for (const exercise of ["Running", "Treadmill Run", "Sprint Intervals", "HIIT", "Rowing", "Jump Rope", "Swimming"]) {
			expect({ exercise, intensity: intensityOf({ exercise }) }).toEqual({ exercise, intensity: "vigorous" });
		}
	});

	it("reads a brisk or incline walk, a bike and an elliptical as moderate", () => {
		for (const exercise of [
			"Brisk Walk",
			"Incline Treadmill Walk",
			"Power Walk",
			"Cycling",
			"Stationary Bike",
			"Spin Class",
			"Elliptical",
			"Hiking",
		]) {
			expect({ exercise, intensity: intensityOf({ exercise }) }).toEqual({ exercise, intensity: "moderate" });
		}
	});

	it("reads a stroll and a casual walk as light", () => {
		for (const exercise of ["Stroll", "Casual Walk", "Leisurely Walk", "Easy Walk", "Slow Walk"]) {
			expect({ exercise, intensity: intensityOf({ exercise }) }).toEqual({ exercise, intensity: "light" });
		}
	});

	it("takes the LONGEST phrase, so a qualifier is never argued with the noun it qualifies", () => {
		// "walk" is on no list; "brisk walk" and "casual walk" are on two different ones and
		// each has to win over the bare word rather than over each other.
		expect(intensityOf({ exercise: "Brisk Walk" })).toBe("moderate");
		expect(intensityOf({ exercise: "Casual Walk" })).toBe("light");
		expect(classifyCardio({ exercise: "Incline Treadmill Walk" }).why).toBe("incline treadmill — moderate");
	});

	it("counts a plain walk, and anything it has never heard of, as moderate", () => {
		expect(intensityOf({ exercise: "Walk" })).toBe("moderate");
		expect(intensityOf({ exercise: "Zumba" })).toBe("moderate");
		expect(classifyCardio({ exercise: "Zumba" }).why).toBe("nothing recognised — counted as moderate");
		expect(intensityOf({ exercise: null })).toBe("moderate");
	});

	it("counts a stretch as light, because moving is not the same as working", () => {
		expect(classifyCardio({ exercise: "Yoga", category: "mobility" })).toMatchObject({
			intensity: "light",
			multiplier: 0.5,
			why: "mobility — light",
		});
	});

	it("carries the multiplier the class is worth", () => {
		expect(classifyCardio({ exercise: "Running" }).multiplier).toBe(INTENSITY_MULTIPLIER.vigorous);
		expect(classifyCardio({ exercise: "Brisk Walk" }).multiplier).toBe(1);
		expect(classifyCardio({ exercise: "Stroll" }).multiplier).toBe(0.5);
	});
});

describe("the pace override", () => {
	it("makes a fast 'walk' vigorous and a slow 'run' moderate", () => {
		// Both directions: the pace is better evidence than the word, whichever way it points.
		expect(classifyCardio({ exercise: "Walk", paceMinMi: 9 })).toMatchObject({
			intensity: "vigorous",
			why: "pace 9 min/mi — vigorous",
		});
		expect(classifyCardio({ exercise: "Running", paceMinMi: 14 })).toMatchObject({
			intensity: "moderate",
			why: "pace 14 min/mi — moderate",
		});
	});

	it("puts the thresholds where the module comment says they are", () => {
		expect(intensityOf({ exercise: "Walk", paceMinMi: 11.9 })).toBe("vigorous");
		expect(intensityOf({ exercise: "Walk", paceMinMi: 12 })).toBe("moderate");
		expect(intensityOf({ exercise: "Walk", paceMinMi: 17.9 })).toBe("moderate");
		expect(intensityOf({ exercise: "Walk", paceMinMi: 18 })).toBe("light");
		expect(intensityOf({ exercise: "Walk", paceMinMi: 24 })).toBe("light");
	});

	it("ignores the pace on a machine whose miles are not walking miles", () => {
		// A bike at 3 min/mi is an easy spin. The exemption is the whole reason the override
		// is not simply "pace wins".
		expect(paceApplies("Cycling")).toBe(false);
		expect(classifyCardio({ exercise: "Cycling", paceMinMi: 3 })).toMatchObject({
			intensity: "moderate",
			why: "cycling — moderate",
		});
		expect(intensityOf({ exercise: "Rowing", paceMinMi: 8 })).toBe("vigorous");
		expect(paceApplies("Brisk Walk")).toBe(true);
	});

	it("is not fooled by a zero or a missing distance", () => {
		expect(intensityOf({ exercise: "Stroll", paceMinMi: 0 })).toBe("light");
		expect(intensityOf({ exercise: "Stroll", paceMinMi: null })).toBe("light");
	});
});

describe("the arithmetic", () => {
	it("weighs minutes and rounds to whole ones", () => {
		expect(equivalentMinutes(30, 2)).toBe(60);
		expect(equivalentMinutes(30, 1)).toBe(30);
		expect(equivalentMinutes(25, 0.5)).toBe(13);
		expect(equivalentMinutes(null, 2)).toBe(0);
		expect(equivalentMinutes(0, 2)).toBe(0);
	});

	it("shows the week's working, and says the multiplier only when it is not one", () => {
		expect(
			equivalentText([
				{ label: "brisk", minutes: 20, multiplier: 1 },
				{ label: "run", minutes: 15, multiplier: 2 },
			])
		).toBe("20 brisk + 15 run×2");
		expect(equivalentText([{ label: "stroll", minutes: 40, multiplier: 0.5 }])).toBe("40 stroll×0.5");
		expect(equivalentText([])).toBe("");
	});

	it("names the largest three and counts the rest", () => {
		const rows = ["a", "b", "c", "d", "e"].map((label, index) => ({
			label,
			minutes: 50 - index * 5,
			multiplier: 1,
		}));
		expect(equivalentText(rows)).toBe("50 a + 45 b + 40 c + 2 more");
	});

	it("shortens a name to the part that distinguishes it", () => {
		expect(shortLabel("Brisk Walk")).toBe("brisk");
		expect(shortLabel("Incline Treadmill Walk")).toBe("incline");
		expect(shortLabel("Running")).toBe("running");
		expect(shortLabel("Walk")).toBe("walk");
	});

	it("says a shortfall in both currencies, and says nothing when there is none", () => {
		expect(alternativesText(22)).toBe("22 moderate min or 11 hard");
		expect(alternativesText(100)).toBe("100 moderate min or 50 hard");
		expect(alternativesText(0)).toBeNull();
		expect(alternativesText(-5)).toBeNull();
	});
});
