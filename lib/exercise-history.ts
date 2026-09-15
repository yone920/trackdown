import { dateLabel } from '@/lib/format';
import { perSideNote } from '@/lib/plates';
import type { ExerciseHistory, ExerciseSession, IsoDate } from '@/lib/types';

// What one exercise's history SAYS (field report 2026-09-02, on All lifts: "60 lb · today
// … doesn't have enough detail … the historic loads, the progress of the load … which
// direction I'm going").
//
// The screen draws these; it works none of them out. Same rule as lib/scoreboard.ts, and
// for the same reason: a session line that renders "4 × 15 @ 60" for a lift and "20 min ·
// 1.2 mi · 16.7 min/mi" for a walk is a formatting decision with four branches in it, and
// four branches belong somewhere a test can reach without a renderer.

/** How many sessions it takes before a line through them is a trend rather than a guess. */
export const MIN_POINTS_FOR_LINE = 3;

/**
 * The line under the chart when there is not enough of it yet. Two dots joined up look
 * exactly like a trend and are not one — the goal card learnt this the hard way (field
 * report 2026-08-31: one weigh-in drew a tall empty box with a dashed line across it).
 */
export function sparseNote(count: number): string | null {
  if (count === 0) return 'Nothing logged yet.';
  if (count >= MIN_POINTS_FOR_LINE) return null;
  return count === 1
    ? 'First session — the line starts when there are three.'
    : 'First sessions — the line starts when there are three.';
}

/** "today", "yesterday", "Mon, Aug 31" — when a session was, as a person says it. */
export function sessionWhen(date: IsoDate, today: IsoDate): string {
  if (date === today) return 'Today';
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  if (days === 1) return 'Yesterday';
  return dateLabel(date);
}

const round1 = (value: number) => String(Math.round(value * 10) / 10);

/**
 * What was done, in the movement's own currency.
 *
 *   · a lift  — "4 × 15 @ 60 lb", or "4 × 15" for a band or a bodyweight movement, where
 *     there is no pound to print and inventing one would be a lie about the work.
 *   · cardio  — "20 min · 1.2 mi · 16.7 min/mi", as much of it as the session measured.
 *
 * On an assisted machine the load is the HELP, so it is named as such — the same rule the
 * board's rows follow (concept-v2 §Progression rules).
 */
export function sessionLine(
  session: ExerciseSession,
  { loadDirection = 'resistance' }: { loadDirection?: 'resistance' | 'assistance' } = {},
): string {
  const cardio: string[] = [];
  if (session.duration_min != null) cardio.push(`${round1(session.duration_min)} min`);
  if (session.distance_mi != null) cardio.push(`${round1(session.distance_mi)} mi`);
  if (session.pace_min_mi != null) cardio.push(`${round1(session.pace_min_mi)} min/mi`);
  if (cardio.length > 0) return cardio.join(' · ');

  const work = session.sets != null && session.reps != null ? `${session.sets} × ${session.reps}` : null;
  const load =
    session.load_lb == null
      ? null
      : loadDirection === 'assistance'
        ? `${round1(session.load_lb)} lb of assistance`
        : `${round1(session.load_lb)} lb`;

  if (work && load) return `${work} @ ${load}`;
  return work ?? load ?? 'Logged';
}

/**
 * The plates on the bar, when the bar is a barbell — "45s/side + bar". Only where the
 * helper applies: a machine's stack and a band have no per-side reading, and printing one
 * would be arithmetic about equipment that does not work that way (lib/plates.ts).
 */
export function sessionPerSide(session: ExerciseSession, equipment: readonly string[]): string | null {
  return perSideNote(session.load_lb, equipment);
}

/** "2 entries that day" — said only when a session was logged more than once. */
export function entriesNote(session: ExerciseSession): string | null {
  return session.entries > 1 ? `${session.entries} entries` : null;
}

export type HistoryPoint = { date: IsoDate; value: number };

/**
 * The points the chart draws, OLDEST first — a chart is read left to right, and the list
 * above it is newest first, so exactly one of the two has to be reversed and it is better
 * that it happens here than in a renderer.
 *
 * A lift is plotted by its top working load; anything measured in minutes is plotted by
 * minutes. A session with neither is not a point: a gap in a line is honest, a zero is not.
 */
export function historyPoints(history: ExerciseHistory): { points: HistoryPoint[]; unit: 'lb' | 'min' | null } {
  const byLoad = history.sessions.filter((session) => session.load_lb != null);
  const byMinutes = history.sessions.filter((session) => session.duration_min != null);
  const use = byLoad.length >= byMinutes.length ? byLoad : byMinutes;
  const unit = use.length === 0 ? null : use === byLoad ? 'lb' : 'min';
  return {
    points: [...use]
      .reverse()
      .map((session) => ({ date: session.date, value: (unit === 'lb' ? session.load_lb : session.duration_min) as number })),
    unit,
  };
}

/**
 * The header's state line: the coach's own next step, exactly as the row that opened this
 * screen shows it, with its reason under it. Never recomputed here — the server reads it
 * off the board so the two cannot drift (backend services/training/history.ts).
 */
export function stateLine(history: ExerciseHistory): { text: string; why: string | null } | null {
  if (!history.next) return null;
  const why = history.next.why?.trim() ? history.next.why.trim() : null;
  const eta = 'eta' in history.next && history.next.eta ? history.next.eta : null;
  return { text: history.next.text, why: [why, eta].filter(Boolean).join(' · ') || null };
}

/** "Chest · shoulders" — the eyebrow over the name. */
export function muscleEyebrow(history: ExerciseHistory): string | null {
  const muscles = history.muscle_groups.filter(Boolean);
  if (muscles.length === 0) return null;
  return muscles.map((muscle) => muscle.replace(/_/g, ' ')).join(' · ');
}

/**
 * "12 sessions · since Mon, Aug 4" — how much history there is, over the chart. A count is
 * the one number that says whether the line above it is worth reading.
 */
export function historySummary(history: ExerciseHistory): string {
  const count = `${history.sessions_count} session${history.sessions_count === 1 ? '' : 's'}`;
  return history.first_date ? `${count} · since ${dateLabel(history.first_date)}` : count;
}
