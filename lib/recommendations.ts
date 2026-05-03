// Evidence-based weight-loss recommendations.
//
// Sources:
//   - NHLBI Clinical Guidelines on the Identification, Evaluation, and Treatment
//     of Overweight and Obesity in Adults (1998); reaffirmed by AHA/ACC/TOS 2013.
//   - Academy of Nutrition and Dietetics Adult Weight Management Evidence-Based
//     Nutrition Practice Guideline; Frankenfield et al., J Am Diet Assoc 2005
//     (Mifflin-St Jeor as preferred RMR equation).
//   - ISSN Position Stand: Diets and Body Composition (Aragon et al., 2017,
//     J Int Soc Sports Nutr) — % deficit framing, 1%/wk cap, protein guidance.
//   - National Academies DRIs for Macronutrients (2005), reaffirmed in USDA
//     Dietary Guidelines for Americans 2020-2025 — AMDR ranges, fiber AI.
//   - WHO/FAO/UNU Human Energy Requirements (2004) — PAL multipliers.
//   - Hall et al., Lancet 2011; Thomas et al., Am J Clin Nutr 2014 — replaces
//     the static 3,500 kcal/lb rule with dynamic models. We use 7,700 kcal/kg
//     only for short-horizon (≤8 wk) projections, with caveat surfaced to user.
//
// This module is NOT medical advice. The exclusion check (computeExclusion)
// must run BEFORE any recommendations are returned to a user.

import {
  ACTIVITY_LABELS,
  computeTdee,
  type ActivityLevel,
  type Sex,
  type TdeeResult,
} from './tdee';

export type GoalPace = 'gentle' | 'standard' | 'aggressive';

export const GOAL_PACE_LABELS: Record<GoalPace, string> = {
  gentle: 'Gentle — 15% deficit, ~0.5 lb / wk',
  standard: 'Standard — 20% deficit, ~1 lb / wk',
  aggressive: 'Aggressive — 25% deficit, up to 1% body weight / wk',
};

const DEFICIT_PCT: Record<GoalPace, number> = {
  gentle: 0.15,
  standard: 0.2,
  aggressive: 0.25,
};

// kcal per kg of body fat — short-horizon approximation only (Wishnofsky 1958).
// For long-horizon projections, prefer the NIH dynamic Hall model.
const KCAL_PER_KG_FAT = 7700;
const KG_PER_LB = 0.45359237;

// Hard intake floors per NHLBI 1998 LCD threshold. These are clinical
// heuristics, NOT RCT-derived — flagged in the algorithm where they bind.
const FLOOR_KCAL: Record<Sex, number> = { male: 1500, female: 1200 };

// Physiologic floor: never below 80% of BMR for sustained periods (per AND
// Adult Weight Management guidance; avoids significant adaptive thermogenesis
// and micronutrient inadequacy).
const BMR_FLOOR_FRACTION = 0.8;

export type ExclusionReason =
  | 'under_18'
  | 'underweight'
  | 'pregnant_or_lactating'
  | 'health_concern';

export type ExclusionInputs = {
  age: number;
  bmi: number;
  pregnantOrLactating: boolean;
  healthConcern: boolean;
};

// Returns the list of reasons this user should NOT get deficit recommendations.
// Empty list = recommendations are appropriate (still display disclaimer).
export function computeExclusions(input: ExclusionInputs): ExclusionReason[] {
  const reasons: ExclusionReason[] = [];
  if (input.age < 18) reasons.push('under_18');
  if (input.bmi < 18.5) reasons.push('underweight');
  if (input.pregnantOrLactating) reasons.push('pregnant_or_lactating');
  if (input.healthConcern) reasons.push('health_concern');
  return reasons;
}

export const EXCLUSION_MESSAGES: Record<ExclusionReason, string> = {
  under_18:
    'Trackdown does not recommend weight-loss targets for people under 18. Pediatric weight management requires specialist guidance (American Academy of Pediatrics).',
  underweight:
    'Your BMI is in the underweight range (<18.5). Weight loss is not indicated; please consult a clinician.',
  pregnant_or_lactating:
    'Caloric deficits are contraindicated during pregnancy and may compromise milk supply during lactation. Trackdown will track without recommending a deficit.',
  health_concern:
    'You indicated a medical condition or history of disordered eating. Trackdown will track without recommending a deficit. Please work with your physician or registered dietitian.',
};

export type RecommendationInputs = {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightLb: number;
  activityLevel: ActivityLevel;
  goalPace: GoalPace;
  goalWeightLb: number | null;
  pregnantOrLactating: boolean;
  healthConcern: boolean;
};

export type Macros = {
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  fiber_g: number;
};

export type Recommendation =
  | {
      mode: 'recommendations';
      tdee: TdeeResult;
      bmi: number;
      dailyCalories: number;
      dailyDeficit: number;
      // Lower bound on intake that is safe without medical supervision.
      // = max(1200 ♀ / 1500 ♂, 0.8 × BMR). Eating below this is unsafe.
      safeFloor: number;
      goalPace: GoalPace;
      macros: Macros;
      projectedWeeklyLossLb: number | null;
      weeksToGoal: number | null;
      flags: RecFlag[];
    }
  | {
      mode: 'tracking_only';
      tdee: TdeeResult;
      bmi: number;
      reasons: ExclusionReason[];
      // Even in tracking-only mode we still expose maintenance calories and
      // sensible macro defaults so the app has *something* to show.
      maintenanceCalories: number;
      safeFloor: number;
      macros: Macros;
    };

export type RecFlag =
  | { kind: 'floor_capped'; floor: number; uncappedTarget: number }
  | { kind: 'pace_capped_by_weekly_loss'; cappedTarget: number; uncappedTarget: number }
  | { kind: 'low_carb_warning'; carbsG: number };

export function bmiFromInputs(weightLb: number, heightCm: number): number {
  const kg = weightLb * KG_PER_LB;
  const m = heightCm / 100;
  return kg / (m * m);
}

export function buildRecommendation(input: RecommendationInputs): Recommendation {
  const tdee = computeTdee({
    sex: input.sex,
    birthYear: input.birthYear,
    heightCm: input.heightCm,
    weightLb: input.weightLb,
    activityLevel: input.activityLevel,
  });
  const bmi = bmiFromInputs(input.weightLb, input.heightCm);
  const exclusions = computeExclusions({
    age: tdee.age,
    bmi,
    pregnantOrLactating: input.pregnantOrLactating,
    healthConcern: input.healthConcern,
  });

  const hardFloor = FLOOR_KCAL[input.sex];
  const physioFloor = Math.round(BMR_FLOOR_FRACTION * tdee.bmr);
  const safeFloor = Math.max(hardFloor, physioFloor);

  if (exclusions.length > 0) {
    // Tracking-only: maintenance kcal + balanced macro defaults.
    const macros = computeMacros({
      dailyCalories: tdee.tdee,
      weightKg: tdee.weightKg,
      ageYears: tdee.age,
      pace: 'gentle',
    });
    return {
      mode: 'tracking_only',
      tdee,
      bmi,
      reasons: exclusions,
      maintenanceCalories: tdee.tdee,
      safeFloor,
      macros: macros.macros,
    };
  }

  const flags: RecFlag[] = [];

  // Step 3 — deficit (% of TDEE, ISSN 2017).
  const deficitPct = DEFICIT_PCT[input.goalPace];
  let target = Math.round(tdee.tdee * (1 - deficitPct));
  const uncappedDeficitTarget = target;

  // Cap weekly loss at 1% of body weight (ISSN 2017).
  const weightKg = tdee.weightKg;
  const maxWeeklyLossKg = 0.01 * weightKg;
  const maxDailyDeficit = (maxWeeklyLossKg * KCAL_PER_KG_FAT) / 7;
  const proposedDeficit = tdee.tdee - target;
  if (proposedDeficit > maxDailyDeficit) {
    target = Math.round(tdee.tdee - maxDailyDeficit);
    flags.push({
      kind: 'pace_capped_by_weekly_loss',
      cappedTarget: target,
      uncappedTarget: uncappedDeficitTarget,
    });
  }

  // Step 4 — intake floor (NHLBI 1998 + 0.8 × BMR physiologic floor).
  let dailyCalories = target;
  if (dailyCalories < safeFloor) {
    flags.push({ kind: 'floor_capped', floor: safeFloor, uncappedTarget: target });
    dailyCalories = safeFloor;
  }

  // Steps 5–8 — macros.
  const macroResult = computeMacros({
    dailyCalories,
    weightKg,
    ageYears: tdee.age,
    pace: input.goalPace,
  });
  if (macroResult.lowCarbWarning) {
    flags.push({ kind: 'low_carb_warning', carbsG: macroResult.macros.carbs_g });
  }

  // Step 9 — short-horizon projection (caveat: static model, see Hall 2011).
  const dailyDeficit = tdee.tdee - dailyCalories;
  const weeklyLossKg = (dailyDeficit * 7) / KCAL_PER_KG_FAT;
  const projectedWeeklyLossLb =
    weeklyLossKg > 0 ? Number((weeklyLossKg / KG_PER_LB).toFixed(2)) : null;

  let weeksToGoal: number | null = null;
  if (input.goalWeightLb && input.goalWeightLb < input.weightLb && projectedWeeklyLossLb) {
    const lbsToLose = input.weightLb - input.goalWeightLb;
    weeksToGoal = Math.ceil(lbsToLose / projectedWeeklyLossLb);
  }

  return {
    mode: 'recommendations',
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

type MacroComputation = { macros: Macros; lowCarbWarning: boolean };

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
  // Protein — ISSN 2017 + Helms 2014. Older adults per PROT-AGE / ESPEN.
  const proteinPerKg = ageYears >= 65 ? 1.4 : pace === 'aggressive' ? 2.2 : 1.8;
  const protein_g = Math.round(proteinPerKg * weightKg);
  const proteinKcal = protein_g * 4;

  // Fat — DRI AMDR midpoint 25%, with essential-fat floor (~0.5 g/kg).
  let fat_g = Math.round((dailyCalories * 0.25) / 9);
  const essentialFatFloor = Math.round(0.5 * weightKg);
  if (fat_g < essentialFatFloor) fat_g = essentialFatFloor;
  const fatKcal = fat_g * 9;

  // Carbs — residual; ISSN: fill remaining caloric budget after protein/fat.
  const carbKcal = Math.max(0, dailyCalories - proteinKcal - fatKcal);
  const carbs_g = Math.round(carbKcal / 4);

  // Fiber — National Academies DRI: 14g per 1,000 kcal.
  const fiber_g = Math.round((14 * dailyCalories) / 1000);

  const lowCarbWarning = carbs_g < 50;

  return {
    macros: { protein_g, fat_g, carbs_g, fiber_g },
    lowCarbWarning,
  };
}

// Re-export for UI convenience.
export { ACTIVITY_LABELS };

// ---------------------------------------------------------------------------
// Day-status classifier — used by the Today screen to pick a hero message
// and color based on the user's current intake/net vs their plan.
//
// We compare INTAKE to the safe floor (the dangerous-undereating signal) and
// NET to the planned deficit (the on-plan / aggressive / surplus signal).
// Intake-below-floor takes precedence — that's the actual safety concern.
// ---------------------------------------------------------------------------

export type DaySeverity = 'good' | 'neutral' | 'caution' | 'danger';

export type DayStatus = {
  severity: DaySeverity;
  headline: string;     // short label above the hero number ("Net today")
  subline: string;      // sentence below the hero ("kcal — in deficit, keep going")
  // True when the user's intake is below their safe floor — UI may want to
  // surface this prominently regardless of net.
  belowSafeFloor: boolean;
};

export function classifyDay(args: {
  consumed: number;
  net: number;
  dailyTarget: number;       // recommended intake (after deficit, above floor)
  targetDeficit: number;     // planned daily deficit
  safeFloor: number;
}): DayStatus {
  const { consumed, net, dailyTarget, targetDeficit, safeFloor } = args;
  const belowSafeFloor = consumed > 0 && consumed < safeFloor;

  // Hard danger override: actually eating below the safe floor.
  // We only surface this once the user has logged something — at 0 kcal we
  // assume the day just started and no message is yet warranted.
  if (belowSafeFloor) {
    const short = safeFloor - consumed;
    return {
      severity: 'danger',
      headline: 'Below safe intake',
      subline: `Eat at least ${short.toLocaleString()} more kcal — sustained intake under ${safeFloor.toLocaleString()} kcal isn't safe.`,
      belowSafeFloor: true,
    };
  }

  // Surplus — net positive means no weight-loss progress today.
  if (net > 0) {
    return {
      severity: 'caution',
      headline: 'Net today',
      subline: 'kcal — surplus, move more or eat less to push into deficit.',
      belowSafeFloor: false,
    };
  }

  // Break-even.
  if (net === 0) {
    return {
      severity: 'neutral',
      headline: 'Net today',
      subline: 'kcal — at break-even, push for deficit.',
      belowSafeFloor: false,
    };
  }

  // Deficit. Compare magnitude to planned deficit.
  const ratio = Math.abs(net) / Math.max(targetDeficit, 1);
  if (ratio > 2.5) {
    return {
      severity: 'danger',
      headline: 'Net today',
      subline: `kcal — far past your planned ${targetDeficit.toLocaleString()} deficit. This is undereating territory; please fuel up.`,
      belowSafeFloor: false,
    };
  }
  if (ratio > 1.5) {
    return {
      severity: 'caution',
      headline: 'Net today',
      subline: `kcal — deeper than your planned ${targetDeficit.toLocaleString()} deficit. Make sure you're eating enough.`,
      belowSafeFloor: false,
    };
  }
  return {
    severity: 'good',
    headline: 'Net today',
    subline: 'kcal — in deficit, keep going.',
    belowSafeFloor: false,
  };
}
