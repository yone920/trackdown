import { z } from "zod";
import { describe, expect, it } from "vitest";
import { activity, daysAgo, facts, meal, TODAY, weight } from "../../test/fixtures/facts.js";
import { computeFeatures, type CoachFeatures } from "./features.js";
import {
	buildRules,
	cardioRule,
	gapRule,
	prescribeLoads,
	recoveryRule,
	selectNudge,
	stepFor,
	targetScheme,
	type CoachGoal,
	type Prescription,
} from "./rules.js";
import { CoachBriefSchema } from "./schema.js";

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
		// 120 min short, but the last session was 30 min: +10 % is 35, and that is the cap.
		expect(rule.minutes_today).toBe(35);
		expect(rule.text).toContain("120 short");
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
				exercises: [{ name: "Lat Pulldown", load_lb: 110, sets: 3, reps: 10, minutes: null, note: null }],
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
