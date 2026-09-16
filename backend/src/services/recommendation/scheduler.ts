// Phase 2: which family today is for, and how its volume splits across its muscles.
// Pure functions — no SQL, no clock, no provider — same discipline coach/rules.ts already
// holds itself to, and for the same reason: the same stats in, the same schedule out.
//
// This module does not know where a MuscleStat comes from. Today that would be
// coach/features.ts's coverage ledger; whatever computes it, the scheduler only ever asks
// "how many days since, how many sets this week" — decoupling the scheduling POLICY from
// wherever the activity data happens to live.

import { type MuscleDefinition, type MuscleFamily, ROTATION_FAMILIES, muscleByKey, musclesInFamily } from "./registry.js";

export interface MuscleStat {
	key: string;
	/** Null means never trained in the window this stat was computed over — the worst case, not zero. */
	daysSince: number | null;
	sets7d: number;
}

/**
 * How many days past its OWN recovery gate a muscle now sits. Negative (or the muscle is
 * simply excluded upstream) means it is still recovering and cannot be today's driver.
 * Never-trained is +Infinity — worse than any number of idle days, because "never" is not
 * a number of days to be behind by.
 */
function excessIdleDays(stat: MuscleStat, definition: MuscleDefinition): number {
	if (stat.daysSince == null) return Infinity;
	return stat.daysSince - definition.recoveryHours / 24;
}

/**
 * Today's family, by debt — not a fixed rotation, not a model's guess. A family's debt is
 * the WORST excess-idle-days among its own members that are past their own recovery gate;
 * whichever family's most-neglected available muscle is the most neglected wins.
 *
 * This is the direct fix for the bug a real account hit on 2026-09-16: chest sat seven
 * days unserved — five days past its own 48-hour gate — while back, which had only
 * just cleared ITS gate at two days (zero days past it), got targeted again. Framed this
 * way, chest's debt (5) beats back's (0) and the family that contains chest wins, which a
 * page of advisory text handed to a model did not reliably produce.
 *
 * `avoidMuscles` is the override's (override.ts, applied by `scheduleTargets` below): a
 * muscle the user asked to skip today is treated as if it weren't a member of its family
 * at all, never as the family's excuse to lose.
 */
export function chooseFamily(
	stats: readonly MuscleStat[],
	avoidMuscles: ReadonlySet<string> = new Set()
): MuscleFamily | null {
	const byKey = new Map(stats.map((stat) => [stat.key, stat]));

	let winner: MuscleFamily | null = null;
	let winnerDebt = -Infinity;

	for (const family of ROTATION_FAMILIES) {
		let debt = -Infinity;
		for (const muscle of musclesInFamily(family)) {
			if (avoidMuscles.has(muscle.key)) continue;
			const stat = byKey.get(muscle.key);
			if (!stat) continue;
			const idle = excessIdleDays(stat, muscle);
			// Still inside its own recovery window: not a candidate to DRIVE this family's
			// debt, the same way a muscle inside 48h is not today's primary target elsewhere
			// in this app.
			if (idle < 0) continue;
			debt = Math.max(debt, idle);
		}
		if (debt > winnerDebt) {
			winnerDebt = debt;
			winner = family;
		}
	}

	return winner;
}

export interface MuscleAllocation {
	key: string;
	slots: number;
}

/**
 * `totalSlots` split across a family's own muscles, weighted by how far each sits below
 * its OWN maximum-adaptive-volume floor — not an equal share, and not the same band for
 * everyone the way the app's flat 10–20 sets/week band on every muscle used to be.
 *
 * Largest-remainder apportionment: exact fractional shares, floored, then the leftover
 * slots (there are always fewer than there are muscles) go to whoever's fractional part
 * was closest to rounding up. Deterministic, and the only method that both sums to
 * exactly `totalSlots` and never gives a bigger shortfall a smaller share than a lesser one.
 *
 * When nobody in the family is short of their own MAV floor — a well-covered family that
 * simply had the least-bad debt of the three — there is nothing to weight by, so the
 * slots split evenly instead of collapsing to zero everywhere.
 */
export function allocateVolume(
	family: MuscleFamily,
	stats: readonly MuscleStat[],
	totalSlots: number,
	avoidMuscles: ReadonlySet<string> = new Set()
): MuscleAllocation[] {
	return allocateAcross(
		musclesInFamily(family).filter((muscle) => !avoidMuscles.has(muscle.key)),
		stats,
		totalSlots
	);
}

/**
 * The same apportionment over ANY set of muscles — a family's members minus the ones the
 * user asked to skip, or exactly the muscles they asked for, whatever family each is in.
 * `allocateVolume` is this over a family; the override is this over the request.
 */
export function allocateAcross(
	members: readonly MuscleDefinition[],
	stats: readonly MuscleStat[],
	totalSlots: number
): MuscleAllocation[] {
	if (members.length === 0 || totalSlots <= 0) return members.map((muscle) => ({ key: muscle.key, slots: 0 }));

	const byKey = new Map(stats.map((stat) => [stat.key, stat]));
	const shortfalls = members.map((muscle) => {
		const sets7d = byKey.get(muscle.key)?.sets7d ?? 0;
		return Math.max(0, muscle.mavLow - sets7d);
	});
	const totalShortfall = shortfalls.reduce((sum, value) => sum + value, 0);

	const weights = totalShortfall > 0 ? shortfalls : members.map(() => 1);
	const totalWeight = weights.reduce((sum, value) => sum + value, 0);

	const raw = weights.map((weight) => (weight / totalWeight) * totalSlots);
	const floors = raw.map((value) => Math.floor(value));
	let remaining = totalSlots - floors.reduce((sum, value) => sum + value, 0);

	// Largest remainder first; a tie goes to the muscle registry's own order, which is
	// stable and arbitrary in exactly the way a tie-break should be.
	const order = raw
		.map((value, index) => ({ index, remainder: value - (floors[index] as number) }))
		.sort((a, b) => b.remainder - a.remainder);

	const slots = [...floors];
	for (const { index } of order) {
		if (remaining <= 0) break;
		slots[index] = (slots[index] as number) + 1;
		remaining -= 1;
	}

	return members.map((muscle, index) => ({ key: muscle.key, slots: slots[index] as number }));
}

/** What a day is for, once the request (if any) has had its say. */
export interface DaySchedule {
	/** Today's theme — the request's when it named one, the debt's otherwise. */
	family: MuscleFamily | null;
	/** Every scheduled muscle and its share of the session's exercise slots. */
	allocation: MuscleAllocation[];
	/** Muscles the request named that ARE scheduled — the reason the split looks the way it does. */
	requested: string[];
	/** Muscles the request named that are still inside their own recovery gate, and so are not. */
	recovering: string[];
	/** Muscles the request said to leave out. */
	avoided: string[];
}

/**
 * `chooseFamily` + `allocateVolume`, with the override applied (ENGINE.md §The override).
 * The one entry point a caller building a day should use, so the family the TARGET line
 * names, the menu built for it, and the request that shaped both can never disagree.
 *
 * The override wins in exactly this order, and each step is the whole of what it does:
 *
 * 1. **Muscles named to be worked** get ALL the slots, split between them by the same
 *    shortfall weighting a family's members get — "give me chest" is a chest day, and
 *    "chest and triceps" splits between the two, whatever family either is in. A named
 *    muscle still inside its OWN recovery gate is not forced (the same gate `chooseFamily`
 *    holds every muscle to); it is reported in `recovering` so the brief can say why.
 * 2. **A family named** ("legs") is forced, and its slots split across its members as
 *    they always do.
 * 3. **Otherwise** the debt decides, as it always did.
 *
 * `avoid` applies at every step: a muscle asked to be skipped is out of the allocation
 * AND out of its family's case for the day (`chooseFamily`'s own `avoidMuscles`).
 *
 * It never touches the stats: a forced day is logged like any other and the schedule
 * recomputes from real history next time.
 */
export function scheduleTargets(
	stats: readonly MuscleStat[],
	totalSlots: number,
	override: { family: MuscleFamily | null; muscles: readonly string[]; avoid: readonly string[] } | null = null
): DaySchedule {
	const avoid = new Set(override?.avoid ?? []);
	const avoided = [...avoid];
	const byKey = new Map(stats.map((stat) => [stat.key, stat]));

	const named = (override?.muscles ?? [])
		.filter((key) => !avoid.has(key))
		.map((key) => muscleByKey(key))
		.filter((muscle): muscle is MuscleDefinition => muscle != null);
	if (named.length > 0) {
		const cleared: MuscleDefinition[] = [];
		const recovering: string[] = [];
		for (const muscle of named) {
			const stat = byKey.get(muscle.key);
			// No stat at all reads as never trained — nothing to recover from.
			if (stat == null || excessIdleDays(stat, muscle) >= 0) cleared.push(muscle);
			else recovering.push(muscle.key);
		}
		if (cleared.length > 0) {
			return {
				family: cleared[0]?.family ?? null,
				allocation: allocateAcross(cleared, stats, totalSlots),
				requested: cleared.map((muscle) => muscle.key),
				recovering,
				avoided,
			};
		}
		// Everything they asked for is still recovering: the debt decides, and the brief is
		// told what was asked for and why it was not done.
		const family = override?.family ?? chooseFamily(stats, avoid);
		return {
			family,
			allocation: family ? allocateVolume(family, stats, totalSlots, avoid) : [],
			requested: [],
			recovering,
			avoided,
		};
	}

	const family = override?.family ?? chooseFamily(stats, avoid);
	return {
		family,
		allocation: family ? allocateVolume(family, stats, totalSlots, avoid) : [],
		requested: [],
		recovering: [],
		avoided,
	};
}

/** Convenience for a caller that only has muscle keys and wants their registry rows — used
 * by callers assembling a brief's `targets` line from an allocation. Undefined keys (an
 * upstream typo) are dropped rather than crashing the plan over one bad string. */
export function definitionsFor(allocations: readonly MuscleAllocation[]): MuscleDefinition[] {
	return allocations
		.map((allocation) => muscleByKey(allocation.key))
		.filter((definition): definition is MuscleDefinition => definition != null);
}
