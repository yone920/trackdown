// The calorie maths, moved server-side (docs/build-plan.md §WP3).
//
// This is a port of the app's `lib/tdee.ts` and `lib/recommendations.ts` — same formulas,
// same constants, same rounding, verified against the app's own outputs in tdee.test.ts.
// It lives here now because the *day* is computed on the server from WP3 on: target,
// allowance and status have to be one number that the Today screen, the closed day, the
// week and the coach all agree on, and two implementations of "what should I eat today"
// is how they stop agreeing. The app keeps its copy until WP6 rewires it to read these.
//
// The one deliberate difference: `computeTdee` takes the date to age against. The app read
// `new Date().getFullYear()` at the call site, which is fine in a UI and wrong in a server
// that recomputes a day in March for a birthday in December — and untestable either way.
//
// Sources (unchanged from the app; see lib/recommendations.ts for the full citations):
// NHLBI 1998 · AND/Frankenfield 2005 (Mifflin-St Jeor) · ISSN 2017 (% deficit, 1 %/wk cap,
// protein) · National Academies DRIs (AMDR, fibre) · WHO/FAO/UNU 2004 (PAL multipliers).
// Not medical advice: `computeExclusions` runs before any deficit is recommended.

export type Sex = "male" | "female";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type GoalPace = "gentle" | "standard" | "aggressive";

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
	sedentary: 1.2,
	light: 1.375,
	moderate: 1.55,
	active: 1.725,
	very_active: 1.9,
};

const DEFICIT_PCT: Record<GoalPace, number> = {
	gentle: 0.15,
	standard: 0.2,
	aggressive: 0.25,
};

export const LB_TO_KG = 0.45359237;
const KG_PER_LB = LB_TO_KG;
/** kcal per kg of body fat — short-horizon approximation only (Wishnofsky 1958). */
const KCAL_PER_KG_FAT = 7700;

/** Hard intake floors, NHLBI 1998 low-calorie-diet threshold. */
const FLOOR_KCAL: Record<Sex, number> = { male: 1500, female: 1200 };
/** Never below 80 % of BMR for sustained periods (AND adult weight management). */
const BMR_FLOOR_FRACTION = 0.8;

export interface TdeeInputs {
	sex: Sex;
	birthYear: number;
	heightCm: number;
	weightLb: number;
	activityLevel: ActivityLevel;
	/** The day being computed; ages the user against its year. Defaults to now. */
	today?: Date;
}

export interface TdeeResult {
	age: number;
	weightKg: number;
	/** Basal metabolic rate, kcal/day. */
	bmr: number;
	/** BMR × activity multiplier, kcal/day. */
	tdee: number;
	multiplier: number;
}

/** Mifflin-St Jeor — the BMR equation the AND guideline prefers. */
export function computeTdee(inputs: TdeeInputs): TdeeResult {
	const age = (inputs.today ?? new Date()).getUTCFullYear() - inputs.birthYear;
	const weightKg = inputs.weightLb * LB_TO_KG;
	const sexOffset = inputs.sex === "male" ? 5 : -161;
	const bmr = 10 * weightKg + 6.25 * inputs.heightCm - 5 * age + sexOffset;
	const multiplier = ACTIVITY_MULTIPLIERS[inputs.activityLevel];
	return { age, weightKg, bmr: Math.round(bmr), tdee: Math.round(bmr * multiplier), multiplier };
}

export function bmiFromInputs(weightLb: number, heightCm: number): number {
	const kg = weightLb * KG_PER_LB;
	const m = heightCm / 100;
	return kg / (m * m);
}

export type ExclusionReason = "under_18" | "underweight" | "pregnant_or_lactating" | "health_concern";

export interface ExclusionInputs {
	age: number;
	bmi: number;
	pregnantOrLactating: boolean;
	healthConcern: boolean;
}

/** Why this user must NOT be given a deficit. Empty = recommendations are appropriate. */
export function computeExclusions(input: ExclusionInputs): ExclusionReason[] {
	const reasons: ExclusionReason[] = [];
	if (input.age < 18) reasons.push("under_18");
	if (input.bmi < 18.5) reasons.push("underweight");
	if (input.pregnantOrLactating) reasons.push("pregnant_or_lactating");
	if (input.healthConcern) reasons.push("health_concern");
	return reasons;
}

export interface Macros {
	protein_g: number;
	fat_g: number;
	carbs_g: number;
	fiber_g: number;
}

export type RecFlag =
	| { kind: "floor_capped"; floor: number; uncappedTarget: number }
	| { kind: "pace_capped_by_weekly_loss"; cappedTarget: number; uncappedTarget: number }
	| { kind: "low_carb_warning"; carbsG: number };

export interface RecommendationInputs {
	sex: Sex;
	birthYear: number;
	heightCm: number;
	weightLb: number;
	activityLevel: ActivityLevel;
	goalPace: GoalPace;
	goalWeightLb: number | null;
	pregnantOrLactating: boolean;
	healthConcern: boolean;
	today?: Date;
}

export type Recommendation =
	| {
			mode: "recommendations";
			tdee: TdeeResult;
			bmi: number;
			dailyCalories: number;
			dailyDeficit: number;
			/** max(1200 ♀ / 1500 ♂, 0.8 × BMR) — eating below this is unsafe. */
			safeFloor: number;
			goalPace: GoalPace;
			macros: Macros;
			projectedWeeklyLossLb: number | null;
			weeksToGoal: number | null;
			flags: RecFlag[];
	  }
	| {
			mode: "tracking_only";
			tdee: TdeeResult;
			bmi: number;
			reasons: ExclusionReason[];
			maintenanceCalories: number;
			safeFloor: number;
			macros: Macros;
	  };

export function buildRecommendation(input: RecommendationInputs): Recommendation {
	const tdee = computeTdee({
		sex: input.sex,
		birthYear: input.birthYear,
		heightCm: input.heightCm,
		weightLb: input.weightLb,
		activityLevel: input.activityLevel,
		...(input.today ? { today: input.today } : {}),
	});
	const bmi = bmiFromInputs(input.weightLb, input.heightCm);
	const exclusions = computeExclusions({
		age: tdee.age,
		bmi,
		pregnantOrLactating: input.pregnantOrLactating,
		healthConcern: input.healthConcern,
	});

	const safeFloor = Math.max(FLOOR_KCAL[input.sex], Math.round(BMR_FLOOR_FRACTION * tdee.bmr));

	if (exclusions.length > 0) {
		// Tracking only: maintenance calories and balanced macros, no deficit.
		const { macros } = computeMacros({
			dailyCalories: tdee.tdee,
			weightKg: tdee.weightKg,
			ageYears: tdee.age,
			pace: "gentle",
		});
		return {
			mode: "tracking_only",
			tdee,
			bmi,
			reasons: exclusions,
			maintenanceCalories: tdee.tdee,
			safeFloor,
			macros,
		};
	}

	const flags: RecFlag[] = [];

	// Deficit as a percentage of TDEE (ISSN 2017).
	let target = Math.round(tdee.tdee * (1 - DEFICIT_PCT[input.goalPace]));
	const uncappedDeficitTarget = target;

	// Cap weekly loss at 1 % of body weight (ISSN 2017).
	const maxDailyDeficit = (0.01 * tdee.weightKg * KCAL_PER_KG_FAT) / 7;
	if (tdee.tdee - target > maxDailyDeficit) {
		target = Math.round(tdee.tdee - maxDailyDeficit);
		flags.push({ kind: "pace_capped_by_weekly_loss", cappedTarget: target, uncappedTarget: uncappedDeficitTarget });
	}

	// Intake floor (NHLBI 1998 + 0.8 × BMR).
	let dailyCalories = target;
	if (dailyCalories < safeFloor) {
		flags.push({ kind: "floor_capped", floor: safeFloor, uncappedTarget: target });
		dailyCalories = safeFloor;
	}

	const macroResult = computeMacros({
		dailyCalories,
		weightKg: tdee.weightKg,
		ageYears: tdee.age,
		pace: input.goalPace,
	});
	if (macroResult.lowCarbWarning) flags.push({ kind: "low_carb_warning", carbsG: macroResult.macros.carbs_g });

	// Short-horizon projection only; the dynamic model (Hall 2011) is the honest one past
	// eight weeks, and the note the app shows says so.
	const dailyDeficit = tdee.tdee - dailyCalories;
	const weeklyLossKg = (dailyDeficit * 7) / KCAL_PER_KG_FAT;
	const projectedWeeklyLossLb = weeklyLossKg > 0 ? Number((weeklyLossKg / KG_PER_LB).toFixed(2)) : null;

	let weeksToGoal: number | null = null;
	if (input.goalWeightLb && input.goalWeightLb < input.weightLb && projectedWeeklyLossLb) {
		weeksToGoal = Math.ceil((input.weightLb - input.goalWeightLb) / projectedWeeklyLossLb);
	}

	return {
		mode: "recommendations",
		tdee,
		bmi,
		dailyCalories,
		dailyDeficit,
		safeFloor,
		goalPace: input.goalPace,
		macros: macroResult.macros,
		projectedWeeklyLossLb,
		weeksToGoal,
		flags,
	};
}

interface MacroComputation {
	macros: Macros;
	lowCarbWarning: boolean;
}

function computeMacros({
	dailyCalories,
	weightKg,
	ageYears,
	pace,
}: {
	dailyCalories: number;
	weightKg: number;
	ageYears: number;
	pace: GoalPace;
}): MacroComputation {
	// Protein — ISSN 2017 + Helms 2014; older adults per PROT-AGE / ESPEN.
	const proteinPerKg = ageYears >= 65 ? 1.4 : pace === "aggressive" ? 2.2 : 1.8;
	const protein_g = Math.round(proteinPerKg * weightKg);

	// Fat — AMDR midpoint 25 %, with an essential-fat floor of ~0.5 g/kg.
	let fat_g = Math.round((dailyCalories * 0.25) / 9);
	const essentialFatFloor = Math.round(0.5 * weightKg);
	if (fat_g < essentialFatFloor) fat_g = essentialFatFloor;

	// Carbs — whatever calories are left after protein and fat.
	const carbs_g = Math.round(Math.max(0, dailyCalories - protein_g * 4 - fat_g * 9) / 4);

	// Fibre — DRI, 14 g per 1,000 kcal.
	const fiber_g = Math.round((14 * dailyCalories) / 1000);

	return { macros: { protein_g, fat_g, carbs_g, fiber_g }, lowCarbWarning: carbs_g < 50 };
}

// ---------------------------------------------------------------------------
// The profile → targets bridge. What services/day.ts actually calls.
// ---------------------------------------------------------------------------

/** The columns of `profiles` the calorie model reads. All nullable — the plan is optional. */
export interface TdeeProfile {
	sex: Sex | null;
	birth_year: number | null;
	height_cm: number | null;
	activity_level: ActivityLevel | null;
	goal_pace: GoalPace | null;
	goal_weight_lb: number | null;
	pregnant_or_lactating: boolean | null;
	health_concern: boolean | null;
	/** The v1 hand-set target; the fallback when the TDEE inputs are incomplete. */
	daily_calorie_target: number | null;
	/** Stated macro targets beat the computed ones — the user said these out loud. */
	protein_g: number | null;
	carbs_max_g: number | null;
}

export interface DayTargets {
	/** Maintenance calories, or null when the profile cannot produce them. */
	tdee: number | null;
	/** What to eat today: TDEE − the goal pace's deficit, floored. Never null once we have either a TDEE or a stated target. */
	target: number | null;
	/** target − TDEE, negative for a deficit. null without a TDEE. */
	deficit: number | null;
	safeFloor: number | null;
	macros: Macros | null;
	/** Where `target` came from, so the UI can say "your target" vs "your plan's". */
	source: "computed" | "stated" | "none";
	/** Set when the profile excludes the user from deficit advice (concept-v2: track, don't prescribe). */
	trackingOnly: boolean;
}

/**
 * Today's calorie and macro targets for one user.
 *
 * `weightLb` is the day's best known body weight (the day's weigh-in, else the most recent
 * one before it): the target moves with the body it is computed for. Without a weight —
 * or without sex/height/birth year/activity — there is no TDEE, and the profile's stated
 * `daily_calorie_target` is used instead. With neither, the day simply has no target and
 * its status is `none`; a made-up target would be judged against, which is worse.
 */
export function computeDayTargets(
	profile: TdeeProfile | null,
	weightLb: number | null,
	today: Date
): DayTargets {
	const none: DayTargets = {
		tdee: null,
		target: null,
		deficit: null,
		safeFloor: null,
		macros: null,
		source: "none",
		trackingOnly: false,
	};
	if (!profile) return none;

	const stated = profile.daily_calorie_target ?? null;
	const complete =
		profile.sex != null &&
		profile.birth_year != null &&
		profile.height_cm != null &&
		profile.activity_level != null &&
		weightLb != null;

	if (!complete) {
		return stated == null
			? none
			: { ...none, target: stated, source: "stated", macros: statedMacros(profile, stated) };
	}

	const rec = buildRecommendation({
		sex: profile.sex as Sex,
		birthYear: profile.birth_year as number,
		heightCm: profile.height_cm as number,
		weightLb: weightLb as number,
		activityLevel: profile.activity_level as ActivityLevel,
		goalPace: profile.goal_pace ?? "standard",
		goalWeightLb: profile.goal_weight_lb,
		pregnantOrLactating: profile.pregnant_or_lactating ?? false,
		healthConcern: profile.health_concern ?? false,
		today,
	});

	const target = rec.mode === "recommendations" ? rec.dailyCalories : rec.maintenanceCalories;
	return {
		tdee: rec.tdee.tdee,
		target,
		deficit: target - rec.tdee.tdee,
		safeFloor: rec.safeFloor,
		macros: overrideMacros(profile, rec.macros),
		source: "computed",
		trackingOnly: rec.mode === "tracking_only",
	};
}

/** A stated protein or carb ceiling wins; the rest of the computed macros stay. */
function overrideMacros(profile: TdeeProfile, macros: Macros): Macros {
	return {
		...macros,
		protein_g: profile.protein_g ?? macros.protein_g,
		carbs_g: profile.carbs_max_g ?? macros.carbs_g,
	};
}

/** Without a TDEE there is nothing to derive macros from — only what the user stated. */
function statedMacros(profile: TdeeProfile, target: number): Macros | null {
	if (profile.protein_g == null && profile.carbs_max_g == null) return null;
	return {
		protein_g: profile.protein_g ?? 0,
		carbs_g: profile.carbs_max_g ?? 0,
		fat_g: 0,
		fiber_g: Math.round((14 * target) / 1000),
	};
}
