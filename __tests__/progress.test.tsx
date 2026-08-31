import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import React from 'react';

import Progress from '@/app/(tabs)/progress';
import type { BoardCardioRow, TrainingBoard } from '@/lib/types';
import { makeGoal, makeMetric, makeWeek } from './fixtures';

// The merged Progress tab (user decision 2026-08-31): "what am I chasing and where do I
// stand", with training first class. Goals used to be a tab of its own and the lifts were
// on neither screen.

const mockApi = jest.fn();
jest.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  upload: jest.fn(),
  tzOffsetMin: () => 0,
  authHeaders: () => ({}),
  evidenceUrl: (id: string) => `http://test/api/evidence/${id}`,
  exerciseMediaUrl: (id: string, n: number) => `http://test/api/exercises/${id}/media/${n}`,
  API_URL: 'http://test',
  ApiError: class extends Error {},
  setUnauthorizedHandler: () => {},
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/lib/auth', () => ({
  useSession: () => ({ session: { user: { id: 'u', email: 'ada@example.com', name: 'ada' } }, loading: false }),
  signOut: jest.fn(),
}));

const BENCH = {
  exercise: 'Bench Press',
  exercise_id: 'ex-bench',
  category: 'strength' as const,
  muscle_groups: ['chest', 'triceps'],
  load_direction: 'resistance' as const,
  load_lb: 135,
  sets: 3,
  reps: 8,
  load_text: '135 lb',
  last_date: '2026-08-30',
  days_since: 1,
  sessions: 3,
  best_load_lb: 135,
  trend: 'up' as const,
  trend_lb: 5,
  delta_text: '+5 lb in four weeks',
  sentiment: 'good' as const,
  series: [
    { date: '2026-08-16', load_lb: 130, sets: 3, reps: 8 },
    { date: '2026-08-23', load_lb: 135, sets: 3, reps: 8 },
    { date: '2026-08-30', load_lb: 135, sets: 3, reps: 8 },
  ],
  next: {
    rule: 'hold' as const,
    load_lb: 135,
    sets: 3,
    reps: 8,
    text: 'Hold 135 lb until 3 × 8 twice',
    eta: '~1–2 wks',
    why: '1 of 2 sessions at target reps.',
  },
};

const CHIN = {
  ...BENCH,
  exercise: 'Assisted Chin-Up',
  exercise_id: 'ex-chin',
  load_direction: 'assistance' as const,
  load_lb: 55,
  load_text: '55 lb of assistance',
  trend_lb: -5,
  trend: 'down' as const,
  delta_text: '5 lb less help',
  sentiment: 'good' as const,
  next: {
    rule: 'step_up' as const,
    load_lb: 50,
    sets: 3,
    reps: 10,
    text: '50 lb of assistance next — one step less help',
    eta: null,
    why: 'Two sessions at target.',
  },
};

/** The field report's own row: it used to be drawn between BENCH and CHIN. */
const WALK: BoardCardioRow = {
  exercise: 'Incline Treadmill Walk',
  exercise_id: 'ex-walk',
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
  next: {
    rule: 'cardio',
    minutes: 22,
    text: '22 min next',
    eta: null,
    why: '30 of 150 min this week, 120 short.',
  },
};

function makeBoard(overrides: Partial<TrainingBoard> = {}): TrainingBoard {
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
    },
    cardio: {
      weeks: [
        { start: '2026-08-17', minutes: 60 },
        { start: '2026-08-24', minutes: 30 },
      ],
      minutes_this_week: 30,
      weekly_target_min: 150,
      short_by_min: 120,
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

const EMPTY_BOARD = makeBoard({
  lifts: [],
  frequency: { weeks: [{ start: '2026-08-24', sessions: 0 }], sessions_this_week: 0, average_per_week: 0, training_days_target: null, muscles: [] },
  cardio: {
    weeks: [{ start: '2026-08-24', minutes: 0 }],
    minutes_this_week: 0,
    weekly_target_min: 150,
    short_by_min: 150,
    last: null,
    best: null,
    activities: [],
    target_stated: false,
  },
  body: { latest: null, latest_date: null, avg_7d: null, trend_per_week: null, series: [] },
});

function serve({
  goals = { active: [], history: [], no_goal: true },
  board = makeBoard(),
}: { goals?: unknown; board?: TrainingBoard } = {}) {
  const calls: { path: string; body?: unknown; method?: string }[] = [];
  mockApi.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
    calls.push({ path, ...(options ?? {}) });
    if (path === '/api/goals') return Promise.resolve(goals);
    if (path.startsWith('/api/goals/') && path.endsWith('/progress'))
      return Promise.resolve({ metrics: (goals as { active: { progress: { metrics: unknown[] } }[] }).active[0]?.progress.metrics ?? [] });
    if (path === '/api/training/board') return Promise.resolve(board);
    if (path === '/api/week') return Promise.resolve(makeWeek());
    if (path === '/api/profile') return Promise.resolve({ id: 'u', stated_at: {}, targets: {} });
    return Promise.resolve(null);
  });
  return calls;
}

function renderProgress() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Progress />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
});

describe('Progress — the goal card', () => {
  const weightGoal = () => ({
    ...makeGoal('lose_fat', [
      makeMetric({
        measure: 'body_weight',
        unit: 'lb',
        direction: 'decrease',
        target: 200,
        current: 210.4,
        baseline: 212,
        percent: 0.13,
        series: [
          { date: '2026-08-03', value: 212 },
          { date: '2026-08-31', value: 210.4 },
        ],
      }),
    ]),
    title: 'Get to 200 lb',
    metrics: [{ measure: 'body_weight', target: 200, unit: 'lb', by: '2027-03-01' }],
  });

  it('says where it started, where it is, how far is left and how fast', async () => {
    serve({ goals: { active: [weightGoal()], history: [], no_goal: false } });
    renderProgress();
    await waitFor(() => expect(screen.getByText('Get to 200 lb')).toBeTruthy());
    expect(screen.getByTestId('goal-standing-goal-1').props.children).toContain('212.0 → 210.4 lb now');
    expect(screen.getByTestId('goal-standing-goal-1').props.children).toContain('10.4 lb to go');
    expect(screen.getByTestId('goal-pace-goal-1')).toBeTruthy();
    expect(screen.getByTestId('goal-week-goal-1').props.children).toContain('4 of 7 served');
  });

  // The field report (2026-08-31): one weigh-in drew a tall empty box with a dashed line
  // across it and the words "No movement yet" under it. Nothing had moved because nothing
  // can move with one point.
  const weighInsGoal = (series: { date: string; value: number }[]) => ({
    ...makeGoal('lose_fat', [
      makeMetric({
        measure: 'body_weight',
        unit: 'lb',
        direction: 'decrease',
        target: 200,
        current: series[series.length - 1]?.value ?? null,
        baseline: series[0]?.value ?? null,
        percent: series.length > 0 ? 0.13 : null,
        series,
      }),
    ]),
    title: 'Get to 200 lb',
    metrics: [{ measure: 'body_weight', target: 200, unit: 'lb', by: '2027-03-01' }],
  });

  it('names the one weigh-in and what would make it a line, on a short strip', async () => {
    serve({
      goals: { active: [weighInsGoal([{ date: '2026-08-31', value: 212 }])], history: [], no_goal: false },
    });
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('goal-pace-goal-1')).toBeTruthy());

    const said = screen.getByTestId('goal-pace-goal-1').props.children as string;
    expect(said).toContain('One weigh-in so far (212.0 lb');
    expect(said).toContain('Weigh in a few mornings and your trend appears.');
    expect(said).not.toContain('No movement yet');
    // No 110 px of empty box under it.
    expect(screen.getByTestId('goal-chart-goal-1').props.style).toMatchObject({ height: 44 });
  });

  it('asks for the first reading when there is none, and draws no chart at all', async () => {
    serve({ goals: { active: [weighInsGoal([])], history: [], no_goal: false } });
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('goal-pace-goal-1')).toBeTruthy());
    expect(screen.getByTestId('goal-standing-goal-1').props.children).toContain('Nothing measured yet');
    expect(screen.getByTestId('goal-pace-goal-1').props.children).toBe('Log a weigh-in to start the line.');
    expect(screen.queryByTestId('goal-chart-goal-1')).toBeNull();
  });

  it('leaves two readings and up exactly as they were', async () => {
    serve({
      goals: {
        active: [weighInsGoal([{ date: '2026-08-03', value: 212 }, { date: '2026-08-31', value: 210.4 }])],
        history: [],
        no_goal: false,
      },
    });
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('goal-chart-goal-1')).toBeTruthy());
    expect(screen.getByTestId('goal-chart-goal-1').props.style).toMatchObject({ height: 110 });
    expect(screen.getByTestId('goal-pace-goal-1').props.children).not.toContain('so far');
  });

  it('draws no weight section of its own when a weight goal already owns that line', async () => {
    serve({ goals: { active: [weightGoal()], history: [], no_goal: false } });
    renderProgress();
    await waitFor(() => expect(screen.getByText('Get to 200 lb')).toBeTruthy());
    expect(screen.queryByTestId('body')).toBeNull();
  });

  it('asks rather than closing a goal the measure thinks is done', async () => {
    const reached = { ...weightGoal(), reached_candidate_at: '2026-08-30T00:05:00.000Z' };
    const calls = serve({ goals: { active: [reached], history: [], no_goal: false } });
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('goal-reached-goal-1')).toBeTruthy());
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);

    fireEvent.press(screen.getByText('Not yet'));
    await waitFor(() => expect(screen.queryByTestId('goal-reached-goal-1')).toBeNull());
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('marks it reached only on the tap', async () => {
    const calls = serve({ goals: { active: [weightGoal()], history: [], no_goal: false } });
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('mark-reached-goal-1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('mark-reached-goal-1'));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({ path: '/api/goals/goal-1', method: 'PATCH' }),
      ),
    );
  });

  it('invites a goal when there is none, and never judges without one', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('goals-empty')).toBeTruthy());
    fireEvent.press(screen.getByTestId('tell-me'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { hint: 'goal' } });
  });

  it('keeps what has ended, with the outcome, below everything else', async () => {
    const past = { ...makeGoal('build_strength'), id: 'old', title: 'Bench 185', status: 'reached', active_to: '2026-06-30', outcome: 'reached' };
    serve({ goals: { active: [], history: [past], no_goal: true } });
    renderProgress();
    await waitFor(() => expect(screen.getByText('Bench 185')).toBeTruthy());
    expect(screen.getByText(/^Reached · /)).toBeTruthy();
  });
});

describe('Progress — the lifts board', () => {
  it('draws a row per lift with the coach’s own next step, goal or no goal', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('lifts-board')).toBeTruthy());

    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByTestId('lift-next-Bench Press').props.children[0]).toBe('Hold 135 lb until 3 × 8 twice');
    // The eta is the board's own addition to the prescription: a hold with a date on it.
    expect(screen.getByText(/~1–2 wks/)).toBeTruthy();
  });

  it('says "of assistance" and draws less help as progress', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('lifts-board')).toBeTruthy());
    expect(screen.getByText(/55 lb of assistance/)).toBeTruthy();
    expect(screen.getByTestId('lift-delta-Assisted Chin-Up').props.children).toBe('5 lb less help');
    // Green, because on an assisted machine less help is the good news — the sentiment
    // the server computed, never the direction the number went.
    expect(screen.getByTestId('lift-delta-Assisted Chin-Up').props.style).toContainEqual(
      expect.objectContaining({ color: '#3DD68C' }),
    );
    expect(screen.getByTestId('lift-next-Assisted Chin-Up').props.children[0]).toContain('one step less help');
  });

  it('opens the exercise sheet from the name', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());
    fireEvent.press(screen.getByText('Bench Press'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/exercise/[id]',
      params: { id: 'ex-bench', name: 'Bench Press' },
    });
  });

  it('is a quiet one-liner with nothing lifted', async () => {
    serve({ board: EMPTY_BOARD });
    renderProgress();
    await waitFor(() => expect(screen.getByText('Nothing lifted in the last four weeks.')).toBeTruthy());
    expect(screen.getByTestId('lifts-empty')).toBeTruthy();
  });
});

describe('Progress — frequency, cardio and body', () => {
  it('counts sessions a week and sets per muscle group, and names what has not been trained', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('frequency')).toBeTruthy());
    expect(screen.getByText('2 this week of 4')).toBeTruthy();
    expect(screen.getByText('6 this week · 18 in 4')).toBeTruthy();
    expect(screen.getByTestId('muscles-untrained').props.children.join('')).toContain('Lats');
  });

  // The coverage ledger, when the server sends one (user decision 2026-08-31 §B7). It
  // replaces the older "not trained in four weeks" line rather than sitting beside it:
  // two lists of absences on one card is one list too many.
  it('marks the muscles the rotation is overdue, longest first', async () => {
    serve({
      board: makeBoard({
        frequency: {
          ...makeBoard().frequency,
          coverage: [
            { key: 'calves', label: 'calves', days_since: null, sets_14d: 0, sets_28d: 0, unit: 'sets', overdue: true },
            { key: 'core', label: 'core', days_since: 21, sets_14d: 0, sets_28d: 3, unit: 'sets', overdue: true },
            { key: 'chest', label: 'chest', days_since: 2, sets_14d: 6, sets_28d: 18, unit: 'sets', overdue: false },
          ],
        },
      }),
    });
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('muscles-overdue')).toBeTruthy());
    expect(screen.getByText('Calves · never · Core · 21 days')).toBeTruthy();
    // One list, not two.
    expect(screen.queryByTestId('muscles-untrained')).toBeNull();
  });

  it('draws cardio against the plan, with the last pace', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('cardio')).toBeTruthy());
    expect(screen.getByText('30 of 150 min')).toBeTruthy();
    expect(screen.getByTestId('cardio-pace').props.children.join('')).toContain('10.2 min/mi');
  });

  // The field report (2026-08-31): "Incline Treadmill Walk · 20 min next" was a row in the
  // Lifts section, between two barbell rows.
  it('gives each cardio activity its own row, in minutes and miles, out of the lifts', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('cardio-board')).toBeTruthy());

    expect(screen.getByText('Incline Treadmill Walk')).toBeTruthy();
    expect(screen.getByTestId('cardio-sub-Incline Treadmill Walk').props.children).toContain(
      '20 min · 1.2 mi · 16.7 min/mi · 1d ago',
    );
    // Minutes, not a repeat of the last session, and never a load.
    expect(screen.getByTestId('cardio-next-Incline Treadmill Walk').props.children).toBe('22 min next');
    expect(screen.queryByTestId('lift-Incline Treadmill Walk')).toBeNull();
  });

  it('never prints a pound on a cardio row', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('cardio-board')).toBeTruthy());
    const row = within(screen.getByTestId('cardio-Incline Treadmill Walk'));
    expect(row.queryByText(/lb/)).toBeNull();
    expect(row.getAllByText(/min/).length).toBeGreaterThan(0);
  });

  it('hides the cardio section entirely when there is none and nobody asked for any', async () => {
    serve({ board: EMPTY_BOARD });
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('frequency-empty')).toBeTruthy());
    expect(screen.queryByText('Cardio')).toBeNull();
    expect(screen.queryByTestId('cardio')).toBeNull();
    expect(screen.queryByTestId('cardio-empty')).toBeNull();
  });

  it('says so quietly when a goal asked for cardio and nothing has been logged', async () => {
    serve({
      board: makeBoard({
        cardio: { ...EMPTY_BOARD.cardio, weekly_target_min: 120, target_stated: true },
      }),
    });
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('cardio-empty')).toBeTruthy());
    expect(screen.getByText(/120 min a week is what the goal asks for/)).toBeTruthy();
  });

  it('shows the weight line when no goal owns it', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('body')).toBeTruthy());
    expect(screen.getByText('210.4')).toBeTruthy();
  });

  it('says nothing rather than drawing zeroes on an empty account', async () => {
    serve({ board: EMPTY_BOARD });
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('frequency-empty')).toBeTruthy());
    expect(screen.getByTestId('body-empty')).toBeTruthy();
  });
});

describe('Progress — the way out to You', () => {
  it('opens the plan and the account from the avatar', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('progress-you')).toBeTruthy());
    fireEvent.press(screen.getByTestId('progress-you'));
    expect(mockPush).toHaveBeenCalledWith('/you');
  });
});
