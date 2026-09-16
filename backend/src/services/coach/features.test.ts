import { describe, expect, it } from "vitest";
import { activity, daysAgo, facts, TODAY, weight } from "../../test/fixtures/facts.js";
import {
	adherenceWindow,
	cardioFeature,
	computeFeatures,
	coverageLedger,
	exerciseFeatures,
	STRETCHING_KEY,
	muscleFeatures,
	recommendationMuscleStats,
	weightFeature,
} from "./features.js";
import { chooseFamily, MUSCLES } from "../recommendation/index.js";

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

	// A hundred and fifty minutes a week is a MODERATE-minutes number, and the week has to be
	// counted in the same currency or the person who runs is told they are behind while the
	// person who ambles is told they are fine (services/coach/cardioIntensity.ts).
	it("weighs a mixed week into equivalent minutes", () => {
		const cardio = cardioFeature(
			facts({
				activities: [
					activity(daysAgo(1), { exercise: "Brisk Walk", category: "cardio", duration_min: 20 }),
					activity(daysAgo(2), { exercise: "Running", category: "cardio", duration_min: 15 }),
					activity(daysAgo(3), { exercise: "Stroll", category: "cardio", duration_min: 40 }),
				],
			}),
			150
		);
		// 20 wall-clock + 15 + 40 = 75 minutes; 20×1 + 15×2 + 40×0.5 = 70 equivalent ones.
		expect(cardio.minutes_this_week).toBe(75);
		expect(cardio.equiv_minutes_this_week).toBe(70);
		expect(cardio.short_by_min).toBe(80);
		expect(cardio.equiv_text).toBe("40 stroll×0.5 + 20 brisk + 15 running×2");
		expect(cardio.alternatives_text).toBe("80 moderate min or 40 hard");
	});

	it("breaks the week down largest first, with the rule that classed each row", () => {
		const cardio = cardioFeature(
			facts({
				activities: [
					activity(daysAgo(1), { exercise: "Running", category: "cardio", duration_min: 15 }),
					activity(daysAgo(2), { exercise: "Brisk Walk", category: "cardio", duration_min: 45 }),
					// Two sessions of the same thing are one line, summed.
					activity(daysAgo(3), { exercise: "Brisk Walk", category: "cardio", duration_min: 15 }),
				],
			}),
			150
		);
		expect(cardio.breakdown).toEqual([
			{
				exercise: "Brisk Walk",
				label: "brisk",
				intensity: "moderate",
				multiplier: 1,
				minutes: 60,
				equiv_minutes: 60,
				why: "brisk walk — moderate",
			},
			{
				exercise: "Running",
				label: "running",
				intensity: "vigorous",
				multiplier: 2,
				minutes: 15,
				equiv_minutes: 30,
				why: "running — vigorous",
			},
		]);
		expect(cardio.intensity_mix).toEqual([
			{ intensity: "moderate", minutes: 60, equiv_minutes: 60 },
			{ intensity: "vigorous", minutes: 15, equiv_minutes: 30 },
		]);
	});

	it("is unchanged for somebody whose cardio is all moderate", () => {
		// The property that let this land without rewriting the existing numbers: at ×1 the
		// equivalent week and the wall-clock week are the same week.
		const cardio = cardioFeature(facts({ activities: [run(daysAgo(1), 30), run(daysAgo(5), 25)] }), 150);
		expect(cardio.minutes_this_week).toBe(55);
		expect(cardio.equiv_minutes_this_week).toBe(55);
		expect(cardio.short_by_min).toBe(95);
	});

	// Provenance, not arithmetic — the same distinction `TargetSource` makes about calories.
	it("says where the weekly target came from: a goal, a statement, or the guideline", () => {
		const week = facts({ activities: [run(daysAgo(1), 30)] });
		expect(cardioFeature(week, null, null)).toMatchObject({ weekly_target_min: 150, target_source: "default" });
		expect(cardioFeature(week, null, 200)).toMatchObject({ weekly_target_min: 200, target_source: "stated" });
		// A goal is the more specific statement of intent and wins over the standing one.
		expect(cardioFeature(week, 120, 200)).toMatchObject({ weekly_target_min: 120, target_source: "goal" });
	});

	it("says nothing about a week nobody has logged, rather than a zero mix", () => {
		const cardio = cardioFeature(facts(), null);
		expect(cardio.equiv_minutes_this_week).toBe(0);
		expect(cardio.breakdown).toEqual([]);
		expect(cardio.intensity_mix).toEqual([]);
		expect(cardio.equiv_text).toBe("");
		expect(cardio.alternatives_text).toBe("150 moderate min or 75 hard");
	});
});

describe("adherence over 1, 3 and 7 days", () => {
	const input = {
		facts: facts({
			activities: [bench(daysAgo(1)), bench(daysAgo(5))],
			weights: [weight(TODAY, 193.4)],
		}),
	};

	it("counts logged and training days inside the window", () => {
		expect(adherenceWindow(input, 1)).toMatchObject({ days: 1, logged_days: 1, training_days: 0 });
		// Two logged days in the last three: today's weigh-in and yesterday's bench.
		expect(adherenceWindow(input, 3)).toMatchObject({ logged_days: 2, training_days: 1 });
	});

	it("names the days with nothing logged", () => {
		const week = adherenceWindow(input, 7);
		expect(week.logged_days).toBe(3);
		expect(week.unlogged_days).toHaveLength(4);
		expect(week.unlogged_days).toContain(daysAgo(2));
		expect(week.unlogged_days).not.toContain(daysAgo(5));
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
			}),
		});

		expect(features.data_quality.low_confidence_items).toEqual([
			{ date: daysAgo(1), exercise: "Bench Press", reason: "read from a photo, never confirmed" },
		]);
		expect(features.data_quality.weigh_in_due).toBe(true);
		expect(features.data_quality.unlogged_days.length).toBeGreaterThan(0);
	});

	it("does not flag a confirmed item or a fresh weigh-in", () => {
		const features = computeFeatures({
			facts: facts({ activities: [bench(TODAY, { confidence: "high" })], weights: [weight(TODAY, 193)] }),
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

	it("has a row for every muscle the registry knows, plus stretching, whether or not it was trained", () => {
		const ledger = coverageLedger(facts({ activities: [squat(TODAY)] }));
		expect(ledger).toHaveLength(MUSCLES.length + 1);
		expect(find(ledger, STRETCHING_KEY)?.label).toBe("stretching");
		expect(ledger.map((entry) => entry.key)).toContain("upper_back");
		// Two rows the old twelve-muscle ledger had nowhere to put (ENGINE.md §4b).
		expect(ledger.map((entry) => entry.key)).toEqual(expect.arrayContaining(["lower_back", "neck"]));
	});

	it("counts sets in 7, 14 and 28 days, and days since it was last served", () => {
		const ledger = coverageLedger(
			facts({ activities: [squat(daysAgo(3), 4), squat(daysAgo(10), 3), squat(daysAgo(20), 5)] })
		);
		const quads = find(ledger, "quads");
		expect(quads).toMatchObject({ days_since: 3, sets_7d: 4, sets_14d: 7, sets_28d: 12, unit: "sets", overdue: false });
		// The same rows pay into every muscle they name.
		expect(find(ledger, "glutes")).toMatchObject({ sets_7d: 4, sets_14d: 7, sets_28d: 12 });
		// The seven-day count is what the body map colours a region by, so it is counted here
		// rather than on the phone: the registry's token mapping exists in one place.
		expect(find(ledger, "chest")).toMatchObject({ sets_7d: 0, sets_28d: 0 });
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
		// abs + obliques are one entry called "abs"; back + traps are "upper back". And a
		// row tagged with both halves is counted once for the entry, not twice.
		expect(find(ledger, "abs")).toMatchObject({ label: "Abs", days_since: 2, sets_28d: 5 });
		expect(find(ledger, "upper_back")).toMatchObject({ label: "Upper back", days_since: 4, sets_28d: 4 });
	});

	it("counts stretching in SESSIONS, because a stretch has no sets", () => {
		const ledger = coverageLedger(facts({ activities: [stretch(daysAgo(1)), stretch(daysAgo(1)), stretch(daysAgo(9))] }));
		expect(find(ledger, STRETCHING_KEY)).toMatchObject({
			days_since: 1,
			// Two stretches on one day are one session, in every window.
			sets_7d: 1,
			sets_14d: 2,
			sets_28d: 2,
			unit: "sessions",
			overdue: false,
		});
	});

	it("calls an entry overdue at two weeks, and 'never' the largest debt there is", () => {
		const ledger = coverageLedger(facts({ activities: [squat(daysAgo(1)), crunch(daysAgo(15))] }));
		expect(find(ledger, "quads")?.overdue).toBe(false);
		expect(find(ledger, "abs")).toMatchObject({ days_since: 15, overdue: true });
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

	// ENGINE.md §4b: each muscle's colour level is judged against ITS OWN band, not one flat
	// 10–20 sets/week band applied to everyone.
	it("judges level against each muscle's own band, and carries the band for the sheet", () => {
		// Forearms' MAV band is 6–10 — 8 sets lands inside it, though it would read as
		// "under the band" against the old flat 10–20 the app used to hold every muscle to.
		const forearmWork = activity(daysAgo(1), {
			exercise: "Wrist Curl",
			category: "strength",
			muscle_groups: ["forearms"],
			sets: 8,
			reps: 15,
		});
		const ledger = coverageLedger(facts({ activities: [forearmWork] }));
		const forearms = find(ledger, "forearms");
		expect(forearms).toMatchObject({ sets_7d: 8, level: 2, band_low: 6, band_high: 10 });
		// Untouched: never served, level 0, still carries its band for the sheet to quote.
		const quads = find(ledger, "quads");
		expect(quads).toMatchObject({ days_since: null, level: 0, band_low: 12, band_high: 18 });
	});

	it("gives stretching a level without a volume band, since it has no MEV/MAV of its own", () => {
		const seenThisWeek = coverageLedger(facts({ activities: [stretch(daysAgo(1))] }));
		expect(find(seenThisWeek, STRETCHING_KEY)).toMatchObject({ level: 2, band_low: null, band_high: null });

		const seenLastMonth = coverageLedger(facts({ activities: [stretch(daysAgo(9))] }));
		expect(find(seenLastMonth, STRETCHING_KEY)).toMatchObject({ level: 1, band_low: null, band_high: null });

		const never = coverageLedger(facts({ activities: [] }));
		expect(find(never, STRETCHING_KEY)).toMatchObject({ level: 0, band_low: null, band_high: null });
	});
});

// recommendationMuscleStats — the adapter feeding the new engine's registry, deliberately
// its own pass rather than a re-shaping of muscleFeatures() above: that function's
// TRACKED_MUSCLES vocabulary has no forearms, no lower_back, no neck, and folds upper_back
// into a plain "back" — exactly the disagreement the registry exists to retire.
describe("recommendationMuscleStats", () => {
	it("reproduces the real 2026-09-16 scenario end to end: chest's family wins over back's", () => {
		const benchPress = activity(daysAgo(7), {
			exercise: "Bench Press",
			category: "strength",
			muscle_groups: ["chest"],
			sets: 3,
			reps: 8,
			load_lb: 135,
			confidence: "high",
		});
		const seatedCableRow = activity(daysAgo(2), {
			exercise: "Seated Cable Row",
			category: "strength",
			muscle_groups: ["back"],
			sets: 3,
			reps: 12,
			load_lb: 115,
			confidence: "high",
		});
		const stats = recommendationMuscleStats(facts({ activities: [benchPress, seatedCableRow] }));
		const chest = stats.find((stat) => stat.key === "chest");
		const upperBack = stats.find((stat) => stat.key === "upper_back");
		expect(chest).toMatchObject({ daysSince: 7, sets7d: 0 });
		expect(upperBack).toMatchObject({ daysSince: 2, sets7d: 3 });
		// Fed straight into the scheduler, chest's family (push) should win outright — the
		// bug that started this whole project, closed end to end.
		expect(chooseFamily(stats)).toBe("push");
	});

	it("counts upper_back from EITHER of its two catalogue tokens — back or traps", () => {
		const facePull = activity(daysAgo(1), {
			exercise: "Face Pull",
			category: "strength",
			muscle_groups: ["shoulders", "traps"],
			sets: 3,
			reps: 15,
			load_lb: 40,
			confidence: "high",
		});
		const stats = recommendationMuscleStats(facts({ activities: [facePull] }));
		expect(stats.find((stat) => stat.key === "upper_back")).toMatchObject({ daysSince: 1, sets7d: 3 });
	});

	it("carries forearms, lower_back and neck — the three gaps the old vocabulary had", () => {
		const stats = recommendationMuscleStats(facts({ activities: [] }));
		expect(stats.map((stat) => stat.key)).toEqual(expect.arrayContaining(["forearms", "lower_back", "neck"]));
		for (const key of ["forearms", "lower_back", "neck"]) {
			expect(stats.find((stat) => stat.key === key)).toMatchObject({ daysSince: null, sets7d: 0 });
		}
	});
});
