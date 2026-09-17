import { describe, expect, it } from "vitest";
import type { CoachBriefInputs } from "../../ports/coach.js";
import { attachProgression, enforceMenu, menuNote, registryKeyForToken } from "./coach.js";
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

// TODAY'S MENU, enforced on the answer. User field report 2026-09-16 (evening): asked for
// a chest day, the model kept Bench Press, Cable Crossover, Chest Press Machine and
// Assisted Dip from the plan it was rewriting — the same four the menu had been built to
// rotate out — and took one item from the ten it was given. A prompt is a request; this
// is the rule.
describe("enforceMenu", () => {
	const CHEST = ["Pec Deck", "Push-Up", "Dumbbell Fly", "Incline Dumbbell Press"];
	const muscleOf = (name: string): string | null =>
		/bench|crossover|chest press|dip|pec deck|push-up|fly|incline dumbbell/i.test(name)
			? "chest"
			: /pushdown|extension/i.test(name)
				? "triceps"
				: null;
	const inputs = (overrides: Partial<CoachBriefInputs> = {}): CoachBriefInputs =>
		({
			date: "2026-09-16",
			menu: { chest: CHEST },
			introductions: ["Pec Deck"],
			rules: { prescriptions: [] },
			...overrides,
		}) as unknown as CoachBriefInputs;

	it("swaps an off-menu movement for a targeted muscle with one from the menu, and says so", () => {
		const { brief: result, swapped } = enforceMenu(
			brief(["Bench Press", "Cable Crossover", "Incline Dumbbell Press"]),
			inputs(),
			muscleOf
		);
		expect(result.workout.exercises.map((exercise) => exercise.name)).toEqual(["Pec Deck", "Push-Up", "Incline Dumbbell Press"]);
		expect(swapped).toEqual([
			{ exercise: "Bench Press", muscle: "Chest", replacement: "Pec Deck" },
			{ exercise: "Cable Crossover", muscle: "Chest", replacement: "Push-Up" },
		]);
		// A menu item the user has never logged arrives with no load and the "new" chip; one
		// the log knows nothing about either way arrives with no load and no chip.
		expect(result.workout.exercises[0]).toMatchObject({ name: "Pec Deck", load_lb: null, is_new: true });
		expect(result.workout.exercises[1]).toMatchObject({ name: "Push-Up", load_lb: null, is_new: false });
		expect(result.workout.exercises[1]!.note).toMatch(/pick a weight/);
	});

	it("prefers a replacement the user has done before, and brings its own numbers", () => {
		const done = prescription("Dumbbell Fly", "hold");
		const { brief: result } = enforceMenu(
			brief(["Bench Press"]),
			inputs({ rules: { prescriptions: [done] } as unknown as CoachBriefInputs["rules"] }),
			muscleOf
		);
		expect(result.workout.exercises[0]).toMatchObject({ name: "Dumbbell Fly", load_lb: 100, sets: 3, reps: 10, is_new: false });
	});

	it("leaves a movement for a muscle with no menu today alone — an accessory is the model's call", () => {
		const { brief: result, swapped } = enforceMenu(brief(["Pec Deck", "Triceps Pushdown"]), inputs(), muscleOf);
		expect(result.workout.exercises.map((exercise) => exercise.name)).toEqual(["Pec Deck", "Triceps Pushdown"]);
		expect(swapped).toEqual([]);
	});

	it("leaves a name the catalogue does not know alone", () => {
		const { brief: result } = enforceMenu(brief(["Something Invented"]), inputs(), () => null);
		expect(result.workout.exercises[0]!.name).toBe("Something Invented");
	});

	it("never puts a movement on the plan twice, and drops what it cannot replace", () => {
		const short = inputs({ menu: { chest: ["Pec Deck"] } });
		const { brief: result, swapped } = enforceMenu(brief(["Bench Press", "Cable Crossover", "Pec Deck"]), short, muscleOf);
		// Pec Deck is already on the plan, so the menu has nothing free: both repeats go.
		expect(result.workout.exercises.map((exercise) => exercise.name)).toEqual(["Pec Deck"]);
		expect(swapped.map((item) => item.replacement)).toEqual([null, null]);
	});

	it("keeps the plan the user already had on an append, whatever the menu says", () => {
		const { brief: result, swapped } = enforceMenu(brief(["Bench Press", "Chest Press Machine"]), inputs(), muscleOf, [
			{ name: "Bench Press" },
		]);
		expect(result.workout.exercises.map((exercise) => exercise.name)).toEqual(["Bench Press", "Pec Deck"]);
		expect(swapped).toHaveLength(1);
	});

	it("will not empty a training day", () => {
		const { brief: result, swapped } = enforceMenu(brief(["Bench Press"]), inputs({ menu: { chest: ["Bench Press"] } }), () => "chest");
		expect(result.workout.exercises[0]!.name).toBe("Bench Press");
		expect(swapped).toEqual([]);
		const empty = enforceMenu(brief(["Cable Crossover"]), inputs({ menu: { chest: ["Cable Crossover"] } }), () => "chest");
		expect(empty.brief.workout.exercises).toHaveLength(1);
	});

	it("does nothing when there is no menu today", () => {
		const { brief: result, swapped } = enforceMenu(brief(["Bench Press"]), inputs({ menu: {} }), muscleOf);
		expect(result.workout.exercises[0]!.name).toBe("Bench Press");
		expect(swapped).toEqual([]);
	});
});

describe("menuNote", () => {
	it("names what went and what came, in one sentence", () => {
		expect(
			menuNote([
				{ exercise: "Bench Press", muscle: "Chest", replacement: "Pec Deck" },
				{ exercise: "Cable Crossover", muscle: "Chest", replacement: "Dumbbell Fly" },
			])
		).toBe(
			"Bench Press and Cable Crossover were off today's chest menu — used in your last two sessions, or not at this place — and were swapped for Pec Deck and Dumbbell Fly."
		);
	});

	it("says what was left off when nothing could replace it", () => {
		expect(menuNote([{ exercise: "Assisted Dip", muscle: "Chest", replacement: null }])).toBe(
			"Assisted Dip was left off: off today's menu, and nothing else was on it."
		);
	});

	it("is null when nothing was swapped", () => {
		expect(menuNote([])).toBeNull();
	});
});

describe("registryKeyForToken", () => {
	it("maps the catalogue's tags onto the registry, including the folded ones", () => {
		expect(registryKeyForToken("chest")).toBe("chest");
		expect(registryKeyForToken("back")).toBe("upper_back");
		expect(registryKeyForToken("traps")).toBe("upper_back");
		expect(registryKeyForToken("obliques")).toBe("abs");
		expect(registryKeyForToken("full_body")).toBeNull();
		expect(registryKeyForToken(undefined)).toBeNull();
	});
});
