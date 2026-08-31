import { describe, expect, it } from "vitest";
import { activity, daysAgo, facts, TODAY, weight } from "../../test/fixtures/facts.js";
import { computeFeatures } from "../coach/features.js";
import { buildRules } from "../coach/rules.js";
import { buildBoard, cadenceDays, etaFor, BOARD_WEEKS, type TrainingBoard } from "./board.js";
import type { DayFacts } from "../goals/measures.js";

// The board, without a database. The one property worth more than all the others is at the
// bottom: **the board's next step is the coach's next step**, asserted by running both
// engines over the same history and comparing the numbers. Everything above it is the
// wording and the arithmetic that turns a Prescription into a row.

const bench = (date: string, load: number, values: Record<string, unknown> = {}) =>
	activity(date, {
		exercise: "Bench Press",
		category: "strength",
		muscle_groups: ["chest", "triceps"],
		sets: 3,
		reps: 8,
		load_lb: load,
		confidence: "high",
		...values,
	});

const assistedChin = (date: string, load: number, values: Record<string, unknown> = {}) =>
	activity(date, {
		exercise: "Assisted Chin-Up",
		category: "strength",
		muscle_groups: ["lats", "biceps"],
		sets: 3,
		reps: 10,
		load_lb: load,
		confidence: "high",
		...values,
	});

const run = (date: string, minutes: number, miles: number | null = null) =>
	activity(date, {
		exercise: "Running",
		category: "cardio",
		duration_min: minutes,
		distance_mi: miles,
		kcal: 240,
	});

function board(input: Partial<DayFacts>, extra: Partial<Parameters<typeof buildBoard>[0]> = {}): TrainingBoard {
	const day = facts(input);
	return buildBoard({ features: computeFeatures({ facts: day }), facts: day, ...extra });
}

const liftNamed = (result: TrainingBoard, name: string) =>
	result.lifts.find((lift) => lift.exercise === name);

describe("one row per regularly-logged exercise", () => {
	it("carries the working load, the sessions and a series to draw", () => {
		const result = board({ activities: [bench(daysAgo(9), 130), bench(daysAgo(5), 135), bench(daysAgo(2), 135)] });
		const lift = liftNamed(result, "Bench Press");
		expect(lift?.load_lb).toBe(135);
		expect(lift?.load_text).toBe("135 lb");
		expect(lift?.sessions).toBe(3);
		expect(lift?.days_since).toBe(2);
		// Oldest first: a chart is read left to right.
		expect(lift?.series.map((point) => point.load_lb)).toEqual([130, 135, 135]);
		expect(lift?.trend_lb).toBe(5);
		expect(lift?.delta_text).toBe("+5 lb in four weeks");
		expect(lift?.sentiment).toBe("good");
	});

	it("says 'First session' rather than inventing a trend from one point", () => {
		const lift = liftNamed(board({ activities: [bench(daysAgo(1), 135)] }), "Bench Press");
		expect(lift?.delta_text).toBe("First session");
		expect(lift?.sentiment).toBe("neutral");
		expect(lift?.trend).toBe("new");
	});

	it("is drawn for every logged lift, goal or no goal", () => {
		const result = board({ activities: [bench(daysAgo(2), 135), assistedChin(daysAgo(2), 55)] });
		expect(result.lifts.map((lift) => lift.exercise).sort()).toEqual(["Assisted Chin-Up", "Bench Press"]);
	});
});

describe("assistance is labelled as assistance", () => {
	const catalog = { equipment: {}, loadDirection: { "assisted chin-up": "assistance" as const } };

	it("says 'of assistance' and reads a drop as progress", () => {
		const result = board(
			{ activities: [assistedChin(daysAgo(9), 60), assistedChin(daysAgo(2), 55)] },
			{ catalog }
		);
		const lift = liftNamed(result, "Assisted Chin-Up");
		expect(lift?.load_direction).toBe("assistance");
		expect(lift?.load_text).toBe("55 lb of assistance");
		// −5 lb of help is five pounds closer to a bodyweight rep.
		expect(lift?.delta_text).toBe("5 lb less help");
		expect(lift?.sentiment).toBe("good");
	});

	it("without the catalogue flag the same rows read the other way", () => {
		const lift = liftNamed(
			board({ activities: [assistedChin(daysAgo(9), 60), assistedChin(daysAgo(2), 55)] }),
			"Assisted Chin-Up"
		);
		expect(lift?.delta_text).toBe("−5 lb in four weeks");
		expect(lift?.sentiment).toBe("watch");
	});

	it("prescribes one step LESS help after two sessions at target", () => {
		const result = board(
			{ activities: [assistedChin(daysAgo(9), 55), assistedChin(daysAgo(2), 55)] },
			{ catalog }
		);
		const next = liftNamed(result, "Assisted Chin-Up")?.next;
		expect(next?.rule).toBe("step_up");
		expect(next?.load_lb).toBe(50);
		expect(next?.text).toBe("50 lb of assistance next — one step less help");
	});
});

describe("the next step, and when", () => {
	it("holds until two clean sessions, with an eta from the exercise's own cadence", () => {
		// One session at 135 so far; the second is what unlocks the step, and this exercise
		// comes round about weekly.
		const result = board({ activities: [bench(daysAgo(14), 130), bench(daysAgo(7), 130), bench(daysAgo(1), 135)] });
		const next = liftNamed(result, "Bench Press")?.next;
		expect(next?.rule).toBe("hold");
		expect(next?.text).toBe("Hold 135 lb until 3 × 8 twice");
		expect(next?.eta).toBe("~1 wk");
	});

	it("steps up when the sessions are in", () => {
		const next = liftNamed(board({ activities: [bench(daysAgo(8), 135), bench(daysAgo(1), 135)] }), "Bench Press")?.next;
		expect(next?.rule).toBe("step_up");
		expect(next?.load_lb).toBe(140);
		expect(next?.text).toBe("Up to 140 lb next");
	});

	it("repeats a first session rather than guessing at it", () => {
		const next = liftNamed(board({ activities: [bench(daysAgo(1), 135)] }), "Bench Press")?.next;
		expect(next?.rule).toBe("new");
		expect(next?.text).toBe("Repeat 135 lb to set a baseline");
	});

	it("prescribes cardio by the week", () => {
		const next = liftNamed(board({ activities: [run(daysAgo(2), 30, 3)] }), "Running")?.next;
		expect(next?.rule).toBe("cardio");
		expect(next?.text).toBe("30 min next");
	});

	it("turns sessions still to go into weeks", () => {
		expect(etaFor(0, 7)).toBeNull();
		expect(etaFor(1, 7)).toBe("~1 wk");
		expect(etaFor(2, 5)).toBe("~1–2 wks");
		expect(etaFor(2, 7)).toBe("~2 wks");
	});

	it("measures cadence as the median gap, and guesses a week with one session", () => {
		expect(cadenceDays([{ date: TODAY, load_lb: 1, sets: null, reps: null, duration_min: null, confidence: null }])).toBe(7);
		expect(
			cadenceDays(
				[daysAgo(0), daysAgo(3), daysAgo(6)].map((date) => ({
					date,
					load_lb: 1,
					sets: null,
					reps: null,
					duration_min: null,
					confidence: null,
				}))
			)
		).toBe(3);
	});
});

describe("frequency, cardio and body", () => {
	it("buckets sessions into whole weeks ending today", () => {
		const result = board({
			activities: [bench(daysAgo(1), 135), bench(daysAgo(3), 135), bench(daysAgo(9), 130), bench(daysAgo(30), 125)],
		});
		expect(result.frequency.weeks).toHaveLength(BOARD_WEEKS);
		expect(result.frequency.weeks.at(-1)?.sessions).toBe(2);
		expect(result.frequency.weeks.at(-2)?.sessions).toBe(1);
		expect(result.frequency.sessions_this_week).toBe(2);
		expect(result.frequency.average_per_week).toBe(0.5);
	});

	it("reports sets per muscle group, and only groups that have been trained", () => {
		const result = board({ activities: [bench(daysAgo(1), 135)] });
		expect(result.frequency.muscles).toEqual([
			{ muscle: "chest", sets_7d: 3, sets_28d: 3 },
			{ muscle: "triceps", sets_7d: 3, sets_28d: 3 },
		]);
	});

	it("draws weekly cardio minutes against the plan's intent, with last and best pace", () => {
		const result = board({ activities: [run(daysAgo(1), 30, 3), run(daysAgo(8), 40, 4), run(daysAgo(2), 20, 2.5)] });
		expect(result.cardio.weeks.at(-1)?.minutes).toBe(50);
		expect(result.cardio.weeks.at(-2)?.minutes).toBe(40);
		expect(result.cardio.minutes_this_week).toBe(50);
		expect(result.cardio.weekly_target_min).toBe(150);
		expect(result.cardio.last).toEqual({ date: daysAgo(1), pace_min_mi: 10, distance_mi: 3 });
		expect(result.cardio.best).toEqual({ date: daysAgo(2), pace_min_mi: 8, distance_mi: 2.5 });
	});

	it("has no pace at all when nothing carried a distance", () => {
		const result = board({ activities: [run(daysAgo(1), 30)] });
		expect(result.cardio.last).toBeNull();
		expect(result.cardio.best).toBeNull();
	});

	it("carries the weigh-ins for the weight line", () => {
		const result = board({ weights: [weight(daysAgo(7), 212), weight(daysAgo(1), 210.4)] });
		expect(result.body.series).toEqual([
			{ date: daysAgo(7), value: 212 },
			{ date: daysAgo(1), value: 210.4 },
		]);
		expect(result.body.latest).toBe(210.4);
	});

	it("is quiet rather than wrong with nothing logged", () => {
		const result = board({});
		expect(result.lifts).toEqual([]);
		expect(result.frequency.sessions_this_week).toBe(0);
		expect(result.frequency.muscles).toEqual([]);
		expect(result.body.latest).toBeNull();
	});

	// The coverage ledger, on the tab (user decision 2026-08-31 §B7). Unlike the bars above
	// it, it draws every entry including the ones with nothing in them — an absence is the
	// only thing this section is for.
	it("carries the coverage ledger with its overdue entries, straight from the features", () => {
		const dayFacts = facts({ date: TODAY, activities: [bench(daysAgo(1), 135)] });
		const result = board({ activities: [bench(daysAgo(1), 135)] });
		const features = computeFeatures({ facts: dayFacts });

		// One ledger, not a second reading of it: the tab and the brief must agree.
		expect(result.frequency.coverage).toEqual(features.coverage);

		const find = (key: string) => result.frequency.coverage.find((entry) => entry.key === key);
		expect(find("chest")).toMatchObject({ days_since: 1, sets_14d: 3, sets_28d: 3, overdue: false });
		// The bars show two muscles; the ledger shows the twelve that have had nothing.
		expect(find("quads")).toMatchObject({ days_since: null, overdue: true });
		expect(find("stretching")).toMatchObject({ label: "stretching", unit: "sessions", overdue: true });
		expect(result.frequency.coverage.filter((entry) => entry.overdue).length).toBeGreaterThan(5);
		// Largest debt first, so an app can render the top of the list as the overdue ones.
		expect(result.frequency.coverage[0]?.overdue).toBe(true);
		expect(result.frequency.coverage.slice(-2).map((entry) => entry.key).sort()).toEqual(["chest", "triceps"]);
	});
});

// The point of the whole module.
describe("the board's next step is the coach's next step", () => {
	it.each([
		["a hold", [bench(daysAgo(14), 130), bench(daysAgo(7), 130), bench(daysAgo(1), 135)]],
		["a step up", [bench(daysAgo(8), 135), bench(daysAgo(1), 135)]],
		["a first session", [bench(daysAgo(1), 135)]],
		["a missed session", [bench(daysAgo(8), 135), bench(daysAgo(1), 135, { reps: 5 })]],
		["an ease-back gap", [bench(daysAgo(12), 135), bench(daysAgo(5), 135)]],
		["a restart gap", [bench(daysAgo(30), 135), bench(daysAgo(20), 135)]],
	])("agrees with buildRules on %s", (_case, activities) => {
		const day = facts({ activities });
		const features = computeFeatures({ facts: day });
		const rules = buildRules({ features, goals: [] });
		const result = buildBoard({ features, facts: day });

		for (const prescription of rules.prescriptions) {
			const lift = liftNamed(result, prescription.exercise);
			expect(lift?.next.rule).toBe(prescription.rule);
			expect(lift?.next.load_lb).toBe(prescription.load_lb);
			expect(lift?.next.sets).toBe(prescription.sets);
			expect(lift?.next.reps).toBe(prescription.reps);
			expect(lift?.next.why).toBe(prescription.why);
		}
	});
});
