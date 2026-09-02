import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Progress from '@/app/(tabs)/progress';
import type { TrainingBoard } from '@/lib/types';
import { EMPTY_BOARD, makeBoard, makeDayRow, makeGoal, makeMetric, makeWeek } from './fixtures';

// Progress, as a SCOREBOARD (user decision 2026-09-02, from a reviewed mockup).
//
// The contract this file holds the page to:
//
//   1. Seven rows, each carrying a computed fact — the page alone says how you are doing.
//   2. **Nothing is open on it.** No body figure, no lift cards, no weigh-in rows, no days
//      archive, no cardio breakdown. Those all still exist, one tap away, and the file that
//      checks they survived is progress-doors.test.tsx.
//   3. Every row is a door, and the doors go where they say.
//   4. A tap on a muscle chip opens the figure over the page, with that muscle's facts.

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
 * is the *data* handed to it — the slugs of the muscle that was tapped, in the ledger's
 * colours — so the stub renders one node per part carrying exactly that.
 */
jest.mock('react-native-body-highlighter', () => {
  const { View } = require('react-native');
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: ({ data, side }: any) =>
      ReactModule.createElement(
        View,
        { testID: `figure-${side}` },
        data.map((part: any) =>
          ReactModule.createElement(View, {
            key: part.slug,
            testID: `part-${side}-${part.slug}`,
            accessibilityLabel: `${part.slug} ${part.styles.fill} ${part.styles.stroke}`,
          }),
        ),
      ),
  };
});

/** The day the fixtures are written around, as `localDateKey()` reads the device clock. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

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
        { date: '2026-08-24', value: 212 },
        { date: '2026-08-31', value: 210.4 },
      ],
    }),
  ]),
  title: 'Get to 200 lb',
  metrics: [{ measure: 'body_weight', target: 200, unit: 'lb', by: '2027-03-01' }],
});

function serve({
  goals = { active: [], history: [], no_goal: true },
  board = makeBoard(),
  days = [
    makeDayRow({ date: todayKey(), is_today: true, earned: 175, summary: 'Pull day + walk' }),
    makeDayRow({ date: '2026-08-30', earned: 300 }),
    makeDayRow({ date: '2026-08-29', earned: 120 }),
    makeDayRow({ date: '2026-08-28', earned: 90 }),
  ],
}: { goals?: unknown; board?: TrainingBoard; days?: unknown[] } = {}) {
  const calls: { path: string; body?: unknown; method?: string }[] = [];
  mockApi.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
    calls.push({ path, ...(options ?? {}) });
    if (path === '/api/goals') return Promise.resolve(goals);
    if (path.startsWith('/api/goals/') && path.endsWith('/progress'))
      return Promise.resolve({ metrics: (goals as { active: { progress: { metrics: unknown[] } }[] }).active[0]?.progress.metrics ?? [] });
    if (path === '/api/training/board') return Promise.resolve(board);
    if (path === '/api/week') return Promise.resolve(makeWeek());
    if (path.startsWith('/api/days')) return Promise.resolve({ days, next_before: null });
    if (path === '/api/profile') return Promise.resolve({ id: 'u', stated_at: {}, targets: {} });
    return Promise.resolve(null);
  });
  return calls;
}

/** The board has arrived: the cardio row is drawn from it and from nothing else. */
const boardReady = () => waitFor(() => expect(screen.getByTestId('tile-cardio')).toBeTruthy());

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

describe('Progress — one screenful of live facts', () => {
  it('draws all seven rows', async () => {
    serve({ goals: { active: [weightGoal()], history: [], no_goal: false } });
    renderProgress();

    await waitFor(() => expect(screen.getByTestId('tile-goal')).toBeTruthy());
    expect(screen.getByText('Progress')).toBeTruthy();
    expect(screen.getByTestId('progress-date')).toBeTruthy();
    expect(screen.getByTestId('tile-body')).toBeTruthy();
    expect(screen.getByTestId('tile-strength')).toBeTruthy();
    expect(screen.getByTestId('tile-coverage')).toBeTruthy();
    expect(screen.getByTestId('tile-cardio')).toBeTruthy();
    expect(screen.getByTestId('tile-days')).toBeTruthy();
  });

  // The whole point of the rebuild: everything below used to be drawn open, in this order,
  // several screens deep, and nobody reached the bottom of it.
  it('opens none of it in place — no figure, no lift cards, no weigh-in rows, no archive', async () => {
    serve({ goals: { active: [weightGoal()], history: [], no_goal: false } });
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('tile-goal')).toBeTruthy());

    expect(screen.queryByTestId('figure-front')).toBeNull();
    expect(screen.queryByTestId('figure-back')).toBeNull();
    expect(screen.queryByTestId('lifts-board')).toBeNull();
    expect(screen.queryByTestId('lift-Bench Press')).toBeNull();
    expect(screen.queryByTestId('cardio-board')).toBeNull();
    expect(screen.queryByTestId('cardio-breakdown')).toBeNull();
    expect(screen.queryByTestId('frequency')).toBeNull();
    // The goal's chart, its readings trio and its controls are all behind the row.
    expect(screen.queryByTestId('goal-chart-goal-1')).toBeNull();
    expect(screen.queryByTestId('mark-reached-goal-1')).toBeNull();
    // The days ARCHIVE (components/days-list.tsx draws `day-<date>`); the row draws three.
    expect(screen.queryByTestId('day-2026-08-30')).toBeNull();
  });

  it('says where the goal stands: the ring, the measure and the last move', async () => {
    serve({ goals: { active: [weightGoal()], history: [], no_goal: false } });
    renderProgress();

    await waitFor(() => expect(screen.getByTestId('goal-value')).toBeTruthy());
    expect(screen.getByTestId('goal-eyebrow').props.children).toBe('Goal · Get to 200 lb');
    expect(screen.getByTestId('goal-percent').props.children).toBe('13%');
    expect(screen.getByTestId('goal-value').props.children).toBe('210.4');
    // The weigh-ins behind the average, so the row can be checked against the scale.
    expect(screen.getByTestId('goal-delta').props.children).toBe('−1.6 lb since Mon, Aug 24');
    // Green, because that is movement toward a stated target.
    expect(screen.getByTestId('goal-delta').props.style.flat(2)).toContainEqual(
      expect.objectContaining({ color: '#3DD68C' }),
    );
  });

  it('draws the weight line on the row it summarises', async () => {
    serve();
    renderProgress();
    await boardReady();
    expect(screen.getByTestId('body-line').props.children[0]).toContain('210.4 lb');
    expect(screen.getByTestId('body-spark')).toBeTruthy();
  });

  it('says what is new on the board, and names the movers it is new about', async () => {
    serve();
    renderProgress();
    await boardReady();

    expect(screen.getByText('Strength · 2 lifts')).toBeTruthy();
    expect(screen.getByTestId('strength-news').props.children).toBe('1 ready to step up');
    // The chin-up is the one with news; the bench is holding and stays behind the door.
    expect(screen.getByTestId('mover-Assisted Chin-Up')).toBeTruthy();
    expect(screen.getByTestId('mover-next-Assisted Chin-Up').props.children).toBe(
      '50 lb of assistance next — one step less help',
    );
    expect(screen.queryByTestId('mover-Bench Press')).toBeNull();
  });

  it('counts the coverage and draws twelve chips, not two figures', async () => {
    serve();
    renderProgress();
    await boardReady();

    expect(screen.getByTestId('coverage-line').props.children).toBe('3 of 12 served · quiet: calves, core');
    expect(screen.getByTestId('chip-chest')).toBeTruthy();
    expect(screen.getByTestId('chip-calves')).toBeTruthy();
    expect(screen.getByTestId('coverage-chips').props.children).toHaveLength(12);
  });

  it('puts the week against its cardio target, with the next prescription in green', async () => {
    serve();
    renderProgress();
    await boardReady();
    expect(screen.getByTestId('cardio-line').props.children[0]).toBe('50 of 150 min');
    expect(screen.getByText(' · 22 min next')).toBeTruthy();
    expect(screen.getByTestId('cardio-bar')).toBeTruthy();
  });

  it('keeps the last three days and what each one earned', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId(`day-row-${todayKey()}`)).toBeTruthy());

    expect(screen.getByText('Today · Pull day + walk')).toBeTruthy();
    expect(screen.getByTestId(`day-right-${todayKey()}`).props.children).toBe('175 earned');
    expect(screen.getByTestId('day-row-2026-08-30')).toBeTruthy();
    expect(screen.getByTestId('day-row-2026-08-29')).toBeTruthy();
    // Three, and the fourth is behind "All days".
    expect(screen.queryByTestId('day-row-2026-08-28')).toBeNull();
    expect(screen.getByText('4 of 7 served', { exact: false })).toBeTruthy();
  });
});

describe('Progress — every row is a door', () => {
  it.each([
    ['tile-goal', '/progress/goal'],
    ['tile-body', '/progress/body'],
    ['tile-strength', '/progress/strength'],
    ['coverage-head', '/progress/coverage'],
    ['tile-cardio', '/progress/cardio'],
    ['days-all', '/days'],
  ])('%s opens %s', async (testID, route) => {
    serve({ goals: { active: [weightGoal()], history: [], no_goal: false } });
    renderProgress();
    await boardReady();
    fireEvent.press(screen.getByTestId(testID));
    expect(mockPush).toHaveBeenCalledWith(route);
  });

  it('sends a day row to its day, and today to the tab that owns it', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('day-row-2026-08-30')).toBeTruthy());

    fireEvent.press(screen.getByTestId('day-row-2026-08-30'));
    expect(mockPush).toHaveBeenCalledWith('/day/2026-08-30');

    fireEvent.press(screen.getByTestId(`day-row-${todayKey()}`));
    expect(mockPush).toHaveBeenCalledWith('/train');
  });

  it('still opens the plan and the account from the avatar', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByTestId('progress-you')).toBeTruthy());
    fireEvent.press(screen.getByTestId('progress-you'));
    expect(mockPush).toHaveBeenCalledWith('/you');
  });

  it('asks for a goal rather than pretending to keep score without one', async () => {
    serve();
    renderProgress();
    await waitFor(() => expect(screen.getByText('No goal yet')).toBeTruthy());
    fireEvent.press(screen.getByTestId('tile-goal-empty'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { hint: 'goal' } });
  });
});

describe('Progress — the muscle popup', () => {
  it('opens the figure over the page with that muscle’s week and what fed it', async () => {
    serve();
    renderProgress();
    await boardReady();
    expect(screen.queryByTestId('muscle-sheet-headline')).toBeNull();

    fireEvent.press(screen.getByTestId('chip-chest'));
    await waitFor(() => expect(screen.getByTestId('muscle-sheet-headline')).toBeTruthy());

    expect(screen.getByTestId('muscle-sheet-eyebrow').props.children).toBe('Coverage · Chest');
    expect(screen.getByTestId('muscle-sheet-headline').props.children).toBe('12 sets this week');
    expect(screen.getByTestId('muscle-sheet-band').props.children).toBe('in the band');
    // The figure, zoomed on the muscle that was tapped and on nothing else.
    expect(screen.getByTestId('part-front-chest')).toBeTruthy();
    expect(screen.queryByTestId('part-front-biceps')).toBeNull();
    // The fact stack: the band, when it was last trained, and what is feeding it.
    expect(screen.getByTestId('muscle-fact-target').props.children).toBe('10–20 sets/wk');
    expect(screen.getByTestId('muscle-fact-last-trained').props.children).toContain('Bench Press');
    expect(screen.getByTestId('muscle-fact-fed-by').props.children).toBe('Bench Press · 3 sets');
  });

  it('closes on the backdrop', async () => {
    serve();
    renderProgress();
    await boardReady();

    fireEvent.press(screen.getByTestId('chip-calves'));
    await waitFor(() => expect(screen.getByTestId('muscle-sheet-headline')).toBeTruthy());
    expect(screen.getByTestId('muscle-sheet-headline').props.children).toBe('Nothing in four weeks');

    fireEvent.press(screen.getByTestId('muscle-sheet-backdrop'));
    await waitFor(() => expect(screen.queryByTestId('muscle-sheet-headline')).toBeNull());
  });
});

describe('Progress — an account with nothing on it', () => {
  it('says the quiet true thing on every row, and invents no shortfall', async () => {
    serve({ board: EMPTY_BOARD, days: [] });
    renderProgress();

    await waitFor(() => expect(screen.getByTestId('body-empty').props.children).toBe('No weigh-ins yet.'));
    expect(screen.getByTestId('strength-news').props.children).toBe('Nothing lifted in four weeks');
    expect(screen.getByTestId('coverage-line').props.children).toBe('0 of 12 served');
    // Cardio is not a row on the screen of somebody who lifts and does not run.
    expect(screen.queryByTestId('tile-cardio')).toBeNull();
    expect(screen.getByTestId('days-empty')).toBeTruthy();
  });
});
