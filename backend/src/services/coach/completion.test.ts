import { describe, expect, it } from "vitest";
import { completionFor, completionOf, matchesPlanned, planIsComplete, sameMovement } from "./completion.js";

// Ticking the plan off against the log (user decision 2026-08-31 §A1). Pure: a Do list and
// a day's rows in, a tick per line out.

const planned = (name: string, sets: number | null = 3, exercise_id: string | null = null) => ({
	name,
	sets,
	exercise_id,
});
const logged = (exercise: string | null, sets: number | null = null, exercise_id: string | null = null) => ({
	exercise,
	sets,
	exercise_id,
});

describe("matching a prescribed exercise to what was logged", () => {
	it("is the same movement across case, punctuation and plurals", () => {
		expect(sameMovement("Lat Pulldown", "lat pulldown")).toBe(true);
		expect(sameMovement("Chin-Up", "chin ups")).toBe(true);
		expect(sameMovement("Dumbbell Bench Press", "Dumbbell  Bench  Press")).toBe(true);
	});

	it("is NOT the same movement when a qualifier differs", () => {
		// The whole "assisted is not a spelling of chin-up" rule, applied the other way
		// round: a plain chin-up in the log does not tick an assisted chin-up off the plan.
		expect(sameMovement("Assisted Chin-Up", "Chin-Up")).toBe(false);
		expect(sameMovement("Chin-Up", "Assisted Chin-Up")).toBe(false);
		expect(sameMovement("Incline Bench Press", "Bench Press")).toBe(false);
		expect(sameMovement("Bench Press", "Overhead Press")).toBe(false);
	});

	it("says nothing about an empty name", () => {
		expect(sameMovement(null, "Bench Press")).toBe(false);
		expect(sameMovement("Bench Press", "")).toBe(false);
	});

	it("settles it on the catalogue id when both sides have one, whatever the names say", () => {
		expect(matchesPlanned(planned("Lat Pulldown", 3, "id-1"), logged("Cable Pulldown", 3, "id-1"))).toBe(true);
		expect(matchesPlanned(planned("Lat Pulldown", 3, "id-1"), logged("Lat Pulldown", 3, "id-2"))).toBe(false);
		// One side without an id falls back to the name.
		expect(matchesPlanned(planned("Lat Pulldown", 3, "id-1"), logged("lat pulldown", 3, null))).toBe(true);
	});
});

describe("the completion state of one line", () => {
	it("is not done when nothing matching was logged", () => {
		expect(completionFor(planned("Bench Press"), [logged("Lat Pulldown", 3)])).toEqual({
			done: false,
			sets_done: 0,
			sets_prescribed: 3,
			partial: false,
		});
	});

	it("is partial when some of the sets are in", () => {
		expect(completionFor(planned("Bench Press", 4), [logged("Bench Press", 2)])).toEqual({
			done: false,
			sets_done: 2,
			sets_prescribed: 4,
			partial: true,
		});
	});

	it("is done at the prescribed count and past it", () => {
		expect(completionFor(planned("Bench Press", 3), [logged("Bench Press", 3)])).toMatchObject({ done: true, partial: false });
		expect(completionFor(planned("Bench Press", 3), [logged("Bench Press", 5)])).toMatchObject({ done: true, sets_done: 5 });
	});

	it("sums sets across the rows one visit produced", () => {
		expect(
			completionFor(planned("Bench Press", 4), [logged("Bench Press", 2), logged("bench press", 2)])
		).toMatchObject({ done: true, sets_done: 4 });
	});

	it("counts a row with no set count as the movement done, not as zero of three", () => {
		expect(completionFor(planned("Bench Press", 3), [logged("Bench Press", null)])).toMatchObject({
			done: true,
			sets_done: 0,
			partial: false,
		});
	});

	it("is done on any matching row when the plan prescribed no sets", () => {
		expect(completionFor(planned("Running", null), [logged("Running", null)])).toEqual({
			done: true,
			sets_done: 0,
			sets_prescribed: null,
			partial: false,
		});
	});

	it("does not tick an assisted machine off with the unassisted movement", () => {
		expect(completionFor(planned("Assisted Chin-Up", 3), [logged("Chin-Up", 3)])).toMatchObject({ done: false, sets_done: 0 });
		expect(completionFor(planned("Assisted Chin-Up", 3), [logged("assisted chin ups", 3)])).toMatchObject({ done: true });
	});
});

describe("the plan as a whole", () => {
	const list = [planned("Bench Press", 3), planned("Lat Pulldown", 3), planned("Plank", 3)];

	it("is complete only when every line is", () => {
		const all = completionOf(list, [logged("Bench Press", 3), logged("Lat Pulldown", 3), logged("Plank", 3)]);
		expect(planIsComplete(all)).toBe(true);

		const most = completionOf(list, [logged("Bench Press", 3), logged("Lat Pulldown", 1)]);
		expect(planIsComplete(most)).toBe(false);
		expect(most.map((item) => item.completion.partial)).toEqual([false, true, false]);
	});

	it("is never complete when there is nothing in it — a rest day is not a finished plan", () => {
		expect(planIsComplete([])).toBe(false);
	});

	it("keeps the line's own fields beside the tick", () => {
		const [first] = completionOf([planned("Bench Press", 3)], [logged("Bench Press", 3)]);
		expect(first).toMatchObject({ name: "Bench Press", sets: 3, completion: { done: true } });
	});
});
