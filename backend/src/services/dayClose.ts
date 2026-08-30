import type pg from "pg";
import { computeDay, type DayView } from "./day.js";
import { addDays, localDateOf, localDay, type IsoDate } from "./localTime.js";
import type { DayReadings } from "./readings/readings.js";

// Day close (docs/concept-v2.md §The day is the session: "at day end — midnight, or the
// next app open — the day closes itself into a daily record. Nothing for the user to
// remember").
//
// There is no cron. The close runs on the first request after the user's local midnight,
// which is the only moment we can be sure their day is over: the phone sends its offset,
// and every unclosed past day with anything in it is written into `daily_summaries` and
// given its `in_short` reading. A user in Berlin and one in Los Angeles close eleven hours
// apart, and neither needs a scheduler that knows where they are.
//
// Closing is idempotent. `closed_at` is the flag: a day that has one is never rewritten, so
// a burst of requests at 00:01, a retry, and `POST /api/day/close` all converge on the same
// record — and the reading, which costs money, is generated once.

type Queryable = pg.Pool | pg.PoolClient;

/**
 * How far back a close will reach. Someone returning after a month gets their last 60 days
 * closed and the rest left alone: a day with no logs has nothing to record, and a summary
 * of nothing is not worth the write.
 */
export const MAX_CLOSE_LOOKBACK_DAYS = 60;

export interface CloseOptions {
	userId: string;
	tzOffsetMin: number;
	/** The instant "now" is read from; the local day around it is the one left open. */
	now?: Date;
	/** Skip the LLM entirely (the seed script's first pass, tests that do not care). */
	withoutReading?: boolean;
}

export interface CloseReport {
	/** Dates closed by this call, oldest first. */
	closed: IsoDate[];
	/** Dates that were already closed and left alone. */
	alreadyClosed: number;
}

/** Every past local date with something logged on it, newest last. */
async function unclosedDates(db: Queryable, userId: string, tzOffsetMin: number, today: IsoDate): Promise<IsoDate[]> {
	const from = addDays(today, -MAX_CLOSE_LOOKBACK_DAYS);
	const start = new Date(Date.parse(`${from}T00:00:00Z`) - tzOffsetMin * 60_000).toISOString();
	const end = new Date(Date.parse(`${today}T00:00:00Z`) - tzOffsetMin * 60_000).toISOString();

	const { rows } = await db.query<{ logged_at: string }>(
		`SELECT logged_at FROM meals WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3
		 UNION ALL
		 SELECT logged_at FROM activities WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3
		 UNION ALL
		 SELECT logged_at FROM weight_logs WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3`,
		[userId, start, end]
	);

	const dates = new Set<IsoDate>();
	for (const row of rows) {
		const date = localDateOf(row.logged_at, tzOffsetMin);
		// The UTC window is a superset of the local one at the edges; the local date decides.
		if (date < today && date >= from) dates.add(date);
	}

	const closed = await db.query<{ date: IsoDate }>(
		`SELECT date FROM daily_summaries WHERE user_id = $1 AND date >= $2::date AND closed_at IS NOT NULL`,
		[userId, from]
	);
	for (const row of closed.rows) dates.delete(row.date);

	return [...dates].sort();
}

/**
 * Write one day into `daily_summaries` and give it its reading. Returns the view it was
 * written from, or null when the day was already closed — the caller's cue that there was
 * nothing to do and no reading to pay for.
 */
export async function closeDay(
	pool: pg.Pool,
	readings: DayReadings,
	date: IsoDate,
	{ userId, tzOffsetMin, now = new Date(), withoutReading = false }: CloseOptions
): Promise<DayView | null> {
	const view = await computeDay(pool, { userId, date, tzOffsetMin, now });
	if (view.closed_at) return null;

	const macros = view.macros;
	const inserted = await pool.query<{ date: IsoDate }>(
		`INSERT INTO daily_summaries (
			user_id, date, kcal_consumed, kcal_burned, protein_g, carbs_g, fat_g, fiber_g, weight_lb,
			eaten, earned, allowance, status, verdict, blocks, muscle_groups, summary_line, meal_count, tdee, closed_at
		 ) VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::text[], $17, $18, $19, NOW())
		 ON CONFLICT (user_id, date) DO UPDATE SET
			kcal_consumed = EXCLUDED.kcal_consumed, kcal_burned = EXCLUDED.kcal_burned,
			protein_g = EXCLUDED.protein_g, carbs_g = EXCLUDED.carbs_g, fat_g = EXCLUDED.fat_g,
			fiber_g = EXCLUDED.fiber_g, weight_lb = EXCLUDED.weight_lb, eaten = EXCLUDED.eaten,
			earned = EXCLUDED.earned, allowance = EXCLUDED.allowance, status = EXCLUDED.status,
			verdict = EXCLUDED.verdict, blocks = EXCLUDED.blocks, muscle_groups = EXCLUDED.muscle_groups,
			summary_line = EXCLUDED.summary_line, meal_count = EXCLUDED.meal_count, tdee = EXCLUDED.tdee,
			closed_at = NOW()
		 -- The idempotency guard: a day that has closed is a record, not a cache. Re-running
		 -- the close (a retry, a second request at 00:01, the admin endpoint) touches nothing.
		 WHERE daily_summaries.closed_at IS NULL
		 RETURNING date`,
		[
			userId,
			date,
			view.eaten,
			view.earned,
			macros.protein_g.eaten ?? 0,
			macros.carbs_g.eaten ?? 0,
			macros.fat_g.eaten ?? 0,
			macros.fiber_g.eaten ?? 0,
			view.weight.day,
			view.eaten,
			view.earned,
			view.allowance,
			// The column allows on_track | over | under only: "none" is the absence of a
			// judgement, which is a NULL, not a fourth verdict.
			view.status === "none" ? null : view.status,
			view.verdict,
			JSON.stringify(view.blocks),
			view.muscle_groups,
			view.summary_line,
			view.items.meals.length,
			view.tdee,
		]
	);

	// Lost the race with a concurrent close: the other one owns the reading too.
	if (inserted.rowCount === 0) return null;

	if (!withoutReading) {
		const reading = await readings.inShort(pool, userId, view);
		if (reading) {
			// Copied onto the summary as well as living in day_readings, so the closed-day
			// record is self-contained for the coach and for an export.
			await pool.query(`UPDATE daily_summaries SET in_short = $3 WHERE user_id = $1 AND date = $2::date`, [
				userId,
				date,
				reading.text,
			]);
		}
	}

	return view;
}

/**
 * Close every unclosed past day. Called at the top of each day-shaped request, which is
 * what "on the first request after local midnight" means in practice — the second request
 * finds nothing to do and costs one indexed query.
 */
export async function closeDueDays(
	pool: pg.Pool,
	readings: DayReadings,
	options: CloseOptions
): Promise<CloseReport> {
	const now = options.now ?? new Date();
	const today = localDay(now, options.tzOffsetMin).date;
	const due = await unclosedDates(pool, options.userId, options.tzOffsetMin, today);

	const closed: IsoDate[] = [];
	let alreadyClosed = 0;
	for (const date of due) {
		const view = await closeDay(pool, readings, date, { ...options, now });
		if (view) closed.push(date);
		else alreadyClosed += 1;
	}
	return { closed, alreadyClosed };
}
