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

/**
 * The figure, stubbed: `react-native-body-highlighter` draws SVG paths, and a test that
 * asserted on path data would be asserting on the package rather than on us. What is ours
 * is the *data* handed to it — one entry per slug with the colour and the stroke the ledger
 * decided — and the tap it reports back. So the stub renders one pressable per part,
 * carrying exactly that.
 */
jest.mock('react-native-body-highlighter', () => {
  const { Pressable } = require('react-native');
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: ({ data, side, onBodyPartPress }: any) =>
      ReactModule.createElement(
        Pressable,
        { testID: `figure-${side}` },
        data.map((part: any) =>
          ReactModule.createElement(Pressable, {
            key: part.slug,
            testID: `part-${side}-${part.slug}`,
            accessibilityLabel: `${part.slug} ${part.styles.fill} ${part.styles.stroke}`,
            onPress: () => onBodyPartPress(part),
          }),
        ),
      ),
  };
});

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

/**
 * The coverage ledger, as the server sends it: chest worked hard this week, biceps lightly,
 * core three weeks ago and overdue, calves never seen at all.
 */
const COVERAGE = [
  { key: 'calves', label: 'calves', days_since: null, last_date: null, sets_7d: 0, sets_14d: 0, sets_28d: 0, unit: 'sets' as const, overdue: true },
  { key: 'core', label: 'core', days_since: 21, last_date: '2026-08-10', sets_7d: 0, sets_14d: 0, sets_28d: 3, unit: 'sets' as const, overdue: true },
  { key: 'chest', label: 'chest', days_since: 1, last_date: '2026-08-30', sets_7d: 12, sets_14d: 18, sets_28d: 18, unit: 'sets' as const, overdue: false },
  { key: 'biceps', label: 'biceps', days_since: 5, last_date: '2026-08-26', sets_7d: 3, sets_14d: 6, sets_28d: 9, unit: 'sets' as const, overdue: false },
];

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
      target_source: 'default' as const,
      breakdown: [
        { exercise: 'Incline Treadmill Walk', intensity: 'moderate' as const, multiplier: 1, minutes: 20, equiv_minutes: 20 },
        { exercise: 'Run', intensity: 'vigorous' as const, multiplier: 2, minutes: 15, equiv_minutes: 30 },
      ],
      intensity_mix: [
        { intensity: 'moderate' as const, minutes: 20, equiv_minutes: 20 },
        { intensity: 'vigorous' as const, minutes: 15, equiv_minutes: 30 },
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

const EMPTY_BOARD = makeBoard({
  lifts: [],
  frequency: { weeks: [{ start: '2026-08-24', sessions: 0 }], sessions_this_week: 0, average_per_week: 0, training_days_target: null, muscles: [], coverage: [] },
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

  it('is a quiet one-liner with nothing lifted, and offers no door to an empty room', async () => {
    serve({ board: EMPTY_BOARD });
    renderProgress();
    await waitFor(() => expect(screen.getByText('Nothing lifted in the last four weeks.')).toBeTruthy());
    expect(screen.getByTestId('lifts-empty')).toBeTruthy();
    expect(screen.queryByTestId('all-lifts')).toBeNull();
  });

  // The board is one row per exercise logged in four weeks; on a real account that is
  // twenty rows above the goals, the cardio and the body (user decision 2026-08-31).
  it('keeps six and sends the rest to their own screen', async () => {
    const many = Array.from({ length: 9 }, (_unused, index) => ({
      ...BENCH,
      exercise: `Lift ${index}`,
      exercise_id: `ex-${index}`,
      days_since: index,
    }));
    serve({ board: makeBoard({ lifts: many }) });
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('lifts-board')).toBeTruthy());

    expect(screen.getByText('Lift 0')).toBeTruthy();
    expect(screen.getByText('Lift 5')).toBeTruthy();
    // Seven days on and it is not "this week"; it is on the other screen.
    expect(screen.queryByText('Lift 7')).toBeNull();
    expect(screen.getByTestId('all-lifts').props.accessibilityLabel).toBe('All lifts, 9');
    expect(screen.getByText('All lifts (9) · 3 more')).toBeTruthy();

    fireEvent.press(screen.getByTestId('all-lifts'));
    expect(mockPush).toHaveBeenCalledWith('/lifts');
  });

  it('still offers the door when everything already fits', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('all-lifts')).toBeTruthy());
    expect(screen.getByText('All lifts (2)')).toBeTruthy();
  });
});

describe('Progress — the snapshot strip', () => {
  it('answers "where do I stand" in one line, above everything it summarises', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('snapshot-strip')).toBeTruthy());
    expect(screen.getByTestId('snapshot-strip').props.children).toBe(
      '2 of 4 sessions this week · 50 of 150 cardio min · −0.8 lb/wk',
    );
  });
});

describe('Progress — coverage, cardio and body', () => {
  it('counts sessions a week, and no longer draws a bar per muscle group', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('frequency')).toBeTruthy());
    expect(screen.getByText('Sessions a week')).toBeTruthy();
    expect(screen.getByText('0.8 a week over 3 weeks')).toBeTruthy();
    // The bars and the text list of absences are both gone: the figure says it once.
    expect(screen.queryByText('6 this week · 18 in 4')).toBeNull();
    expect(screen.queryByTestId('muscles-untrained')).toBeNull();
    expect(screen.queryByTestId('muscles-overdue')).toBeNull();
    expect(screen.queryByText('Sets per muscle group · 4 weeks')).toBeNull();
  });

  // The body map (user decision 2026-08-31). The ledger is the only input, so the tab and
  // the coach cannot disagree about what is overdue.
  it('colours every region from the ledger, front and back, with a legend', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('body-map')).toBeTruthy());

    expect(screen.getByTestId('figure-front')).toBeTruthy();
    expect(screen.getByTestId('figure-back')).toBeTruthy();
    expect(screen.getByTestId('body-map-legend')).toBeTruthy();
    expect(screen.getByText('10–20')).toBeTruthy();
    expect(screen.getByText('Overdue a turn')).toBeTruthy();

    // Chest: twelve sets this week, inside the band, so the middle step of the ramp.
    expect(screen.getByTestId('part-front-chest').props.accessibilityLabel).toBe(
      'chest #A4561E #23262D',
    );
    // Biceps: three sets, under the band — the faintest step, and no outline.
    expect(screen.getByTestId('part-front-biceps').props.accessibilityLabel).toBe(
      'biceps #5C3822 #23262D',
    );
    // Calves: never in four weeks, and overdue — grey, with the accent stroke.
    expect(screen.getByTestId('part-front-calves').props.accessibilityLabel).toBe(
      'calves #2A2E36 #FF7A1A',
    );
    // Core: nothing this week but three sets inside the four, so the faintest step and
    // NOT the grey — grey means "never seen". It is also overdue, so it is outlined, and
    // it is two paths on one ledger entry, so both of them are.
    expect(screen.getByTestId('part-front-abs').props.accessibilityLabel).toBe(
      'abs #5C3822 #FF7A1A',
    );
    expect(screen.getByTestId('part-front-obliques').props.accessibilityLabel).toBe(
      'obliques #5C3822 #FF7A1A',
    );
  });

  it('answers a tap on a region with its week, and closes on a second tap', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('body-map-hint')).toBeTruthy());

    fireEvent.press(screen.getByTestId('part-front-biceps'));
    await waitFor(() => expect(screen.getByTestId('body-map-detail')).toBeTruthy());
    expect(screen.getByTestId('body-map-detail').props.accessibilityLabel).toBe(
      'Biceps — 3 sets this week · last trained Wed · target 10+ sets/wk',
    );

    fireEvent.press(screen.getByTestId('part-front-biceps'));
    await waitFor(() => expect(screen.queryByTestId('body-map-detail')).toBeNull());
  });

  it('names the overdue regions under the figure, longest debt first', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('body-map-overdue')).toBeTruthy());
    expect(screen.getByTestId('body-map-overdue').props.children).toBe(
      'Overdue: Calves · never · Core · 21 days',
    );
  });

  it('draws cardio in equivalent minutes, with the last pace', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('cardio')).toBeTruthy());
    // Fifty, not thirty: a hard fifteen minutes counts double (user decision 2026-08-31).
    expect(screen.getByText('50 of 150 min')).toBeTruthy();
    expect(screen.getByText('Equivalent minutes a week')).toBeTruthy();
    expect(screen.getByTestId('cardio-equiv-text').props.children).toBe('20 brisk + 15 run×2');
    expect(screen.getByTestId('cardio-pace').props.children.join('')).toContain('10.2 min/mi');
  });

  // The lesson `daily_calorie_target` cost (fix-safearea-target-label): a number nobody
  // chose must never be reported back as one they did.
  it('says the 150 is a guideline and not something the user stated', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('cardio-provenance')).toBeTruthy());
    expect(screen.getByTestId('cardio-provenance').props.children).toBe(
      'Standard guideline — tell me yours',
    );
  });

  it('shows what the equivalent minutes are made of, on a tap, and not before', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('cardio-equivalent')).toBeTruthy());
    expect(screen.queryByTestId('cardio-breakdown')).toBeNull();

    fireEvent.press(screen.getByTestId('cardio-equivalent'));
    await waitFor(() => expect(screen.getByTestId('cardio-breakdown')).toBeTruthy());
    expect(screen.getByText('Run · vigorous')).toBeTruthy();
    expect(screen.getByText('15 min → 30')).toBeTruthy();
    // The same shortfall said two ways, which is what equivalent minutes buy.
    expect(screen.getByTestId('cardio-alternatives').props.children).toBe(
      'Still short: 100 moderate min or 50 hard.',
    );
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
