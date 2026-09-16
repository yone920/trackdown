import { describe, expect, it } from "vitest";
import { allocateVolume, chooseFamily, definitionsFor, type MuscleStat } from "./scheduler.js";
import { musclesInFamily } from "./registry.js";

// Every push/pull/legs muscle, "just cleared its own gate" — the neutral starting point
// each test overrides from, so a test only has to say what's actually different about it.
function neutralStats(): MuscleStat[] {
	return [...musclesInFamily("push"), ...musclesInFamily("pull"), ...musclesInFamily("legs")].map((muscle) => ({
		key: muscle.key,
		daysSince: Math.ceil(muscle.recoveryHours / 24),
		sets7d: muscle.mavLow,
	}));
}

function withStat(stats: MuscleStat[], key: string, patch: Partial<MuscleStat>): MuscleStat[] {
	return stats.map((stat) => (stat.key === key ? { ...stat, ...patch } : stat));
}

describe("chooseFamily", () => {
	it("reproduces the real fix: chest 5 days past its gate beats back at exactly its gate", () => {
		// The 2026-09-16 field report, in stat form: chest idle 7 days (gate 2 → +5 excess),
		// back idle 2 days (gate 2 → +0 excess). Chest's family should win outright now.
		let stats = neutralStats();
		stats = withStat(stats, "chest", { daysSince: 7 }); // 48h gate -> +5 excess
		stats = withStat(stats, "lats", { daysSince: 2 }); // 48h gate -> +0 excess
		expect(chooseFamily(stats)).toBe("push");
	});

	it("treats never-trained as worse than any number of idle days", () => {
		let stats = neutralStats();
		stats = withStat(stats, "quads", { daysSince: null });
		// Every other muscle is barely past its own gate (0 excess); quads is +Infinity.
		expect(chooseFamily(stats)).toBe("legs");
	});

	it("never picks a muscle still inside its own recovery window as the driver", () => {
		let stats = neutralStats();
		// Chest trained yesterday — well inside its 48h gate — even though every OTHER
		// push muscle is neutral. Push must not win on chest's account.
		stats = withStat(stats, "chest", { daysSince: 1 });
		// Make legs the only family with real debt so the test is unambiguous.
		stats = withStat(stats, "quads", { daysSince: 10 });
		expect(chooseFamily(stats)).toBe("legs");
	});

	it("an explicit override removes a muscle from its family's case, not just from the answer", () => {
		let stats = neutralStats();
		stats = withStat(stats, "chest", { daysSince: 7 }); // would otherwise win push outright
		stats = withStat(stats, "quads", { daysSince: 3 }); // legs' best case, smaller than chest's
		expect(chooseFamily(stats)).toBe("push");
		expect(chooseFamily(stats, new Set(["chest"]))).toBe("legs");
	});

	it("returns null when literally nothing is available", () => {
		const allRecovering: MuscleStat[] = musclesInFamily("push")
			.concat(musclesInFamily("pull"), musclesInFamily("legs"))
			.map((muscle) => ({ key: muscle.key, daysSince: 0, sets7d: 0 }));
		expect(chooseFamily(allRecovering)).toBeNull();
	});
});

describe("allocateVolume", () => {
	it("weights slots toward whichever muscle sits furthest below its own MAV floor", () => {
		// quads mavLow 12: given 0 sets7d, shortfall 12. hamstrings mavLow 10, sets7d 8: shortfall 2.
		// glutes and calves already at their floor: shortfall 0.
		const stats: MuscleStat[] = [
			{ key: "quads", daysSince: 5, sets7d: 0 },
			{ key: "hamstrings", daysSince: 5, sets7d: 8 },
			{ key: "glutes", daysSince: 5, sets7d: 16 },
			{ key: "calves", daysSince: 5, sets7d: 16 },
		];
		const allocation = allocateVolume("legs", stats, 4);
		expect(allocation.reduce((sum, item) => sum + item.slots, 0)).toBe(4);
		const byKey = Object.fromEntries(allocation.map((item) => [item.key, item.slots]));
		// quads carries six times hamstrings' shortfall (12 vs 2) and should draw the most slots.
		expect(byKey.quads).toBeGreaterThan(byKey.hamstrings as number);
		expect(byKey.quads).toBeGreaterThan(0);
	});

	it("splits evenly when nobody in the family is short of their own floor", () => {
		const stats: MuscleStat[] = musclesInFamily("push").map((muscle) => ({
			key: muscle.key,
			daysSince: 3,
			sets7d: muscle.mavHigh, // everybody already past their own ceiling
		}));
		const allocation = allocateVolume("push", stats, 3);
		expect(allocation.reduce((sum, item) => sum + item.slots, 0)).toBe(3);
		// Three muscles, three slots, nobody weighted differently: one each.
		expect(allocation.every((item) => item.slots === 1)).toBe(true);
	});

	it("always sums to exactly totalSlots, whatever the rounding", () => {
		const stats: MuscleStat[] = musclesInFamily("pull").map((muscle, index) => ({
			key: muscle.key,
			daysSince: 5,
			sets7d: index, // uneven, deliberately ugly shortfalls
		}));
		for (const totalSlots of [0, 1, 2, 3, 5, 7]) {
			const allocation = allocateVolume("pull", stats, totalSlots);
			expect(allocation.reduce((sum, item) => sum + item.slots, 0)).toBe(totalSlots);
		}
	});

	it("names every member of the family, even one with zero slots", () => {
		const allocation = allocateVolume("legs", [], 2);
		expect(allocation.map((item) => item.key).sort()).toEqual(
			musclesInFamily("legs").map((muscle) => muscle.key).sort()
		);
	});
});

describe("definitionsFor", () => {
	it("resolves allocations back to their registry rows, dropping an unknown key rather than throwing", () => {
		const definitions = definitionsFor([
			{ key: "chest", slots: 2 },
			{ key: "not-a-real-muscle", slots: 1 },
		]);
		expect(definitions.map((d) => d.key)).toEqual(["chest"]);
	});
});
