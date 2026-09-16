// The ONLY import path anything outside this module is allowed to use (ENGINE.md
// §Module shape). Everything else in this directory is a private implementation detail —
// free to be reshaped without anything else in the codebase noticing, as long as what it
// exports through here stays the same shape.
//
// The registry, the scheduler that reads it (with the override applied), the
// exercise-pool filters, and the coverage-level arithmetic — all live: `coach/coach.ts`
// and `coach/rules.ts` ask THIS module, not the model, which muscles today is for, how
// many slots each gets, and what may fill them.

export { MUSCLES, ROTATION_FAMILIES, muscleByKey, musclesInFamily } from "./registry.js";
export type { MuscleDefinition, MuscleFamily, RotationFamily } from "./registry.js";
export { allocateAcross, allocateVolume, chooseFamily, definitionsFor, scheduleTargets } from "./scheduler.js";
export type { DaySchedule, MuscleAllocation, MuscleStat } from "./scheduler.js";
export { parseOverride } from "./override.js";
export type { Override } from "./override.js";
export {
	ROTATION_WINDOW_SESSIONS,
	chooseAnchor,
	eligiblePool,
	filterByEquipment,
	filterByMedia,
	filterByRotation,
} from "./exercisePool.js";
export type { CandidateExercise, EligiblePoolOptions, LoadHistory, LoadSession, RecentUsage } from "./exercisePool.js";
export { coverageLevel } from "./coverage.js";
export type { CoverageLevel } from "./coverage.js";
