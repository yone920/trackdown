import { describe, expect, it } from "vitest";
import { activity, daysAgo, facts, meal, TODAY, weight } from "../../test/fixtures/facts.js";
import {
	adherenceWindow,
	cardioFeature,
	computeFeatures,
	coverageLedger,
	exerciseFeatures,
	LEDGER_MUSCLES,
	STRETCHING_KEY,
	muscleFeatures,
	weightFeature,
} from "./features.js";

// The coach's inputs, without a database and without a provider. Everything the brief is
// built on is a pure function of a 28-day DayFacts window, which is what makes "why did it
// say five days" a question with an answer.

const bench = (date: string, values: Record<string, unknown> = {}) =>
	activity(date, {
		exercise: "Bench Press",
		category: "strength",
		muscle_groups: ["chest", "triceps"],
		sets: 3,
		reps: 8,
		load_lb: 135,
		...values,
	});

const pulldown = (date: string, values: Record<string, unknown> = {}) =>
	activity(date, {
		exercise: "Lat Pulldown",
		category: "strength",
		muscle_groups: ["back", "lats", "biceps"],
		sets: 3,
		reps: 10,
		load_lb: 110,
		...values,
	});

const run = (date: string, minutes: number) =>
	activity(date, { exercise: "Running", category: "cardio", duration_min: minutes, distance_mi: 2, kcal: 240 });

describe("days since the last workout — the gap the whole brief turns on", () => {
	it("counts from the most recent activity of any kind", () => {
		const features = computeFeatures({ facts: facts({ activities: [bench(daysAgo(5)), run(daysAgo(2), 30)] }) });
		expect(features.days_since_last_workout).toBe(2);
		expect(features.last_workout_date).toBe(daysAgo(2));
	});

	it("is 0 when the user has already trained today", () => {
		expect(computeFeatures({ facts: facts({ activities: [bench(TODAY)] }) }).days_since_last_workout).toBe(0);
	});

	it("is null — not zero — when nothing is in the window at all", () => {
		const features = computeFeatures({ facts: facts() });
		expect(features.days_since_last_workout).toBeNull();
		expect(features.sessions_in_window).toBe(0);
	});

	it("counts sessions by day, this week against last week", () => {
		const features = computeFeatures({
			facts: facts({
				activities: [
					// Two lifts in one visit are one session.
					bench(daysAgo(1)),
					pulldown(daysAgo(1)),
					bench(daysAgo(3)),
					bench(daysAgo(9)),
					bench(daysAgo(11)),
				],
			}),
			trainingDaysTarget: 4,
		});
		expect(features.sessions_this_week).toBe(2);
		expect(features.sessions_last_week).toBe(2);
		expect(features.sessions_in_window).toBe(4);
		expect(features.training_days_target).toBe(4);
	});
});

describe("muscle groups", () => {
	it("reports days since and weekly sets, longest untrained first", () => {
		const muscles = muscleFeatures(
			facts({ activities: [bench(daysAgo(1)), pulldown(daysAgo(6)), pulldown(daysAgo(9))] })
		);
		const byName = new Map(muscles.map((muscle) => [muscle.muscle, muscle]));

		expect(byName.get("chest")).toMatchObject({ days_since: 1, sets_7d: 3, sets_28d: 3, recent: true });
		// Two pulldown sessions in the window; only the six-day-old one is inside the week.
		expect(byName.get("back")).toMatchObject({ days_since: 6, sets_7d: 3, sets_28d: 6, recent: false });
		// Never trained: null, not zero — the coach has to be able to see an absence.
		expect(byName.get("quads")).toMatchObject({ days_since: null, sets_28d: 0 });
		expect(muscles[0]?.days_since).toBeNull();
	});

	it("names the groups with no entry in four weeks", () => {
		const features = computeFeatures({ facts: facts({ activities: [bench(daysAgo(2))] }) });
		expect(features.untrained_muscles).toContain("back");
		expect(features.untrained_muscles).toContain("quads");
		expect(features.untrained_muscles).not.toContain("chest");
	});

	it("treats a group trained yesterday as still recovering and one trained two days ago as fair game", () => {
		const muscles = muscleFeatures(facts({ activities: [bench(daysAgo(1)), pulldown(daysAgo(2))] }));
		expect(muscles.find((m) => m.muscle === "chest")?.recent).toBe(true);
		expect(muscles.find((m) => m.muscle === "back")?.recent).toBe(false);
	});
});

describe("exercises", () => {
	it("gives last load × sets × reps, the best in four weeks, and the trend", () => {
		const features = exerciseFeatures(
			facts({
				activities: [
					bench(daysAgo(21), { load_lb: 125 }),
					bench(daysAgo(14), { load_lb: 130 }),
					bench(daysAgo(4), { load_lb: 135 }),
				],
			})
		);
		const press = features.find((exercise) => exercise.exercise === "Bench Press");
		expect(press).toMatchObject({ days_since: 4, best_load_lb: 135, trend: "up", trend_lb: 10 });
		expect(press?.last).toMatchObject({ load_lb: 135, sets: 3, reps: 8 });
		expect(press?.sessions).toHaveLength(3);
		// Newest first, so a truncated prompt keeps what matters.
		expect(press?.sessions[0]?.date).toBe(daysAgo(4));
	});

	it("folds one day's sets into one session at that day's top load", () => {
		const features = exerciseFeatures(
			facts({
				activities: [
					bench(daysAgo(2), { load_lb: 115, sets: 1, reps: 10 }),
					bench(daysAgo(2), { load_lb: 135, sets: 3, reps: 8 }),
				],
			})
		);
		const press = features[0];
		expect(press?.sessions).toHaveLength(1);
		// The top set is the progression's subject; the warm-up set still counts as volume.
		expect(press?.last).toMatchObject({ load_lb: 135, sets: 4, reps: 8 });
	});

	it("calls a single session 'new' rather than flat", () => {
		expect(exerciseFeatures(facts({ activities: [bench(daysAgo(3))] }))[0]).toMatchObject({
			trend: "new",
			trend_lb: null,
		});
	});

	it("ignores rows outside the four-week window", () => {
		expect(exerciseFeatures(facts({ activities: [bench(daysAgo(40))] }))).toHaveLength(0);
	});
});

describe("cardio", () => {
	it("counts this week's minutes against the plan and last week's", () => {
		const cardio = cardioFeature(facts({ activities: [run(daysAgo(1), 30), run(daysAgo(5), 25), run(daysAgo(9), 40)] }), 150);
		expect(cardio).toMatchObject({
			minutes_this_week: 55,
			minutes_last_week: 40,
			weekly_target_min: 150,
			short_by_min: 95,
			sessions_this_week: 2,
			days_since: 1,
		});
	});

	it("falls back to the WHO's 150 min/week when nobody has said", () => {
		expect(cardioFeature(facts(), null).weekly_target_min).toBe(150);
	});

	it("does not count a lift as cardio", () => {
		expect(cardioFeature(facts({ activities: [bench(daysAgo(1))] }), 150).minutes_this_week).toBe(0);
	});
});

describe("adherence over 1, 3 and 7 days", () => {
	const input = {
		facts: facts({
			meals: [
				meal(TODAY, { kcal: 700, protein_g: 50, carbs_g: 60 }),
				meal(TODAY, { kcal: 500, protein_g: 30, carbs_g: 40 }),
				meal(daysAgo(1), { kcal: 2400, protein_g: 150, carbs_g: 260 }),
				meal(daysAgo(5), { kcal: 2000, protein_g: 120, carbs_g: 200 }),
			],
			activities: [bench(daysAgo(1))],
			weights: [weight(TODAY, 193.4)],
		}),
		targets: { kcal: 2250, protein_g: 160, carbs_max_g: 250 },
	};

	it("averages per day, not per meal", () => {
		expect(adherenceWindow(input, 1)).toMatchObject({ days: 1, logged_days: 1, kcal_avg: 1200, kcal_delta_avg: -1050 });
		// Two logged days in the last three: 1,200 and 2,400.
		expect(adherenceWindow(input, 3)).toMatchObject({ logged_days: 2, kcal_avg: 1800, training_days: 1 });
	});

	it("names the days with nothing logged", () => {
		const week = adherenceWindow(input, 7);
		expect(week.logged_days).toBe(3);
		expect(week.unlogged_days).toHaveLength(4);
		expect(week.unlogged_days).toContain(daysAgo(2));
		expect(week.unlogged_days).not.toContain(daysAgo(5));
	});

	it("has no calorie delta without a target", () => {
		const bare = adherenceWindow({ facts: input.facts }, 7);
		expect(bare.kcal_target).toBeNull();
		expect(bare.kcal_delta_avg).toBeNull();
	});
});

describe("weight", () => {
	it("smooths to a 7-day average and reports the week-on-week trend", () => {
		const feature = weightFeature(
			facts({
				weights: [
					weight(daysAgo(13), 196),
					weight(daysAgo(10), 195.4),
					weight(daysAgo(8), 195),
					weight(daysAgo(3), 194),
					weight(daysAgo(1), 193.4),
					weight(TODAY, 193),
				],
			})
		);
		expect(feature.latest).toBe(193);
		expect(feature.days_since_weigh_in).toBe(0);
		expect(feature.avg_7d).toBeCloseTo(193.5, 1);
		expect(feature.avg_7d_prev).toBeCloseTo(195.5, 1);
		expect(feature.trend_per_week).toBeLessThan(0);
	});

	it("is all nulls with no weigh-ins, rather than zeroes", () => {
		expect(weightFeature(facts())).toMatchObject({ latest: null, avg_7d: null, trend_per_week: null, days_since_weigh_in: null });
	});
});

describe("data quality — what the coach must discount", () => {
	it("flags low-confidence items, unlogged days and a due weigh-in", () => {
		const features = computeFeatures({
			facts: facts({
				activities: [bench(daysAgo(1), { confidence: "low", source: "fused" }), pulldown(daysAgo(1), { confidence: "high" })],
				weights: [weight(daysAgo(4), 194)],
				meals: [meal(daysAgo(1), { kcal: 600, protein_g: null })],
			}),
			targets: { kcal: 2250, protein_g: 160, carbs_max_g: null },
		});

		expect(features.data_quality.low_confidence_items).toEqual([
			{ date: daysAgo(1), exercise: "Bench Press", reason: "read from a photo, never confirmed" },
		]);
		expect(features.data_quality.weigh_in_due).toBe(true);
		expect(features.data_quality.meals_missing_macros).toBe(1);
		expect(features.data_quality.no_calorie_target).toBe(false);
		expect(features.data_quality.unlogged_days.length).toBeGreaterThan(0);
	});

	it("says so when there is no calorie target to advise against", () => {
		const features = computeFeatures({ facts: facts(), targets: { kcal: null, protein_g: null, carbs_max_g: null } });
		expect(features.data_quality.no_calorie_target).toBe(true);
		expect(features.data_quality.weigh_in_due).toBe(true);
	});

	it("does not flag a confirmed item or a fresh weigh-in", () => {
		const features = computeFeatures({
			facts: facts({ activities: [bench(TODAY, { confidence: "high" })], weights: [weight(TODAY, 193)] }),
			targets: { kcal: 2250, protein_g: 160, carbs_max_g: null },
		});
		expect(features.data_quality.low_confidence_items).toHaveLength(0);
		expect(features.data_quality.weigh_in_due).toBe(false);
	});
});

// ── The coverage ledger ──────────────────────────────────────────────────────────────
// Fine-grained, in the words a lifter uses, and it counts absences: an entry nothing has
// served is the whole point (user decision 2026-08-31 §B7).

describe("the coverage ledger", () => {
	const find = (ledger: ReturnType<typeof coverageLedger>, key: string) => ledger.find((entry) => entry.key === key);

	const squat = (date: string, sets = 4) =>
		activity(date, { exercise: "Back Squat", category: "strength", muscle_groups: ["quads", "glutes"], sets, reps: 5, load_lb: 225 });
	const crunch = (date: string, sets = 3) =>
		activity(date, { exercise: "Crunch", category: "strength", muscle_groups: ["abs"], sets, reps: 20 });
	const stretch = (date: string) =>
		activity(date, { exercise: "Stretching", category: "mobility", muscle_groups: ["full_body"], duration_min: 10 });

	it("has a row for every muscle it tracks, plus stretching, whether or not it was trained", () => {
		const ledger = coverageLedger(facts({ activities: [squat(TODAY)] }));
		expect(ledger).toHaveLength(LEDGER_MUSCLES.length + 1);
		expect(find(ledger, STRETCHING_KEY)?.label).toBe("stretching");
		expect(ledger.map((entry) => entry.key)).toContain("upper_back");
	});

	it("counts sets in 14 and 28 days, and days since it was last served", () => {
		const ledger = coverageLedger(
			facts({ activities: [squat(daysAgo(3), 4), squat(daysAgo(10), 3), squat(daysAgo(20), 5)] })
		);
		const quads = find(ledger, "quads");
		expect(quads).toMatchObject({ days_since: 3, sets_14d: 7, sets_28d: 12, unit: "sets", overdue: false });
		// The same rows pay into every muscle they name.
		expect(find(ledger, "glutes")).toMatchObject({ sets_14d: 7, sets_28d: 12 });
	});

	it("folds the catalogue's tags into the words a lifter uses", () => {
		const ledger = coverageLedger(
			facts({
				activities: [
					crunch(daysAgo(2), 3),
					activity(daysAgo(2), { exercise: "Russian Twist", category: "strength", muscle_groups: ["obliques"], sets: 2 }),
					activity(daysAgo(4), { exercise: "Barbell Row", category: "strength", muscle_groups: ["back", "traps"], sets: 4 }),
				],
			})
		);
		// abs + obliques are one entry called "core"; back + traps are "upper back". And a
		// row tagged with both halves is counted once for the entry, not twice.
		expect(find(ledger, "core")).toMatchObject({ label: "core", days_since: 2, sets_28d: 5 });
		expect(find(ledger, "upper_back")).toMatchObject({ label: "upper back", days_since: 4, sets_28d: 4 });
	});

	it("counts stretching in SESSIONS, because a stretch has no sets", () => {
		const ledger = coverageLedger(facts({ activities: [stretch(daysAgo(1)), stretch(daysAgo(1)), stretch(daysAgo(9))] }));
		expect(find(ledger, STRETCHING_KEY)).toMatchObject({
			days_since: 1,
			sets_14d: 2,
			sets_28d: 2,
			unit: "sessions",
			overdue: false,
		});
	});

	it("calls an entry overdue at two weeks, and 'never' the largest debt there is", () => {
		const ledger = coverageLedger(facts({ activities: [squat(daysAgo(1)), crunch(daysAgo(15))] }));
		expect(find(ledger, "quads")?.overdue).toBe(false);
		expect(find(ledger, "core")).toMatchObject({ days_since: 15, overdue: true });
		expect(find(ledger, "calves")).toMatchObject({ days_since: null, overdue: true, debt_days: 29 });
		// Never-served entries sort above a 15-day debt, which sorts above everything fresh.
		expect(ledger[0]?.days_since).toBeNull();
		expect(ledger.at(-1)?.key).toBe("quads");
	});

	it("ignores what happened after the day being advised, like every other feature", () => {
		const ledger = coverageLedger(facts({ activities: [squat(daysAgo(-2))] }));
		expect(find(ledger, "quads")).toMatchObject({ days_since: null, sets_28d: 0 });
	});

	it("rides on computeFeatures, so the prompt and the board read one ledger", () => {
		const features = computeFeatures({ facts: facts({ activities: [squat(daysAgo(2))] }) });
		expect(features.coverage).toEqual(coverageLedger(facts({ activities: [squat(daysAgo(2))] })));
	});
});
