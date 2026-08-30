import { MUSCLE_GROUPS } from '@/lib/today-cards';
import type { DayRow, GoalKind, GoalWithProgress, IsoDate, MetricProgress } from '@/lib/types';

// What the Progress screen draws, decided by the measure (docs/design-system.md
// §Progress: "one section per active goal, rendered from its metrics — weight line with a
// 7-day average and a target line; lift load trend; weekly cardio bars; sets per muscle
// group"). Pure, and the same pattern as lib/today-cards.ts: the numbers come in, the
// sections come out, and the rule is tested without a renderer.
//
// A measure gets a **line** when its number means something on any single day (a weight, a
// best load, a pace) and **columns** when it only means something over a week (cardio
// minutes, weekly sets, macros). That is the whole selection rule; everything else here is
// formatting.

export type ProgressChart =
  | {
      kind: 'line';
      /** The measure's own series — for body weight, the 7-day average. */
      values: (number | null)[];
      /** The raw daily readings under it, when the day rows carry them. */
      raw?: (number | null)[] | null;
      target?: number | null;
    }
  | { kind: 'columns'; columns: { label: string; fraction: number; muted?: boolean }[] }
  | { kind: 'rows'; rows: { label: string; fraction: number; value: string }[] };

export type ProgressSection = {
  key: string;
  /** The eyebrow: what is being measured. */
  eyebrow: string;
  value: string;
  unit: string | null;
  sub: string | null;
  chart: ProgressChart | null;
  /** False for the no-goal variant: no green, no orange (concept-v2 §Goals). */
  judge: boolean;
};

/** Measures whose value is a reading on a day; everything else is a weekly total. */
const LINE_MEASURES = new Set(['body_weight', 'exercise_load', 'pace', 'resting_hr', 'vo2']);

const WEEKS_OF_CONSISTENCY = 8;
const COVERAGE_DAYS = 28;

const round1 = (value: number) => (Math.round(value * 10) / 10).toFixed(1);

function pretty(value: number, unit: string | null): string {
  if (unit === 'lb' || unit === 'mi' || unit === 'min/mi') return round1(value);
  return Math.round(value).toLocaleString('en-US');
}

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Buckets a dated series into ISO weeks, newest last, summing what falls in each. */
function byWeek(series: { date: IsoDate; value: number }[], weeks: number): { label: string; total: number }[] {
  const buckets = new Map<string, number>();
  for (const point of series) {
    const key = mondayOf(point.date);
    buckets.set(key, (buckets.get(key) ?? 0) + point.value);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-weeks)
    .map(([key, total]) => ({ label: dayOfMonth(key), total }));
}

function mondayOf(date: IsoDate): IsoDate {
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7));
  return at.toISOString().slice(0, 10);
}

function dayOfMonth(date: IsoDate): string {
  return String(Number(date.slice(8, 10)));
}

function columnsFrom(buckets: { label: string; total: number }[], judge: boolean): ProgressChart | null {
  if (buckets.length === 0) return null;
  const peak = Math.max(...buckets.map((bucket) => bucket.total), 1);
  return {
    kind: 'columns',
    columns: buckets.map((bucket) => ({
      label: bucket.label,
      fraction: bucket.total / peak,
      muted: !judge,
    })),
  };
}

/**
 * One section per metric of one goal. `dailyWeights` is the Days list's own weight column:
 * the body_weight measure's series is already smoothed to a 7-day average, and the design
 * asks for both lines — the average is the claim, the weigh-ins are the evidence.
 */
export function goalSections(
  goal: GoalWithProgress,
  dailyWeights?: { date: IsoDate; value: number }[] | null,
): ProgressSection[] {
  const kind: GoalKind = goal.kind;
  const judge = kind !== 'maintain' && kind !== 'custom';

  return goal.progress.metrics
    .map((metric) => sectionFor(metric, judge, dailyWeights ?? null))
    .filter((section): section is ProgressSection => section !== null);
}

function sectionFor(
  metric: MetricProgress,
  judge: boolean,
  dailyWeights: { date: IsoDate; value: number }[] | null,
): ProgressSection | null {
  // A measure with no reading at all has nothing to draw, and a flat zero would be a
  // claim about the user rather than about the data (lib/today-cards.ts, same rule).
  if (metric.current == null && metric.series.length === 0) return null;

  const eyebrow = metric.scope ? `${metric.label} · ${titleCase(metric.scope)}` : metric.label;
  const value = metric.current == null ? '—' : pretty(metric.current, metric.unit);
  const sub = [
    metric.target == null ? null : `of ${pretty(metric.target, metric.unit)} ${metric.unit ?? ''}`.trim(),
    metric.percent == null ? null : `${Math.round(metric.percent * 100)}%`,
  ]
    .filter(Boolean)
    .join(' · ');

  const chart: ProgressChart | null = LINE_MEASURES.has(metric.measure)
    ? metric.series.length > 0
      ? {
          kind: 'line',
          values: metric.series.map((point) => point.value),
          raw:
            metric.measure === 'body_weight' && dailyWeights && dailyWeights.length > 1
              ? alignTo(metric.series, dailyWeights)
              : null,
          target: metric.target,
        }
      : null
    : columnsFrom(byWeek(metric.series, WEEKS_OF_CONSISTENCY), judge);

  return {
    key: `${metric.measure}${metric.scope ? `-${metric.scope}` : ''}`,
    eyebrow,
    value,
    unit: metric.unit,
    sub: sub || null,
    chart,
    judge,
  };
}

/** Puts the raw weigh-ins on the average's x axis: same dates, gaps where none was logged. */
function alignTo(
  series: { date: IsoDate; value: number }[],
  raw: { date: IsoDate; value: number }[],
): (number | null)[] {
  const byDate = new Map(raw.map((point) => [point.date, point.value]));
  return series.map((point) => byDate.get(point.date) ?? null);
}

// ---------------------------------------------------------------------------
// The two sections every Progress screen ends with
// ---------------------------------------------------------------------------

/** Workouts per week over eight weeks — the one number that is true with or without a goal. */
export function consistencySection(days: DayRow[], judge: boolean): ProgressSection | null {
  const trained = days.filter((day) => day.muscle_groups.length > 0);
  if (days.length === 0) return null;
  const buckets = byWeek(
    trained.map((day) => ({ date: day.date, value: 1 })),
    WEEKS_OF_CONSISTENCY,
  );
  const thisWeek = buckets[buckets.length - 1]?.total ?? 0;
  const weeks = buckets.length || 1;
  const average = buckets.reduce((sum, bucket) => sum + bucket.total, 0) / weeks;
  return {
    key: 'consistency',
    eyebrow: 'Workouts a week',
    value: `${thisWeek}`,
    unit: 'this week',
    sub: `${round1(average)} a week over ${weeks} week${weeks === 1 ? '' : 's'}`,
    chart: columnsFrom(buckets, judge),
    judge,
  };
}

/** Which muscle groups have been trained in the last four weeks, and how often. */
export function coverageSection(days: DayRow[], judge: boolean): ProgressSection | null {
  const recent = [...days].sort((a, b) => b.date.localeCompare(a.date)).slice(0, COVERAGE_DAYS);
  if (recent.length === 0) return null;
  const counts = new Map<string, number>();
  for (const day of recent) {
    for (const muscle of day.muscle_groups) {
      const key = muscle.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const peak = Math.max(...[...counts.values()], 1);
  const covered = MUSCLE_GROUPS.filter((muscle) => (counts.get(muscle) ?? 0) > 0).length;
  return {
    key: 'coverage',
    eyebrow: 'Coverage · 4 weeks',
    value: `${covered}`,
    unit: `of ${MUSCLE_GROUPS.length} groups`,
    sub:
      MUSCLE_GROUPS.filter((muscle) => !counts.has(muscle))
        .slice(0, 4)
        .map(titleCase)
        .join(', ') || 'All of them',
    chart: {
      kind: 'rows',
      rows: MUSCLE_GROUPS.map((muscle) => {
        const count = counts.get(muscle) ?? 0;
        return {
          label: titleCase(muscle),
          fraction: count / peak,
          value: count === 0 ? '—' : `${count} day${count === 1 ? '' : 's'}`,
        };
      }),
    },
    judge,
  };
}
