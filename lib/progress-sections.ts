import { addDays } from '@/lib/days-weeks';
import { dateLabel } from '@/lib/format';
import { MUSCLE_GROUPS } from '@/lib/today-cards';
import type { DayRow, GoalKind, GoalWithProgress, IsoDate, MetricProgress, WeekView } from '@/lib/types';

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
// The goal card — "what am I chasing and where do I stand"
// ---------------------------------------------------------------------------
//
// The top of the merged Progress tab (user decision 2026-08-31). One card per active goal,
// and it answers four questions in the order a person asks them: where am I, how far is
// left, how fast am I moving, and does that get me there by the day I said.
//
// All of it is arithmetic over the metric's own series, which is why it lives here beside
// the chart rules and not inside the screen. The verdict is the only opinion on the card
// and it is a comparison of two dates, not a judgement of the user.

/** `good` for ahead or on pace, `accent` for behind, `mute` when there is nothing to judge. */
export type PaceTone = 'good' | 'accent' | 'mute';

export type GoalCardChart = {
  /** The measure over the goal's life, oldest first, padded into the future with nulls. */
  values: (number | null)[];
  /** The dotted continuation: null everywhere but today's point and the projected end. */
  projection: (number | null)[];
  target: number | null;
};

export type GoalCardView = {
  key: string;
  title: string;
  measure: string;
  /** "212 → 210.4 now (7-day avg)" — where it started and where it is. */
  standing: string;
  /** "10.4 lb to go", "Reached", or null when there is no finish line. */
  to_go: string | null;
  /** "−0.8 lb/wk" — the rate the projection is made from. */
  rate: string | null;
  percent: number | null;
  pace: { text: string; tone: PaceTone } | null;
  /** "This week: 5 of 7 served · −0.6 lb" */
  week: string | null;
  chart: GoalCardChart | null;
  judge: boolean;
};

/** Measures whose series is already smoothed on the server, so the card can say so. */
const SMOOTHED_MEASURES = new Set(['body_weight']);
/** Inside this many days of the stated date, "on pace" rather than early or late. */
const ON_PACE_DAYS = 4;
/** A rate measured over fewer days than this is noise, not a trend. */
const MIN_RATE_DAYS = 3;
/** How far past the last point the projection may be drawn, as a share of the goal's life. */
const MAX_PROJECTION_STEPS = 12;

function daysBetween(from: IsoDate, to: IsoDate): number {
  const at = (date: IsoDate) => {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

function signed(value: number, unit: string | null): string {
  const magnitude = pretty(Math.abs(value), unit);
  return `${value > 0 ? '+' : '−'}${magnitude}${unit ? ` ${unit}` : ''}`;
}

/** Change per week over the series, from the first point to the last. Null when too short. */
export function ratePerWeek(series: { date: IsoDate; value: number }[]): number | null {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return null;
  const days = daysBetween(first.date, last.date);
  if (days < MIN_RATE_DAYS) return null;
  return ((last.value - first.value) / days) * 7;
}

/**
 * One goal, as the card reads it. `today` is the app's own local date — the projection is
 * measured from the day the user is looking at the screen, not from the last weigh-in.
 */
export function goalCard(
  goal: GoalWithProgress,
  { week = null, today }: { week?: WeekView | null; today: IsoDate },
): GoalCardView {
  const kind: GoalKind = goal.kind;
  const judge = kind !== 'maintain' && kind !== 'custom';
  const metric = goal.progress.metrics[0] ?? null;
  const spec = goal.metrics[0];
  const unit = metric?.unit ?? spec?.unit ?? null;
  const current = metric?.current ?? null;
  const baseline = metric?.baseline ?? null;
  const target = metric?.target ?? spec?.target ?? null;
  const series = metric?.series ?? [];
  const by = spec?.by ?? null;
  const smoothed = SMOOTHED_MEASURES.has(metric?.measure ?? '');

  const standing =
    current == null
      ? 'Nothing measured yet'
      : baseline == null || baseline === current
        ? `${pretty(current, unit)}${unit ? ` ${unit}` : ''} now${smoothed ? ' (7-day avg)' : ''}`
        : `${pretty(baseline, unit)} → ${pretty(current, unit)}${unit ? ` ${unit}` : ''} now${
            smoothed ? ' (7-day avg)' : ''
          }`;

  const met = metric?.percent === 1;
  const to_go =
    target == null || current == null
      ? null
      : met
        ? 'Reached'
        : `${pretty(Math.abs(target - current), unit)}${unit ? ` ${unit}` : ''} to go`;

  const rateValue = ratePerWeek(series);
  const rate = rateValue == null || Math.abs(rateValue) < 0.05 ? null : `${signed(rateValue, unit)}/wk`;

  return {
    key: goal.id,
    title: goal.title,
    measure: metric?.measure ?? spec?.measure ?? '',
    standing,
    to_go,
    rate,
    percent: metric?.percent ?? goal.progress.percent ?? null,
    pace: paceVerdict({ current, target, rateValue, by, today, met, judge }),
    week: weekLine(week, series, today, unit),
    chart: goalChart(series, target, current, rateValue, by, today),
    judge,
  };
}

/**
 * Ahead, on pace, or behind — a comparison between the day the user named and the day the
 * rate they are actually moving at arrives. Never a word about effort: the projection is
 * arithmetic and it is allowed to be wrong tomorrow.
 */
function paceVerdict({
  current,
  target,
  rateValue,
  by,
  today,
  met,
  judge,
}: {
  current: number | null;
  target: number | null;
  rateValue: number | null;
  by: IsoDate | null;
  today: IsoDate;
  met: boolean;
  judge: boolean;
}): { text: string; tone: PaceTone } | null {
  if (met) return { text: 'The measure says you are there', tone: judge ? 'good' : 'mute' };
  if (target == null || current == null) return null;

  const needed = target - current;
  if (rateValue == null || rateValue === 0) {
    return by
      ? { text: `No movement yet · you said ${dateLabel(by)}`, tone: 'mute' }
      : { text: 'No movement yet', tone: 'mute' };
  }
  // Moving the wrong way is a fact about the numbers, not an accusation.
  if (Math.sign(rateValue) !== Math.sign(needed)) {
    return { text: by ? `Going the other way · you said ${dateLabel(by)}` : 'Going the other way', tone: judge ? 'accent' : 'mute' };
  }

  const weeks = needed / rateValue;
  const projected = addDays(today, Math.round(weeks * 7));
  if (!by) return { text: `At this rate, ${dateLabel(projected)}`, tone: 'mute' };

  const slack = daysBetween(projected, by);
  if (slack > ON_PACE_DAYS) return { text: `Ahead of ${dateLabel(by)}`, tone: judge ? 'good' : 'mute' };
  if (slack >= -ON_PACE_DAYS) return { text: `On pace for ${dateLabel(by)}`, tone: judge ? 'good' : 'mute' };
  return { text: `Behind · ${dateLabel(projected)} at this rate`, tone: judge ? 'accent' : 'mute' };
}

/** "This week: 5 of 7 served · −0.6 lb" — the days, and what the measure did over them. */
function weekLine(
  week: WeekView | null,
  series: { date: IsoDate; value: number }[],
  today: IsoDate,
  unit: string | null,
): string | null {
  const parts: string[] = [];
  if (week && week.judged > 0) parts.push(`${week.served} of ${week.judged} served`);

  const weekAgo = addDays(today, -7);
  const before = [...series].filter((point) => point.date <= weekAgo).at(-1);
  const last = series[series.length - 1];
  if (before && last && last.date > before.date) {
    const moved = last.value - before.value;
    if (Math.abs(moved) >= 0.05) parts.push(signed(moved, unit));
  }

  return parts.length === 0 ? null : `This week: ${parts.join(' · ')}`;
}

/**
 * The line from where it started to where it is, and a dotted continuation to where the
 * current rate lands. The projection is drawn only when there is a rate and a finish line
 * to draw it to — an invented dotted line is a promise the data has not made.
 */
function goalChart(
  series: { date: IsoDate; value: number }[],
  target: number | null,
  current: number | null,
  rateValue: number | null,
  by: IsoDate | null,
  today: IsoDate,
): GoalCardChart | null {
  if (series.length === 0) return null;
  const values: (number | null)[] = series.map((point) => point.value);

  const last = series[series.length - 1];
  if (!last || current == null || rateValue == null || target == null) {
    return { values, projection: values.map(() => null), target };
  }

  // How far ahead to draw: to the stated date when there is one, else to the target.
  const daysAhead = by
    ? Math.max(0, daysBetween(today, by))
    : Math.max(0, Math.round(((target - current) / rateValue) * 7));
  if (daysAhead <= 0) return { values, projection: values.map(() => null), target };

  const span = Math.max(1, daysBetween(series[0]!.date, last.date));
  const steps = Math.min(
    MAX_PROJECTION_STEPS,
    Math.max(1, Math.round((daysAhead / span) * Math.max(1, series.length - 1))),
  );
  const projectedEnd = current + (rateValue * daysAhead) / 7;

  const padded = [...values, ...Array.from({ length: steps }, () => null)];
  const projection: (number | null)[] = padded.map(() => null);
  projection[values.length - 1] = current;
  projection[padded.length - 1] = projectedEnd;

  return { values: padded, projection, target };
}

// ---------------------------------------------------------------------------
// The training board's own sections
// ---------------------------------------------------------------------------
//
// Frequency and cardio used to be computed here out of the Days list — one dot per day
// that had a muscle group on it. The board carries the real thing (sessions a week, sets
// per group, minutes per week), so these are formatters now rather than calculators: they
// scale the numbers the server sent into bars.

export type BoardColumns = { columns: { label: string; fraction: number; muted?: boolean }[] };

/** "5" under a bar: the day of the month the week began. */
function weekTick(start: IsoDate): string {
  return String(Number(start.slice(8, 10)));
}

/** Sessions a week, as bars. Scaled to the busiest week so a quiet one looks quiet. */
export function frequencyColumns(
  weeks: { start: IsoDate; sessions: number }[],
  judge = true,
): BoardColumns | null {
  if (weeks.length === 0) return null;
  const peak = Math.max(...weeks.map((week) => week.sessions), 1);
  return {
    columns: weeks.map((week) => ({
      label: weekTick(week.start),
      fraction: week.sessions / peak,
      muted: !judge,
    })),
  };
}

/**
 * Cardio minutes a week, scaled against the **plan's intent** rather than against the
 * user's own best week: a bar that reaches the top means the week's target was met, which
 * is the only comparison the section is for.
 */
export function cardioColumns(
  weeks: { start: IsoDate; minutes: number }[],
  targetMin: number,
  judge = true,
): BoardColumns | null {
  if (weeks.length === 0) return null;
  const peak = Math.max(targetMin, ...weeks.map((week) => week.minutes), 1);
  return {
    columns: weeks.map((week) => ({
      label: weekTick(week.start),
      fraction: week.minutes / peak,
      muted: !judge,
    })),
  };
}

/** Sets per muscle group over four weeks, longest bar first. */
export function muscleBars(
  muscles: { muscle: string; sets_7d: number; sets_28d: number }[],
): { label: string; fraction: number; value: string }[] {
  const peak = Math.max(...muscles.map((muscle) => muscle.sets_28d), 1);
  return muscles.map((muscle) => ({
    label: titleCase(muscle.muscle),
    fraction: muscle.sets_28d / peak,
    value: `${muscle.sets_7d} this week · ${muscle.sets_28d} in 4`,
  }));
}

/**
 * The groups the board has no sets for at all. Stated as an absence rather than drawn as a
 * row of zeroes: eleven empty bars is a verdict on the user, and this is a fact about the
 * log ("no pulling movement since Monday" is the sentence this exists for).
 */
export function untrainedGroups(muscles: { muscle: string }[]): string[] {
  const trained = new Set(muscles.map((muscle) => muscle.muscle.toLowerCase()));
  return MUSCLE_GROUPS.filter((muscle) => !trained.has(muscle)).map(titleCase);
}

/** "3.1 a week over 8 weeks" — the line under the frequency bars. */
export function frequencySummary(weeks: { sessions: number }[], average: number): string {
  return `${round1(average)} a week over ${weeks.length} week${weeks.length === 1 ? '' : 's'}`;
}
