// The ONLY import path anything outside this module is allowed to use (ENGINE.md
// §Module shape). Everything else in this directory is a private implementation detail —
// free to be reshaped without anything else in the codebase noticing, as long as what it
// exports through here stays the same shape.
//
// Phases 1–3 (this file, today): the registry, the scheduler that reads it, and the
// exercise-pool filters. None of it is wired into `coach/rules.ts` yet — that live system
// still targets muscles and picks exercises by asking a model to read advisory prose.
// Only once all of it is proven does coach.ts start asking THIS module, instead of the
// model, which muscle today is for and what may fill its slots.

export { MUSCLES, ROTATION_FAMILIES, muscleByKey, musclesInFamily } from "./registry.js";
export type { MuscleDefinition, MuscleFamily } from "./registry.js";
export { allocateVolume, chooseFamily, definitionsFor } from "./scheduler.js";
export type { MuscleAllocation, MuscleStat } from "./scheduler.js";
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
