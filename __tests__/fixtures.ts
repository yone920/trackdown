import type {
  BoardCardioRow,
  BoardLift,
  CoverageEntry,
  DayRow,
  DayView,
  GoalKind,
  GoalWithProgress,
  MetricProgress,
  TrainingBoard,
  WeekView,
} from '@/lib/types';

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

export function makeDayRow(overrides: Partial<DayRow> = {}): DayRow {
  return {
    date: '2026-08-30',
    day_number: 12,
    is_today: false,
    closed: true,
    status: 'on_track',
    verdict: 'served',
    verdict_words: 'Served your goal',
    summary: 'Chest and triceps · 1,450 kcal',
    in_short: null,
    eaten: 1450,
    earned: 300,
    allowance: 2150,
    balance: 500,
    weight_lb: null,
    muscle_groups: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The training board (GET /api/training/board)
// ---------------------------------------------------------------------------
//
// These lived inside progress.test.tsx until the Progress page became a scoreboard: the
// same board now feeds the page's summary rows AND every detail screen behind them, and
// two copies of a lift would let the two disagree about what the board says.

export const BENCH: BoardLift = {
  exercise: 'Bench Press',
  exercise_id: 'ex-bench',
  media_count: 2,
  category: 'strength',
  muscle_groups: ['chest', 'triceps'],
  load_direction: 'resistance',
  load_lb: 135,
  sets: 3,
  reps: 8,
  load_text: '135 lb',
  last_date: '2026-08-30',
  days_since: 1,
  sessions: 3,
  best_load_lb: 135,
  trend: 'up',
  trend_lb: 5,
  delta_text: '+5 lb in four weeks',
  sentiment: 'good',
  series: [
    { date: '2026-08-16', load_lb: 130, sets: 3, reps: 8 },
    { date: '2026-08-23', load_lb: 135, sets: 3, reps: 8 },
    { date: '2026-08-30', load_lb: 135, sets: 3, reps: 8 },
  ],
  next: {
    rule: 'hold',
    load_lb: 135,
    sets: 3,
    reps: 8,
    text: 'Hold 135 lb until 3 × 8 twice',
    eta: '~1–2 wks',
    why: '1 of 2 sessions at target reps.',
  },
};

export const CHIN: BoardLift = {
  ...BENCH,
  exercise: 'Assisted Chin-Up',
  exercise_id: 'ex-chin',
  muscle_groups: ['lats', 'biceps'],
  load_direction: 'assistance',
  load_lb: 55,
  load_text: '55 lb of assistance',
  trend_lb: -5,
  trend: 'down',
  delta_text: '5 lb less help',
  sentiment: 'good',
  next: {
    rule: 'step_up',
    load_lb: 50,
    sets: 3,
    reps: 10,
    text: '50 lb of assistance next — one step less help',
    eta: null,
    why: 'Two sessions at target.',
  },
};

/** The field report's own row: it used to be drawn between BENCH and CHIN. */
export const WALK: BoardCardioRow = {
  exercise: 'Incline Treadmill Walk',
  exercise_id: 'ex-walk',
  // A treadmill is one of the movements free-exercise-db has no picture of: tappable,
  // and honest about having nothing to show.
  media_count: 0,
  category: 'cardio',
  last_date: '2026-08-30',
  days_since: 1,
  sessions: 4,
  duration_min: 20,
  distance_mi: 1.2,
  pace_min_mi: 16.67,
  best_pace_min_mi: 15.5,
  summary_text: '20 min · 1.2 mi · 16.7 min/mi',
  delta_text: '+5 min in four weeks',
  sentiment: 'neutral',
  series: [
    { date: '2026-08-23', duration_min: 15, distance_mi: 0.9, pace_min_mi: 16.67 },
    { date: '2026-08-30', duration_min: 20, distance_mi: 1.2, pace_min_mi: 16.67 },
  ],
  next: { rule: 'cardio', minutes: 22, text: '22 min next', eta: null, why: '30 of 150 min this week, 120 short.' },
};

/**
 * The coverage ledger, as the server sends it: chest worked hard this week, biceps lightly,
 * core three weeks ago and overdue, calves never seen at all.
 */
export const COVERAGE: CoverageEntry[] = [
  { key: 'calves', label: 'calves', days_since: null, last_date: null, sets_7d: 0, sets_14d: 0, sets_28d: 0, unit: 'sets', overdue: true },
  { key: 'core', label: 'core', days_since: 21, last_date: '2026-08-10', sets_7d: 0, sets_14d: 0, sets_28d: 3, unit: 'sets', overdue: true },
  { key: 'chest', label: 'chest', days_since: 1, last_date: '2026-08-30', sets_7d: 12, sets_14d: 18, sets_28d: 18, unit: 'sets', overdue: false },
  { key: 'biceps', label: 'biceps', days_since: 5, last_date: '2026-08-26', sets_7d: 3, sets_14d: 6, sets_28d: 9, unit: 'sets', overdue: false },
];

export function makeBoard(overrides: Partial<TrainingBoard> = {}): TrainingBoard {
  return {
    date: '2026-08-31',
    lifts: [BENCH, CHIN],
    frequency: {
      weeks: [
        { start: '2026-08-10', sessions: 1 },
        { start: '2026-08-17', sessions: 3 },
        { start: '2026-08-24', sessions: 2 },
      ],
      sessions_this_week: 2,
      average_per_week: 0.8,
      training_days_target: 4,
      muscles: [
        { muscle: 'chest', sets_7d: 6, sets_28d: 18 },
        { muscle: 'triceps', sets_7d: 3, sets_28d: 9 },
      ],
      coverage: COVERAGE,
    },
    cardio: {
      weeks: [
        { start: '2026-08-17', minutes: 60 },
        { start: '2026-08-24', minutes: 30 },
      ],
      minutes_this_week: 30,
      equiv_minutes_this_week: 50,
      weekly_target_min: 150,
      short_by_min: 100,
      equiv_text: '20 brisk + 15 run×2',
      alternatives_text: '100 moderate min or 50 hard',
      target_source: 'default',
      breakdown: [
        { exercise: 'Incline Treadmill Walk', intensity: 'moderate', multiplier: 1, minutes: 20, equiv_minutes: 20 },
        { exercise: 'Run', intensity: 'vigorous', multiplier: 2, minutes: 15, equiv_minutes: 30 },
      ],
      intensity_mix: [
        { intensity: 'moderate', minutes: 20, equiv_minutes: 20 },
        { intensity: 'vigorous', minutes: 15, equiv_minutes: 30 },
      ],
      last: { date: '2026-08-29', pace_min_mi: 10.2, distance_mi: 3 },
      best: { date: '2026-08-20', pace_min_mi: 9.4, distance_mi: 2 },
      activities: [WALK],
      target_stated: false,
    },
    body: {
      latest: 210.4,
      latest_date: '2026-08-31',
      avg_7d: 210.9,
      trend_per_week: -0.8,
      series: [
        { date: '2026-08-24', value: 212 },
        { date: '2026-08-31', value: 210.4 },
      ],
    },
    ...overrides,
  };
}

/** An account that has logged nothing the board can read. */
export const EMPTY_BOARD: TrainingBoard = makeBoard({
  lifts: [],
  frequency: {
    weeks: [{ start: '2026-08-24', sessions: 0 }],
    sessions_this_week: 0,
    average_per_week: 0,
    training_days_target: null,
    muscles: [],
    coverage: [],
  },
  cardio: {
    weeks: [{ start: '2026-08-24', minutes: 0 }],
    minutes_this_week: 0,
    equiv_minutes_this_week: 0,
    weekly_target_min: 150,
    short_by_min: 150,
    target_source: 'default',
    breakdown: [],
    last: null,
    best: null,
    activities: [],
    target_stated: false,
  },
  body: { latest: null, latest_date: null, avg_7d: null, trend_per_week: null, series: [] },
});
