import { describe, expect, it } from "vitest";
import { allocateVolume, chooseFamily, definitionsFor, scheduleTargets, type MuscleStat } from "./scheduler.js";
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

	it("leaves a muscle the user asked to skip out of the split entirely", () => {
		const allocation = allocateVolume("legs", neutralStats(), 4, new Set(["calves"]));
		expect(allocation.map((item) => item.key)).not.toContain("calves");
		expect(allocation.reduce((sum, item) => sum + item.slots, 0)).toBe(4);
	});
});

// The override (ENGINE.md §The override): what the user asked for by name wins, for
// that ask. The scenario is the real one from 2026-09-16 — twelve sets of chest six days
// ago, still inside the 7-day window, so the debt gave chest ZERO slots on the very day
// the user typed "generate chest workout" into the box.
describe("scheduleTargets", () => {
	const todayReal = (): MuscleStat[] => {
		let stats = neutralStats();
		stats = withStat(stats, "chest", { daysSince: 6, sets7d: 12 }); // exactly its floor: no shortfall
		stats = withStat(stats, "shoulders", { daysSince: 6, sets7d: 3 });
		stats = withStat(stats, "triceps", { daysSince: 6, sets7d: 0 });
		return stats;
	};

	it("without a request, is exactly chooseFamily + allocateVolume", () => {
		const stats = todayReal();
		const schedule = scheduleTargets(stats, 6);
		expect(schedule.family).toBe(chooseFamily(stats));
		expect(schedule.allocation).toEqual(allocateVolume(schedule.family!, stats, 6));
		expect(schedule).toMatchObject({ requested: [], recovering: [], avoided: [] });
		// The bug, pinned: the debt alone gives chest nothing today.
		expect(schedule.allocation.find((item) => item.key === "chest")?.slots).toBe(0);
	});

	it("gives a muscle asked for by name the whole session", () => {
		const schedule = scheduleTargets(todayReal(), 6, { family: null, muscles: ["chest"], avoid: [] });
		expect(schedule.family).toBe("push");
		expect(schedule.allocation).toEqual([{ key: "chest", slots: 6 }]);
		expect(schedule.requested).toEqual(["chest"]);
	});

	it("splits the session between the muscles asked for, whatever family each is in", () => {
		const schedule = scheduleTargets(neutralStats(), 6, { family: null, muscles: ["biceps", "triceps"], avoid: [] });
		expect(schedule.allocation.map((item) => item.key).sort()).toEqual(["biceps", "triceps"]);
		expect(schedule.allocation.reduce((sum, item) => sum + item.slots, 0)).toBe(6);
	});

	it("forces a family asked for by name, split across its members as usual", () => {
		const stats = todayReal(); // push would win on debt
		const schedule = scheduleTargets(stats, 6, { family: "legs", muscles: [], avoid: [] });
		expect(schedule.family).toBe("legs");
		expect(schedule.allocation).toEqual(allocateVolume("legs", stats, 6));
		expect(schedule.requested).toEqual([]);
	});

	it("will not force a muscle still inside its own recovery gate, and says which", () => {
		let stats = neutralStats();
		stats = withStat(stats, "chest", { daysSince: 1 }); // 48h gate
		stats = withStat(stats, "quads", { daysSince: 10 });
		const schedule = scheduleTargets(stats, 6, { family: null, muscles: ["chest"], avoid: [] });
		expect(schedule.recovering).toEqual(["chest"]);
		expect(schedule.requested).toEqual([]);
		// The debt decides instead — and quads is the debt.
		expect(schedule.family).toBe("legs");
	});

	it("keeps the cleared muscles when only some of a request is recovering", () => {
		let stats = neutralStats();
		stats = withStat(stats, "chest", { daysSince: 1 });
		const schedule = scheduleTargets(stats, 4, { family: null, muscles: ["chest", "shoulders"], avoid: [] });
		expect(schedule.requested).toEqual(["shoulders"]);
		expect(schedule.recovering).toEqual(["chest"]);
		expect(schedule.allocation).toEqual([{ key: "shoulders", slots: 4 }]);
	});

	it("a muscle asked to be skipped is out of the split and out of its family's case", () => {
		let stats = neutralStats();
		stats = withStat(stats, "chest", { daysSince: 7 }); // would win push on its own
		stats = withStat(stats, "quads", { daysSince: 3 });
		const schedule = scheduleTargets(stats, 6, { family: null, muscles: [], avoid: ["chest"] });
		expect(schedule.family).toBe("legs");
		expect(schedule.avoided).toEqual(["chest"]);
		expect(schedule.allocation.map((item) => item.key)).not.toContain("chest");
	});

	it("never trained counts as cleared: nothing to recover from", () => {
		let stats = neutralStats();
		stats = withStat(stats, "neck", { daysSince: null });
		const schedule = scheduleTargets(stats, 2, { family: null, muscles: ["neck"], avoid: [] });
		expect(schedule.allocation).toEqual([{ key: "neck", slots: 2 }]);
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
