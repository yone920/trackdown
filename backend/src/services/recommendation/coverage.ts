// Phase 4: the level a muscle's week lands on, judged against ITS OWN MEV/MAV/MRV band
// instead of the one flat 10–20 sets/week band `lib/body-map.ts` used to hold every
// muscle to. Same four states, same meaning, as that file's own retired `levelOf` — this
// just reads the registry for the numbers instead of a single constant.
//
// Live in `coach/features.ts`'s `coverageLedger()` (ENGINE.md §4b), which reads this
// registry's fourteen muscles instead of its own older LEDGER_MUSCLES vocabulary (twelve
// tokens: no lower_back, no neck, "core" instead of a separate "abs") and stamps each
// entry with this function's answer plus the muscle's own band, for `lib/body-map.ts` to
// draw and quote directly instead of recomputing a flat-band level of its own.

import type { MuscleDefinition } from "./registry.js";
import type { MuscleStat } from "./scheduler.js";

export type CoverageLevel = 0 | 1 | 2 | 3;

/**
 * Level 0 is `daysSince == null` and NOTHING else — not served in the window at all,
 * the same deliberate distinction `lib/body-map.ts` already documents: a treadmill walk
 * can serve calves and glutes with zero sets recorded, and grey would wrongly say
 * "untouched" about something trained this morning. Levels 2 and 3 are judged against
 * THIS muscle's own mavLow/mavHigh — a forearm crossing 10 sets means something
 * different than a quad crossing 10 sets, and the flat band never said so.
 */
export function coverageLevel(stat: MuscleStat, muscle: MuscleDefinition): CoverageLevel {
	if (stat.daysSince == null) return 0;
	if (stat.sets7d >= muscle.mavLow && stat.sets7d <= muscle.mavHigh) return 2;
	if (stat.sets7d > muscle.mavHigh) return 3;
	return 1;
}
