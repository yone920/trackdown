import { describe, expect, it } from "vitest";
import {
	checkWeighIn,
	outlierThresholdLb,
	OUTLIER_MIN_LB,
	type RecentWeights,
} from "./weightCheck.js";

// Field report 2026-09-02: a 110 lb reading from somebody who weighs about 212 was swallowed
// whole — the 7-day average fell to 161, the week header read "−102.0 lb", and the goal card
// announced "Reached". A wrong verdict that FLATTERS is worse than one that scolds, because
// nothing about it invites a second look.

const recent = (over: Partial<RecentWeights> = {}): RecentWeights => ({
	avg_7d: 212,
	previous: { weight_lb: 212, logged_at: new Date(Date.now() - 86_400_000).toISOString() },
	count: 4,
	...over,
});

describe("the threshold", () => {
	it("is a percentage for a large body and a floor for a small one", () => {
		// A flat percentage over-challenges a small body; a flat pound figure under-challenges
		// a large one. Both, so neither.
		expect(outlierThresholdLb(212)).toBeCloseTo(21.2, 1);
		expect(outlierThresholdLb(120)).toBe(OUTLIER_MIN_LB);
		expect(outlierThresholdLb(150)).toBe(OUTLIER_MIN_LB);
	});
});

describe("what gets challenged", () => {
	it("challenges the reading from the field report", () => {
		const check = checkWeighIn(110, recent());
		expect(check).not.toBeNull();
		expect(check!.delta_lb).toBe(102);
		expect(check!.question).toMatch(/102 lb below/);
		expect(check!.question).toMatch(/Is that right\?/);
	});

	it("lets ordinary movement through without a word", () => {
		// Water, a heavy meal and a different scale together are a handful of pounds. A
		// question that fires on those teaches people to tap through it.
		expect(checkWeighIn(212, recent())).toBeNull();
		expect(checkWeighIn(209, recent())).toBeNull();
		expect(checkWeighIn(216.5, recent())).toBeNull();
	});

	it("challenges in both directions — a sudden GAIN is as implausible as a loss", () => {
		expect(checkWeighIn(240, recent())).not.toBeNull();
		expect(checkWeighIn(240, recent())!.question).toMatch(/above/);
	});

	describe("at the edge", () => {
		it("stays quiet just inside the threshold and speaks just outside it", () => {
			// 212 → the bar is 21.2 lb.
			expect(checkWeighIn(212 - 21.1, recent())).toBeNull();
			expect(checkWeighIn(212 - 21.3, recent())).not.toBeNull();
		});

		it("uses the 15 lb floor for a lighter person, not 10% of them", () => {
			const light = recent({ avg_7d: 120, previous: { weight_lb: 120, logged_at: new Date().toISOString() } });
			// 10% would be 12 lb; the floor is 15, so a 13 lb swing is not challenged.
			expect(checkWeighIn(107, light)).toBeNull();
			expect(checkWeighIn(104, light)).not.toBeNull();
		});
	});
});

describe("what is NEVER challenged", () => {
	it("says nothing when there is no recent data to doubt it against", () => {
		// A first weigh-in, or the first after months away. Inventing a baseline to doubt it
		// with would be the app making up the history it is supposed to be recording.
		expect(checkWeighIn(110, recent({ avg_7d: null, count: 0, previous: null }))).toBeNull();
		expect(checkWeighIn(110, recent({ count: 0 }))).toBeNull();
	});

	it("says nothing about a number that is not a number", () => {
		expect(checkWeighIn(Number.NaN, recent())).toBeNull();
	});
});

describe("the words it uses", () => {
	it("names the day the reading it disagrees with came from", () => {
		const monday = new Date();
		monday.setUTCDate(monday.getUTCDate() - 3);
		const check = checkWeighIn(110, recent({ previous: { weight_lb: 212, logged_at: monday.toISOString() } }));
		// A weekday, not an ISO timestamp: "is that right?" on its own is a question nobody
		// can check.
		expect(check!.question).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
	});

	it("says yesterday and today by name", () => {
		const today = checkWeighIn(110, recent({ previous: { weight_lb: 212, logged_at: new Date().toISOString() } }));
		expect(today!.question).toMatch(/today/);
		const yesterday = checkWeighIn(
			110,
			recent({ previous: { weight_lb: 212, logged_at: new Date(Date.now() - 86_400_000).toISOString() } }),
		);
		expect(yesterday!.question).toMatch(/yesterday/);
	});

	it("measures the gap against the previous READING, which is what the user remembers", () => {
		// The average is what makes it suspicious; the last reading is what makes it legible.
		const check = checkWeighIn(110, recent({ avg_7d: 200, previous: { weight_lb: 212, logged_at: new Date().toISOString() } }));
		expect(check!.question).toMatch(/102 lb/);
		expect(check!.avg_7d).toBe(200);
		expect(check!.previous_lb).toBe(212);
	});
});
