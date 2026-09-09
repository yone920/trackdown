import type { MetricChart } from '@/components/metric-card';
import { C } from '@/lib/theme';
import type { DayView, GoalKind, GoalWithProgress, MetricProgress, WeekView } from '@/lib/types';

// Which metric cards Today shows, decided by the primary goal (docs/design-system.md
// §Today; docs/concept-v2.md §Goals). Pure, so the rule is testable without a renderer
// and without a server — the numbers come in, the cards come out.
//
// **A card with a missing number does not appear.** Every branch below returns fewer
// cards when the data is not there rather than a zero or a dash: an empty ring says the
// user ate nothing, and that is a different claim from "we do not know yet".

export type CardSpec = {
  key: string;
  eyebrow: string;
  value: string;
  unit?: string | null;
  sub?: string | null;
  chart?: MetricChart;
  valueColor?: string;
};

export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'lats',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
] as const;

const PUSH_PULL_LEGS: { label: string; muscles: string[] }[] = [
  { label: 'Push', muscles: ['chest', 'shoulders', 'triceps'] },
  { label: 'Pull', muscles: ['back', 'lats', 'biceps'] },
  { label: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
];

const round = (n: number) => Math.round(n);

function metric(goal: GoalWithProgress | null | undefined, measure: string): MetricProgress | null {
  return goal?.progress?.metrics?.find((m) => m.measure === measure) ?? null;
}

/** The muscle groups trained anywhere in the week the strip is drawn for. */
function weekMuscles(week: WeekView | null | undefined, day: DayView): Set<string> {
  const seen = new Set<string>();
  for (const row of week?.days ?? []) for (const muscle of row.muscle_groups) seen.add(muscle.toLowerCase());
  for (const muscle of day.muscle_groups) seen.add(muscle.toLowerCase());
  return seen;
}

function workoutDays(week: WeekView | null | undefined): number | null {
  if (!week) return null;
  return week.days.filter((row) => row.muscle_groups.length > 0).length;
}

/** Today's cardio, in minutes — the only cardio figure the day view carries by itself. */
function cardioMinutesToday(day: DayView): number {
  return day.items.activities
    .filter((activity) => activity.category === 'cardio')
    .reduce((sum, activity) => sum + (activity.duration_min ?? 0), 0);
}

export type CardsInput = {
  day: DayView;
  week?: WeekView | null;
  /** The primary goal — `goals.active[0]`. Null when there is none. */
  goal?: GoalWithProgress | null;
};

// ---------------------------------------------------------------------------
// The shared cards
// ---------------------------------------------------------------------------

function weightTrend(day: DayView, goal: GoalWithProgress | null | undefined): CardSpec | null {
  const measure = metric(goal, 'body_weight');
  const current = day.weight.avg_7d ?? day.weight.day ?? measure?.current ?? null;
  if (current == null) return null;
  const series = (measure?.series ?? []).map((point) => point.value);
  const trend = day.weight.trend_per_week;
  return {
    key: 'weight-trend',
    eyebrow: '7-day weight',
    value: (Math.round(current * 10) / 10).toFixed(1),
    unit: 'lb',
    sub:
      trend == null
        ? null
        : `${trend > 0 ? '+' : ''}${(Math.round(trend * 10) / 10).toFixed(1)} lb / week`,
    chart: series.length > 1 ? { kind: 'sparkline', points: series, target: measure?.target ?? null } : undefined,
  };
}

function coverageStrip(day: DayView, week: WeekView | null | undefined, judge: boolean): CardSpec | null {
  const trained = weekMuscles(week, day);
  const covered = MUSCLE_GROUPS.filter((muscle) => trained.has(muscle)).length;
  return {
    key: 'coverage',
    eyebrow: 'Coverage this week',
    value: `${covered}`,
    unit: `of ${MUSCLE_GROUPS.length} groups`,
    sub: MUSCLE_GROUPS.filter((muscle) => !trained.has(muscle))
      .slice(0, 4)
      .join(', ') || 'All of them',
    chart: {
      kind: 'segments',
      segments: MUSCLE_GROUPS.map((muscle) => ({
        filled: trained.has(muscle),
        color: judge ? C.accent : C.mute,
      })),
    },
  };
}

function workoutsThisWeek(week: WeekView | null | undefined, judge: boolean): CardSpec | null {
  const count = workoutDays(week);
  if (count == null || !week) return null;
  return {
    key: 'workouts-week',
    eyebrow: 'Workouts this week',
    value: `${count}`,
    unit: `of ${week.days.length} days`,
    chart: {
      kind: 'segments',
      segments: week.days.map((row) => ({
        filled: row.muscle_groups.length > 0,
        color: judge ? C.accent : C.mute,
      })),
    },
  };
}

function fromMeasure(
  goal: GoalWithProgress | null | undefined,
  measure: string,
  eyebrow: string,
  unit: string,
): CardSpec | null {
  const found = metric(goal, measure);
  if (!found || found.current == null) return null;
  const target = found.target;
  return {
    key: measure,
    eyebrow: found.scope ? `${eyebrow} · ${found.scope}` : eyebrow,
    value: `${round(found.current)}`,
    unit: target == null ? (found.unit ?? unit) : `of ${round(target)} ${found.unit ?? unit}`,
    sub: found.percent == null ? null : `${Math.round(found.percent * 100)}% of the goal`,
    chart:
      target == null || target <= 0
        ? found.series.length > 1
          ? { kind: 'sparkline', points: found.series.map((p) => p.value) }
          : undefined
        : { kind: 'bar', fraction: found.current / target, color: C.accent },
  };
}

function cardioToday(day: DayView, judge: boolean): CardSpec {
  const minutes = cardioMinutesToday(day);
  return {
    key: 'cardio-today',
    eyebrow: 'Cardio today',
    value: `${round(minutes)}`,
    unit: 'min',
    valueColor: judge ? C.ink : C.ink,
  };
}

/** Pace from the day's own run, when it had one; nothing is inferred from a walk. */
function lastRunPace(day: DayView): CardSpec | null {
  const runs = day.items.activities.filter(
    (activity) =>
      activity.category === 'cardio' &&
      (activity.distance_mi ?? 0) > 0 &&
      (activity.duration_min ?? 0) > 0,
  );
  const run = runs[runs.length - 1];
  if (!run) return null;
  const paceMin = run.duration_min! / run.distance_mi!;
  const minutes = Math.floor(paceMin);
  const seconds = Math.round((paceMin - minutes) * 60);
  return {
    key: 'pace',
    eyebrow: 'Pace today',
    value: `${minutes}:${String(seconds).padStart(2, '0')}`,
    unit: '/ mi',
    sub: `${(Math.round(run.distance_mi! * 100) / 100).toFixed(2)} mi`,
  };
}

function pushPullLegs(day: DayView, week: WeekView | null | undefined): CardSpec {
  const trained = weekMuscles(week, day);
  const hit = PUSH_PULL_LEGS.filter((group) => group.muscles.some((muscle) => trained.has(muscle)));
  return {
    key: 'push-pull-legs',
    eyebrow: 'Push · pull · legs',
    value: `${hit.length}`,
    unit: 'of 3',
    sub: hit.length === 0 ? 'None this week' : hit.map((group) => group.label).join(' · '),
    chart: {
      kind: 'segments',
      segments: PUSH_PULL_LEGS.map((group) => ({
        filled: group.muscles.some((muscle) => trained.has(muscle)),
        color: C.accent,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

/**
 * The primary goal decides the cards. `null` — and `custom`, which has no headline number
 * of its own — get the no-judgement set: consistency and coverage in `mute`, no green and
 * no orange (concept-v2 §Goals).
 */
export function todayCards({ day, week, goal }: CardsInput): CardSpec[] {
  const kind: GoalKind | null = goal?.kind ?? null;
  const judge = kind !== null && kind !== 'custom';

  const cards: (CardSpec | null)[] = (() => {
    switch (kind) {
      case 'gain_muscle':
        return [
          fromMeasure(goal, 'weekly_sets', 'Sets this week', 'sets'),
          coverageStrip(day, week, true),
          weightTrend(day, goal),
        ];
      case 'improve_endurance':
        return [
          fromMeasure(goal, 'weekly_cardio_min', 'Cardio this week', 'min'),
          lastRunPace(day),
          fromMeasure(goal, 'resting_hr', 'Resting HR', 'bpm'),
        ];
      case 'build_strength':
        return [
          fromMeasure(goal, 'exercise_load', 'Target lift', 'lb'),
          fromMeasure(goal, 'weekly_sets', 'Sets this week', 'sets'),
          pushPullLegs(day, week),
        ];
      default:
        return [workoutsThisWeek(week, judge), cardioToday(day, judge), coverageStrip(day, week, judge)];
    }
  })();

  return cards.filter((card): card is CardSpec => card !== null);
}
