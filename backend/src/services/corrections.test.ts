import { describe, expect, it } from "vitest";
import { CORRECTABLE_FIELDS, diffFields, diffResults } from "./corrections.js";
import type { FusionResult } from "./fusion/schema.js";

// The diff half of correction history (migration 0015). Pure: no database.

const meal = (over: Partial<Extract<FusionResult, { kind: "meal" }>> = {}): FusionResult => ({
	kind: "meal",
	description: "tuna, eggs, vegetables and four slices of bread",
	meal_type: "lunch",
	kcal: 918,
	protein_g: 67,
	carbs_g: 398,
	fat_g: 35,
	fiber_g: 12,
	items: [],
	confidence: "high",
	sources: null,
	consistency: null,
	...over,
});

const activity = (over: Record<string, unknown> = {}): Extract<FusionResult, { kind: "activities" }> => ({
	kind: "activities",
	items: [
		{
			exercise: "Chest-Supported Row",
			equipment: "chest-supported row machine",
			description: "3 × 12 chest-supported row at 45 lb",
			category: "strength",
			muscle_groups: ["back"],
			sets: 3,
			reps: 12,
			load_lb: 45,
			duration_min: null,
			distance_mi: null,
			kcal: 120,
			confidence: "low",
			sources: null,
			refine: null,
			...over,
		},
	],
});

describe("diffFields", () => {
	it("reports only what moved, in the order the fields are named", () => {
		const changes = diffFields(
			{ description: "lunch", kcal: 918, protein_g: 67, carbs_g: 398, fat_g: 35, fiber_g: 12, meal_type: "lunch" },
			{ description: "lunch", kcal: 918, protein_g: 67, carbs_g: 89, fat_g: 35, fiber_g: 12, meal_type: "lunch" },
			CORRECTABLE_FIELDS.meal
		);
		expect(changes).toEqual([{ field: "carbs_g", from: 398, to: 89 }]);
	});

	it("treats a cleared field as a change to null, and undefined as null", () => {
		expect(diffFields({ load_lb: 45 }, { load_lb: null }, ["load_lb"])).toEqual([
			{ field: "load_lb", from: 45, to: null },
		]);
		expect(diffFields({ equipment: undefined }, { equipment: "cable stack" }, ["equipment"])).toEqual([
			{ field: "equipment", from: null, to: "cable stack" },
		]);
	});

	it("compares arrays structurally and numbers with a hair of slack", () => {
		expect(diffFields({ muscle_groups: ["back"] }, { muscle_groups: ["back"] }, ["muscle_groups"])).toEqual([]);
		expect(diffFields({ muscle_groups: ["back"] }, { muscle_groups: ["back", "biceps"] }, ["muscle_groups"])).toHaveLength(1);
		// 45.0 out of NUMERIC(6,1) is the same 45 the model answered with.
		expect(diffFields({ load_lb: 45 }, { load_lb: 45.0000000001 }, ["load_lb"])).toEqual([]);
	});

	it("ignores a field the patch never named", () => {
		// The row has every column; the patch had one. Only what was sent can be corrected.
		expect(diffFields({ kcal: 900, description: "lunch" }, { kcal: 900 }, CORRECTABLE_FIELDS.meal)).toEqual([]);
	});
});

describe("diffResults", () => {
	it("measures the field case: the carbs, and nothing else", () => {
		const corrections = diffResults([meal()], [meal({ carbs_g: 89, confidence: "high" })], "the carbs look wrong");
		expect(corrections).toEqual([
			{
				part: 0,
				item: null,
				instruction: "the carbs look wrong",
				changes: [{ field: "carbs_g", from: 398, to: 89 }],
			},
		]);
	});

	it("says nothing about a part the instruction did not touch", () => {
		// Every part is re-read on a revision, so "the carbs look wrong" reaches the run too.
		// A part that came back as it went in is not history.
		const before = [meal(), activity()];
		const after = [meal({ carbs_g: 89 }), activity()];
		const corrections = diffResults(before, after, "the carbs look wrong");
		expect(corrections).toHaveLength(1);
		expect(corrections[0]!.part).toBe(0);
	});

	it("keeps an activities part's items apart — each one is its own row", () => {
		const before: FusionResult = {
			kind: "activities",
			items: [...activity().items, ...activity({ exercise: "Lat Pulldown" }).items],
		};
		const after: FusionResult = {
			kind: "activities",
			items: [
				...activity().items,
				...activity({ exercise: "Lat Pulldown", reps: 15 }).items,
			],
		};
		const corrections = diffResults([before], [after], "the pulldown was 15 reps");
		expect(corrections).toEqual([
			{ part: 0, item: 1, instruction: "the pulldown was 15 reps", changes: [{ field: "reps", from: 12, to: 15 }] },
		]);
	});

	it("refuses to invent a diff when the shape changed under it", () => {
		// A revision that dropped an exercise, or turned a meal into something else, is not
		// a field-level correction and a fictional diff is worse than none.
		expect(diffResults([activity()], [{ kind: "activities", items: [] } as unknown as FusionResult], "drop it")).toEqual([]);
		expect(diffResults([meal()], [activity()], "that was a workout")).toEqual([]);
	});

	it("files a split as one correction per part, each naming the record it replaced", () => {
		// Field report 2026-09-01: "4 sets of 10 at 85, the last two sets I reduced to 70".
		// One record cannot hold two loads, so the correction replaces it with two — and
		// each of the two has to be able to explain, on its own row, where it came from.
		const before = activity({ exercise: "Chest Press", sets: 4, reps: 10, load_lb: 85 });
		const after: FusionResult = {
			kind: "activities",
			items: [
				{ ...before.items[0]!, sets: 2, reps: 10, load_lb: 85, description: "chest press, first two sets" },
				{ ...before.items[0]!, sets: 2, reps: 10, load_lb: 70, description: "chest press, last two sets — dropped to 70" },
			],
		};
		const said = "the last two sets I reduced the load to 70";
		const corrections = diffResults([before], [after], said);

		expect(corrections).toHaveLength(2);
		expect(corrections.every((correction) => correction.replaces === 0)).toBe(true);
		expect(corrections.map((correction) => correction.item)).toEqual([0, 1]);
		// The first part kept the load and lost half the sets; the second changed both.
		expect(corrections[0]!.changes).toContainEqual({ field: "sets", from: 4, to: 2 });
		expect(corrections[0]!.changes).not.toContainEqual({ field: "load_lb", from: 85, to: 85 });
		expect(corrections[1]!.changes).toContainEqual({ field: "sets", from: 4, to: 2 });
		expect(corrections[1]!.changes).toContainEqual({ field: "load_lb", from: 85, to: 70 });
		// The parts SUM to what was actually done — four sets, not six.
		const total = after.kind === "activities" ? after.items.reduce((sum, item) => sum + (item.sets ?? 0), 0) : 0;
		expect(total).toBe(4);
	});

	it("still refuses to guess when SEVERAL records became a different number of records", () => {
		// Which of two originals a new part came out of is not a question positions can
		// answer, and a guessed provenance is worse than none.
		const before: FusionResult = {
			kind: "activities",
			items: [...activity().items, ...activity({ exercise: "Lat Pulldown" }).items],
		};
		const after: FusionResult = {
			kind: "activities",
			items: [...activity().items, ...activity().items, ...activity().items],
		};
		expect(diffResults([before], [after], "split the pulldown")).toEqual([]);
	});

	it("has nothing to say about a goal, a statement or a question", () => {
		const goal: FusionResult = {
			kind: "goal",
			spec: { kind: "lose_fat", title: "Down to 170", metrics: [], active_from: null, active_to: null },
			proposed_timeline: null,
			facts: null,
		};
		expect(diffResults([goal], [{ ...goal, spec: { ...goal.spec, title: "Down to 165" } }], "make it 165")).toEqual([]);
		expect(diffResults([{ kind: "unclear", question: "Which machine?" }], [{ kind: "unclear", question: "Which one?" }], "x")).toEqual([]);
	});
});
