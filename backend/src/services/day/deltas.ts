import { DEFAULT_LOAD_DIRECTION, type LoadDirection } from "../../db/exercises.js";
import type { DayActivity } from "./types.js";

// "each exercise's load and its delta vs last time" (docs/design-system.md §Day). The
// comparison is against the *previous occurrence of the same exercise*, wherever it was —
// earlier today, or three weeks ago. It is one fact, computed, and the coach's progression
// rules read the same number.
//
// `direction` says which way the NUMBER went. `sentiment` says whether that was progress,
// and they are not the same question: on an assisted machine the load is the help, so
// "−5 lb" is five pounds less help and the best thing on the screen (migration 0013). The
// app colours by sentiment; it never has to know which movement it is looking at.

export type DeltaDirection = "up" | "down" | "same" | "new";

/** Progress, regression, or neither. Green, amber and quiet, in that order. */
export type DeltaSentiment = "good" | "watch" | "neutral";

export interface DeltaVsLast {
	/** What the row shows: "same", "+5 lb", "+1 set", "-10 lb", "first time". */
	text: string;
	direction: DeltaDirection;
	/**
	 * Whether the move was progress. On resistance that is "up"; on an assisted machine it
	 * is "down", because the number is the help. Only ever set from `load_lb` — a set or a
	 * rep more is progress whatever the machine, and a minute more is not obviously either.
	 */
	sentiment: DeltaSentiment;
	/** Which fact moved — the app colours load and sets the same, but the coach cares. */
	field: "load_lb" | "sets" | "reps" | "duration_min" | "distance_mi" | null;
	load_lb: number | null;
	sets: number | null;
	reps: number | null;
	previous: {
		logged_at: string;
		load_lb: number | null;
		sets: number | null;
		reps: number | null;
	} | null;
}

function sameExercise(a: DayActivity, b: DayActivity): boolean {
	const left = (a.exercise ?? "").trim().toLowerCase();
	const right = (b.exercise ?? "").trim().toLowerCase();
	return left !== "" && left === right;
}

/** 45, 45.0 and 45.5 all have to read the way a person would say them. */
function format(value: number, unit: string): string {
	const rounded = Math.round(value * 10) / 10;
	const sign = rounded > 0 ? "+" : "-";
	const magnitude = Math.abs(rounded);
	const digits = Number.isInteger(magnitude) ? String(magnitude) : magnitude.toFixed(1);
	const plural = unit === "lb" || unit === "min" || unit === "mi" ? unit : magnitude === 1 ? unit : `${unit}s`;
	return `${sign}${digits} ${plural}`;
}

/**
 * Compare one activity with the last time the same exercise was done. Fields are checked
 * in the order that matters to a lifter: load first, then sets, then reps — a heavier bar
 * is the progression, and set count is what changed when the bar did not. Cardio has
 * neither, so duration and distance take over on their own.
 */
export function deltaVsLast(
	current: DayActivity,
	previous: DayActivity | null,
	loadDirection: LoadDirection = DEFAULT_LOAD_DIRECTION
): DeltaVsLast {
	if (!previous) {
		return {
			text: "first time",
			direction: "new",
			sentiment: "neutral",
			field: null,
			load_lb: null,
			sets: null,
			reps: null,
			previous: null,
		};
	}

	const was = {
		logged_at: previous.logged_at,
		load_lb: previous.load_lb,
		sets: previous.sets,
		reps: previous.reps,
	};
	const load = diff(current.load_lb, previous.load_lb);
	const sets = diff(current.sets, previous.sets);
	const reps = diff(current.reps, previous.reps);
	const duration = diff(current.duration_min, previous.duration_min);
	const distance = diff(current.distance_mi, previous.distance_mi);

	const candidates: [DeltaVsLast["field"], number | null, string][] = [
		["load_lb", load, "lb"],
		["sets", sets, "set"],
		["reps", reps, "rep"],
		["duration_min", duration, "min"],
		["distance_mi", distance, "mi"],
	];
	const moved = candidates.find(([, value]) => value !== null && value !== 0);

	if (!moved) {
		return { text: "same", direction: "same", sentiment: "neutral", field: null, load_lb: load, sets, reps, previous: was };
	}
	const [field, value, unit] = moved;
	const direction = (value as number) > 0 ? "up" : "down";
	return {
		text: format(value as number, unit),
		direction,
		sentiment: sentimentOf(field, direction, loadDirection),
		field,
		load_lb: load,
		sets,
		reps,
		previous: was,
	};
}

/**
 * Which way is up. A heavier bar, an extra set, an extra rep, a longer run and a further
 * one are all progress; a smaller number on all of those is the one to look at. The single
 * exception is an **assistance** load, where the two are swapped — five pounds less help is
 * five pounds closer to doing it unaided.
 */
function sentimentOf(
	field: DeltaVsLast["field"],
	direction: "up" | "down",
	loadDirection: LoadDirection
): DeltaSentiment {
	const better = field === "load_lb" && loadDirection === "assistance" ? "down" : "up";
	return direction === better ? "good" : "watch";
}

/** null when either side never said — "no number" is not "no change". */
function diff(now: number | null, then: number | null): number | null {
	return now == null || then == null ? null : now - then;
}

/**
 * Attach a delta to every activity in the day. `history` is the same user's earlier
 * activities (before the day started), newest first; activities earlier in the day are
 * compared against too, so a second set of squats after lunch reads against the morning's.
 */
export function withDeltas(
	dayActivities: DayActivity[],
	history: DayActivity[],
	/** Catalogue `load_direction` keyed by lower-cased exercise name; anything absent is resistance. */
	loadDirections: Record<string, LoadDirection> = {}
): { activity: DayActivity; delta_vs_last: DeltaVsLast | null }[] {
	const chronological = dayActivities.slice().sort((a, b) => Date.parse(a.logged_at) - Date.parse(b.logged_at));
	const seenToday: DayActivity[] = [];

	return chronological.map((activity) => {
		if (!activity.exercise) {
			// Nothing to compare an unnamed activity with — "a walk" is not the same walk.
			seenToday.push(activity);
			return { activity, delta_vs_last: null };
		}
		const earlierToday = [...seenToday].reverse().find((other) => sameExercise(activity, other));
		const previous = earlierToday ?? history.find((other) => sameExercise(activity, other)) ?? null;
		seenToday.push(activity);
		const direction = loadDirections[activity.exercise.trim().toLowerCase()] ?? DEFAULT_LOAD_DIRECTION;
		return { activity, delta_vs_last: deltaVsLast(activity, previous, direction) };
	});
}
