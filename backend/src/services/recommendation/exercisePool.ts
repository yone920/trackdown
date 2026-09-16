// Phase 3: which exercises are even ON the menu for a muscle's slots today — the engine
// deciding the pool, not merely hoping the model rotates on its own (ENGINE.md §Why this
// exists: "the same four chest exercises repeated session after session because nothing
// forced rotation"). Pure functions again: every filter takes the candidates and the facts
// about them, and returns a narrower list. Nothing here queries a database or a catalogue
// — that translation is the caller's job, same separation scheduler.ts already keeps from
// wherever a MuscleStat comes from.

export interface CandidateExercise {
	name: string;
	/** Whether the catalogue holds an illustration for this movement. */
	hasMedia: boolean;
	/** Lower-cased equipment tags, e.g. ["barbell", "bench"] — the catalogue's own vocabulary. */
	equipment: readonly string[];
}

export interface RecentUsage {
	exercise: string;
	/** How many sessions ago THIS muscle was trained with this exercise — 0 is last time. */
	sessionsAgo: number;
}

/**
 * How many of a muscle's most recent sessions an exercise is barred from repeating in.
 * Two, matching `coach/rules.ts`'s own STRENGTH_RUT_SESSIONS — the number a real account
 * had already been stuck on (the same four chest exercises, session after session) before
 * that threshold was chosen.
 */
export const ROTATION_WINDOW_SESSIONS = 2;

const normalize = (name: string): string => name.trim().toLowerCase();

/**
 * Excludes anything used in the muscle's last `ROTATION_WINDOW_SESSIONS` sessions — EXCEPT
 * the anchor, which is exempt on purpose: progressive overload needs one exercise to stay
 * put so there is a number to track going up, and rotating it away the moment it repeats
 * would erase the very continuity the anchor exists for.
 */
export function filterByRotation(
	candidates: readonly CandidateExercise[],
	recentUsage: readonly RecentUsage[],
	anchor: string | null,
	windowSessions: number = ROTATION_WINDOW_SESSIONS
): CandidateExercise[] {
	const recentlyUsed = new Set(
		recentUsage.filter((usage) => usage.sessionsAgo < windowSessions).map((usage) => normalize(usage.exercise))
	);
	const anchorKey = anchor ? normalize(anchor) : null;
	return candidates.filter((candidate) => {
		const key = normalize(candidate.name);
		if (key === anchorKey) return true;
		return !recentlyUsed.has(key);
	});
}

/** Only what the catalogue can show a picture of — "a name the user has to go and google" is not a recommendation. */
export function filterByMedia(candidates: readonly CandidateExercise[]): CandidateExercise[] {
	return candidates.filter((candidate) => candidate.hasMedia);
}

/**
 * Only what the stated place actually has. `available` null means equipment is unknown —
 * every candidate stays, the same "no place is the normal state" default `places.ts`
 * already documents; an empty list is a real, informative fact (a bodyweight-only place)
 * and DOES filter, it just leaves nothing with named equipment on the menu.
 */
export function filterByEquipment(
	candidates: readonly CandidateExercise[],
	available: readonly string[] | null
): CandidateExercise[] {
	if (available == null) return candidates.slice();
	const owned = new Set(available.map((item) => item.trim().toLowerCase()));
	return candidates.filter((candidate) => candidate.equipment.every((item) => owned.has(item.trim().toLowerCase())));
}

export interface LoadSession {
	date: string;
	loadLb: number | null;
}

export interface LoadHistory {
	exercise: string;
	/** Newest first — the same order `ExerciseFeature.sessions` already keeps. */
	sessions: readonly LoadSession[];
}

/**
 * The one exercise per muscle exempt from rotation: whichever logged movement has the
 * MOST sessions carrying an actual load, tie-broken by whichever was trained most
 * recently. Not "trending up" — a lift that's been HELD at one weight for two sessions
 * (see `coach/rules.ts`'s own `hold` rule) still needs continuity to know when it's ready
 * to step, and losing that continuity to rotation is the failure this exists to prevent.
 * A history with no loaded sessions at all (only bodyweight or cardio work) has no anchor,
 * which is a real answer: nothing here needs the continuity a heavy compound lift does.
 */
export function chooseAnchor(history: readonly LoadHistory[]): string | null {
	let best: { exercise: string; loadedSessions: number; lastDate: string } | null = null;
	for (const entry of history) {
		const loaded = entry.sessions.filter((session) => session.loadLb != null);
		if (loaded.length === 0) continue;
		const lastDate = entry.sessions[0]?.date ?? "";
		if (
			!best ||
			loaded.length > best.loadedSessions ||
			(loaded.length === best.loadedSessions && lastDate > best.lastDate)
		) {
			best = { exercise: entry.exercise, loadedSessions: loaded.length, lastDate };
		}
	}
	return best?.exercise ?? null;
}

export interface EligiblePoolOptions {
	recentUsage?: readonly RecentUsage[];
	anchor?: string | null;
	availableEquipment?: readonly string[] | null;
	rotationWindowSessions?: number;
}

/**
 * The full pipeline in the order it has to run, and the safety valve that keeps a
 * muscle from being handed nothing to prescribe: rotation and equipment are real
 * constraints, held even if they leave a short list; the media requirement is relaxed
 * FIRST if the pool would otherwise come back empty, because "no picture" is a worse
 * gap than "we showed you something you've done before" (`coach/coach.ts`'s
 * `dropRecovering` documents the same principle for the recovery rule: "it will not
 * empty a training day").
 */
export function eligiblePool(candidates: readonly CandidateExercise[], options: EligiblePoolOptions = {}): CandidateExercise[] {
	const { recentUsage = [], anchor = null, availableEquipment = null, rotationWindowSessions } = options;

	const constrained = filterByEquipment(
		filterByRotation(candidates, recentUsage, anchor, rotationWindowSessions),
		availableEquipment
	);
	const withMedia = filterByMedia(constrained);
	if (withMedia.length > 0) return withMedia;
	if (constrained.length > 0) return constrained;

	// Rotation and equipment together left nothing at all — the same "menu had nothing
	// legal on it" case coach.ts already accepts as a fact worth surfacing rather than a
	// crash to paper over. Equipment stays honored (there is genuinely nothing to lift);
	// rotation is what gives, since repeating something is better than prescribing
	// nothing.
	return filterByEquipment(candidates, availableEquipment);
}
