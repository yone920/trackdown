import { describe, expect, it } from "vitest";
import { addDays } from "../localTime.js";
import { activity, daysAgo, facts, meal, TODAY, weightTrend } from "../../test/fixtures/facts.js";
import {
	proposeTimeline,
	toProposedTimeline,
	validateMetrics,
	type ProposalSpec,
} from "./proposal.js";

// The safe-rate projection (docs/concept-v2.md §Goals). These are the numbers the Goals
// screen puts under "about 20 weeks at a standard pace → Jan 14", so they are pinned here
// rather than eyeballed: a change to a rate constant should fail this file, not surprise
// someone in six months when their date moves.

const inWeeks = (weeks: number): string => addDays(TODAY, weeks * 7);

function spec(partial: Partial<ProposalSpec> & Pick<ProposalSpec, "metrics">): ProposalSpec {
	return { kind: "custom", title: "A goal", ...partial };
}

/** A user who weighs a steady 195 lb — the seven days body_weight averages over. */
const AT_195 = facts({ weights: weightTrend(7, 195, 0) });

describe("fat loss", () => {
	const toOneSeventy = spec({
		kind: "lose_fat",
		metrics: [{ measure: "body_weight", target: 170, unit: "lb", direction: "decrease" }],
	});

	it("projects 195 → 170 at 0.75 %/week for the standard pace", () => {
		const proposal = proposeTimeline({ spec: toOneSeventy, facts: AT_195, pace: "standard", today: TODAY });
		// ln(170/195) / ln(1 − 0.0075) = 18.2 weeks, rounded up to whole weeks.
		expect(proposal.weeks).toBe(19);
		expect(proposal.projected_date).toBe(inWeeks(19));
		expect(proposal.rate).toContain("1.5 lb a week");
		expect(proposal.rate).toContain("0.8 % of body weight");
		expect(proposal.unrealistic).toBe(false);
		expect(proposal.standing).toBe(false);
		expect(proposal.metrics[0]?.current).toBe(195);
	});

	it("moves the date with the profile's pace, inside the 0.5–1 %/week band", () => {
		const weeks = (pace: "gentle" | "standard" | "aggressive"): number | null =>
			proposeTimeline({ spec: toOneSeventy, facts: AT_195, pace, today: TODAY }).weeks;
		expect(weeks("gentle")).toBe(28);
		expect(weeks("standard")).toBe(19);
		expect(weeks("aggressive")).toBe(14);
		// Nothing said about pace is the standard one.
		expect(proposeTimeline({ spec: toOneSeventy, facts: AT_195, today: TODAY }).weeks).toBe(19);
	});

	it("keeps an unrealistic user date and says what it would take", () => {
		const soon = addDays(TODAY, 28);
		const proposal = proposeTimeline({
			spec: spec({
				kind: "lose_fat",
				metrics: [{ measure: "body_weight", target: 170, unit: "lb", direction: "decrease", by: soon }],
			}),
			facts: AT_195,
			today: TODAY,
		});
		expect(proposal.unrealistic).toBe(true);
		// Both dates survive: theirs, and the one the safe rate gives.
		expect(proposal.by).toBe(soon);
		expect(proposal.projected_date).toBe(inWeeks(19));
		expect(proposal.note).toContain(soon);
		expect(proposal.note).toContain("6.3 lb a week");
		expect(proposal.note).toContain("faster than is safe");
		expect(proposal.note).toContain(inWeeks(19));
	});

	it("keeps a date that is brisk but still inside the safe band", () => {
		// 195 → 170 in 16 weeks is 1.6 lb a week: faster than the standard 0.75 %/week,
		// slower than the 1 %/week the band allows. Their date stands; the note says so.
		const brisk = addDays(TODAY, 16 * 7);
		const proposal = proposeTimeline({
			spec: spec({
				kind: "lose_fat",
				metrics: [{ measure: "body_weight", target: 170, unit: "lb", direction: "decrease", by: brisk }],
			}),
			facts: AT_195,
			today: TODAY,
		});
		expect(proposal.unrealistic).toBe(false);
		expect(proposal.by).toBe(brisk);
		expect(proposal.note).toContain("still safe, but faster than");
	});

	it("accepts a user date the safe rate can meet", () => {
		const later = addDays(TODAY, 200);
		const proposal = proposeTimeline({
			spec: spec({
				kind: "lose_fat",
				metrics: [{ measure: "body_weight", target: 170, unit: "lb", direction: "decrease", by: later }],
			}),
			facts: AT_195,
			today: TODAY,
		});
		expect(proposal.unrealistic).toBe(false);
		expect(proposal.by).toBe(later);
		expect(proposal.note).toContain("works");
	});

	it("calls a date in the past unrealistic rather than projecting backwards", () => {
		const proposal = proposeTimeline({
			spec: spec({
				kind: "lose_fat",
				metrics: [{ measure: "body_weight", target: 170, unit: "lb", direction: "decrease", by: daysAgo(10) }],
			}),
			facts: AT_195,
			today: TODAY,
		});
		expect(proposal.unrealistic).toBe(true);
		expect(proposal.projected_date).toBe(inWeeks(19));
	});

	it("says so when the goal is already met", () => {
		const proposal = proposeTimeline({
			spec: toOneSeventy,
			facts: facts({ weights: weightTrend(7, 168, 0) }),
			today: TODAY,
		});
		expect(proposal.weeks).toBe(0);
		expect(proposal.projected_date).toBe(TODAY);
		// Worded with the number it used, and offering the other answer: the trend may
		// simply be older than the user standing on the scale.
		expect(proposal.note).toContain("168");
		expect(proposal.note).toContain("already under 170 lb");
		expect(proposal.note).toContain("tell me your current weight");
	});

	it("projects from a weight stated with the goal rather than from the stale trend", () => {
		// The field report: seeded weigh-ins at 181, the user types "I am 212, my goal is
		// 200". Going by the trend alone the goal is already met; going by what they just
		// said it is twelve pounds away.
		const stale = facts({ weights: weightTrend(7, 181.2, 0) });
		const toTwoHundred = {
			kind: "lose_fat",
			title: "Down to 200 lb",
			metrics: [{ measure: "body_weight", target: 200, unit: "lb", direction: "decrease" }],
		};
		expect(proposeTimeline({ spec: toTwoHundred, facts: stale, today: TODAY }).weeks).toBe(0);

		const stated = proposeTimeline({ spec: toTwoHundred, facts: stale, today: TODAY, statedWeightLb: 212 });
		expect(stated.metrics[0]?.current).toBe(212);
		expect(stated.weeks).toBeGreaterThan(1);
		expect(stated.projected_date).not.toBe(TODAY);
	});

	it("has no date to give before the first weigh-in", () => {
		const proposal = proposeTimeline({ spec: toOneSeventy, facts: facts(), today: TODAY });
		expect(proposal.projected_date).toBeNull();
		expect(proposal.weeks).toBeNull();
		expect(proposal.note).toContain("body weight");
	});
});

describe("gaining", () => {
	it("projects weight gain at half the fat-loss rate", () => {
		const proposal = proposeTimeline({
			spec: spec({
				kind: "gain_muscle",
				metrics: [{ measure: "body_weight", target: 190, unit: "lb", direction: "increase" }],
			}),
			facts: facts({ weights: weightTrend(7, 180, 0) }),
			today: TODAY,
		});
		// ln(190/180) / ln(1 + 0.00375) = 14.4 weeks.
		expect(proposal.weeks).toBe(15);
		expect(proposal.rate).toContain("0.7 lb a week");
	});
});

describe("strength", () => {
	const benchTo185 = spec({
		kind: "build_strength",
		metrics: [{ measure: "exercise_load", scope: "Bench Press", target: 185, unit: "lb", direction: "increase" }],
	});
	const benching135 = facts({
		activities: [activity(daysAgo(3), { exercise: "Bench Press", load_lb: 135, sets: 3, reps: 8 })],
	});

	it("steps a plate every week and a half at the standard pace", () => {
		const proposal = proposeTimeline({ spec: benchTo185, facts: benching135, pace: "standard", today: TODAY });
		// 50 lb at 5 lb per week and a half = 15 weeks.
		expect(proposal.weeks).toBe(15);
		expect(proposal.rate).toContain("5 lb every week and a half");
		expect(proposal.metrics[0]?.current).toBe(135);
	});

	it("is a plate every two weeks at the gentle pace and one a week at the aggressive one", () => {
		expect(proposeTimeline({ spec: benchTo185, facts: benching135, pace: "gentle", today: TODAY }).weeks).toBe(20);
		expect(proposeTimeline({ spec: benchTo185, facts: benching135, pace: "aggressive", today: TODAY }).weeks).toBe(10);
	});
});

describe("endurance", () => {
	const to150 = spec({
		kind: "improve_endurance",
		metrics: [{ measure: "weekly_cardio_min", target: 150, unit: "min", direction: "increase" }],
	});

	it("grows the week by 10 %, whatever the pace", () => {
		const running100 = facts({
			activities: [activity(daysAgo(2), { category: "cardio", duration_min: 100 })],
		});
		const proposal = proposeTimeline({ spec: to150, facts: running100, pace: "aggressive", today: TODAY });
		// ln(150/100) / ln(1.1) = 4.25 weeks.
		expect(proposal.weeks).toBe(5);
		expect(proposal.rate).toContain("10 % more each week");
		expect(proposal.rate).toContain("+10 min to start");
	});

	it("gives no date out of nothing — 10 % of zero never arrives", () => {
		const proposal = proposeTimeline({ spec: to150, facts: facts(), today: TODAY });
		expect(proposal.projected_date).toBeNull();
		expect(proposal.note).toContain("cardio this week");
	});
});

describe("standing intentions and unprojectable measures", () => {
	it("proposes no date for a goal with no finish line", () => {
		const proposal = proposeTimeline({
			spec: spec({
				kind: "maintain",
				metrics: [{ measure: "weekly_cardio_min", target: 150, unit: "min", direction: "at_least" }],
			}),
			facts: facts({ activities: [activity(daysAgo(1), { category: "cardio", duration_min: 60 })] }),
			today: TODAY,
		});
		expect(proposal.standing).toBe(true);
		expect(proposal.projected_date).toBeNull();
		expect(proposal.note).toContain("standing intention");
	});

	it("refuses to invent a journey out of a daily target", () => {
		const proposal = proposeTimeline({
			spec: spec({ metrics: [{ measure: "protein_g", target: 200, unit: "g", direction: "increase" }] }),
			facts: facts({ meals: [meal(TODAY, { protein_g: 120 })] }),
			today: TODAY,
		});
		expect(proposal.projected_date).toBeNull();
		expect(proposal.note).toContain("daily target");
	});
});

describe("a goal with several metrics", () => {
	it("takes the slowest of them", () => {
		const proposal = proposeTimeline({
			spec: spec({
				kind: "custom",
				metrics: [
					// 5 weeks…
					{ measure: "weekly_cardio_min", target: 150, unit: "min", direction: "increase" },
					// …and 15, which is the one the date has to come from.
					{ measure: "exercise_load", scope: "Bench Press", target: 185, unit: "lb", direction: "increase" },
				],
			}),
			facts: facts({
				activities: [
					activity(daysAgo(2), { category: "cardio", duration_min: 100 }),
					activity(daysAgo(3), { exercise: "Bench Press", load_lb: 135 }),
				],
			}),
			today: TODAY,
		});
		expect(proposal.weeks).toBe(15);
		expect(proposal.metrics.map((metric) => metric.weeks)).toEqual([5, 15]);
	});
});

describe("the confirm card's shape", () => {
	it("carries the date the goal will be saved with", () => {
		const proposal = proposeTimeline({
			spec: spec({
				kind: "lose_fat",
				metrics: [{ measure: "body_weight", target: 170, unit: "lb", direction: "decrease" }],
			}),
			facts: AT_195,
			today: TODAY,
		});
		expect(toProposedTimeline(proposal)).toMatchObject({ by: inWeeks(19), realistic: true });

		const withTheirDate = proposeTimeline({
			spec: spec({
				kind: "lose_fat",
				metrics: [
					{ measure: "body_weight", target: 170, unit: "lb", direction: "decrease", by: addDays(TODAY, 28) },
				],
			}),
			facts: AT_195,
			today: TODAY,
		});
		// Their date is what the card shows; `realistic: false` is what it says about it.
		expect(toProposedTimeline(withTheirDate)).toMatchObject({ by: addDays(TODAY, 28), realistic: false });
	});
});

describe("validateMetrics", () => {
	it("refuses a measure the app cannot compute", () => {
		expect(validateMetrics([{ measure: "vibes", direction: "increase" }])).toContain("vibes");
	});

	it("refuses a scoped measure with nothing to scope it to", () => {
		expect(validateMetrics([{ measure: "exercise_load", target: 185, direction: "increase" }])).toContain("exercise");
		expect(
			validateMetrics([{ measure: "exercise_load", scope: "Bench Press", target: 185, direction: "increase" }])
		).toBeNull();
	});

	// weekly_sets scopes to a muscle when one is named and to the whole body when none is,
	// so an unscoped one is a goal, not a validation error (the field bug this fixed).
	it("accepts weekly sets with no muscle named — that is the whole body", () => {
		expect(validateMetrics([{ measure: "weekly_sets", target: 18, direction: "increase" }])).toBeNull();
		expect(
			validateMetrics([{ measure: "weekly_sets", scope: "chest", target: 12, direction: "increase" }])
		).toBeNull();
	});

	it("accepts an unscoped measure", () => {
		expect(validateMetrics([{ measure: "body_weight", target: 170, direction: "decrease" }])).toBeNull();
	});
});
