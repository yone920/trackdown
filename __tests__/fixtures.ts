import type { DayView, GoalKind, GoalWithProgress, MetricProgress, WeekView } from '@/lib/types';

// Fixtures for the app tests. Small on purpose: every field here is one the screens
// actually read, and a fixture that carries more than that stops being readable.

export function makeDay(overrides: Partial<DayView> = {}): DayView {
  return {
    date: '2026-08-30',
    tz_offset_min: 0,
    is_today: true,
    closed_at: null,
    day_number: 12,
    items: { meals: [], activities: [], weights: [] },
    blocks: [],
    eaten: 1450,
    earned: 300,
    target: 2000,
    allowance: 2150,
    remaining: 700,
    eatback: 'half',
    tdee: 2500,
    balance: 1350,
    status: 'on_track',
    over_by: null,
    macros: {
      protein_g: { eaten: 120, target: 160, note: 'under' },
      carbs_g: { eaten: 130, target: null, note: null },
      fat_g: { eaten: 55, target: null, note: null },
      fiber_g: { eaten: 18, target: null, note: null },
    },
    weight: { day: null, avg_7d: 181.4, trend_per_week: -0.9 },
    muscle_groups: ['chest', 'triceps'],
    muscle_summary: [{ muscle: 'chest', sets: 6, exercises: ['Bench Press'] }],
    health: { active_energy: null, steps: null },
    eating_pattern: 'Back-loaded — 58% of the day after 5 pm.',
    arc: [],
    expected: [],
    verdict: 'served',
    verdict_words: 'Served your goal',
    verdict_why: 'Under the allowance.',
    goal: null,
    goal_involves_calories: true,
    summary_line: 'Chest and triceps · 1,450 kcal',
    reading: null,
    coach: null,
    ...overrides,
  };
}

export function makeWeek(overrides: Partial<WeekView> = {}): WeekView {
  const days = ['24', '25', '26', '27', '28', '29', '30'].map((day, index) => ({
    date: `2026-08-${day}`,
    day_number: 6 + index,
    is_today: index === 6,
    closed: index < 6,
    status: 'on_track' as const,
    verdict: (index % 2 === 0 ? 'served' : 'missed') as 'served' | 'missed',
    verdict_words: 'Served your goal',
    summary: 'A day',
    in_short: null,
    eaten: 2000,
    earned: 200,
    allowance: 2200,
    balance: index % 2 === 0 ? 500 : -200,
    weight_lb: null,
    muscle_groups: index % 3 === 0 ? ['chest', 'triceps'] : [],
  }));
  return {
    end: '2026-08-30',
    start: '2026-08-24',
    days,
    weekly_deficit: 1400,
    served: 4,
    judged: 7,
    ...overrides,
  };
}

export function makeMetric(overrides: Partial<MetricProgress> = {}): MetricProgress {
  return {
    measure: 'body_weight',
    label: 'Body weight',
    scope: null,
    unit: 'lb',
    direction: 'decrease',
    target: 170,
    current: 181.4,
    baseline: 190,
    percent: 0.43,
    series: [
      { date: '2026-08-01', value: 190 },
      { date: '2026-08-15', value: 185 },
      { date: '2026-08-30', value: 181.4 },
    ],
    ...overrides,
  };
}

export function makeGoal(kind: GoalKind, metrics: MetricProgress[] = []): GoalWithProgress {
  return {
    id: 'goal-1',
    kind,
    title: 'Get to 170 lb',
    metrics: [{ measure: metrics[0]?.measure ?? 'body_weight', target: 170, unit: 'lb', by: '2026-12-01' }],
    priority: 1,
    status: 'active',
    active_from: '2026-07-01',
    active_to: null,
    stated_at: '2026-07-01T00:00:00.000Z',
    reached_candidate_at: null,
    stalled_since: null,
    created_at: '2026-07-01T00:00:00.000Z',
    progress: {
      goal_id: 'goal-1',
      percent: 0.43,
      metrics: metrics.length > 0 ? metrics : [makeMetric()],
    },
  };
}
