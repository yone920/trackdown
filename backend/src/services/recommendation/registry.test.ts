import { describe, expect, it } from "vitest";
import { MUSCLES, ROTATION_FAMILIES, muscleByKey, musclesInFamily } from "./registry.js";

// The registry is data, so its tests are invariants, not behavior: shapes a caller
// downstream (the scheduler, the exercise pool) is allowed to rely on without re-checking.

describe("the muscle registry", () => {
	it("has fourteen muscles, each with a unique key", () => {
		expect(MUSCLES).toHaveLength(14);
		expect(new Set(MUSCLES.map((muscle) => muscle.key)).size).toBe(14);
	});

	it("carries the two gaps the old vocabulary was missing", () => {
		expect(muscleByKey("forearms")).toBeTruthy();
		expect(muscleByKey("neck")).toBeTruthy();
	});

	it("keeps every volume band internally ordered — mev <= mavLow <= mavHigh <= mrv", () => {
		for (const muscle of MUSCLES) {
			expect(muscle.mev).toBeLessThanOrEqual(muscle.mavLow);
			expect(muscle.mavLow).toBeLessThanOrEqual(muscle.mavHigh);
			expect(muscle.mavHigh).toBeLessThanOrEqual(muscle.mrv);
		}
	});

	it("gives every muscle a positive recovery window", () => {
		for (const muscle of MUSCLES) expect(muscle.recoveryHours).toBeGreaterThan(0);
	});

	it("puts lower_back's band well below a limb's — injury-sensitive, not volume-chased", () => {
		const lowerBack = muscleByKey("lower_back")!;
		const quads = muscleByKey("quads")!;
		expect(lowerBack.mrv).toBeLessThanOrEqual(quads.mev);
	});

	it("looks up case-insensitively and trims, and returns undefined rather than throwing for an unknown key", () => {
		expect(muscleByKey(" Chest ")?.key).toBe("chest");
		expect(muscleByKey("shin")).toBeUndefined();
	});

	it("rotation families are exactly push, pull, legs — accessories never win a day's theme", () => {
		expect(ROTATION_FAMILIES).toEqual(["push", "pull", "legs"]);
		for (const family of ROTATION_FAMILIES) {
			expect(musclesInFamily(family).length).toBeGreaterThan(0);
		}
	});

	it("every accessory muscle is in the accessory family, and only accessories are", () => {
		const accessories = musclesInFamily("accessory").map((m) => m.key).sort();
		expect(accessories).toEqual(["abs", "lower_back", "neck"]);
	});
});
