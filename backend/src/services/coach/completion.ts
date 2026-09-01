import { qualifiersIn, tokenize } from "../exerciseMatch.js";

// Is the plan done? (user decision 2026-08-31: "the day's brief is a PLAN, never a verdict …
// each prescribed exercise is matched against the day's logged activities → per-item
// { done, sets_done, sets_prescribed }".)
//
// Everything here is pure and everything here is computed at READ time. Nothing in this file
// is ever written to `coach_briefs`: a brief is what the coach said, and what the user has
// since done is a fact about the log. Storing the tick would mean a stored brief and a live
// log that could disagree, and the log always wins.
//
// The matching rule is the log's own rule, not a looser one. An `exercise_id` on both sides
// settles it outright; otherwise the names must resolve to the same key under
// services/exerciseMatch.ts's normalisation AND carry the same qualifiers — so an
// **Assisted** Chin-Up in the plan is not ticked off by a plain Chin-Up in the log, and vice
// versa. That is the same "assisted is not a spelling of chin-up" rule that stopped the
// catalogue snapping a qualifier away, applied to the other direction.

/** One line of the Do list, as much of it as the match needs. */
export interface PlannedExercise {
	name: string;
	exercise_id?: string | null;
	sets?: number | null;
}

/** One activity logged on the day being advised. */
export interface LoggedExercise {
	exercise: string | null;
	exercise_id?: string | null;
	sets?: number | null;
	/**
	 * The row's own id and numbers, so the match can say WHICH records ticked a line off
	 * (user decision 2026-09-01: the plan and the log are one section, and a checked line
	 * shows what was actually done under what was asked for). Optional throughout: the
	 * matcher's older callers pass names and set counts only, and the tick has never needed
	 * more than that.
	 */
	id?: string | null;
	logged_at?: string | null;
	reps?: number | null;
	load_lb?: number | null;
	duration_min?: number | null;
	kcal?: number | null;
}

/**
 * One logged record that ticked a plan item off — enough to draw its "truth line" and to
 * open it. The app never re-derives this matching: it is the same computation the tick is
 * made from, and two matchers would eventually disagree about the same row.
 */
export interface CompletionRecord {
	id: string;
	logged_at: string | null;
	sets: number | null;
	reps: number | null;
	load_lb: number | null;
	duration_min: number | null;
	kcal: number | null;
}

export interface ExerciseCompletion {
	/** True once every prescribed set has been logged (or once any set has, with no target). */
	done: boolean;
	/** Sets logged against this movement today, summed over every row that matched. */
	sets_done: number;
	/** What the brief asked for; null when it prescribed no set count (cardio, a hold). */
	sets_prescribed: number | null;
	/** True when something was logged but not all of it — the "2 of 3" state. */
	partial: boolean;
	/**
	 * The rows that matched, in the order they were logged (additive, 2026-09-01). Several
	 * is normal and is the whole reason this is a list: a drop set corrected into two
	 * records is two rows against one prescribed line, and both have to be reachable.
	 *
	 * Only rows that carry an id appear here — a caller that matched on names alone has
	 * nothing to point at, and an empty list is the honest answer for it.
	 */
	records: CompletionRecord[];
}

/**
 * Words that join a name together without saying what the movement is. Fewer than
 * exerciseMatch's list on purpose: this compares two exercise NAMES, not a rambling
 * description against the catalogue.
 */
const JOINERS = new Set(["a", "an", "the", "and", "with", "on", "of", "for", "x"]);

/** "ups" → "up", "presses" → "presse". Crude, and applied to both sides, so it is fair. */
function singular(word: string): string {
	if (word.length > 3 && word.endsWith("es") && !word.endsWith("ses")) return word.slice(0, -2);
	if (word.length > 2 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
	return word;
}

/**
 * The key two names are compared on: normalised, joiners dropped, singularised, sorted.
 *
 * Sorted, so "dumbbell bench press" and "bench press with dumbbells" are one movement — the
 * log and the brief write names in whatever order they were said, and word order is not a
 * fact about the exercise. What word order would have protected (a qualifier the other side
 * does not carry) is protected properly, by `qualifiersIn`, one line below.
 */
export function movementKey(name: string | null | undefined): string {
	return tokenize(name ?? "")
		.map(singular)
		.filter((token) => !JOINERS.has(token))
		.sort()
		.join(" ");
}

/** Two names are the same movement: same key, and neither carries a qualifier the other lacks. */
export function sameMovement(a: string | null | undefined, b: string | null | undefined): boolean {
	const left = movementKey(a);
	if (left === "" || left !== movementKey(b)) return false;
	// Belt and braces: an equal key almost always implies equal qualifiers, and "almost" is
	// how "assisted chin up" got saved as a chin-up in the first place.
	const qualifiersA = qualifiersIn(a ?? "");
	const qualifiersB = qualifiersIn(b ?? "");
	return (
		qualifiersA.length === qualifiersB.length && qualifiersA.every((qualifier) => qualifiersB.includes(qualifier))
	);
}

/** Whether one logged row is this planned exercise being done. Id first, then the name. */
export function matchesPlanned(planned: PlannedExercise, logged: LoggedExercise): boolean {
	if (planned.exercise_id && logged.exercise_id) return planned.exercise_id === logged.exercise_id;
	return sameMovement(planned.name, logged.exercise);
}

/**
 * The completion state of one prescribed exercise against everything logged today.
 *
 * Sets are summed across rows, because three logged sets of bench in one visit may arrive as
 * three rows or as one row saying "3 sets" — the day model already treats them as one
 * session and so does this. A row with no set count on it still counts as *something done*:
 * "I did the lat pulldown" with no numbers is not nothing.
 */
export function completionFor(planned: PlannedExercise, logged: readonly LoggedExercise[]): ExerciseCompletion {
	const matches = logged.filter((row) => matchesPlanned(planned, row));
	const prescribed = planned.sets ?? null;
	const records = recordsOf(matches);
	if (matches.length === 0) {
		return { done: false, sets_done: 0, sets_prescribed: prescribed, partial: false, records };
	}
	const setsDone = matches.reduce((total, row) => total + (row.sets ?? 0), 0);
	// Nothing said how many sets: any matching row is the movement done.
	if (prescribed == null) return { done: true, sets_done: setsDone, sets_prescribed: null, partial: false, records };
	// Rows with no set count at all: the movement happened, and we cannot count it against
	// a target, so it reads as done rather than as "0 of 3".
	if (setsDone === 0) return { done: true, sets_done: 0, sets_prescribed: prescribed, partial: false, records };
	const done = setsDone >= prescribed;
	return { done, sets_done: setsDone, sets_prescribed: prescribed, partial: !done, records };
}

/** The matched rows that can actually be pointed at, oldest first. */
function recordsOf(matches: readonly LoggedExercise[]): CompletionRecord[] {
	return matches
		.filter((row): row is LoggedExercise & { id: string } => typeof row.id === "string" && row.id !== "")
		.map((row) => ({
			id: row.id,
			logged_at: row.logged_at ?? null,
			sets: row.sets ?? null,
			reps: row.reps ?? null,
			load_lb: row.load_lb ?? null,
			duration_min: row.duration_min ?? null,
			kcal: row.kcal ?? null,
		}))
		.sort((a, b) => (a.logged_at ?? "").localeCompare(b.logged_at ?? ""));
}

/** Every line of the Do list, in order, with its completion beside it. */
export function completionOf<T extends PlannedExercise>(
	exercises: readonly T[],
	logged: readonly LoggedExercise[]
): (T & { completion: ExerciseCompletion })[] {
	return exercises.map((exercise) => ({ ...exercise, completion: completionFor(exercise, logged) }));
}

/** True when every line of a non-empty Do list is done — the "Plan complete" state. */
export function planIsComplete(completions: readonly { completion: ExerciseCompletion }[]): boolean {
	return completions.length > 0 && completions.every((item) => item.completion.done);
}
