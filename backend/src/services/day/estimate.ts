import { LB_TO_KG } from "../tdee.js";
import type { ActivityCategory, Block, DayActivity } from "./types.js";

// Strength calories are estimates (docs/concept-v2.md §Calories). A treadmill prints a
// number and we read it as-is; a barbell prints nothing, so a real lifting session — four
// exercises, 8:00 to 8:39, no kcal on any of them — used to be worth exactly zero and the
// day said "0 kcal earned" after the user had been in the gym for forty minutes.
//
// The estimate is derived on every read, from the block, exactly like the blocks
// themselves. **Nothing here is ever written to `activities`**: a row keeps the calories
// the user or a machine gave it and no others, so a later correction — or a watch that
// turns up with the measured figure — simply replaces the estimate instead of adding to
// something already stored.
//
// The formula is the standard MET one (Ainsworth 2011 compendium of physical activities;
// ACSM's metabolic equations):
//
//     kcal = MET × 3.5 × weight_kg / 200 × duration_min
//
// with the compendium's own values for the two categories worth estimating. Cardio is
// never estimated: it either carries the machine's number or the watch's, and inventing a
// third would be the double count the block rules exist to prevent.

/** Compendium MET values. Resistance training general; stretching/mobility light. */
export const MET_BY_CATEGORY: Record<"strength" | "mobility", number> = {
	strength: 4.5,
	mobility: 2.5,
};

/** Body weight when there is no weigh-in and no plan to derive one from. */
export const FALLBACK_WEIGHT_KG = 80;

/**
 * What one logged exercise is worth in minutes when nothing said how long it took. A
 * single lift logged at one instant has no span at all, and no span must not mean no
 * work — three sets, the rest between them and the walk to the rack is about this.
 */
export const MINUTES_PER_EXERCISE = 8;

/** No estimate stretches past this, whatever the block's span says. */
export const MAX_ESTIMATED_MIN = 120;

/** True for an activity the estimate is allowed to cover: a lift or a stretch with no number. */
export function isEstimable(activity: DayActivity): boolean {
	return activity.kcal <= 0 && (activity.category === "strength" || activity.category === "mobility");
}

function metFor(category: ActivityCategory | null): number {
	return category === "mobility" ? MET_BY_CATEGORY.mobility : MET_BY_CATEGORY.strength;
}

/** The MET formula itself, unrounded. */
export function metKcal(met: number, weightKg: number, minutes: number): number {
	return ((met * 3.5 * weightKg) / 200) * minutes;
}

/**
 * The body weight the estimate is computed for, in kilograms: the day's weigh-in (or the
 * latest one before it), else whatever the plan implies, else a middle-of-the-road adult.
 * A wrong weight moves the estimate by a few per cent; no estimate at all moves it to zero.
 */
export function estimateWeightKg(weightLb: number | null, goalWeightLb: number | null = null): number {
	const pounds = weightLb ?? goalWeightLb;
	return pounds == null || pounds <= 0 ? FALLBACK_WEIGHT_KG : pounds * LB_TO_KG;
}

export interface KcalEstimates {
	blocks: Block[];
	/** Estimated kcal per activity id — what the day's facts window carries, in memory only. */
	byActivity: Map<string, number>;
}

/**
 * One block's calories, with the strength and mobility members that carried none estimated
 * in. The arithmetic, in the order it matters:
 *
 *   1. A block whose calories came off a watch is left alone. The watch measured these same
 *      minutes; our MET guess about them is not an improvement, and adding both is the
 *      double count.
 *   2. Minutes already spoken for are subtracted. An activity that carries its own kcal —
 *      the bike's 180 for twenty minutes — has accounted for its share of the block, so the
 *      estimate only covers what is left of the span. That is what "no double count" means
 *      here: the estimate never runs over minutes another number already claimed.
 *   3. What remains is floored at {@link MINUTES_PER_EXERCISE} per estimable exercise and
 *      capped at {@link MAX_ESTIMATED_MIN}, so a lift logged at a single instant is still
 *      worth something and a block that spans three hours is not worth a marathon.
 *   4. Those minutes are split between the estimable exercises: one that named its own
 *      duration weighs that, one that did not weighs the per-exercise default. Each gets
 *      the MET of its own category, so a block of lifts and a stretch is not all one rate.
 *
 * Rounding is per activity, and the block's figure is the sum of the rounded ones, so the
 * rows and the header always add up.
 */
export function estimateBlock(
	block: Block,
	members: DayActivity[],
	weightKg: number
): { block: Block; byActivity: Map<string, number> } {
	const byActivity = new Map<string, number>();
	const unchanged = { block: { ...block, kcal_estimated: false }, byActivity };

	if (block.kcal_from_health) return unchanged;
	const estimable = members.filter(isEstimable);
	if (estimable.length === 0) return unchanged;

	const accountedMin = members
		.filter((activity) => activity.kcal > 0)
		.reduce((total, activity) => total + (activity.duration_min ?? 0), 0);

	const floorMin = MINUTES_PER_EXERCISE * estimable.length;
	const minutes = Math.min(Math.max(block.minutes - accountedMin, floorMin), MAX_ESTIMATED_MIN);

	const weights = estimable.map((activity) =>
		activity.duration_min != null && activity.duration_min > 0 ? activity.duration_min : MINUTES_PER_EXERCISE
	);
	const totalWeight = weights.reduce((a, b) => a + b, 0);

	let estimated = 0;
	estimable.forEach((activity, index) => {
		const share = (minutes * (weights[index] as number)) / totalWeight;
		const kcal = Math.round(metKcal(metFor(activity.category), weightKg, share));
		estimated += kcal;
		if (activity.id) byActivity.set(activity.id, kcal);
	});

	return { block: { ...block, kcal: block.kcal + estimated, kcal_estimated: estimated > 0 }, byActivity };
}

/**
 * Every block's calories with the estimates in. Membership comes from `activity_ids`, so
 * this runs after the Health merge has had its say — a measured block keeps its measured
 * figure (see rule 1 above).
 */
export function applyKcalEstimates(blocks: Block[], activities: DayActivity[], weightKg: number): KcalEstimates {
	const byId = new Map<string, DayActivity>();
	for (const activity of activities) if (activity.id) byId.set(activity.id, activity);

	const byActivity = new Map<string, number>();
	const estimated = blocks.map((block) => {
		const members = block.activity_ids
			.map((id) => byId.get(id))
			.filter((activity): activity is DayActivity => activity !== undefined);
		const result = estimateBlock(block, members, weightKg);
		for (const [id, kcal] of result.byActivity) byActivity.set(id, kcal);
		return result.block;
	});

	return { blocks: estimated, byActivity };
}
