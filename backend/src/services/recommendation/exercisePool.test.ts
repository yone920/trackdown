import { describe, expect, it } from "vitest";
import {
	chooseAnchor,
	eligiblePool,
	filterByEquipment,
	filterByMedia,
	filterByRotation,
	type CandidateExercise,
} from "./exercisePool.js";

const candidate = (name: string, over: Partial<CandidateExercise> = {}): CandidateExercise => ({
	name,
	hasMedia: true,
	equipment: [],
	...over,
});

describe("filterByRotation", () => {
	// The real pattern this closes: Bench Press, Cable Crossover, Chest Press Machine and
	// Assisted Dip repeated identically for chest's last two sessions running.
	const chestPool = [
		candidate("Bench Press"),
		candidate("Cable Crossover"),
		candidate("Chest Press Machine"),
		candidate("Assisted Dip"),
		candidate("Incline Dumbbell Press"),
	];
	const recentUsage = [
		{ exercise: "Bench Press", sessionsAgo: 0 },
		{ exercise: "Cable Crossover", sessionsAgo: 0 },
		{ exercise: "Chest Press Machine", sessionsAgo: 1 },
		{ exercise: "Assisted Dip", sessionsAgo: 1 },
	];

	it("excludes everything used in the last two sessions", () => {
		const pool = filterByRotation(chestPool, recentUsage, null);
		expect(pool.map((c) => c.name)).toEqual(["Incline Dumbbell Press"]);
	});

	it("exempts the anchor even though it was just used", () => {
		const pool = filterByRotation(chestPool, recentUsage, "Bench Press");
		expect(pool.map((c) => c.name)).toEqual(["Bench Press", "Incline Dumbbell Press"]);
	});

	it("stops excluding once an exercise falls outside the rotation window", () => {
		const olderUsage = [{ exercise: "Bench Press", sessionsAgo: 2 }];
		const pool = filterByRotation(chestPool, olderUsage, null);
		expect(pool.map((c) => c.name)).toContain("Bench Press");
	});

	it("matches case- and whitespace-insensitively, the way the log's own matcher does", () => {
		const pool = filterByRotation(chestPool, [{ exercise: "  bench press ", sessionsAgo: 0 }], null);
		expect(pool.map((c) => c.name)).not.toContain("Bench Press");
	});
});

describe("filterByMedia", () => {
	it("keeps only the illustrated ones", () => {
		const pool = filterByMedia([candidate("Has Photo", { hasMedia: true }), candidate("No Photo", { hasMedia: false })]);
		expect(pool.map((c) => c.name)).toEqual(["Has Photo"]);
	});
});

describe("filterByEquipment", () => {
	const gymPool = [
		candidate("Band Chest Crossover", { equipment: ["band"] }),
		candidate("Bench Press", { equipment: ["barbell", "bench"] }),
		candidate("Push-Up", { equipment: [] }),
	];

	it("passes everything through when equipment is unknown — no place is the normal state", () => {
		expect(filterByEquipment(gymPool, null).map((c) => c.name)).toEqual(gymPool.map((c) => c.name));
	});

	it("keeps only what a stated place actually has", () => {
		const pool = filterByEquipment(gymPool, ["band"]);
		// Push-Up needs nothing, so it's always in bounds; the barbell lift is not.
		expect(pool.map((c) => c.name).sort()).toEqual(["Band Chest Crossover", "Push-Up"]);
	});

	it("an empty equipment list is a real fact — bodyweight only — and filters accordingly", () => {
		const pool = filterByEquipment(gymPool, []);
		expect(pool.map((c) => c.name)).toEqual(["Push-Up"]);
	});
});

describe("chooseAnchor", () => {
	it("picks whichever exercise has the most loaded sessions", () => {
		const anchor = chooseAnchor([
			{ exercise: "Bench Press", sessions: [{ date: "2026-09-15", loadLb: 135 }, { date: "2026-09-08", loadLb: 130 }] },
			{ exercise: "Cable Crossover", sessions: [{ date: "2026-09-15", loadLb: 60 }] },
		]);
		expect(anchor).toBe("Bench Press");
	});

	it("breaks a tie in loaded-session count by whichever was trained most recently", () => {
		const anchor = chooseAnchor([
			{ exercise: "Older", sessions: [{ date: "2026-09-01", loadLb: 100 }] },
			{ exercise: "Newer", sessions: [{ date: "2026-09-15", loadLb: 100 }] },
		]);
		expect(anchor).toBe("Newer");
	});

	it("ignores an exercise with no loaded sessions at all — bodyweight has no anchor to give", () => {
		const anchor = chooseAnchor([{ exercise: "Push-Up", sessions: [{ date: "2026-09-15", loadLb: null }] }]);
		expect(anchor).toBeNull();
	});

	it("is null with no history", () => {
		expect(chooseAnchor([])).toBeNull();
	});
});

describe("eligiblePool", () => {
	const pool = [
		candidate("Bench Press", { equipment: ["barbell", "bench"] }),
		candidate("Cable Crossover", { equipment: ["cable"] }),
		candidate("Band Chest Crossover", { equipment: ["band"], hasMedia: false }),
	];

	it("applies rotation, equipment, and media together", () => {
		const result = eligiblePool(pool, {
			recentUsage: [{ exercise: "Bench Press", sessionsAgo: 0 }],
			availableEquipment: ["barbell", "bench", "cable", "band"],
		});
		// Bench Press is rotated out; Band Chest Crossover has no media, so only Cable Crossover survives cleanly.
		expect(result.map((c) => c.name)).toEqual(["Cable Crossover"]);
	});

	it("relaxes the media requirement before it ever relaxes rotation or equipment", () => {
		const result = eligiblePool(pool, {
			recentUsage: [{ exercise: "Bench Press", sessionsAgo: 0 }, { exercise: "Cable Crossover", sessionsAgo: 0 }],
			availableEquipment: ["band"],
		});
		// Only the band exercise fits equipment-wise, and it survived rotation — media gives way.
		expect(result.map((c) => c.name)).toEqual(["Band Chest Crossover"]);
	});

	it("never returns something outside the stated equipment, even with nothing else left", () => {
		const result = eligiblePool(pool, {
			recentUsage: [
				{ exercise: "Bench Press", sessionsAgo: 0 },
				{ exercise: "Cable Crossover", sessionsAgo: 0 },
				{ exercise: "Band Chest Crossover", sessionsAgo: 0 },
			],
			availableEquipment: ["band"],
		});
		expect(result.every((c) => c.equipment.every((item) => item === "band"))).toBe(true);
	});
});
