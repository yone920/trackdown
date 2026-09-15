import type pg from "pg";
import { lookupExercises } from "../entries.js";
import { localDay, type IsoDate } from "../localTime.js";
import { loadBoard, type BoardCardioNext, type BoardNextStep } from "./board.js";

// One exercise, all of it (user field report 2026-09-02, on All lifts: "60 lb · today …
// doesn't have enough detail … the historic loads, the progress of the load … which
// direction I'm going").
//
// The board answers "where does this movement stand" in one row, over four weeks. This
// answers "how did it get there", over everything that was ever logged: a session per day,
// newest first, each one carrying the id of the row it came from so it can be corrected
// from the list.
//
// **Additive.** Nothing here changes the board, and the progression state on the header is
// not recomputed: it is READ OFF THE BOARD (`loadBoard`), so the sentence on this screen and
// the sentence on the row that opened it cannot drift apart. That costs one extra read of
// the four-week window per open, which is the price of there being exactly one progression
// engine in this codebase.

/** How far back the list goes. Two years of sessions is a list nobody scrolls past. */
const HISTORY_DAYS = 730;
/** And a hard cap on rows, so a pathological log cannot make an unbounded response. */
const MAX_SESSIONS = 400;

export interface ExerciseSession {
	/** The user's local calendar day the session fell on. */
	date: IsoDate;
	/** The row this session's numbers came from — what a tap opens for a correction. */
	id: string | null;
	logged_at: string;
	/** The top working set of that day: the heaviest, and the fullest of the ties. */
	load_lb: number | null;
	sets: number | null;
	reps: number | null;
	duration_min: number | null;
	distance_mi: number | null;
	/** Minutes per mile, when the session measured both. */
	pace_min_mi: number | null;
	kcal: number;
	/** How many rows were logged for this exercise that day; 1 for almost every session. */
	entries: number;
}

export interface ExerciseHistory {
	exercise: string;
	exercise_id: string | null;
	media_count: number;
	category: string | null;
	muscle_groups: string[];
	equipment: string[];
	load_direction: "resistance" | "assistance";
	/** Newest first — the order the list is read in. */
	sessions: ExerciseSession[];
	/** The board's own next step, or null for a movement it has nothing to say about. */
	next: BoardNextStep | BoardCardioNext | null;
	best_load_lb: number | null;
	first_date: IsoDate | null;
	sessions_count: number;
}

interface Row {
	id: string;
	logged_at: string;
	exercise: string | null;
	category: string | null;
	muscle_groups: string[] | null;
	equipment: string[] | null;
	sets: number | null;
	reps: number | null;
	load_lb: string | number | null;
	duration_min: string | number | null;
	distance_mi: string | number | null;
	kcal: string | number | null;
}

/** The same shape `loadBoard` takes: a pool or a client checked out of one. */
type Queryable = pg.Pool | pg.PoolClient;

const num = (value: string | number | null | undefined): number | null => {
	if (value === null || value === undefined) return null;
	const parsed = typeof value === "string" ? Number(value) : value;
	return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Which of a day's rows is "the session": the heaviest working set, and among equal loads
 * the one that did the most work. A day with three rows of the same lift is one session in
 * this list — the alternative is a chart with three dots on one date, which reads as three
 * sessions and is a lie about frequency.
 */
function topOf(rows: Row[]): Row {
	return [...rows].sort((a, b) => {
		const load = (num(b.load_lb) ?? -1) - (num(a.load_lb) ?? -1);
		if (load !== 0) return load;
		const work = (b.sets ?? 0) * (b.reps ?? 0) - (a.sets ?? 0) * (a.reps ?? 0);
		if (work !== 0) return work;
		return (num(b.duration_min) ?? 0) - (num(a.duration_min) ?? 0);
	})[0] as Row;
}

export interface LoadHistoryOptions {
	exercise: string;
	tzOffsetMin: number;
	now?: Date;
}

export async function loadExerciseHistory(
	db: Queryable,
	userId: string,
	{ exercise, tzOffsetMin, now = new Date() }: LoadHistoryOptions
): Promise<ExerciseHistory | null> {
	const wanted = exercise.trim();
	if (wanted === "") return null;

	const { rows } = await db.query<Row>(
		`SELECT id, logged_at, exercise, category, muscle_groups, equipment, sets, reps,
		        load_lb, duration_min, distance_mi, kcal
		   FROM activities
		  WHERE user_id = $1
		    AND lower(exercise) = lower($2)
		    AND logged_at >= NOW() - ($3 || ' days')::interval
		  ORDER BY logged_at DESC`,
		[userId, wanted, String(HISTORY_DAYS)]
	);

	// A name nobody has ever logged has no history to show. Deliberately null rather than an
	// empty history: the screen can say "nothing logged" for a real exercise, and a
	// mistyped name is a 404 rather than a page of nothing.
	if (rows.length === 0) return null;

	// One session per local day, newest first.
	const byDate = new Map<IsoDate, Row[]>();
	for (const row of rows) {
		const date = localDay(new Date(row.logged_at), tzOffsetMin).date;
		byDate.set(date, [...(byDate.get(date) ?? []), row]);
	}
	const sessions: ExerciseSession[] = [...byDate.entries()]
		.sort((a, b) => b[0].localeCompare(a[0]))
		.slice(0, MAX_SESSIONS)
		.map(([date, dayRows]) => {
			const top = topOf(dayRows);
			const minutes = num(top.duration_min);
			const miles = num(top.distance_mi);
			return {
				date,
				id: top.id,
				logged_at: top.logged_at,
				load_lb: num(top.load_lb),
				sets: top.sets,
				reps: top.reps,
				duration_min: minutes,
				distance_mi: miles,
				pace_min_mi: minutes != null && miles != null && miles > 0 ? Math.round((minutes / miles) * 10) / 10 : null,
				// The day's whole cost, not the top set's: two rows of the same lift on one
				// day both happened, and the calories are what the day earned.
				kcal: dayRows.reduce((sum, row) => sum + (num(row.kcal) ?? 0), 0),
				entries: dayRows.length,
			};
		});

	const first = rows[rows.length - 1] as Row;
	const name = (rows[0] as Row).exercise?.trim() || wanted;
	const key = name.toLowerCase();

	const matches = await lookupExercises(db, [name]);
	const match = matches.get(key) ?? null;

	// The progression state, read off the board rather than recomputed — one engine, one
	// sentence (see the note at the top of this file). A movement that has fallen out of the
	// board's four-week window simply has no next step, which is the truth about it.
	const board = await loadBoard(db, userId, { tzOffsetMin, now });
	const lift = board.lifts.find((row) => row.exercise.trim().toLowerCase() === key) ?? null;
	const cardio = (board.cardio.activities ?? []).find((row) => row.exercise.trim().toLowerCase() === key) ?? null;

	const loads = sessions.map((session) => session.load_lb).filter((load): load is number => load != null);

	return {
		exercise: lift?.exercise ?? cardio?.exercise ?? match?.name ?? name,
		exercise_id: lift?.exercise_id ?? cardio?.exercise_id ?? match?.id ?? null,
		media_count: lift?.media_count ?? cardio?.media_count ?? match?.media_count ?? 0,
		category: lift?.category ?? cardio?.category ?? match?.category ?? (rows[0] as Row).category ?? null,
		muscle_groups: lift?.muscle_groups ?? match?.primary_muscles ?? (rows[0] as Row).muscle_groups ?? [],
		equipment: match?.equipment ?? (rows[0] as Row).equipment ?? [],
		load_direction: lift?.load_direction ?? match?.load_direction ?? "resistance",
		sessions,
		next: lift?.next ?? cardio?.next ?? null,
		best_load_lb: loads.length > 0 ? Math.max(...loads) : null,
		first_date: localDay(new Date(first.logged_at), tzOffsetMin).date,
		sessions_count: byDate.size,
	};
}
