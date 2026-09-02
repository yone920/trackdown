import { describe, expect, it } from "vitest";
import { activity, daysAgo, facts, TODAY, weight, weightTrend } from "../../test/fixtures/facts.js";
import { STALL_DAYS, detectReached, type DetectableGoal } from "./detect.js";

// The smoothed reached rules and the three-week stall (docs/concept-v2.md §Goals). What
// these tests are really guarding is the *smoothing*: every "not reached" case below is a
// day on which the raw number says the goal is met, and the rule says wait.

function goal(partial: Partial<DetectableGoal> & Pick<DetectableGoal, "metrics">): DetectableGoal {
	return { kind: "custom", active_from: daysAgo(90), ...partial };
}

const downTo170 = goal({
	kind: "lose_fat",
	metrics: [{ measure: "body_weight", target: 170, direction: "decrease" }],
});

describe("body weight", () => {
	it("is reached when the 7-day average has been at or under target for a week", () => {
		const detection = detectReached(downTo170, facts({ weights: weightTrend(14, 169, 0) }));
		expect(detection.reached).toBe(true);
		expect(detection.reached_why).toContain("7 days");
		expect(detection.stalled).toBe(false);
	});

	it("is not reached the day the average first dips under", () => {
		// Falling steadily, crossing 170 only in the last couple of days: today's average
		// is under, the average three days ago was not.
		const detection = detectReached(downTo170, facts({ weights: weightTrend(14, 176, -0.7) }));
		expect(detection.metrics[0]?.current).toBeLessThan(170);
		expect(detection.reached).toBe(false);
	});

	it("is not reached on a single weigh-in under target", () => {
		const detection = detectReached(downTo170, facts({ weights: [weight(TODAY, 168)] }));
		// One reading is the average of a one-day week, and six days of nothing behind it.
		expect(detection.metrics[0]?.current).toBe(168);
		expect(detection.reached).toBe(false);
	});

	// Field report 2026-09-02. A seven-day mean of ONE reading is that reading wearing a
	// statistic's clothes, and every one of the seven windows can contain the same lone
	// number — so the "held for a week" run could pass on a single weigh-in.
	it("will not call it held on too few weigh-ins, however good the average looks", () => {
		// Two readings, both comfortably under target, taken a day apart.
		const detection = detectReached(
			downTo170,
			facts({ weights: [weight(daysAgo(1), 168), weight(TODAY, 168)] }),
		);
		expect(detection.metrics[0]?.current).toBeLessThan(170);
		expect(detection.reached).toBe(false);
		expect(detection.metrics[0]?.why).toContain("weigh-in");
	});

	it("will not call it held on several readings taken the same day", () => {
		// Three readings is three readings only if they are three days. Stepping on the
		// scale three times one morning is one morning.
		const detection = detectReached(
			downTo170,
			facts({ weights: [weight(TODAY, 168), weight(TODAY, 167.5), weight(TODAY, 168.5)] }),
		);
		expect(detection.reached).toBe(false);
	});

	it("still calls it held on a real week of weigh-ins", () => {
		// The gate is about evidence, not about making the goal unreachable.
		const detection = detectReached(downTo170, facts({ weights: weightTrend(14, 169, 0) }));
		expect(detection.reached).toBe(true);
		expect(detection.reached_why).toContain("weigh-ins");
	});

	it("says so when nobody has weighed themselves", () => {
		const detection = detectReached(downTo170, facts({ weights: weightTrend(3, 169, 0, daysAgo(20)) }));
		expect(detection.reached).toBe(false);
		expect(detection.metrics[0]?.why).toContain("No weigh-in");
	});

	it("reaches a gaining goal the same way, from the other side", () => {
		const gaining = goal({
			kind: "gain_muscle",
			metrics: [{ measure: "body_weight", target: 190, direction: "increase" }],
		});
		expect(detectReached(gaining, facts({ weights: weightTrend(14, 191, 0) })).reached).toBe(true);
		expect(detectReached(gaining, facts({ weights: weightTrend(14, 188, 0) })).reached).toBe(false);
	});
});

describe("a lift at target", () => {
	const bench185 = goal({
		kind: "build_strength",
		metrics: [{ measure: "exercise_load", scope: "Bench Press", target: 185, direction: "increase" }],
	});

	it("needs two separate days", () => {
		const once = facts({
			activities: [activity(daysAgo(5), { exercise: "Bench Press", load_lb: 185, sets: 3, reps: 5 })],
		});
		expect(detectReached(bench185, once).reached).toBe(false);
		expect(detectReached(bench185, once).metrics[0]?.why).toContain("1 of 2");

		const twice = facts({
			activities: [
				activity(daysAgo(5), { exercise: "Bench Press", load_lb: 185 }),
				activity(daysAgo(1), { exercise: "Bench Press", load_lb: 190 }),
			],
		});
		expect(detectReached(bench185, twice).reached).toBe(true);
	});

	it("does not count two sets on one day as twice", () => {
		const oneSession = facts({
			activities: [
				activity(daysAgo(2), { exercise: "Bench Press", load_lb: 185 }),
				activity(daysAgo(2), { exercise: "Bench Press", load_lb: 185 }),
			],
		});
		expect(detectReached(bench185, oneSession).reached).toBe(false);
	});

	it("only counts the lift the goal is about", () => {
		const otherLifts = facts({
			activities: [
				activity(daysAgo(5), { exercise: "Incline Press", load_lb: 200 }),
				activity(daysAgo(2), { exercise: "Incline Press", load_lb: 200 }),
			],
		});
		expect(detectReached(bench185, otherLifts).reached).toBe(false);
	});
});

describe("weekly volume", () => {
	const cardio150 = goal({
		kind: "improve_endurance",
		metrics: [{ measure: "weekly_cardio_min", target: 150, direction: "increase" }],
	});

	it("needs two weeks running", () => {
		const oneWeek = facts({ activities: [activity(daysAgo(2), { category: "cardio", duration_min: 160 })] });
		expect(detectReached(cardio150, oneWeek).reached).toBe(false);

		const twoWeeks = facts({
			activities: [
				activity(daysAgo(2), { category: "cardio", duration_min: 160 }),
				activity(daysAgo(9), { category: "cardio", duration_min: 155 }),
			],
		});
		expect(detectReached(cardio150, twoWeeks).reached).toBe(true);
		expect(detectReached(cardio150, twoWeeks).reached_why).toContain("2 weeks running");
	});
});

describe("standing intentions", () => {
	it("are never reached, however good the week was", () => {
		const standing = goal({
			kind: "maintain",
			metrics: [{ measure: "weekly_cardio_min", target: 150, direction: "at_least" }],
		});
		const detection = detectReached(
			standing,
			facts({ activities: [activity(daysAgo(1), { category: "cardio", duration_min: 400 })] })
		);
		expect(detection.metrics[0]?.standing).toBe(true);
		expect(detection.reached).toBe(false);
		expect(detection.stalled).toBe(false);
	});
});

describe("a goal with two numbers in it", () => {
	const both = goal({
		metrics: [
			{ measure: "body_weight", target: 170, direction: "decrease" },
			{ measure: "exercise_load", scope: "Bench Press", target: 185, direction: "increase" },
		],
	});

	it("is reached only when both halves are", () => {
		const weightOnly = facts({ weights: weightTrend(14, 169, 0) });
		expect(detectReached(both, weightOnly).reached).toBe(false);

		const bothDone = facts({
			weights: weightTrend(14, 169, 0),
			activities: [
				activity(daysAgo(5), { exercise: "Bench Press", load_lb: 185 }),
				activity(daysAgo(1), { exercise: "Bench Press", load_lb: 185 }),
			],
		});
		expect(detectReached(both, bothDone).reached).toBe(true);
	});
});

describe("stalling", () => {
	it("flags three weeks of a flat weight", () => {
		const detection = detectReached(downTo170, facts({ weights: weightTrend(28, 195, 0) }));
		expect(detection.reached).toBe(false);
		expect(detection.stalled).toBe(true);
		expect(detection.stalled_since).toBe(daysAgo(STALL_DAYS));
	});

	it("does not flag a weight that is moving", () => {
		// 0.15 lb a day is about a pound a week — slow, but not stalled.
		const detection = detectReached(downTo170, facts({ weights: weightTrend(28, 199, -0.15) }));
		expect(detection.stalled).toBe(false);
		expect(detection.stalled_since).toBeNull();
	});

	it("cannot have stalled since before the goal existed", () => {
		const young = goal({
			kind: "lose_fat",
			active_from: daysAgo(10),
			metrics: [{ measure: "body_weight", target: 170, direction: "decrease" }],
		});
		expect(detectReached(young, facts({ weights: weightTrend(28, 195, 0) })).stalled_since).toBe(daysAgo(10));
	});

	it("says nothing about a user with no data — that is a logging problem, not a stall", () => {
		expect(detectReached(downTo170, facts()).stalled).toBe(false);
		expect(detectReached(downTo170, facts({ weights: weightTrend(3, 195, 0) })).stalled).toBe(false);
	});

	it("never calls a reached goal stalled", () => {
		const detection = detectReached(downTo170, facts({ weights: weightTrend(28, 169, 0) }));
		expect(detection.reached).toBe(true);
		expect(detection.stalled).toBe(false);
	});

	it("flags a lift that has not gone up in three weeks", () => {
		const bench185 = goal({
			kind: "build_strength",
			metrics: [{ measure: "exercise_load", scope: "Bench Press", target: 185, direction: "increase" }],
		});
		const stuck = facts({
			activities: [
				activity(daysAgo(25), { exercise: "Bench Press", load_lb: 155 }),
				activity(daysAgo(11), { exercise: "Bench Press", load_lb: 155 }),
				activity(daysAgo(2), { exercise: "Bench Press", load_lb: 155 }),
			],
		});
		expect(detectReached(bench185, stuck).stalled).toBe(true);

		const climbing = facts({
			activities: [
				activity(daysAgo(25), { exercise: "Bench Press", load_lb: 145 }),
				activity(daysAgo(11), { exercise: "Bench Press", load_lb: 150 }),
				activity(daysAgo(2), { exercise: "Bench Press", load_lb: 160 }),
			],
		});
		expect(detectReached(bench185, climbing).stalled).toBe(false);
	});
});
