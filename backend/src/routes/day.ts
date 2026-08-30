import { Router, type Response } from "express";
import type pg from "pg";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { computeDay, dayNumberFrom, firstActiveDate, type DayView } from "../services/day.js";
import { closeDay, closeDueDays } from "../services/dayClose.js";
import { verdictWords, type DayStatus, type Verdict } from "../services/goals/verdict.js";
import { addDays, datesEndingOn, isIsoDate, localDay, type IsoDate } from "../services/localTime.js";
import type { DayReadings } from "../services/readings/readings.js";

// The day, the week and the list of days (docs/build-plan.md §WP3).
//
//   GET  /api/day/:date?tz=      one day — live when it is today, the record when it is past
//   GET  /api/week?end=&tz=      seven statuses and verdicts, plus the week's deficit
//   GET  /api/days?before=&tz=   the Days list, paged
//   POST /api/day/close          close past days now (tests, admin, the seed script)
//
// Every one of them closes the user's unclosed past days first. That is the whole of the
// "day close job": there is no scheduler, because only the phone knows when its owner's
// midnight was — it sends `tz`, and the first request after midnight does the work
// (services/dayClose.ts).

/** Minutes to add to UTC for local time. ±14 h covers every real zone. */
const tzOffset = z.coerce.number().int().min(-840).max(840).default(0);

const DayQuery = z.object({ tz: tzOffset });
const WeekQuery = z.object({ tz: tzOffset, end: z.string().optional() });
const DaysQuery = z.object({
	tz: tzOffset,
	before: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(60).default(14),
});
const CloseBody = z.object({
	tz_offset_min: z.number().int().min(-840).max(840).default(0),
	/** One named day instead of everything due. Must be in the past. */
	date: z.string().optional(),
});

function badRequest(res: Response, message: string, issues?: unknown): void {
	res.status(400).json({ error: message, ...(issues ? { issues } : {}) });
}

/** `facts` is the 28-day window the measure calculators read — server-side only. */
function toBody(view: DayView): Omit<DayView, "facts"> {
	const { facts, ...rest } = view;
	return rest;
}

interface SummaryRow {
	date: IsoDate;
	eaten: number | null;
	earned: number | null;
	allowance: number | null;
	tdee: number | null;
	status: DayStatus | null;
	verdict: Verdict | null;
	in_short: string | null;
	summary_line: string | null;
	meal_count: number | null;
	weight_lb: number | null;
	muscle_groups: string[] | null;
	closed_at: string | null;
}

export interface DayRow {
	date: IsoDate;
	day_number: number;
	is_today: boolean;
	closed: boolean;
	status: DayStatus;
	verdict: Verdict;
	verdict_words: string;
	summary: string;
	in_short: string | null;
	eaten: number | null;
	earned: number | null;
	allowance: number | null;
	balance: number | null;
	weight_lb: number | null;
	muscle_groups: string[];
}

function rowFromSummary(row: SummaryRow, dayNumber: number): DayRow {
	const status = row.status ?? "none";
	const over = row.allowance == null || row.eaten == null ? null : row.eaten - row.allowance;
	return {
		date: row.date,
		day_number: dayNumber,
		is_today: false,
		closed: row.closed_at !== null,
		status,
		verdict: row.verdict ?? "none",
		verdict_words: verdictWords(row.verdict ?? "none", status, over),
		summary: row.summary_line ?? "Nothing logged",
		in_short: row.in_short,
		eaten: row.eaten,
		earned: row.earned,
		allowance: row.allowance,
		balance: row.tdee == null ? null : Math.round(row.tdee + (row.earned ?? 0) - (row.eaten ?? 0)),
		weight_lb: row.weight_lb,
		muscle_groups: row.muscle_groups ?? [],
	};
}

function rowFromView(view: DayView): DayRow {
	return {
		date: view.date,
		day_number: view.day_number,
		is_today: view.is_today,
		closed: view.closed_at !== null,
		status: view.status,
		verdict: view.verdict,
		verdict_words: view.verdict_words,
		summary: view.summary_line,
		in_short: null,
		eaten: view.eaten,
		earned: view.earned,
		allowance: view.allowance,
		balance: view.balance,
		weight_lb: view.weight.day,
		muscle_groups: view.muscle_groups,
	};
}

export function dayRouter(pool: pg.Pool, readings: DayReadings): Router {
	const router = Router();

	async function summariesFor(userId: string, dates: IsoDate[]): Promise<Map<IsoDate, SummaryRow>> {
		if (dates.length === 0) return new Map();
		const { rows } = await pool.query<SummaryRow>(
			`SELECT date, eaten, earned, allowance, tdee, status, verdict, in_short, summary_line,
			        meal_count, weight_lb, muscle_groups, closed_at
			   FROM daily_summaries WHERE user_id = $1 AND date = ANY($2::date[])`,
			[userId, dates]
		);
		return new Map(rows.map((row) => [row.date, row]));
	}

	router.get("/api/day/:date", async (req: AuthenticatedRequest, res) => {
		const parsed = DayQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		const tzOffsetMin = parsed.data.tz;
		const userId = req.userId!;
		const now = new Date();
		const today = localDay(now, tzOffsetMin).date;

		const asked = req.params.date as string;
		const date = asked === "today" ? today : asked;
		if (!isIsoDate(date)) return badRequest(res, `"${asked}" is not a date. Use YYYY-MM-DD or "today".`);
		if (date > today) return badRequest(res, "That day has not happened yet.");

		await closeDueDays(pool, readings, { userId, tzOffsetMin, now });

		const view = await computeDay(pool, { userId, date, tzOffsetMin, now });
		// Today reads live and its reading follows the day; a closed day's reading was
		// written once at close and is only generated here if the close could not (no key
		// at the time, a provider outage).
		const reading = view.is_today
			? await readings.rightNow(pool, userId, view, now)
			: ((await readings.cached(pool, userId, date, "in_short")) ?? (await readings.inShort(pool, userId, view)));

		res.json({ ...toBody(view), reading });
	});

	router.get("/api/week", async (req: AuthenticatedRequest, res) => {
		const parsed = WeekQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		const { tz: tzOffsetMin } = parsed.data;
		const userId = req.userId!;
		const now = new Date();
		const today = localDay(now, tzOffsetMin).date;
		const end = parsed.data.end ?? today;
		if (!isIsoDate(end)) return badRequest(res, `"${parsed.data.end}" is not a date.`);

		await closeDueDays(pool, readings, { userId, tzOffsetMin, now });

		const dates = datesEndingOn(end, 7).filter((date) => date <= today);
		const summaries = await summariesFor(userId, dates);
		const firstDate = await firstActiveDate(pool, userId, tzOffsetMin);

		const days: DayRow[] = [];
		for (const date of dates) {
			const summary = summaries.get(date);
			// A closed day is read from its record; today (and any day the close skipped
			// because it had nothing in it) is computed.
			if (summary?.closed_at) days.push(rowFromSummary(summary, dayNumberFrom(firstDate, date)));
			else days.push(rowFromView(await computeDay(pool, { userId, date, tzOffsetMin, now })));
		}

		// "−2,900 of −3,500 this week": Σ(TDEE + earned − eaten), positive = a deficit.
		const balances = days.map((day) => day.balance).filter((value): value is number => value != null);
		res.json({
			end,
			start: dates[0] ?? end,
			days,
			weekly_deficit: balances.length === 0 ? null : balances.reduce((a, b) => a + b, 0),
			served: days.filter((day) => day.verdict === "served").length,
			judged: days.filter((day) => day.verdict === "served" || day.verdict === "missed").length,
		});
	});

	router.get("/api/days", async (req: AuthenticatedRequest, res) => {
		const parsed = DaysQuery.safeParse(req.query);
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		const { tz: tzOffsetMin, limit } = parsed.data;
		const userId = req.userId!;
		const now = new Date();
		const today = localDay(now, tzOffsetMin).date;
		if (parsed.data.before !== undefined && !isIsoDate(parsed.data.before)) {
			return badRequest(res, `"${parsed.data.before}" is not a date.`);
		}
		const before = parsed.data.before ?? addDays(today, 1);

		await closeDueDays(pool, readings, { userId, tzOffsetMin, now });

		const firstDate = await firstActiveDate(pool, userId, tzOffsetMin);
		const rows: DayRow[] = [];

		// The open day is not in daily_summaries — it is still being written. It leads the
		// list when the page starts at the top.
		if (today < before) {
			const view = await computeDay(pool, { userId, date: today, tzOffsetMin, now });
			rows.push(rowFromView(view));
		}

		const { rows: summaries } = await pool.query<SummaryRow>(
			`SELECT date, eaten, earned, allowance, tdee, status, verdict, in_short, summary_line,
			        meal_count, weight_lb, muscle_groups, closed_at
			   FROM daily_summaries
			  WHERE user_id = $1 AND date < $2::date AND date < $3::date
			  ORDER BY date DESC LIMIT $4`,
			[userId, before, today, limit]
		);
		for (const summary of summaries) rows.push(rowFromSummary(summary, dayNumberFrom(firstDate, summary.date)));

		const last = summaries.at(-1);
		res.json({
			days: rows,
			// Ask for the next page with this; null when there is nothing older.
			next_before: summaries.length === limit && last ? last.date : null,
		});
	});

	router.post("/api/day/close", async (req: AuthenticatedRequest, res) => {
		const parsed = CloseBody.safeParse(req.body ?? {});
		if (!parsed.success) return badRequest(res, "Invalid request.", parsed.error.issues);
		const tzOffsetMin = parsed.data.tz_offset_min;
		const userId = req.userId!;
		const now = new Date();
		const today = localDay(now, tzOffsetMin).date;

		if (parsed.data.date !== undefined) {
			const date = parsed.data.date;
			if (!isIsoDate(date)) return badRequest(res, `"${date}" is not a date.`);
			// The live day cannot close: it is not over, and a record of it would be a lie
			// that the next log would have to contradict.
			if (date >= today) return badRequest(res, "That day is still running.");
			const view = await closeDay(pool, readings, date, { userId, tzOffsetMin, now });
			res.json({ closed: view ? [date] : [], already_closed: view ? 0 : 1 });
			return;
		}

		const report = await closeDueDays(pool, readings, { userId, tzOffsetMin, now });
		res.json({ closed: report.closed, already_closed: report.alreadyClosed });
	});

	return router;
}
