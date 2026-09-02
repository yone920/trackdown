import type { DayRow, IsoDate, Verdict } from '@/lib/types';

// The month grid, as arithmetic (user request 2026-09-02: "the train only shows today …
// there should be some sort of calendar so anyone can easily go back and see what they did
// last week or a specific day. Same for the eat").
//
// Everything about *what a month looks like* lives here rather than in the sheet, for the
// same reason lib/scoreboard.ts exists: a grid that pads the wrong number of leading cells,
// or colours a dot from the wrong verdict, is a bug you want a test to find and not a
// screenshot. The component draws what these functions return and decides nothing.
//
// Dates are handled as `YYYY-MM-DD` strings and built with local `Date` parts only — never
// `new Date(iso)`, which parses as UTC and lands on the previous day for anybody west of
// Greenwich (the same trap lib/format.ts §dateLabel documents).

/** A month, as `YYYY-MM`. The unit the sheet pages through. */
export type MonthKey = string;

export const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** The month a date belongs to. */
export function monthOf(date: IsoDate): MonthKey {
  return date.slice(0, 7);
}

/** "September 2026" — the sheet's title. */
export function monthTitle(month: MonthKey): string {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return month;
  return new Date(year, index - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** The month before or after this one, rolling the year over. */
export function shiftMonth(month: MonthKey, by: number): MonthKey {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return month;
  const moved = new Date(year, index - 1 + by, 1);
  return `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The window to ask `GET /api/days` for.
 *
 * `before` is EXCLUSIVE on that endpoint and the list comes back newest first, so the first
 * day of the NEXT month plus a limit of 31 covers any month exactly. A month with gaps in it
 * spills a few rows out of the older end of the window, which costs nothing: the sheet keeps
 * the days whose date is in the month and ignores the rest.
 */
export function monthWindow(month: MonthKey): { before: IsoDate; limit: number } {
  return { before: `${shiftMonth(month, 1)}-01`, limit: 31 };
}

/** How many days that month has. */
export function daysInMonth(month: MonthKey): number {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return 0;
  return new Date(year, index, 0).getDate();
}

export type CalendarCell = {
  /** Null in the padding cells before the 1st and after the last. */
  date: IsoDate | null;
  /** The number drawn in the cell. */
  day: number | null;
  isToday: boolean;
  /** A day that has not happened yet cannot be read, so it is not a door. */
  future: boolean;
};

/**
 * The month as weeks of seven, **Monday first**. Padding cells carry no date, so the grid is
 * always rectangular and a renderer never has to know which day the 1st fell on.
 */
export function monthGrid(month: MonthKey, today: IsoDate): CalendarCell[][] {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return [];
  const total = daysInMonth(month);
  // JS weeks start on Sunday; this grid starts on Monday.
  const lead = (new Date(year, index - 1, 1).getDay() + 6) % 7;

  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i += 1) cells.push({ date: null, day: null, isToday: false, future: false });
  for (let day = 1; day <= total; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    cells.push({ date, day, isToday: date === today, future: date > today });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null, isToday: false, future: false });

  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The three things a dot can say. Nothing at all for a day with no log — an empty day is empty. */
export type DotTone = 'good' | 'mute' | 'accent';

/**
 * The dot under a date: the day's own verdict, in the colours the Days list already uses
 * (components/days-list.tsx). `served` is green, `missed` is accent, and a day that was
 * logged but not judged — the open day, a day with no goal to serve — is a quiet mute dot,
 * because "something happened here" is worth seeing even when nothing was judged.
 */
export function dotTone(row: DayRow | undefined): DotTone | null {
  if (!row) return null;
  const verdict: Verdict = row.verdict;
  if (verdict === 'served') return 'good';
  if (verdict === 'missed') return 'accent';
  // No verdict: only a day with something actually on it gets a mark.
  return hasSomething(row) ? 'mute' : null;
}

/** Did anything happen on this day? A number logged, food, training, or a weigh-in. */
function hasSomething(row: DayRow): boolean {
  return (
    (row.eaten ?? 0) > 0 ||
    (row.earned ?? 0) > 0 ||
    row.weight_lb != null ||
    row.muscle_groups.length > 0 ||
    row.closed
  );
}

/** The month's rows, by date, ignoring anything the window spilled from a neighbouring month. */
export function rowsByDate(rows: readonly DayRow[], month: MonthKey): Map<IsoDate, DayRow> {
  return new Map(rows.filter((row) => monthOf(row.date) === month).map((row) => [row.date, row]));
}
