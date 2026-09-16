// The recommendation engine's data — and only its data (docs/recommendation-engine.md
// §Phase 1). Everything downstream (the scheduler, the accessory rules, the exercise
// pool) reads this file and never invents a muscle name, a family, or a volume band of
// its own — which is the whole point of an open/closed module: retuning a band, adding a
// muscle, or moving one between families is an edit HERE, never a change to the
// scheduling code that reads it.
//
// Fourteen muscles, replacing two different, disagreeing vocabularies that used to live
// in this codebase (coach/features.ts's TRACKED_MUSCLES had no forearms or neck;
// coach/features.ts's LEDGER_MUSCLES folded traps into upper_back and had no lower_back
// as its own entry). One list, one spelling, read by everything.

/** The three rotation families a session can be built around, plus the accessories that
 * never get a day of their own. */
export type MuscleFamily = "push" | "pull" | "legs" | "accessory";

export interface MuscleDefinition {
	key: string;
	label: string;
	family: MuscleFamily;
	/**
	 * Hours before this muscle is available as today's primary target again — the same
	 * physiological gate `coach/rules.ts`'s RECOVERY_DAYS already enforces (48h), extended
	 * per muscle instead of one number for everyone. The low end of a real range: a
	 * muscle described as "48–72h" recovers HERE at 48, the same conservative minimum the
	 * existing app already used, not the upper end.
	 */
	recoveryHours: number;
	/** Minimum effective volume — sets/week below which nothing meaningful is happening. */
	mev: number;
	/** Maximum adaptive volume — the band worth living in most weeks, low and high ends. */
	mavLow: number;
	mavHigh: number;
	/** Maximum recoverable volume — sets/week beyond which more stops helping. */
	mrv: number;
	/**
	 * The catalogue's own muscle tags that count toward this key — `backend/data/
	 * exercises.json`'s `primary_muscles` vocabulary, which is what an activity's
	 * `muscle_groups` column actually holds. Most muscles are a 1:1 rename; `upper_back`
	 * folds in `traps` and `abs` folds in `obliques`, the same two mergers
	 * `coach/features.ts`'s older `LEDGER_MUSCLES` already made for the same reason.
	 * `adductors`, `abductors`, `hip_flexors` and `full_body` are real catalogue tags with
	 * no honest 1:1 home here and are deliberately left unmapped rather than guessed at.
	 */
	tokens: readonly string[];
}

/**
 * Sourcing, stated once so it travels with the numbers rather than living only in a
 * conversation: the ≥2×/week-beats-1×/week frequency claim is a real, replicated finding
 * (Schoenfeld & Grgic 2016 and follow-ups). The MEV/MAV/MRV framework is the
 * industry-standard numeric system (Renaissance Periodization / Mike Israetel) — evidence
 * *informed* coaching consensus, not a single controlled trial. Treat every number below
 * as a tuned default, not a physical constant.
 */
export const MUSCLES: readonly MuscleDefinition[] = [
	{ key: "chest", label: "Chest", family: "push", recoveryHours: 48, mev: 8, mavLow: 12, mavHigh: 20, mrv: 22, tokens: ["chest"] },
	{
		key: "shoulders",
		label: "Shoulders",
		family: "push",
		recoveryHours: 48,
		mev: 6,
		mavLow: 8,
		mavHigh: 16,
		mrv: 20,
		tokens: ["shoulders"],
	},
	{
		key: "triceps",
		label: "Triceps",
		family: "push",
		recoveryHours: 24,
		mev: 4,
		mavLow: 6,
		mavHigh: 12,
		mrv: 18,
		tokens: ["triceps"],
	},

	{ key: "lats", label: "Lats", family: "pull", recoveryHours: 48, mev: 8, mavLow: 14, mavHigh: 22, mrv: 25, tokens: ["lats"] },
	{
		key: "upper_back",
		label: "Upper back",
		family: "pull",
		recoveryHours: 48,
		mev: 6,
		mavLow: 12,
		mavHigh: 20,
		mrv: 24,
		tokens: ["back", "traps"],
	},
	{
		key: "biceps",
		label: "Biceps",
		family: "pull",
		recoveryHours: 24,
		mev: 5,
		mavLow: 8,
		mavHigh: 14,
		mrv: 20,
		tokens: ["biceps"],
	},
	{
		key: "forearms",
		label: "Forearms",
		family: "pull",
		recoveryHours: 24,
		mev: 2,
		mavLow: 6,
		mavHigh: 10,
		mrv: 24,
		tokens: ["forearms"],
	},

	{ key: "quads", label: "Quads", family: "legs", recoveryHours: 48, mev: 8, mavLow: 12, mavHigh: 18, mrv: 20, tokens: ["quads"] },
	{
		key: "hamstrings",
		label: "Hamstrings",
		family: "legs",
		recoveryHours: 48,
		mev: 6,
		mavLow: 10,
		mavHigh: 16,
		mrv: 20,
		tokens: ["hamstrings"],
	},
	{
		key: "glutes",
		label: "Glutes",
		family: "legs",
		recoveryHours: 48,
		mev: 4,
		mavLow: 8,
		mavHigh: 16,
		mrv: 20,
		tokens: ["glutes"],
	},
	{
		key: "calves",
		label: "Calves",
		family: "legs",
		recoveryHours: 24,
		mev: 8,
		mavLow: 12,
		mavHigh: 16,
		mrv: 20,
		tokens: ["calves"],
	},

	// Accessories never get a rotation turn of their own — see accessories.ts. lower_back
	// is deliberately the odd one out: injury-sensitive, so its band is capped low rather
	// than chased upward the way a limb's is.
	{
		key: "abs",
		label: "Abs",
		family: "accessory",
		recoveryHours: 24,
		mev: 0,
		mavLow: 16,
		mavHigh: 20,
		mrv: 25,
		tokens: ["abs", "obliques"],
	},
	{
		key: "lower_back",
		label: "Lower back",
		family: "accessory",
		recoveryHours: 72,
		mev: 0,
		mavLow: 4,
		mavHigh: 6,
		mrv: 8,
		tokens: ["lower_back"],
	},
	{
		key: "neck",
		label: "Neck",
		family: "accessory",
		recoveryHours: 48,
		mev: 0,
		mavLow: 4,
		mavHigh: 6,
		mrv: 8,
		tokens: ["neck"],
	},
] as const;

/** A family that can be a day's theme — everything but the accessories. */
export type RotationFamily = Exclude<MuscleFamily, "accessory">;

/** The three families a day's theme rotates through. Accessories ride along; they never win the rotation. */
export const ROTATION_FAMILIES: readonly RotationFamily[] = ["push", "pull", "legs"];

const BY_KEY = new Map(MUSCLES.map((muscle) => [muscle.key, muscle]));

/** The one place a muscle key is looked up. Returns undefined rather than throwing — an
 * unrecognised key (an old client, a typo upstream) is a fact the caller decides what to
 * do with, not a crash. */
export function muscleByKey(key: string): MuscleDefinition | undefined {
	return BY_KEY.get(key.trim().toLowerCase());
}

export function musclesInFamily(family: MuscleFamily): readonly MuscleDefinition[] {
	return MUSCLES.filter((muscle) => muscle.family === family);
}

/**
 * feet/ankles, and every other real body part that isn't here: these don't map onto
 * resistance-training volume science the way the fourteen above do (docs/
 * recommendation-engine.md §Deferred, on purpose). They stay under the existing
 * `stretching`/mobility category rather than becoming a volume-tracked muscle with an
 * MEV/MAV band that wouldn't mean anything for them.
 */
