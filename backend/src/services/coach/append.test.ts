import { describe, expect, it } from "vitest";
import { appendToBrief, skippedNote } from "./coach.js";
import type { CoachBriefRecord } from "./coach.js";
import type { RevisedBrief } from "../../ports/coach.js";

// The append gate (field report 2026-09-02).
//
// The user had five movements planned and said, through *Add to today's plan*, "I'll have a
// one hour session — regenerate based on that". The model did the most literal thing
// available to it: it returned a whole one-hour session, which was the same five movements
// it had just been shown. The append stored them wholesale and every exercise appeared
// twice, under an "ADDED 7:09 AM" heading.
//
// The prompt now says extend rather than restate. A prompt is a request, so this is the
// rule: two movements that are the same movement do not both belong on one day's plan,
// whatever the model believed it was doing.

const move = (name: string) => ({
	name,
	load_lb: null,
	sets: 3,
	reps: 10,
	minutes: null,
	note: null,
	is_new: false,
});

function plan(...names: string[]): CoachBriefRecord {
	return {
		headline: "Pull day: back, biceps and hamstrings",
		why: "Back is five days overdue.",
		workout: { type: "strength", targets: ["back"], exercises: names.map(move), finisher: [] },
		nutrition: { kcal: 2254, protein_g: 160, carbs_max_g: null, ideas: [], why: "Steady." },
		nudge: "Weigh in tomorrow.",
	} as unknown as CoachBriefRecord;
}

function answer(...names: string[]): RevisedBrief {
	return {
		revision_mode: "append",
		headline: "ignored",
		why: "A little more.",
		workout: { type: "strength", targets: ["back"], exercises: names.map(move), finisher: [] },
		nutrition: { kcal: 0, protein_g: 0, carbs_max_g: null, ideas: [], why: "" },
		nudge: "",
	} as unknown as RevisedBrief;
}

const THE_FIVE = ["Lat Pulldown", "Seated Cable Row", "Barbell Curl", "Hammer Curl", "Good Morning"];

describe("an append never re-adds what is already there", () => {
	it("drops the whole session the model handed back, and names every movement it dropped", () => {
		// The field report, exactly: five planned, the same five returned.
		const { brief, skipped } = appendToBrief(plan(...THE_FIVE), answer(...THE_FIVE), "7:09a");

		expect(brief.workout.exercises).toHaveLength(5);
		expect(brief.workout.exercises.map((e) => e.name)).toEqual(THE_FIVE);
		// Nothing was stamped as added, because nothing was.
		expect(brief.workout.exercises.every((e) => !("added_at" in e) || !e.added_at)).toBe(true);
		expect(skipped).toEqual(THE_FIVE);
	});

	it("keeps the genuinely new movements and drops only the repeats", () => {
		const { brief, skipped } = appendToBrief(
			plan(...THE_FIVE),
			answer("Lat Pulldown", "Face Pull", "Barbell Curl", "Plank"),
			"7:09a",
		);

		expect(brief.workout.exercises.map((e) => e.name)).toEqual([...THE_FIVE, "Face Pull", "Plank"]);
		expect(skipped).toEqual(["Lat Pulldown", "Barbell Curl"]);
		// The new ones carry the stamp the "added 7:09a" divider is drawn from.
		const added = brief.workout.exercises.filter((e) => (e as { added_at?: string }).added_at);
		expect(added.map((e) => e.name)).toEqual(["Face Pull", "Plank"]);
	});

	it("reads a qualified variation as its own movement, not as a duplicate", () => {
		// The qualifier rule the log itself uses: an ASSISTED Chin-Up is not a Chin-Up, and
		// swallowing one as a repeat of the other would lose a movement the user wanted.
		const { brief, skipped } = appendToBrief(
			plan("Chin-Up", "Bench Press"),
			answer("Assisted Chin-Up", "Incline Bench Press"),
			"7:09a",
		);
		expect(brief.workout.exercises.map((e) => e.name)).toEqual([
			"Chin-Up",
			"Bench Press",
			"Assisted Chin-Up",
			"Incline Bench Press",
		]);
		expect(skipped).toEqual([]);
	});

	it("sees through word order and plurals, which are not facts about the exercise", () => {
		const { skipped } = appendToBrief(
			plan("Dumbbell Bench Press"),
			answer("Bench Press with Dumbbells"),
			"7:09a",
		);
		expect(skipped).toEqual(["Bench Press with Dumbbells"]);
	});

	it("refuses a model that repeats itself INSIDE one append", () => {
		// The same bug arriving twice as fast.
		const { brief, skipped } = appendToBrief(plan("Lat Pulldown"), answer("Face Pull", "Face Pull"), "7:09a");
		expect(brief.workout.exercises.map((e) => e.name)).toEqual(["Lat Pulldown", "Face Pull"]);
		expect(skipped).toEqual(["Face Pull"]);
	});

	it("leaves an ordinary append completely alone", () => {
		const { brief, skipped } = appendToBrief(plan("Lat Pulldown"), answer("Plank", "Side Plank"), "7:09a");
		expect(brief.workout.exercises.map((e) => e.name)).toEqual(["Lat Pulldown", "Plank", "Side Plank"]);
		expect(skipped).toEqual([]);
	});
});

describe("what the user is told about a dropped duplicate", () => {
	it("says nothing when nothing was dropped", () => {
		expect(skippedNote([])).toBeNull();
	});

	it("names one, in a sentence", () => {
		expect(skippedNote(["Barbell Curl"])).toBe(
			"Barbell Curl is already on the plan, so it was not added again.",
		);
	});

	it("names several, and does not repeat itself", () => {
		const note = skippedNote(["Lat Pulldown", "Barbell Curl", "Lat Pulldown"]);
		expect(note).toBe("Lat Pulldown and Barbell Curl are already on the plan, so they were not added again.");
	});

	it("never leaves the drop silent — the user asked for more and got fewer", () => {
		expect(skippedNote(THE_FIVE)).toMatch(/already on the plan/);
		expect(skippedNote(THE_FIVE)).toContain("Good Morning");
	});
});
