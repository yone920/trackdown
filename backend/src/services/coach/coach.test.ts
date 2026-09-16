import { describe, expect, it } from "vitest";
import { attachProgression } from "./coach.js";
import type { Prescription } from "./rules.js";

// attachProgression matches the model's answer back onto the deterministic prescriptions
// by name (§dropRecovering's own pattern, applied the other way round): the model never
// sees or sets this field, so a plan cannot claim a step up it did not compute.

const prescription = (exercise: string, rule: Prescription["rule"]): Prescription => ({
	exercise,
	muscle_groups: [],
	load_lb: 100,
	sets: 3,
	reps: 10,
	minutes: null,
	rule,
	why: "test fixture",
	days_since: 2,
	load_direction: "resistance",
});

const exercise = (name: string) => ({
	name,
	load_lb: 100,
	sets: 3,
	reps: 10,
	minutes: null,
	note: null,
	is_new: false,
	added_at: null,
	progression: null,
});

const brief = (names: string[]) => ({
	headline: "",
	why: "",
	nudge: "",
	workout: { type: "strength" as const, targets: [], exercises: names.map(exercise), finisher: [] },
});

describe("attachProgression", () => {
	it("carries the prescription's rule onto the matching exercise", () => {
		const result = attachProgression(brief(["Bench Press"]), [prescription("Bench Press", "step_up")]);
		expect(result.workout.exercises[0]?.progression).toBe("step_up");
	});

	it("matches by movement, not exact string, the same way off_menu does", () => {
		const result = attachProgression(brief(["Deadlifts"]), [prescription("Deadlift", "hold")]);
		expect(result.workout.exercises[0]?.progression).toBe("hold");
	});

	it("is null for an exercise with no matching prescription — an introduction, say", () => {
		const result = attachProgression(brief(["Cable Crossover"]), [prescription("Bench Press", "step_up")]);
		expect(result.workout.exercises[0]?.progression).toBeNull();
	});

	it("leaves everything else about the brief untouched", () => {
		const result = attachProgression(brief(["Bench Press"]), [prescription("Bench Press", "step_up")]);
		expect(result.workout.exercises[0]).toMatchObject({ name: "Bench Press", load_lb: 100, sets: 3, reps: 10 });
	});
});
