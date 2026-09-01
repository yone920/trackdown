import { z } from "zod";
import { describe, expect, it } from "vitest";
import { activity, daysAgo, facts, meal, TODAY, weight } from "../../test/fixtures/facts.js";
import { computeFeatures, type CoachFeatures } from "./features.js";
import {
	buildRules,
	cardioNextMinutes,
	cardioRule,
	coverageRule,
	DEFAULT_SESSION_MINUTES,
	gapRule,
	prescribeLoads,
	recoveryRule,
	selectNudge,
	sessionSizing,
	stepFor,
	targetScheme,
	varietyRule,
	type CoachGoal,
	type Prescription,
} from "./rules.js";
import {
	assertUsableBrief,
	assertUsableRevision,
	CoachBriefSchema,
	CoachRevisionSchema,
	resolveRestAfterTraining,
	UnusableBriefError,
} from "./schema.js";

// The deterministic half of the coach. Every number in a brief comes from this file, so
// every rule in docs/concept-v2.md §Progression rules has a test here that would fail if
// the rule quietly changed.

interface LiftOptions {
	load?: number;
	sets?: number;
	reps?: number;
	confidence?: "low" | "medium" | "high";
	exercise?: string;
	muscles?: string[];
}

function lift(date: string, { load = 135, sets = 3, reps = 8, confidence = "high", exercise = "Bench Press", muscles = ["chest"] }: LiftOptions = {}) {
	return activity(date, {
		exercise,
		category: "strength",
		muscle_groups: muscles,
		sets,
		reps,
		load_lb: load,
		confidence,
	});
}

function featuresFor(activities: ReturnType<typeof activity>[], extra: Partial<Parameters<typeof computeFeatures>[0]> = {}): CoachFeatures {
	return computeFeatures({ facts: facts({ activities, weights: [weight(TODAY, 190)] }), ...extra });
}

function only(prescriptions: Prescription[], exercise = "Bench Press"): Prescription {
	const found = prescriptions.find((item) => item.exercise === exercise);
	if (!found) throw new Error(`No prescription for ${exercise}`);
	return found;
}

describe("the gap rule", () => {
	it("is quiet inside two days", () => {
		expect(gapRule(2).level).toBe("none");
		expect(gapRule(1).level).toBe("fresh");
		expect(gapRule(0).text).toContain("Already trained today");
	});

	it("eases back in after three or four days, and says so without scolding", () => {
		const gap = gapRule(4);
		expect(gap.level).toBe("ease_back");
		expect(gap.text).toContain("Ease back in");
		expect(gap.text).toContain("without scolding");
	});

	it("treats a fortnight or more as a restart", () => {
		expect(gapRule(13).level).toBe("ease_back");
		expect(gapRule(14).level).toBe("restart");
		expect(gapRule(30).text).toContain("restart, not a resumption");
	});

	it("treats an empty history as a restart too", () => {
		expect(gapRule(null)).toMatchObject({ days: null, level: "restart" });
	});
});

describe("the recovery rule", () => {
	it("keeps a group trained inside 48 hours off the day's primary targets", () => {
		const rule = recoveryRule(featuresFor([lift(daysAgo(1)), lift(daysAgo(6), { exercise: "Lat Pulldown", muscles: ["back"] })]).muscles);
		expect(rule.avoid_primary).toContain("chest");
		expect(rule.prefer_primary).not.toContain("chest");
		expect(rule.text).toContain("not today's primary target");
	});

	it("prefers the longest untrained groups", () => {
		const rule = recoveryRule(featuresFor([lift(TODAY)]).muscles);
		// Everything else is "not in four weeks", which sorts first.
		expect(rule.prefer_primary).not.toContain("chest");
		expect(rule.text).toContain("not in four weeks");
	});
});

describe("the cardio rule — the week, not yesterday", () => {
	it("prescribes the shortfall, capped at one safe step on the last session", () => {
		const features = computeFeatures({
			facts: facts({ activities: [activity(daysAgo(2), { exercise: "Running", category: "cardio", duration_min: 30 })] }),
			cardioTargetMin: 150,
		});
		const rule = cardioRule(features);
		// Thirty minutes of running is sixty EQUIVALENT minutes (×2), so the week is 90 short
		// rather than 120 — the whole point of counting a run as harder than a walk. The step
		// is still one safe step on the last session: +10 % of 30 is 35, and that is the cap.
		expect(rule.minutes_today).toBe(35);
		expect(rule.text).toContain("60 of 150 equivalent min");
		expect(rule.text).toContain("(30 running×2)");
		expect(rule.text).toContain("90 short");
	});

	it("offers the shortfall in both currencies, because they are the same shortfall", () => {
		const features = computeFeatures({
			facts: facts({ activities: [activity(daysAgo(2), { exercise: "Brisk Walk", category: "cardio", duration_min: 30 })] }),
			cardioTargetMin: 150,
		});
		const rule = cardioRule(features);
		// A brisk walk is moderate, so thirty minutes are thirty and the week is 120 short.
		expect(rule.text).toContain("30 of 150 equivalent min");
		expect(rule.text).toContain("(30 brisk)");
		expect(rule.text).toContain("The whole shortfall is 120 moderate min or 60 hard.");
		expect(rule.text).toContain("Vigorous work counts double and light work counts half");
	});

	it("divides the shortfall by the row's own multiplier, so a run is not asked for twice", () => {
		// 40 equivalent minutes short. Paid in moderate minutes that is 40; paid in running
		// it is 20 — and the +10 % cap on a 30-minute session does not bind either of them.
		expect(cardioNextMinutes(40, 30)).toBe(33);
		expect(cardioNextMinutes(40, 30, 2)).toBe(20);
		// Light work is the other way: half as much credit, so twice as many minutes — up to
		// the cap, which is what stops a stroll being prescribed for eighty minutes.
		expect(cardioNextMinutes(40, 30, 0.5)).toBe(33);
		expect(cardioNextMinutes(40, 200, 0.5)).toBe(80);
		// The floor and the "nothing to do" answer are unmoved by the multiplier.
		expect(cardioNextMinutes(4, 30, 2)).toBe(10);
		expect(cardioNextMinutes(0, 30, 2)).toBeNull();
	});

	it("prescribes nothing once the week is already there", () => {
		const features = computeFeatures({
			facts: facts({ activities: [activity(daysAgo(1), { exercise: "Running", category: "cardio", duration_min: 160 })] }),
			cardioTargetMin: 150,
		});
		expect(cardioRule(features).minutes_today).toBeNull();
		expect(cardioRule(features).text).toContain("optional today");
	});

	it("starts someone with no cardio history at half an hour", () => {
		expect(cardioRule(computeFeatures({ facts: facts(), cardioTargetMin: 150 })).minutes_today).toBe(30);
	});
});

describe("targetScheme — the rep scheme the user is working to", () => {
	it("is the best they have proved at the load they are on, not the average of their days", () => {
		expect(
			targetScheme([
				{ date: TODAY, load_lb: 135, sets: 3, reps: 6, duration_min: null, confidence: "high" },
				{ date: daysAgo(3), load_lb: 135, sets: 3, reps: 8, duration_min: null, confidence: "high" },
			])
		).toEqual({ sets: 3, reps: 8 });
	});

	it("ignores what was done at another load — a warm-up set is not the target", () => {
		expect(
			targetScheme([
				{ date: TODAY, load_lb: 140, sets: 3, reps: 6, duration_min: null, confidence: "high" },
				{ date: daysAgo(4), load_lb: 115, sets: 3, reps: 15, duration_min: null, confidence: "high" },
			])
		).toEqual({ sets: 3, reps: 6 });
	});
});

describe("stepFor — the smallest plate", () => {
	it("is five pounds on free weights", () => {
		expect(stepFor("Bench Press", 135, { "bench press": ["barbell", "bench"] })).toBe(5);
		expect(stepFor("Bench Press", 135)).toBe(5);
	});

	it("is five per cent on a stack, never less than a plate", () => {
		expect(stepFor("Lat Pulldown", 200, { "lat pulldown": ["machine"] })).toBe(10);
		expect(stepFor("Lat Pulldown", 90, { "lat pulldown": ["cable"] })).toBe(5);
	});
});

describe("prescribeLoads — the numbers the model is not allowed to invent", () => {
	it("repeats what the user reported the first time a new exercise appears", () => {
		const item = only(prescribeLoads(featuresFor([lift(daysAgo(1), { load: 95, sets: 3, reps: 10 })])));
		expect(item).toMatchObject({ rule: "new", load_lb: 95, sets: 3, reps: 10 });
		expect(item.why).toContain("First time on record");
	});

	it("holds the load until two consecutive sessions hit the target reps", () => {
		// One session at target, one short of it.
		const item = only(prescribeLoads(featuresFor([lift(daysAgo(2)), lift(daysAgo(5), { reps: 6 })])));
		expect(item).toMatchObject({ rule: "hold", load_lb: 135, sets: 3, reps: 8 });
		expect(item.why).toContain("hold");
	});

	it("steps up one plate after two sessions at target reps", () => {
		const item = only(prescribeLoads(featuresFor([lift(daysAgo(1)), lift(daysAgo(8)), lift(daysAgo(15), { load: 130 })])));
		expect(item).toMatchObject({ rule: "step_up", load_lb: 140, sets: 3, reps: 8 });
		expect(item.why).toContain("up one step to 140 lb");
	});

	it("never steps twice in a week", () => {
		// Two good sessions at 135, but the jump from 130 was only four days ago.
		const item = only(prescribeLoads(featuresFor([lift(daysAgo(1)), lift(daysAgo(4)), lift(daysAgo(9), { load: 130 })])));
		expect(item).toMatchObject({ rule: "hold", load_lb: 135 });
		expect(item.why).toContain("never more than one step a week");
	});

	it("does not count a low-confidence session as a session at target", () => {
		const item = only(
			prescribeLoads(featuresFor([lift(daysAgo(1), { confidence: "low" }), lift(daysAgo(8)), lift(daysAgo(15), { load: 130 })]))
		);
		expect(item.rule).toBe("hold");
		expect(item.load_lb).toBe(135);
	});

	it("drops one step after two sessions short of target, and never further in one go", () => {
		// Eight reps proved a fortnight ago, then two sessions that fell short of it.
		const item = only(
			prescribeLoads(featuresFor([lift(daysAgo(2), { reps: 5 }), lift(daysAgo(6), { reps: 6 }), lift(daysAgo(13), { reps: 8 })]))
		);
		expect(item).toMatchObject({ rule: "step_down", load_lb: 130 });
		expect(item.why).toContain("drop one step");
	});

	it("holds the load and drops a set after a three-day gap", () => {
		const item = only(prescribeLoads(featuresFor([lift(daysAgo(3)), lift(daysAgo(10))])));
		expect(item).toMatchObject({ rule: "ease_back", load_lb: 135, sets: 2, reps: 8 });
	});

	it("comes back a step lighter and a set shorter after a fortnight", () => {
		const item = only(prescribeLoads(featuresFor([lift(daysAgo(16)), lift(daysAgo(23))])));
		expect(item).toMatchObject({ rule: "restart", load_lb: 130, sets: 2 });
		expect(item.why).toContain("Coming back after 16 days");
	});

	it("steps a machine by five per cent rather than a plate", () => {
		const features = featuresFor([
			lift(daysAgo(1), { exercise: "Leg Press", load: 300, muscles: ["quads"] }),
			lift(daysAgo(8), { exercise: "Leg Press", load: 300, muscles: ["quads"] }),
			lift(daysAgo(15), { exercise: "Leg Press", load: 280, muscles: ["quads"] }),
		]);
		const item = only(prescribeLoads(features, { equipment: { "leg press": ["machine"] } }), "Leg Press");
		expect(item).toMatchObject({ rule: "step_up", load_lb: 315 });
	});

	it("gives cardio minutes rather than a load", () => {
		const features = computeFeatures({
			facts: facts({ activities: [activity(daysAgo(2), { exercise: "Running", category: "cardio", duration_min: 30 })] }),
		});
		expect(only(prescribeLoads(features), "Running")).toMatchObject({ rule: "cardio", load_lb: null, minutes: 30 });
	});

	it("has nothing to prescribe for someone with no history", () => {
		expect(prescribeLoads(featuresFor([]))).toEqual([]);
	});
});

describe("prescribeLoads — an assisted machine, where the load is the help", () => {
	// The field report (migration 0013). 55 lb on an assisted chin-up machine is 55 lb of
	// help: more of it is easier, and getting stronger is the number coming down. Every
	// rule below is the resistance rule with its sign flipped, and nothing else changes.
	const ASSISTED = { "assisted chin-up": "assistance" as const };

	function assisted(date: string, options: Omit<LiftOptions, "exercise" | "muscles"> = {}) {
		return lift(date, { ...options, exercise: "Assisted Chin-Up", muscles: ["lats"] });
	}

	function prescribe(activities: ReturnType<typeof activity>[]): Prescription {
		return only(prescribeLoads(featuresFor(activities), { loadDirection: ASSISTED }), "Assisted Chin-Up");
	}

	it("takes five pounds OFF once the reps are proved", () => {
		const item = prescribe([
			assisted(daysAgo(1), { load: 55 }),
			assisted(daysAgo(8), { load: 55 }),
			assisted(daysAgo(15), { load: 60 }),
		]);
		expect(item).toMatchObject({ rule: "step_up", load_lb: 50, load_direction: "assistance" });
		expect(item.why).toContain("one step LESS help, 50 lb");
	});

	it("would have stepped the same history the wrong way without the catalogue flag", () => {
		const item = only(
			prescribeLoads(
				featuresFor([assisted(daysAgo(1), { load: 55 }), assisted(daysAgo(8), { load: 55 }), assisted(daysAgo(15), { load: 60 })])
			),
			"Assisted Chin-Up"
		);
		// No loadDirection given: read as resistance, and 55 lb of help becomes 60. This is
		// the test that says `load_direction` is what does the work, not the name.
		expect(item).toMatchObject({ rule: "step_up", load_lb: 60, load_direction: "resistance" });
	});

	it("adds help rather than removing it after two sessions short of target", () => {
		const item = prescribe([
			assisted(daysAgo(2), { load: 55, reps: 5 }),
			assisted(daysAgo(6), { load: 55, reps: 6 }),
			assisted(daysAgo(13), { load: 55, reps: 8 }),
		]);
		expect(item).toMatchObject({ rule: "step_down", load_lb: 60 });
		expect(item.why).toContain("MORE help");
	});

	it("comes back with more help after a fortnight, not less", () => {
		const item = prescribe([assisted(daysAgo(16), { load: 55 }), assisted(daysAgo(23), { load: 55 })]);
		expect(item).toMatchObject({ rule: "restart", load_lb: 60, sets: 2 });
		expect(item.why).toContain("MORE help");
	});

	it("counts a drop in assistance as the step that a week must pass after", () => {
		// 60 → 55 four days ago is progress here, so the once-a-week rule applies to it.
		const item = prescribe([assisted(daysAgo(1), { load: 55 }), assisted(daysAgo(4), { load: 55 }), assisted(daysAgo(9), { load: 60 })]);
		expect(item).toMatchObject({ rule: "hold", load_lb: 55 });
		expect(item.why).toContain("never more than one step a week");
	});

	it("stops at nothing rather than going negative — no help left is a bodyweight rep", () => {
		const item = prescribe([
			assisted(daysAgo(1), { load: 5 }),
			assisted(daysAgo(8), { load: 5 }),
			assisted(daysAgo(15), { load: 10 }),
		]);
		expect(item.load_lb).toBe(0);
	});

	it("says so in the rules the prompt is handed, and only when one is in today's list", () => {
		const withAssisted = buildRules({
			features: featuresFor([assisted(daysAgo(1), { load: 55 }), assisted(daysAgo(8), { load: 55 })]),
			goals: [],
			loadDirection: ASSISTED,
		});
		const line = withAssisted.statements.find((statement) => statement.startsWith("ASSISTED MACHINES"));
		expect(line).toContain("Assisted Chin-Up");
		expect(line).toContain("More pounds is EASIER");

		const withoutAssisted = buildRules({ features: featuresFor([lift(daysAgo(1)), lift(daysAgo(8))]), goals: [] });
		expect(withoutAssisted.statements.some((statement) => statement.startsWith("ASSISTED MACHINES"))).toBe(false);
	});
});

describe("prescribeLoads — a stated load, when the log has nothing", () => {
	const stated = [
		{ exercise: "Bench Press", load_lb: 165, reps: 5 },
		{ exercise: "Back Squat", load_lb: 225, reps: null },
	];

	it("prescribes from what the user said they lift", () => {
		const prescriptions = prescribeLoads(featuresFor([]), { referenceLoads: stated });
		expect(prescriptions).toHaveLength(2);
		expect(only(prescriptions)).toMatchObject({
			rule: "reference",
			load_lb: 165,
			sets: 3,
			reps: 5,
			// Never logged here, so there is no "days since" to print. Null, not zero.
			days_since: null,
		});
		expect(only(prescriptions).why).toContain("Stated, not logged");
		// No reps given is a load with no scheme; the model fills that in.
		expect(only(prescriptions, "Back Squat")).toMatchObject({ load_lb: 225, sets: 3, reps: null });
	});

	it("is ignored the moment the exercise has real sessions behind it", () => {
		// Two logged sessions at 135 that hit the scheme: the progression steps to 140 and
		// the user's claim of 165 does not get a say.
		const prescriptions = prescribeLoads(featuresFor([lift(daysAgo(1)), lift(daysAgo(8)), lift(daysAgo(15), { load: 130 })]), {
			referenceLoads: stated,
		});
		expect(only(prescriptions)).toMatchObject({ rule: "step_up", load_lb: 140 });
		expect(prescriptions.filter((item) => item.exercise === "Bench Press")).toHaveLength(1);
		// The one the log has never seen is still prescribed from what was stated.
		expect(only(prescriptions, "Back Squat")).toMatchObject({ rule: "reference", load_lb: 225 });
	});

	it("takes a step off a stated load only after a gap it can actually measure", () => {
		// A brand new account: gapRule calls this a restart, but "we have never seen you
		// train" is not "you stopped training", so the stated load is taken as given.
		expect(only(prescribeLoads(featuresFor([]), { referenceLoads: stated }))).toMatchObject({
			load_lb: 165,
			sets: 3,
		});

		// Eighteen days since a *logged* session is a real return, and the stated load
		// eases back with everything else.
		const returning = only(
			prescribeLoads(featuresFor([lift(daysAgo(18), { exercise: "Lat Pulldown", muscles: ["back"] })]), {
				referenceLoads: stated,
			})
		);
		expect(returning).toMatchObject({ rule: "reference", load_lb: 160, sets: 2 });
		expect(returning.why).toContain("18 days");
	});
});

describe("selectNudge — the single most useful thing", () => {
	const goal = (values: Partial<CoachGoal>): CoachGoal => ({
		id: "g1",
		kind: "lose_fat",
		title: "Down to 170 lb",
		priority: 1,
		metrics: [{ measure: "body_weight", target: 170, direction: "decrease" }],
		reached_candidate_at: null,
		stalled_since: null,
		...values,
	});

	const clean = computeFeatures({
		facts: facts({ activities: [lift(daysAgo(1))], weights: [weight(TODAY, 169.4)], meals: [meal(TODAY, { kcal: 2000, protein_g: 150 })] }),
		targets: { kcal: 2250, protein_g: 160, carbs_max_g: null },
	});

	it("asks about a reached goal before anything else", () => {
		const nudge = selectNudge(clean, [goal({ reached_candidate_at: "2026-08-28T00:00:00Z", reached_why: "7-day average 169.4 lb, at or under 170 for 7 days." })]);
		expect(nudge.action).toEqual({ kind: "mark_reached", goal_id: "g1", label: "Mark it done" });
		expect(nudge.subject).toContain("Down to 170 lb");
		expect(nudge.subject).toContain("169.4");
		// Never auto-closed: the sentence has to be a question (concept-v2 §Goals).
		expect(nudge.subject).toContain("only the user closes a goal");
	});

	it("offers to adjust a stalled one", () => {
		const nudge = selectNudge(clean, [goal({ stalled_since: "2026-08-05" })]);
		expect(nudge.action).toMatchObject({ kind: "adjust_goal", goal_id: "g1" });
		expect(nudge.subject).toContain("Do not imply the user failed");
	});

	it("takes the higher-priority goal when two of them are candidates", () => {
		const nudge = selectNudge(clean, [
			goal({ id: "g2", priority: 2, title: "Bench 185", reached_candidate_at: "2026-08-28T00:00:00Z" }),
			goal({ id: "g1", priority: 1, title: "Down to 170 lb", reached_candidate_at: "2026-08-28T00:00:00Z" }),
		]);
		expect(nudge.action?.goal_id).toBe("g1");
	});

	it("falls back to unconfirmed items, then to a weigh-in, then to the gaps", () => {
		const unconfirmed = computeFeatures({
			facts: facts({ activities: [lift(daysAgo(1), { confidence: "low" })], weights: [weight(TODAY, 190)] }),
		});
		expect(selectNudge(unconfirmed, []).action).toMatchObject({ kind: "close_items" });

		const noWeighIn = computeFeatures({ facts: facts({ activities: [lift(daysAgo(1))] }) });
		expect(selectNudge(noWeighIn, []).action).toMatchObject({ kind: "weigh_in" });
		expect(selectNudge(noWeighIn, []).subject).toContain("No weigh-in on record");
	});

	it("asks a user it knows nothing about for their background, before any log-quality nudge", () => {
		// Nothing logged: every data-quality flag is up (no weigh-in, seven unlogged days),
		// and all of them are worse things to say than "tell me where you are starting".
		const cold = computeFeatures({ facts: facts({}) });
		const nudge = selectNudge(cold, [], { experience: null, background: null, reference_loads: [] });
		expect(nudge.action).toEqual({ kind: "tell_background", goal_id: null, label: "Tell me your background" });
		expect(nudge.subject).toContain("bench 165");
		expect(nudge.subject).toContain("pitched at a beginner");

		// One word about themselves is enough to stop asking.
		expect(
			selectNudge(cold, [], { experience: "intermediate", background: null, reference_loads: [] }).action
		).toMatchObject({ kind: "weigh_in" });
		expect(
			selectNudge(cold, [], { experience: null, background: null, reference_loads: [{ exercise: "Bench Press", load_lb: 165, reps: 5 }] })
				.action
		).toMatchObject({ kind: "weigh_in" });
	});

	it("does not ask for a background from someone who has been logging", () => {
		const logging = computeFeatures({ facts: facts({ activities: [lift(daysAgo(1))] }) });
		expect(selectNudge(logging, [], { experience: null, background: null, reference_loads: [] }).action).toMatchObject({
			kind: "weigh_in",
		});
	});

	it("has no action when nothing needs one, and still names a subject", () => {
		const complete = computeFeatures({
			facts: facts({
				activities: [lift(daysAgo(1)), lift(daysAgo(3)), lift(daysAgo(4)), lift(daysAgo(5)), lift(daysAgo(6)), lift(daysAgo(2)), lift(TODAY)],
				weights: [weight(TODAY, 190)],
				meals: [meal(TODAY, { kcal: 2000, protein_g: 150 })],
			}),
		});
		const nudge = selectNudge(complete, []);
		expect(nudge.action).toBeNull();
		expect(nudge.subject).toContain("one thing that would most improve");
	});
});

describe("buildRules — what the prompt is handed", () => {
	it("puts every rule in the statements, including the ban on inventing numbers", () => {
		const features = featuresFor([lift(daysAgo(4))], { trainingDaysTarget: 4 });
		const rules = buildRules({ features, goals: [] });
		expect(rules.gap.level).toBe("ease_back");
		expect(rules.prescriptions).toHaveLength(1);
		expect(rules.statements.join("\n")).toContain("not yours to change");
		expect(rules.statements.join("\n")).toContain("plan of 4/week");
		expect(rules.statements.at(-1)).toContain("Nudge:");
	});

	it("refuses to assume a beginner when it has never seen the user train", () => {
		const rules = buildRules({ features: featuresFor([]), goals: [] });
		const said = rules.statements.join("\n");
		expect(said).toContain("Do NOT assume a beginner");
		expect(said).toContain("do not know their background yet");
		expect(rules.nudge.action).toMatchObject({ kind: "tell_background" });
	});

	it("pitches the first session at the background the user stated", () => {
		const rules = buildRules({
			features: featuresFor([]),
			goals: [],
			background: {
				experience: "advanced",
				background: "three years of 5/3/1",
				reference_loads: [{ exercise: "Bench Press", load_lb: 165, reps: 5 }],
			},
		});
		const said = rules.statements.join("\n");
		expect(said).toContain("advanced");
		expect(said).toContain("three years of 5/3/1");
		expect(said).toContain("Bench Press 165 lb × 5");
		expect(said).not.toContain("Do NOT assume a beginner");
		// And the number reaches the model as a prescription, not as prose it has to parse.
		expect(rules.prescriptions).toEqual([expect.objectContaining({ exercise: "Bench Press", load_lb: 165 })]);
		// It is a claim, so it is not the nudge's business any more either.
		expect(rules.nudge.action).not.toMatchObject({ kind: "tell_background" });
	});

	it("says nothing about a background once there is a log to read instead", () => {
		const rules = buildRules({ features: featuresFor([lift(daysAgo(2))]), goals: [] });
		expect(rules.statements.join("\n")).not.toContain("assume a beginner");
	});
});

describe("assertUsableBrief — a training day with nothing to do is not an answer", () => {
	const workout = (type: string, exercises: unknown[]) => ({ workout: { type, exercises } });

	it("refuses a non-rest brief with an empty Do list", () => {
		expect(() => assertUsableBrief(workout("strength", []))).toThrow(UnusableBriefError);
		expect(() => assertUsableBrief(workout("cardio", []))).toThrow(/listed no exercises/);
		expect(() => assertUsableBrief(workout("mixed", []))).toThrow(UnusableBriefError);
	});

	it("lets a rest day through, and any day that actually has exercises in it", () => {
		expect(assertUsableBrief(workout("rest", []))).toBeTruthy();
		expect(assertUsableBrief(workout("strength", [{ name: "Bench Press" }]))).toBeTruthy();
	});
});

describe("the brief schema", () => {
	/**
	 * The ceiling WP2 measured the hard way: Anthropic compiles a structured-output schema
	 * into a decoding grammar and refuses one much past this, on Haiku and Sonnet alike (the
	 * note at the top of services/fusion/schema.ts). The brief is the biggest generated
	 * shape in the app, so this is the test that keeps a new field from finding out in
	 * production.
	 */
	const GRAMMAR_CEILING_BYTES = 4500;
	const BRIEF_BUDGET_BYTES = 3000;

	it("stays under the provider's grammar limit", () => {
		const bytes = Buffer.byteLength(JSON.stringify(z.toJSONSchema(CoachBriefSchema)), "utf8");
		expect({ overBudget: bytes > BRIEF_BUDGET_BYTES, bytes: bytes < GRAMMAR_CEILING_BYTES }).toEqual({
			overBudget: false,
			bytes: true,
		});
	});

	it("accepts a full brief and refuses an unknown workout type", () => {
		const brief = {
			headline: "Pull day: back and shoulders",
			why: "Back is five days since its last session.",
			workout: {
				type: "strength",
				targets: ["back"],
				exercises: [
					{ name: "Lat Pulldown", load_lb: 110, sets: 3, reps: 10, minutes: null, note: null, is_new: false },
				],
				finisher: [{ name: "Lat Stretch", minutes: 2, note: null }],
			},
			nutrition: { kcal: 2250, protein_g: 160, carbs_max_g: 250, ideas: ["Greek yoghurt"], why: "Carbs ran high yesterday." },
			nudge: "Weigh in tomorrow.",
		};
		expect(CoachBriefSchema.parse(brief).workout.type).toBe("strength");
		expect(CoachBriefSchema.safeParse({ ...brief, workout: { ...brief.workout, type: "yoga" } }).success).toBe(false);
		// Every optional fact is nullable, never absent — both providers want the key there.
		expect(
			CoachBriefSchema.safeParse({
				...brief,
				workout: { ...brief.workout, exercises: [{ name: "Lat Pulldown", load_lb: 110, sets: 3, reps: 10 }] },
			}).success
		).toBe(false);
	});
});

// ── Sizing the session, and the ledger's debts ───────────────────────────────────────
// Both are user decisions of 2026-08-31: a brief scales with the minutes the user actually
// has, and the rotation is held to a ledger rather than to the model's taste.

describe("sizing the session to the minutes", () => {
	it("is an hour when nobody has said, and says which of the two it is", () => {
		const hour = sessionSizing(null, false);
		expect(hour.minutes).toBe(DEFAULT_SESSION_MINUTES);
		expect(hour.stated).toBe(false);
		expect(hour.text).toContain("nobody has said");
		// Five or six movements is what the prompt has always asked for, so the default
		// changes nobody's brief.
		expect(hour.target_exercises).toBeGreaterThanOrEqual(5);
		expect(hour.target_exercises).toBeLessThanOrEqual(6);
	});

	it("shrinks the list as the minutes shrink, and never below two movements", () => {
		expect(sessionSizing(90, true).target_exercises).toBeGreaterThan(sessionSizing(60, true).target_exercises);
		expect(sessionSizing(60, true).target_exercises).toBeGreaterThan(sessionSizing(30, true).target_exercises);
		expect(sessionSizing(45, true).target_exercises).toBeGreaterThan(sessionSizing(25, true).target_exercises);
		// The floor: below about half an hour there are two movements and no arguing.
		expect(sessionSizing(25, true).target_exercises).toBe(2);
		expect(sessionSizing(10, true).target_exercises).toBe(2);
	});

	it("caps one over the ask, so a sixth movement with a reason is not refused", () => {
		for (const minutes of [15, 25, 40, 60, 90, 120]) {
			const sizing = sessionSizing(minutes, true);
			expect(sizing.max_exercises).toBe(sizing.target_exercises + 1);
			expect(sizing.max_exercises).toBeLessThanOrEqual(10);
		}
	});

	it("scales the finisher too, and always leaves at least two items", () => {
		expect(sessionSizing(20, true).finisher_items).toBe(2);
		expect(sessionSizing(35, true).finisher_items).toBe(3);
		expect(sessionSizing(60, true).finisher_items).toBe(4);
	});

	it("holds an absurd number to something a body can do", () => {
		expect(sessionSizing(5, true).minutes).toBe(10);
		expect(sessionSizing(600, true).minutes).toBe(240);
		expect(sessionSizing(600, true).target_exercises).toBeLessThanOrEqual(8);
	});

	it("reaches the prompt through buildRules, and says the user said so when they did", () => {
		const features = computeFeatures({ facts: facts({ activities: [lift(daysAgo(2))] }) });
		const said = buildRules({ features, goals: [], sessionMinutes: 30 });
		expect(said.sizing).toMatchObject({ minutes: 30, stated: true });
		expect(said.statements.join("\n")).toContain("SESSION LENGTH: 30 minutes (the user said so)");

		const unsaid = buildRules({ features, goals: [] });
		expect(unsaid.sizing.minutes).toBe(DEFAULT_SESSION_MINUTES);
		expect(unsaid.sizing.stated).toBe(false);
	});
});

describe("the coverage rule", () => {
	const ledger = (entries: Partial<Parameters<typeof coverageRule>[0][number]>[]) =>
		entries.map((entry) => ({
			key: entry.key ?? "core",
			label: entry.label ?? "core",
			days_since: entry.days_since ?? null,
			last_date: entry.last_date ?? null,
			sets_7d: entry.sets_7d ?? 0,
			sets_14d: entry.sets_14d ?? 0,
			sets_28d: entry.sets_28d ?? 0,
			unit: entry.unit ?? ("sets" as const),
			overdue: entry.overdue ?? true,
			debt_days: entry.debt_days ?? 29,
		}));

	it("names each debt with its number and demands the largest be retired", () => {
		const text = coverageRule(
			ledger([
				{ key: "core", label: "core", days_since: 21, overdue: true },
				{ key: "calves", label: "calves", days_since: null, overdue: true },
			]),
			[]
		);
		expect(text).toContain("core: 21 days unserved");
		expect(text).toContain("calves: never served in four weeks");
		expect(text).toContain("RETIRE THE LARGEST DEBTS");
	});

	it("says so plainly when nothing is owed, rather than inventing an obligation", () => {
		const text = coverageRule(
			ledger([{ key: "core", label: "core", days_since: 2, overdue: false, debt_days: 2 }]),
			[]
		);
		expect(text).toContain("nothing is overdue");
		expect(text).not.toContain("RETIRE");
	});

	it("keeps a debt from overruling the 48-hour rule", () => {
		const text = coverageRule(ledger([{ key: "quads", label: "quads", days_since: 20 }]), ["chest", "triceps"]);
		expect(text).toContain("chest, triceps");
		expect(text).toContain("still recovering");
	});

	it("says nothing at all with no ledger to read", () => {
		expect(coverageRule([], [])).toBeNull();
	});
});

describe("variety and the one introduction", () => {
	it("offers the candidates it was given, and only those", () => {
		const text = varietyRule(["Hanging Leg Raise", "Face Pull"]);
		expect(text).toContain("AT MOST ONE");
		expect(text).toContain("Hanging Leg Raise, Face Pull");
		expect(text).toContain("and from nowhere else");
	});

	it("asks for no introduction at all when there is nothing left to introduce", () => {
		const text = varietyRule([]);
		expect(text).toContain("introduce nothing");
		expect(text).not.toContain("AT MOST ONE");
	});

	it("always asks for bodyweight work in the rotation and a finisher on a training day", () => {
		const text = varietyRule(["Push-Up"]);
		expect(text.toLowerCase()).toContain("bodyweight");
		expect(text.toLowerCase()).toContain("rest day has no finisher");
	});
});

// ── Never a retroactive rest verdict ─────────────────────────────────────────────────

describe("a brief asked for after the session has already happened", () => {
	it("tells the model to build around what was done, and never to call it rest", () => {
		const rule = gapRule(0);
		expect(rule.level).toBe("fresh");
		expect(rule.text).toContain("COMPLEMENT");
		expect(rule.text).toContain('MUST NOT be "rest"');
		expect(rule.text).toContain("MUST NOT be empty");
		expect(rule.text.toLowerCase()).not.toMatch(/consider mobility, cardio or rest/);
	});

	/**
	 * The prompt says it twice and the live model still answered "rest" with an empty list
	 * for a user who had logged four sets of pulldowns that morning. So it is enforced in
	 * code as well as asked for.
	 */
	const restBrief = (exercises: unknown[]) => ({ workout: { type: "rest", targets: [], exercises } });

	it("relabels a rest day that has a complement in it, rather than losing the complement", () => {
		const answer = resolveRestAfterTraining(restBrief([{ name: "Lat Stretch" }]), { trainedToday: true });
		expect(answer.workout.type).toBe("mixed");
		expect(answer.workout.exercises).toHaveLength(1);
	});

	it("throws on a rest verdict with nothing in it, so the caller asks again", () => {
		expect(() => resolveRestAfterTraining(restBrief([]), { trainedToday: true })).toThrow(UnusableBriefError);
	});

	it("leaves a genuinely planned rest day alone", () => {
		const planned = resolveRestAfterTraining(restBrief([]), { trainedToday: false });
		expect(planned.workout.type).toBe("rest");
		expect(assertUsableBrief(planned)).toBeTruthy();
	});

	it("touches nothing on a training day, trained or not", () => {
		const strength = { workout: { type: "strength", targets: [], exercises: [{ name: "Bench Press" }] } };
		expect(resolveRestAfterTraining(strength, { trainedToday: true })).toBe(strength);
		expect(resolveRestAfterTraining(strength, { trainedToday: false })).toBe(strength);
	});
});

// ── The revision's mode ──────────────────────────────────────────────────────────────

describe("the revision schema", () => {
	const brief = {
		headline: "Pull day",
		why: "Back is five days out.",
		workout: {
			type: "strength",
			targets: ["back"],
			exercises: [{ name: "Lat Pulldown", load_lb: 110, sets: 3, reps: 10, minutes: null, note: null, is_new: false }],
			finisher: [],
		},
		nutrition: { kcal: 2250, protein_g: 160, carbs_max_g: 250, ideas: [], why: "Steady." },
		nudge: "Weigh in tomorrow.",
	};

	it("will not parse a revision that forgot to say which kind it is", () => {
		expect(CoachRevisionSchema.safeParse(brief).success).toBe(false);
		expect(CoachRevisionSchema.safeParse({ ...brief, revision_mode: "merge" }).success).toBe(false);
		expect(CoachRevisionSchema.parse({ ...brief, revision_mode: "append" }).revision_mode).toBe("append");
	});

	it("refuses an append that adds nothing, and a rewrite with an empty training day", () => {
		const empty = { ...brief, workout: { ...brief.workout, exercises: [] } };
		expect(() => assertUsableRevision({ ...empty, revision_mode: "append" } as never)).toThrow(UnusableBriefError);
		expect(() => assertUsableRevision({ ...empty, revision_mode: "rewrite" } as never)).toThrow(UnusableBriefError);
		// A rest day is still the one answer allowed to be empty.
		const rest = { ...empty, workout: { ...empty.workout, type: "rest" }, revision_mode: "rewrite" as const };
		expect(assertUsableRevision(rest as never)).toBeTruthy();
		// An append that adds something is fine even onto a rest day.
		expect(assertUsableRevision({ ...brief, revision_mode: "append" } as never)).toBeTruthy();
	});
});
