import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import React from 'react';

import DaysScreen from '@/app/days';
import BodyDetail from '@/app/progress/body';
import CardioDetail from '@/app/progress/cardio';
import CoverageDetail from '@/app/progress/coverage';
import GoalDetail from '@/app/progress/goal';
import StrengthDetail from '@/app/progress/strength';
import type { TrainingBoard } from '@/lib/types';
import { BENCH, EMPTY_BOARD, makeBoard, makeDayRow, makeGoal, makeMetric, makeWeek } from './fixtures';

// The rooms behind the Progress scoreboard (user decision 2026-09-02).
//
// **Nothing was deleted when the page became a page of doors** — this file is the proof.
// Every assertion here was a Progress-tab assertion before the rebuild: the goal card and
// its admin, the six live lifts with the coach's own next step, the body figure and its
// ledger colours, the cardio breakdown and its provenance, the weigh-in rows, the days
// archive. The screens changed container and nothing else.

const mockApi = jest.fn();
jest.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  upload: jest.fn(),
  tzOffsetMin: () => 0,
  authHeaders: () => ({}),
  evidenceUrl: (id: string) => `http://test/api/evidence/${id}`,
  exerciseMediaUrl: (id: string, n: number, w?: number) =>
    `http://test/api/exercises/${id}/media/${n}${w ? `?w=${w}` : ''}`,
  SHEET_PHOTO_WIDTH: 640,
  THUMB_PHOTO_WIDTH: 320,
  API_URL: 'http://test',
  ApiError: class extends Error {},
  setUnauthorizedHandler: () => {},
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('@/lib/auth', () => ({
  useSession: () => ({ session: { user: { id: 'u', email: 'ada@example.com', name: 'ada' } }, loading: false }),
  signOut: jest.fn(),
}));

/** The figure, stubbed — see the note in progress.test.tsx. */
jest.mock('react-native-body-highlighter', () => {
  const { Pressable, View } = require('react-native');
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: ({ data, side, onBodyPartPress }: any) => {
      // The coverage tile's pair and the muscle sheet's zoomed figure are mounted at the
      // same time, so a test reaches parts through the wrapper it wants (`within`).
      return ReactModule.createElement(
        View,
        { testID: `figure-${side}` },
        data.map((part: any) =>
          ReactModule.createElement(Pressable, {
            key: part.slug,
            testID: `part-${side}-${part.slug}`,
            accessibilityLabel: `${part.slug} ${part.styles.fill} ${part.styles.stroke}`,
            onPress: () => onBodyPartPress?.({ slug: part.slug }),
          }),
        ),
      );
    },
  };
});

function serve({
  goals = { active: [], history: [], no_goal: true },
  board = makeBoard(),
  weighIns = [] as unknown[],
  days = [makeDayRow({ date: '2026-08-30' }), makeDayRow({ date: '2026-08-29' })],
}: { goals?: unknown; board?: TrainingBoard; weighIns?: unknown[]; days?: unknown[] } = {}) {
  const calls: { path: string; body?: unknown; method?: string }[] = [];
  mockApi.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
    calls.push({ path, ...(options ?? {}) });
    if (path === '/api/goals') return Promise.resolve(goals);
    if (path.startsWith('/api/goals/') && path.endsWith('/progress'))
      return Promise.resolve({ metrics: (goals as { active: { progress: { metrics: unknown[] } }[] }).active[0]?.progress.metrics ?? [] });
    if (path === '/api/training/board') return Promise.resolve(board);
    if (path === '/api/week') return Promise.resolve(makeWeek());
    if (path === '/api/weight') return Promise.resolve(weighIns);
    if (path.startsWith('/api/days')) return Promise.resolve({ days, next_before: null });
    if (path === '/api/profile') return Promise.resolve({ id: 'u', stated_at: {}, targets: {} });
    return Promise.resolve(null);
  });
  return calls;
}

function show(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
});

// ── the goal, at length ──────────────────────────────────────────────────────────────

describe('behind the goal row', () => {
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

  it('says where it started, where it is, how far is left and how fast', async () => {
    serve({ goals: { active: [weightGoal()], history: [], no_goal: false } });
    show(<GoalDetail />);
    await waitFor(() => expect(screen.getByText('Get to 200 lb')).toBeTruthy());
    expect(screen.getByTestId('goal-standing-goal-1').props.children).toContain('212.0 → 210.4 lb now');
    expect(screen.getByTestId('goal-standing-goal-1').props.children).toContain('10.4 lb to go');
    expect(screen.getByTestId('goal-pace-goal-1')).toBeTruthy();
    expect(screen.getByTestId('goal-week-goal-1').props.children).toContain('4 of 7 served');
  });

  it('keeps the labelled, dated weigh-in trio', async () => {
    serve({ goals: { active: [weightGoal()], history: [], no_goal: false } });
    show(<GoalDetail />);
    await waitFor(() => expect(screen.getByTestId('goal-readings-goal-1')).toBeTruthy());
    expect(screen.getByText('Latest')).toBeTruthy();
    expect(screen.getByText('Before that')).toBeTruthy();
    expect(screen.getByText('7-day average')).toBeTruthy();
  });

  // The field report (2026-08-31): one weigh-in drew a tall empty box with a dashed line
  // across it and the words "No movement yet" under it.
  it('names the one weigh-in and what would make it a line, on a short strip', async () => {
    serve({ goals: { active: [weighInsGoal([{ date: '2026-08-31', value: 212 }])], history: [], no_goal: false } });
    show(<GoalDetail />);
    await waitFor(() => expect(screen.getByTestId('goal-pace-goal-1')).toBeTruthy());

    const said = screen.getByTestId('goal-pace-goal-1').props.children as string;
    expect(said).toContain('One weigh-in so far (212.0 lb');
    expect(said).toContain('Weigh in a few mornings and your trend appears.');
    expect(said).not.toContain('No movement yet');
    expect(screen.getByTestId('goal-chart-goal-1').props.style).toMatchObject({ height: 44 });
  });

  it('asks for the first reading when there is none, and draws no chart at all', async () => {
    serve({ goals: { active: [weighInsGoal([])], history: [], no_goal: false } });
    show(<GoalDetail />);
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
    show(<GoalDetail />);
    await waitFor(() => expect(screen.getByTestId('goal-chart-goal-1')).toBeTruthy());
    expect(screen.getByTestId('goal-chart-goal-1').props.style).toMatchObject({ height: 110 });
    expect(screen.getByTestId('goal-pace-goal-1').props.children).not.toContain('so far');
  });

  it('asks rather than closing a goal the measure thinks is done', async () => {
    const reached = { ...weightGoal(), reached_candidate_at: '2026-08-30T00:05:00.000Z' };
    const calls = serve({ goals: { active: [reached], history: [], no_goal: false } });
    show(<GoalDetail />);
    await waitFor(() => expect(screen.getByTestId('goal-reached-goal-1')).toBeTruthy());
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);

    fireEvent.press(screen.getByText('Not yet'));
    await waitFor(() => expect(screen.queryByTestId('goal-reached-goal-1')).toBeNull());
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('marks it reached only on the tap', async () => {
    const calls = serve({ goals: { active: [weightGoal()], history: [], no_goal: false } });
    show(<GoalDetail />);
    await waitFor(() => expect(screen.getByTestId('mark-reached-goal-1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('mark-reached-goal-1'));
    await waitFor(() =>
      expect(calls).toContainEqual(expect.objectContaining({ path: '/api/goals/goal-1', method: 'PATCH' })),
    );
  });

  it('invites a goal when there is none, and never judges without one', async () => {
    serve();
    show(<GoalDetail />);
    await waitFor(() => expect(screen.getByTestId('goals-empty')).toBeTruthy());
    fireEvent.press(screen.getByTestId('tell-me'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { hint: 'goal' } });
  });

  it('keeps what has ended, with the outcome, below everything else', async () => {
    const past = { ...makeGoal('build_strength'), id: 'old', title: 'Bench 185', status: 'reached', active_to: '2026-06-30', outcome: 'reached' };
    serve({ goals: { active: [], history: [past], no_goal: true } });
    show(<GoalDetail />);
    await waitFor(() => expect(screen.getByText('Bench 185')).toBeTruthy());
    expect(screen.getByText(/^Reached · /)).toBeTruthy();
  });
});

// ── the body ─────────────────────────────────────────────────────────────────────────

describe('behind the body row', () => {
  it('draws the weight line at full height', async () => {
    serve();
    show(<BodyDetail />);
    await waitFor(() => expect(screen.getByTestId('body')).toBeTruthy());
    expect(screen.getByText('210.4')).toBeTruthy();
  });

  // The weigh-ins lost their only surface once already (field report 2026-09-02): loud
  // everywhere, correctable nowhere. This is the screen that owes them a home.
  it('keeps every weigh-in reachable, and correctable', async () => {
    serve({
      weighIns: [
        { id: 'w1', logged_at: '2026-08-31T07:00:00.000Z', weight_lb: 210.4, confidence: 'high' },
        { id: 'w2', logged_at: '2026-08-29T07:00:00.000Z', weight_lb: 212, confidence: 'high' },
      ],
    });
    show(<BodyDetail />);
    await waitFor(() => expect(screen.getByTestId('row-weight-w1')).toBeTruthy());

    fireEvent.press(screen.getByTestId('row-weight-w1-open'));
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/log', params: expect.objectContaining({ editId: 'w1', editKind: 'weight' }) }),
    );
    expect(screen.getByTestId('row-weight-w2-delete')).toBeTruthy();
  });

  it('says nothing rather than drawing zeroes on an empty account', async () => {
    serve({ board: EMPTY_BOARD });
    show(<BodyDetail />);
    await waitFor(() => expect(screen.getByTestId('body-empty')).toBeTruthy());
  });
});

// ── the lifts ────────────────────────────────────────────────────────────────────────

describe('behind the strength row', () => {
  it('draws a row per live lift with the coach’s own next step', async () => {
    serve();
    show(<StrengthDetail />);
    await waitFor(() => expect(screen.getByTestId('lifts-board')).toBeTruthy());

    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByTestId('lift-next-Bench Press').props.children[0]).toBe('Hold 135 lb until 3 × 8 twice');
    expect(screen.getByText(/~1–2 wks/)).toBeTruthy();
  });

  it('says "of assistance" and draws less help as progress', async () => {
    serve();
    show(<StrengthDetail />);
    await waitFor(() => expect(screen.getByTestId('lifts-board')).toBeTruthy());
    expect(screen.getByText(/55 lb of assistance/)).toBeTruthy();
    expect(screen.getByTestId('lift-delta-Assisted Chin-Up').props.children).toBe('5 lb less help');
    // Green, because on an assisted machine less help is the good news — the sentiment the
    // server computed, never the direction the number went.
    expect(screen.getByTestId('lift-delta-Assisted Chin-Up').props.style).toContainEqual(
      expect.objectContaining({ color: '#3DD68C' }),
    );
  });

  it('opens the exercise sheet from the name', async () => {
    serve();
    show(<StrengthDetail />);
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());
    fireEvent.press(screen.getByText('Bench Press'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/exercise/[id]',
      params: { id: 'ex-bench', name: 'Bench Press', media: '2' },
    });
  });

  it('keeps six and sends the rest to their own screen', async () => {
    const many = Array.from({ length: 9 }, (_unused, index) => ({
      ...BENCH,
      exercise: `Lift ${index}`,
      exercise_id: `ex-${index}`,
      days_since: index,
    }));
    serve({ board: makeBoard({ lifts: many }) });
    show(<StrengthDetail />);
    await waitFor(() => expect(screen.getByTestId('lifts-board')).toBeTruthy());

    expect(screen.getByText('Lift 0')).toBeTruthy();
    expect(screen.getByText('Lift 5')).toBeTruthy();
    // Seven days on and it is not "this week"; it is on the other screen.
    expect(screen.queryByText('Lift 7')).toBeNull();
    expect(screen.getByText('All lifts (9) · 3 more')).toBeTruthy();

    fireEvent.press(screen.getByTestId('all-lifts'));
    expect(mockPush).toHaveBeenCalledWith('/lifts');
  });

  it('is a quiet one-liner with nothing lifted, and offers no door to an empty room', async () => {
    serve({ board: EMPTY_BOARD });
    show(<StrengthDetail />);
    await waitFor(() => expect(screen.getByText('Nothing lifted in the last four weeks.')).toBeTruthy());
    expect(screen.queryByTestId('all-lifts')).toBeNull();
  });
});

// ── coverage ─────────────────────────────────────────────────────────────────────────

describe('behind the coverage row', () => {
  it('counts sessions a week, and no longer draws a bar per muscle group', async () => {
    serve();
    show(<CoverageDetail />);
    await waitFor(() => expect(screen.getByTestId('frequency')).toBeTruthy());
    expect(screen.getByText('0.8 a week over 3 weeks')).toBeTruthy();
    expect(screen.queryByText('Sets per muscle group · 4 weeks')).toBeNull();
  });

  it('colours every region from the ledger, front and back, with a legend', async () => {
    serve();
    show(<CoverageDetail />);
    await waitFor(() => expect(screen.getByTestId('body-map')).toBeTruthy());

    expect(screen.getByTestId('figure-front')).toBeTruthy();
    expect(screen.getByTestId('figure-back')).toBeTruthy();
    expect(screen.getByTestId('body-map-legend')).toBeTruthy();
    expect(screen.getByText('10–20')).toBeTruthy();
    expect(screen.getByText('Overdue a turn')).toBeTruthy();

    // Chest: twelve sets this week, inside the band, so the middle step of the ramp.
    expect(screen.getByTestId('part-front-chest').props.accessibilityLabel).toBe('chest #A4561E #23262D');
    // Biceps: three sets, under the band — the faintest step, and no outline.
    expect(screen.getByTestId('part-front-biceps').props.accessibilityLabel).toBe('biceps #5C3822 #23262D');
    // Calves: never in four weeks, and overdue — grey, with the accent stroke.
    expect(screen.getByTestId('part-front-calves').props.accessibilityLabel).toBe('calves #2A2E36 #FF7A1A');
    // Core: nothing this week but three sets inside the four, so the faintest step and NOT
    // the grey — grey means "never seen". Two paths on one ledger entry, so both outlined.
    expect(screen.getByTestId('part-front-abs').props.accessibilityLabel).toBe('abs #5C3822 #FF7A1A');
    expect(screen.getByTestId('part-front-obliques').props.accessibilityLabel).toBe('obliques #5C3822 #FF7A1A');
  });

  it('answers a tap on a region with its week, and closes on a second tap', async () => {
    serve();
    show(<CoverageDetail />);
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
    show(<CoverageDetail />);
    await waitFor(() => expect(screen.getByTestId('body-map-overdue')).toBeTruthy());
    expect(screen.getByTestId('body-map-overdue').props.children).toBe('Overdue: Calves · never · Core · 21 days');
  });

  it('says so quietly when nothing has been trained at all', async () => {
    serve({ board: EMPTY_BOARD });
    show(<CoverageDetail />);
    await waitFor(() => expect(screen.getByTestId('frequency-empty')).toBeTruthy());
  });
});

// ── cardio ───────────────────────────────────────────────────────────────────────────

describe('behind the cardio row', () => {
  it('draws cardio in equivalent minutes, with the last pace', async () => {
    serve();
    show(<CardioDetail />);
    await waitFor(() => expect(screen.getByTestId('cardio')).toBeTruthy());
    // Fifty, not thirty: a hard fifteen minutes counts double.
    expect(screen.getByText('Equivalent minutes a week')).toBeTruthy();
    expect(screen.getByTestId('cardio-equiv-text').props.children).toBe('20 brisk + 15 run×2');
    expect(screen.getByTestId('cardio-pace').props.children.join('')).toContain('10.2 min/mi');
  });

  // The lesson `daily_calorie_target` cost (fix-safearea-target-label): a number nobody
  // chose must never be reported back as one they did.
  it('says the 150 is a guideline and not something the user stated', async () => {
    serve();
    show(<CardioDetail />);
    await waitFor(() => expect(screen.getByTestId('cardio-provenance')).toBeTruthy());
    expect(screen.getByTestId('cardio-provenance').props.children).toBe('Standard guideline — tell me yours');
  });

  it('shows what the equivalent minutes are made of, on a tap, and not before', async () => {
    serve();
    show(<CardioDetail />);
    await waitFor(() => expect(screen.getByTestId('cardio-equivalent')).toBeTruthy());
    expect(screen.queryByTestId('cardio-breakdown')).toBeNull();

    fireEvent.press(screen.getByTestId('cardio-equivalent'));
    await waitFor(() => expect(screen.getByTestId('cardio-breakdown')).toBeTruthy());
    expect(screen.getByText('Run · vigorous')).toBeTruthy();
    expect(screen.getByText('15 min → 30')).toBeTruthy();
    expect(screen.getByTestId('cardio-alternatives').props.children).toBe(
      'Still short: 100 moderate min or 50 hard.',
    );
  });

  it('gives each cardio activity its own row, in minutes and miles, and never a pound', async () => {
    serve();
    show(<CardioDetail />);
    await waitFor(() => expect(screen.getByTestId('cardio-board')).toBeTruthy());

    expect(screen.getByText('Incline Treadmill Walk')).toBeTruthy();
    expect(screen.getByTestId('cardio-sub-Incline Treadmill Walk').props.children).toContain(
      '20 min · 1.2 mi · 16.7 min/mi · 1d ago',
    );
    expect(screen.getByTestId('cardio-next-Incline Treadmill Walk').props.children).toBe('22 min next');

    const row = within(screen.getByTestId('cardio-Incline Treadmill Walk'));
    expect(row.queryByText(/lb/)).toBeNull();
    expect(row.getAllByText(/min/).length).toBeGreaterThan(0);
  });

  it('says so quietly when a goal asked for cardio and nothing has been logged', async () => {
    serve({ board: makeBoard({ cardio: { ...EMPTY_BOARD.cardio, weekly_target_min: 120, target_stated: true } }) });
    show(<CardioDetail />);
    await waitFor(() => expect(screen.getByText(/120 min a week is what the goal asks for/)).toBeTruthy());
  });
});

// ── the days archive ─────────────────────────────────────────────────────────────────

describe('behind "All days"', () => {
  it('is the whole archive, with every row the Days list ever drew', async () => {
    serve();
    show(<DaysScreen />);
    await waitFor(() => expect(screen.getByTestId('day-2026-08-30')).toBeTruthy());
    expect(screen.getByTestId('day-2026-08-29')).toBeTruthy();

    fireEvent.press(screen.getByTestId('day-2026-08-29'));
    expect(mockPush).toHaveBeenCalledWith('/day/2026-08-29');
  });
});
