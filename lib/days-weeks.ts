import type { DayRow, IsoDate, WeekView } from '@/lib/types';

// The Days tab groups its rows by week and puts a tally on each one — "5 of 7 served ·
// −3,100 · −0.9 lb" (docs/design-system.md §Days). Pure, like lib/today-cards.ts: rows in,
// weeks out, so the arithmetic is testable without a renderer or a server.
//
// The tally is computed from the rows themselves rather than asked for per week: one
// `GET /api/days` page already carries every number it needs (verdict, balance, weight),
// and seven extra requests to say "5 of 7" would be seven extra requests. `GET /api/week`
// is still the authority for the week the user is living — pass it in and its `served` and
// `weekly_deficit` win, because that week is the one the rest of the app is judging.

export type WeekGroup = {
  /** The Monday the week starts on — the group's identity. */
  key: IsoDate;
  label: string;
  tally: string | null;
  /** Newest first, as they arrived. */
  days: DayRow[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(date: IsoDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

/** Days are calendar dates, never instants: everything here is UTC-noon arithmetic. */
function asUtc(date: IsoDate): Date {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function toIso(at: Date): IsoDate {
  return at.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` shifted by whole calendar days — the Day screen's ‹ › navigation. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const at = asUtc(date);
  at.setUTCDate(at.getUTCDate() + days);
  return toIso(at);
}

/** The Monday of the week `date` falls in. Weeks start on Monday. */
export function weekStart(date: IsoDate): IsoDate {
  const at = asUtc(date);
  const monday = (at.getUTCDay() + 6) % 7;
  at.setUTCDate(at.getUTCDate() - monday);
  return toIso(at);
}

/** "17 Aug" — the week eyebrow's date, without the weekday the rows already show. */
export function shortDate(date: IsoDate): string {
  const { m, d } = parts(date);
  return `${d} ${MONTHS[m - 1] ?? ''}`.trim();
}

/** "Mon" — the row's weekday. */
export function weekdayLabel(date: IsoDate): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][asUtc(date).getUTCDay()] ?? '';
}

const kcal = (value: number) => Math.round(Math.abs(value)).toLocaleString('en-US');

/** "−3,100": a positive balance is a deficit, which is what the minus sign means here. */
function deficitWords(total: number): string {
  return `${total >= 0 ? '−' : '+'}${kcal(total)}`;
}

function weightWords(days: DayRow[]): string | null {
  // Oldest first, so "the change across the week" is last minus first.
  const weighed = [...days].sort((a, b) => a.date.localeCompare(b.date)).filter((day) => day.weight_lb != null);
  const first = weighed[0]?.weight_lb;
  const last = weighed[weighed.length - 1]?.weight_lb;
  if (first == null || last == null || weighed.length < 2) return null;
  const change = last - first;
  if (Math.abs(change) < 0.05) return 'no change';
  return `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(1)} lb`;
}

/**
 * The tally line. Each part is dropped when its fact is missing rather than shown as a
 * zero: "0 of 0 served" is not a summary of a week nobody logged.
 */
export function tallyFor(days: DayRow[], week?: WeekView | null): string | null {
  const judged = week ? week.judged : days.filter((day) => day.verdict === 'served' || day.verdict === 'missed').length;
  const served = week ? week.served : days.filter((day) => day.verdict === 'served').length;

  const balances = days.map((day) => day.balance).filter((value): value is number => value != null);
  const deficit = week?.weekly_deficit ?? (balances.length > 0 ? balances.reduce((a, b) => a + b, 0) : null);

  const parts: string[] = [];
  if (judged > 0) parts.push(`${served} of ${judged} served`);
  if (deficit != null) parts.push(deficitWords(deficit));
  const weight = weightWords(days);
  if (weight) parts.push(weight);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * Group the day rows into weeks, newest week first, keeping the order the rows arrived in
 * inside each one. A week the page only partly covers is still a group — the next page
 * appends to it rather than opening a second heading for the same Monday.
 */
export function groupByWeek(days: DayRow[], week?: WeekView | null): WeekGroup[] {
  const groups = new Map<IsoDate, DayRow[]>();
  for (const day of days) {
    const key = weekStart(day.date);
    const list = groups.get(key);
    if (list) list.push(day);
    else groups.set(key, [day]);
  }

  const currentWeek = week ? weekStart(week.end) : null;
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, rows]) => ({
      key,
      label: rows.some((row) => row.is_today) ? 'This week' : `Week of ${shortDate(key)}`,
      tally: tallyFor(rows, key === currentWeek ? week : null),
      days: rows,
    }));
}
