// Phase 4, the safe half: the level a muscle's week lands on, judged against ITS OWN
// MEV/MAV/MRV band instead of the one flat 10–20 sets/week band `lib/body-map.ts` holds
// every muscle to today. Same four states, same meaning, as that file's own `levelOf` —
// this just reads the registry for the numbers instead of a single constant.
//
// Deliberately NOT wired into anything live in this commit. `coach/features.ts`'s
// `coverageLedger()` — the one function that actually produces what the map and the
// coach's own prompt both read — still uses its own, older LEDGER_MUSCLES vocabulary
// (twelve tokens: no lower_back, no neck, "core" instead of a separate "abs"). Migrating
// it onto this registry changes what the live coach's COVERAGE DEBTS text says and what a
// real user's map shows — a production behavior change, not an additive one, and every
// other phase of this module was kept additive on purpose. That migration is its own
// deliberate, reviewed step; this file is the arithmetic it will call once it happens.

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
