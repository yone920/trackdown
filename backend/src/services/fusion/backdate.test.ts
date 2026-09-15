import { describe, expect, it } from "vitest";

import { backdateLabel, readBackdate, shiftDate } from "./backdate.js";

// Reading the day out of what was said (services/fusion/backdate.ts). Arithmetic and a
// closed vocabulary, so it is tested without a model and without a renderer — the same
// convention the macro gate follows.
//
// Thursday 2026-09-03 is the day these are written from: getUTCDay() === 4.
const THURSDAY = 4;

describe("the day a sentence is about", () => {
	it("says nothing about a sentence that is about now", () => {
		expect(readBackdate("two scoops of ice cream", THURSDAY)).toBeNull();
		expect(readBackdate("shoulder press, three sets of ten", THURSDAY)).toBeNull();
		expect(readBackdate("", THURSDAY)).toBeNull();
		expect(readBackdate(null, THURSDAY)).toBeNull();
	});

	it("reads yesterday, and last night with it", () => {
		expect(readBackdate("yesterday I had two scoops of ice cream", THURSDAY)).toEqual({
			days_ago: 1,
			phrase: "yesterday",
		});
		expect(readBackdate("chicken and rice last night", THURSDAY)).toMatchObject({ days_ago: 1 });
	});

	// "yesterday" is inside "the day before yesterday", so the longer phrase has to win.
	it("does not read the day before yesterday as yesterday", () => {
		expect(readBackdate("the day before yesterday I ran 5k", THURSDAY)).toEqual({
			days_ago: 2,
			phrase: "day before yesterday",
		});
	});

	it("counts days, in digits and in words", () => {
		expect(readBackdate("bench press 3 days ago", THURSDAY)).toMatchObject({ days_ago: 3 });
		expect(readBackdate("weighed 181 three days ago", THURSDAY)).toMatchObject({ days_ago: 3 });
		// Past the window there is no day to file it on, and no guess is better than a wrong one.
		expect(readBackdate("that was 40 days ago", THURSDAY)).toBeNull();
		// A number nobody said is not a number.
		expect(readBackdate("a few days ago I ate late", THURSDAY)).toBeNull();
	});

	it("walks back to the weekday that has already happened", () => {
		// Thursday looking back at Saturday is five days.
		expect(readBackdate("squats on Saturday", THURSDAY)).toMatchObject({ days_ago: 5 });
		expect(readBackdate("last Monday I weighed 184", THURSDAY)).toMatchObject({ days_ago: 3 });
		// Today's own weekday means today: "I trained Thursday", said on a Thursday.
		expect(readBackdate("I trained Thursday", THURSDAY)).toBeNull();
	});

	// A question about a past day is not a log filed on it.
	it("leaves a question alone", () => {
		expect(readBackdate("what did I eat yesterday", THURSDAY)).toBeNull();
		expect(readBackdate("did I train on Saturday", THURSDAY)).toBeNull();
	});
});

describe("the date it lands on", () => {
	it("steps back over a month boundary", () => {
		expect(shiftDate("2026-09-04", 1)).toBe("2026-09-03");
		expect(shiftDate("2026-09-01", 1)).toBe("2026-08-31");
		expect(shiftDate("2026-03-01", 1)).toBe("2026-02-28");
		expect(shiftDate("2026-09-04", 14)).toBe("2026-08-21");
	});

	it("names the day the way a person would", () => {
		expect(backdateLabel(1)).toBe("yesterday");
		expect(backdateLabel(3)).toBe("3 days ago");
	});
});
