import { describe, expect, it } from "vitest";
import { coverageLevel } from "./coverage.js";
import { muscleByKey } from "./registry.js";

describe("coverageLevel", () => {
	it("is 0 for a muscle never seen in the window, regardless of sets — grey means untouched, not zero", () => {
		const chest = muscleByKey("chest")!;
		expect(coverageLevel({ key: "chest", daysSince: null, sets7d: 0 }, chest)).toBe(0);
	});

	it("is 1 for a muscle served but below its own MAV floor", () => {
		const chest = muscleByKey("chest")!; // mavLow 12
		expect(coverageLevel({ key: "chest", daysSince: 2, sets7d: 5 }, chest)).toBe(1);
	});

	it("is 2 inside the muscle's own MAV band", () => {
		const chest = muscleByKey("chest")!; // 12-20
		expect(coverageLevel({ key: "chest", daysSince: 2, sets7d: 16 }, chest)).toBe(2);
	});

	it("is 3 past the muscle's own MAV ceiling", () => {
		const chest = muscleByKey("chest")!; // mavHigh 20
		expect(coverageLevel({ key: "chest", daysSince: 2, sets7d: 24 }, chest)).toBe(3);
	});

	it("judges two different muscles by two different bands for the identical set count", () => {
		// 10 sets: below chest's own floor (12), but inside forearms' own band (6-10).
		const chest = muscleByKey("chest")!;
		const forearms = muscleByKey("forearms")!;
		expect(coverageLevel({ key: "chest", daysSince: 2, sets7d: 10 }, chest)).toBe(1);
		expect(coverageLevel({ key: "forearms", daysSince: 2, sets7d: 10 }, forearms)).toBe(2);
	});

	it("treats zero sets with a recent date as level 1, not 0 — a cardio-credited muscle with no strength sets", () => {
		const calves = muscleByKey("calves")!;
		expect(coverageLevel({ key: "calves", daysSince: 0, sets7d: 0 }, calves)).toBe(1);
	});
});
