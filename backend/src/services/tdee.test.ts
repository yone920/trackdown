import { describe, expect, it } from "vitest";
import {
	bmiFromInputs,
	buildRecommendation,
	computeDayTargets,
	computeExclusions,
	computeTdee,
	type TdeeProfile,
} from "./tdee.js";

// The port has to agree with the app, digit for digit — the whole point of moving the
// maths here is that there is one number, not two. The expectations below are the app's
// own outputs: produced by running `lib/tdee.ts` and `lib/recommendations.ts` (the shipped
// code, unmodified) over these four profiles with tsx, and pasted in. They are frozen
// values, so a change to a constant on either side shows up as a failure here rather than
// as a target that quietly drifts between the phone and the server.
//
// The app ages the user against `new Date().getFullYear()`; this port takes the day being
// computed. `today` below is a 2026 date, which is the year the goldens were produced in.

const TODAY = new Date("2026-06-15T12:00:00Z");

describe("computeTdee — the app's numbers", () => {
	it("matches lib/tdee.ts on a 38-year-old male, moderate activity", () => {
		expect(
			computeTdee({
				sex: "male",
				birthYear: 1988,
				heightCm: 180,
				weightLb: 195,
				activityLevel: "moderate",
				today: TODAY,
			})
		).toMatchObject({ age: 38, bmr: 1825, tdee: 2828, multiplier: 1.55 });
	});

	it("matches on a 31-year-old female, light activity", () => {
		expect(
			computeTdee({
				sex: "female",
				birthYear: 1995,
				heightCm: 165,
				weightLb: 150,
				activityLevel: "light",
				today: TODAY,
			})
		).toMatchObject({ age: 31, bmr: 1396, tdee: 1919 });
	});

	it("ages against the day being computed, not the server's clock", () => {
		const inputs = { sex: "male", birthYear: 2000, heightCm: 180, weightLb: 180, activityLevel: "light" } as const;
		const then = computeTdee({ ...inputs, today: new Date("2026-01-01T00:00:00Z") });
		const later = computeTdee({ ...inputs, today: new Date("2030-01-01T00:00:00Z") });
		expect(then.age).toBe(26);
		expect(later.age).toBe(30);
		expect(later.bmr).toBeLessThan(then.bmr);
	});
});

describe("buildRecommendation — the app's numbers", () => {
	it("matches lib/recommendations.ts on the standard-pace male", () => {
		const rec = buildRecommendation({
			sex: "male",
			birthYear: 1988,
			heightCm: 180,
			weightLb: 195,
			activityLevel: "moderate",
			goalPace: "standard",
			goalWeightLb: 170,
			pregnantOrLactating: false,
			healthConcern: false,
			today: TODAY,
		});
		expect(rec.mode).toBe("recommendations");
		if (rec.mode !== "recommendations") return;
		expect(rec).toMatchObject({
			dailyCalories: 2262,
			dailyDeficit: 566,
			safeFloor: 1500,
			projectedWeeklyLossLb: 1.13,
			weeksToGoal: 23,
			flags: [],
		});
		expect(rec.macros).toEqual({ protein_g: 159, fat_g: 63, carbs_g: 265, fiber_g: 32 });
		expect(rec.bmi).toBeCloseTo(27.3, 1);
	});

	it("matches on the gentle-pace female", () => {
		const rec = buildRecommendation({
			sex: "female",
			birthYear: 1995,
			heightCm: 165,
			weightLb: 150,
			activityLevel: "light",
			goalPace: "gentle",
			goalWeightLb: 135,
			pregnantOrLactating: false,
			healthConcern: false,
			today: TODAY,
		});
		if (rec.mode !== "recommendations") throw new Error("expected recommendations");
		expect(rec).toMatchObject({ dailyCalories: 1631, dailyDeficit: 288, safeFloor: 1200, weeksToGoal: 26 });
		expect(rec.macros).toEqual({ protein_g: 122, fat_g: 45, carbs_g: 185, fiber_g: 23 });
	});

	it("matches on the 66-year-old, where the safe floor binds and protein drops to 1.4 g/kg", () => {
		const rec = buildRecommendation({
			sex: "male",
			birthYear: 1960,
			heightCm: 172,
			weightLb: 210,
			activityLevel: "sedentary",
			goalPace: "aggressive",
			goalWeightLb: 180,
			pregnantOrLactating: false,
			healthConcern: false,
			today: TODAY,
		});
		if (rec.mode !== "recommendations") throw new Error("expected recommendations");
		expect(rec).toMatchObject({ dailyCalories: 1532, dailyDeficit: 511, safeFloor: 1500 });
		expect(rec.macros).toEqual({ protein_g: 133, fat_g: 48, carbs_g: 142, fiber_g: 21 });
	});

	it("tracks without prescribing for an underweight user", () => {
		const rec = buildRecommendation({
			sex: "female",
			birthYear: 2000,
			heightCm: 170,
			weightLb: 118,
			activityLevel: "active",
			goalPace: "standard",
			goalWeightLb: 110,
			pregnantOrLactating: false,
			healthConcern: false,
			today: TODAY,
		});
		// BMI 18.52 is over the 18.5 threshold, so the app still recommends here — the
		// golden confirms the boundary is where the app put it.
		if (rec.mode !== "recommendations") throw new Error("expected recommendations");
		expect(rec.dailyCalories).toBe(1803);

		const underweight = buildRecommendation({
			sex: "female",
			birthYear: 2000,
			heightCm: 170,
			weightLb: 112,
			activityLevel: "active",
			goalPace: "standard",
			goalWeightLb: 110,
			pregnantOrLactating: false,
			healthConcern: false,
			today: TODAY,
		});
		expect(underweight.mode).toBe("tracking_only");
		if (underweight.mode !== "tracking_only") return;
		expect(underweight.reasons).toEqual(["underweight"]);
		expect(underweight.maintenanceCalories).toBe(underweight.tdee.tdee);
	});

	it("excludes on age, pregnancy and a stated health concern", () => {
		expect(
			computeExclusions({ age: 16, bmi: 22, pregnantOrLactating: true, healthConcern: true })
		).toEqual(["under_18", "pregnant_or_lactating", "health_concern"]);
		expect(computeExclusions({ age: 30, bmi: 24, pregnantOrLactating: false, healthConcern: false })).toEqual([]);
		expect(bmiFromInputs(195, 180)).toBeCloseTo(27.3, 1);
	});
});

describe("computeDayTargets", () => {
	const full: TdeeProfile = {
		sex: "male",
		birth_year: 1988,
		height_cm: 180,
		activity_level: "moderate",
		goal_pace: "standard",
		goal_weight_lb: 170,
		pregnant_or_lactating: false,
		health_concern: false,
		daily_calorie_target: 2100,
		protein_g: null,
		carbs_max_g: null,
	};

	it("computes the target from the day's weight, not the profile's stated number", () => {
		const targets = computeDayTargets(full, 195, TODAY);
		expect(targets).toMatchObject({ tdee: 2828, target: 2262, deficit: -566, source: "computed" });
		expect(targets.macros).toMatchObject({ protein_g: 159 });
	});

	it("moves with the body it is computed for", () => {
		const heavier = computeDayTargets(full, 210, TODAY).target as number;
		const lighter = computeDayTargets(full, 180, TODAY).target as number;
		expect(heavier).toBeGreaterThan(lighter);
	});

	it("lets a stated protein or carb ceiling win over the computed one", () => {
		const targets = computeDayTargets({ ...full, protein_g: 200, carbs_max_g: 100 }, 195, TODAY);
		expect(targets.macros).toMatchObject({ protein_g: 200, carbs_g: 100, fat_g: 63 });
	});

	it("falls back to the profile's stated target when the TDEE inputs are incomplete", () => {
		expect(computeDayTargets({ ...full, height_cm: null }, 195, TODAY)).toMatchObject({
			tdee: null,
			target: 2100,
			source: "stated",
		});
		// No weight is the common case on a brand-new account.
		expect(computeDayTargets(full, null, TODAY)).toMatchObject({ target: 2100, source: "stated" });
	});

	it("has no target at all rather than an invented one", () => {
		expect(computeDayTargets({ ...full, height_cm: null, daily_calorie_target: null }, 195, TODAY)).toMatchObject({
			target: null,
			source: "none",
		});
		expect(computeDayTargets(null, 195, TODAY).source).toBe("none");
	});

	it("marks an excluded profile as tracking-only, at maintenance", () => {
		const targets = computeDayTargets({ ...full, health_concern: true }, 195, TODAY);
		expect(targets).toMatchObject({ trackingOnly: true, target: 2828, deficit: 0 });
	});
});
