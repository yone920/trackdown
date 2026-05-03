export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary — desk job, little walking',
  light: 'Light — occasional walks, light chores',
  moderate: 'Moderate — exercise 3–5x/week',
  active: 'Active — exercise 6–7x/week',
  very_active: 'Very active — hard exercise + physical job',
};

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const LB_TO_KG = 0.45359237;

export type TdeeInputs = {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightLb: number;
  activityLevel: ActivityLevel;
};

export type TdeeResult = {
  age: number;
  weightKg: number;
  bmr: number;            // basal metabolic rate (kcal/day)
  tdee: number;           // BMR × activity (kcal/day)
  multiplier: number;
};

// Mifflin-St Jeor — the most accurate widely-used BMR formula.
export function computeTdee(inputs: TdeeInputs): TdeeResult {
  const age = new Date().getFullYear() - inputs.birthYear;
  const weightKg = inputs.weightLb * LB_TO_KG;
  const sexOffset = inputs.sex === 'male' ? 5 : -161;
  const bmr = 10 * weightKg + 6.25 * inputs.heightCm - 5 * age + sexOffset;
  const multiplier = ACTIVITY_MULTIPLIERS[inputs.activityLevel];
  const tdee = bmr * multiplier;
  return { age, weightKg, bmr: Math.round(bmr), tdee: Math.round(tdee), multiplier };
}

// Inches → cm helper (we collect height in inches in the UI).
export function inchesToCm(inches: number): number {
  return inches * 2.54;
}

export function cmToInches(cm: number): number {
  return cm / 2.54;
}
