// Local-day arithmetic. Day boundaries are the *user's* local midnight (docs/agent-brief.md
// §Units): the client sends `tz_offset_min` — minutes to add to UTC to get local time,
// which is `-new Date().getTimezoneOffset()` on the phone — and the server's own timezone
// is never consulted. It is a container in UTC and has no opinion about when someone's day
// starts.
//
// This module was `localDay` inside services/fusion/context.ts until WP3, which needed the
// same arithmetic in the day model, the close job and the week. One implementation, so a
// log at 23:30 in Los Angeles lands on the same date everywhere.

const MS_PER_MINUTE = 60_000;
export const MS_PER_DAY = 86_400_000;

/** A calendar date in the user's timezone, `YYYY-MM-DD`. */
export type IsoDate = string;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
	return typeof value === "string" && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export interface LocalDay {
	/** YYYY-MM-DD in the user's timezone. */
	date: IsoDate;
	/** HH:MM in the user's timezone. */
	time: string;
	/** UTC instants bounding that local day: [start, end). */
	startUtc: Date;
	endUtc: Date;
}

/** The user's local day around `instant`. */
export function localDay(instant: Date, tzOffsetMin: number): LocalDay {
	const shifted = new Date(instant.getTime() + tzOffsetMin * MS_PER_MINUTE);
	const date = shifted.toISOString().slice(0, 10);
	const time = shifted.toISOString().slice(11, 16);
	return { date, time, ...boundsOf(date, tzOffsetMin) };
}

/** The UTC window of one named local date. */
export function boundsOf(date: IsoDate, tzOffsetMin: number): { startUtc: Date; endUtc: Date } {
	const startUtc = new Date(Date.parse(`${date}T00:00:00Z`) - tzOffsetMin * MS_PER_MINUTE);
	return { startUtc, endUtc: new Date(startUtc.getTime() + MS_PER_DAY) };
}

/** Which local date an instant falls on. */
export function localDateOf(instant: string | Date, tzOffsetMin: number): IsoDate {
	const ms = typeof instant === "string" ? Date.parse(instant) : instant.getTime();
	return new Date(ms + tzOffsetMin * MS_PER_MINUTE).toISOString().slice(0, 10);
}

/** Minutes since the user's local midnight — 0 to 1439. What the day arc is drawn on. */
export function localMinutesOf(instant: string | Date, tzOffsetMin: number): number {
	const ms = typeof instant === "string" ? Date.parse(instant) : instant.getTime();
	const shifted = new Date(ms + tzOffsetMin * MS_PER_MINUTE);
	return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** The instant at `minutes` past local midnight on `date`. */
export function instantAt(date: IsoDate, tzOffsetMin: number, minutes: number): string {
	return new Date(boundsOf(date, tzOffsetMin).startUtc.getTime() + minutes * MS_PER_MINUTE).toISOString();
}

/** Calendar dates only: never differenced through the server's timezone. */
export function addDays(date: IsoDate, days: number): IsoDate {
	return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
	return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/** The `count` dates ending on `end`, oldest first. */
export function datesEndingOn(end: IsoDate, count: number): IsoDate[] {
	return Array.from({ length: count }, (_, i) => addDays(end, i - (count - 1)));
}

/** "6:10 pm" — the app's clock format, computed once here so every string matches. */
export function formatClock(minutes: number): string {
	const hour24 = Math.floor(minutes / 60) % 24;
	const minute = minutes % 60;
	const suffix = hour24 < 12 ? "am" : "pm";
	const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
	return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}
