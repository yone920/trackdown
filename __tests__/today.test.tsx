import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Today from '@/app/(tabs)/today';
import { clock } from '@/lib/format';
import type { CoachStatus, DayActivity, DayMeal } from '@/lib/types';
import { makeDay, makeGoal, makeMetric, makeWeek } from './fixtures';

// Today rendered against a fake API: the header, the goal banner and — the part that is a
// decision rather than a rendering — the cards the primary goal chose.

const mockApi = jest.fn();
jest.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  upload: jest.fn(),
  tzOffsetMin: () => 0,
  authHeaders: () => ({}),
  evidenceUrl: (id: string) => `http://test/api/evidence/${id}`,
  API_URL: 'http://test',
  ApiError: class extends Error {},
  setUnauthorizedHandler: () => {},
}));

// The global mock hands out a fresh `push` per call, so this screen brings its own.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

function renderToday() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Today />
    </QueryClientProvider>,
  );
}

/** What GET /api/coach/status answers. No plan asked for yet is the default. */
function noPlan(overrides: Partial<CoachStatus> = {}): CoachStatus {
  return {
    date: '2026-08-31',
    has_plan: false,
    headline: null,
    done_count: 0,
    total_count: 0,
    complete: false,
    ...overrides,
  };
}

function serve({
  day = makeDay(),
  week = makeWeek(),
  goals = { active: [], history: [], no_goal: true },
  coach = noPlan(),
}: { day?: unknown; week?: unknown; goals?: unknown; coach?: unknown } = {}) {
  mockApi.mockImplementation((path: string) => {
    if (path.startsWith('/api/day/')) return Promise.resolve(day);
    if (path === '/api/week') return Promise.resolve(week);
    if (path === '/api/goals') return Promise.resolve(goals);
    if (path === '/api/profile') return Promise.resolve({ id: 'u', targets: {} });
    if (path === '/api/coach/status') return Promise.resolve(coach);
    return Promise.resolve(null);
  });
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
});

/** One logged exercise, for the Training section's own tests. */
function lift(overrides: Partial<DayActivity> = {}): DayActivity {
  return {
    id: 'a1',
    logged_at: '2026-08-30T08:10:00.000Z',
    description: '3 × 8 bench at 135 lb',
    exercise: 'Bench Press',
    exercise_id: 'ex-bench',
    media_count: 0,
    equipment: null,
    category: 'strength',
    muscle_groups: ['chest'],
    sets: 3,
    reps: 8,
    load_lb: 135,
    duration_min: null,
    distance_mi: null,
    kcal: 264,
    source: 'manual',
    confidence: 'high',
    block_id: 'b1',
    delta_vs_last: null,
    evidence: [],
    ...overrides,
  };
}

describe('Today', () => {
  it('shows the day number with no verdict on an empty day, and the no-goal banner', async () => {
    serve();
    renderToday();
    await waitFor(() => expect(screen.getByText(/Day 12/)).toBeTruthy());
    // 0 eaten is trivially "under allowance": an untouched day earns no green badge.
    expect(screen.queryByText('on track')).toBeNull();
    expect(screen.getByText('No goal set')).toBeTruthy();
    expect(screen.getByText('Training for consistency')).toBeTruthy();
  });

  it('shows the status once something is logged', async () => {
    serve({ day: makeDay({ items: { meals: [MEAL], activities: [], weights: [] } }) });
    renderToday();
    await waitFor(() => expect(screen.getByText(/Day 12/)).toBeTruthy());
    expect(screen.getByText('on track')).toBeTruthy();
  });

  it('draws the fat-loss cards when the primary goal is fat loss', async () => {
    serve({ goals: { active: [makeGoal('lose_fat')], history: [], no_goal: false } });
    renderToday();
    await waitFor(() => expect(screen.getByTestId('metric-calories-left')).toBeTruthy());
    expect(screen.getByTestId('metric-weekly-deficit')).toBeTruthy();
    // The 7-day weight lives on Home now: it does not move over the course of a day, so
    // it is not news on the working page (user decision 2026-09-01).
    expect(screen.queryByTestId('metric-weight-trend')).toBeNull();
    expect(screen.queryByTestId('metric-coverage')).toBeNull();
    expect(screen.getByText('Get to 170 lb')).toBeTruthy();
  });

  it('draws the muscle cards when the primary goal is muscle', async () => {
    serve({
      goals: {
        active: [
          makeGoal('gain_muscle', [
            makeMetric({ measure: 'weekly_sets', label: 'Weekly sets', unit: 'sets', target: 12, current: 6 }),
          ]),
        ],
        history: [],
        no_goal: false,
      },
    });
    renderToday();
    await waitFor(() => expect(screen.getByTestId('metric-protein')).toBeTruthy());
    expect(screen.getByTestId('metric-weekly_sets')).toBeTruthy();
    expect(screen.getByTestId('metric-coverage')).toBeTruthy();
    expect(screen.queryByTestId('metric-calories-left')).toBeNull();
  });

  // It used to flip to "What should I do tomorrow?" the moment anything was logged, which
  // told a user standing in the gym that today was over — and the brief behind the button
  // is a plan for the rest of today, with the morning's work already ticked off it (user
  // decision 2026-08-31 §A4).
  it("does not print the day's log twice: the training figure lives behind the door", async () => {
    // The full grouped log and its "est." qualifier moved to app/today/training.tsx; what
    // is left here is one line (user decision 2026-09-01 — the log was pushing the day off
    // its own screen).
    const block = {
      id: 'b1',
      title: 'Chest & Triceps',
      start: '2026-08-30T08:00:00.000Z',
      end: '2026-08-30T08:39:00.000Z',
      minutes: 39,
      kcal: 264,
      kcal_from_health: false,
      kcal_estimated: true,
      exercise_count: 4,
      activity_ids: ['a1'],
      muscle_groups: ['chest'],
      category: 'strength' as const,
      health: null,
    };
    serve({
      day: makeDay({ blocks: [block], earned: 264, items: { meals: [], weights: [], activities: [lift()] } }),
    });
    renderToday();

    await waitFor(() => expect(screen.getByTestId('today-done-line')).toHaveTextContent(/264 kcal earned/));
    expect(screen.getByTestId('today-done-line')).toHaveTextContent(/1 move/);
    // Not a single row, and not the block's own title.
    expect(screen.queryByText('Bench Press')).toBeNull();
    expect(screen.queryByText('Chest & Triceps')).toBeNull();
  });

  // A day that has one lift and one meal in it, so a delete has something to change.
  const ACTIVITY: DayActivity = {
    id: 'a1',
    logged_at: '2026-08-30T08:10:00.000Z',
    description: '3 × 8 bench at 135 lb',
    exercise: 'Bench Press',
    exercise_id: 'ex-bench',
    media_count: 2,
    equipment: null,
    category: 'strength',
    muscle_groups: ['chest'],
    sets: 3,
    reps: 8,
    load_lb: 135,
    duration_min: null,
    distance_mi: null,
    kcal: 264,
    source: 'manual',
    confidence: 'high',
    block_id: 'b1',
    delta_vs_last: null,
    evidence: [],
  };

  const MEAL: DayMeal = {
    id: 'm1',
    logged_at: '2026-08-30T07:30:00.000Z',
    description: 'eggs and toast',
    slot: 'breakfast',
    stated_slot: null,
    kcal: 480,
    protein_g: 32,
    carbs_g: 40,
    fat_g: 20,
    fiber_g: 4,
    evidence: [],
  };

  const BLOCK = {
    id: 'b1',
    title: 'Chest',
    start: '2026-08-30T08:00:00.000Z',
    end: '2026-08-30T08:39:00.000Z',
    minutes: 39,
    kcal: 264,
    kcal_from_health: false,
    kcal_estimated: false,
    exercise_count: 1,
    activity_ids: ['a1'],
    muscle_groups: ['chest'],
    category: 'strength' as const,
    health: null,
  };

  /**
   * The API before and after the row is gone. The day is served from a flag the DELETE
   * flips, which is what the server does: the screen re-reads and the numbers move.
   */
  function serveDeletable() {
    const calls: { path: string; method?: string }[] = [];
    let gone = false;
    mockApi.mockImplementation((path: string, options?: { method?: string }) => {
      calls.push({ path, method: options?.method });
      if (options?.method === 'DELETE') {
        gone = true;
        return Promise.resolve(undefined);
      }
      if (path.startsWith('/api/day/')) {
        return Promise.resolve(
          gone
            ? makeDay({ blocks: [], earned: 0, eaten: 0, items: { meals: [], activities: [], weights: [] } })
            : makeDay({
                blocks: [BLOCK],
                earned: 264,
                eaten: 480,
                items: { meals: [MEAL], activities: [ACTIVITY], weights: [] },
              }),
        );
      }
      if (path === '/api/week') return Promise.resolve(makeWeek());
      if (path === '/api/goals') return Promise.resolve({ active: [], history: [], no_goal: true });
      if (path === '/api/profile') return Promise.resolve({ id: 'u', targets: {} });
      return Promise.resolve(null);
    });
    return calls;
  }

  it('shows the Right now reading as a pure card — the + is the one door to log', async () => {
    serve({
      day: makeDay({
        reading: {
          kind: 'right_now',
          text: 'You are 700 under. Dinner is the only thing missing.',
          next_action: { label: 'Log dinner', kind: 'log_meal', hint: null },
          actions: [{ label: 'Weigh in', kind: 'weigh_in' }],
          inputs_hash: 'x',
          model: 'test',
          created_at: '2026-08-30T18:00:00.000Z',
        },
      }),
    });
    renderToday();
    await waitFor(() => expect(screen.getByText(/700 under/)).toBeTruthy());
    expect(screen.queryByText('Log dinner')).toBeNull();
    expect(screen.queryByText('Weigh in')).toBeNull();
  });
});
describe('Today — the plan and the day on one page', () => {
  // User decision 2026-09-01. The plan used to live on a page of its own behind a button
  // at the bottom of this one, which put what you are about to do and what you have
  // actually done two screens apart.

  const BRIEF = {
    date: '2026-08-30',
    brief: {
      headline: 'Pull day',
      why: 'Back is five days overdue.',
      workout: {
        type: 'strength',
        targets: ['back'],
        exercises: [
          { name: 'Lat Pulldown', exercise_id: null, load_lb: 60, sets: 3, reps: 12, note: null, completion: null },
        ],
        finisher: [],
        complete: false,
      },
      nutrition: null,
      nudge: null,
      asked_at: '2026-08-30T07:10:00.000Z',
      cached: true,
    },
    stale: false,
  };

  function serveWithPlan(day: unknown, plan: unknown) {
    mockApi.mockImplementation((path: string) => {
      if (path.startsWith('/api/day/')) return Promise.resolve(day);
      if (path === '/api/week') return Promise.resolve(makeWeek());
      if (path === '/api/goals') return Promise.resolve({ active: [], history: [], no_goal: true });
      if (path === '/api/profile') return Promise.resolve({ id: 'u', targets: {} });
      if (path === '/api/coach/next') return Promise.resolve(plan);
      return Promise.resolve(null);
    });
  }

  it('draws Do, Done and Eat together, from one plan and one day', async () => {
    serveWithPlan(
      makeDay({
        earned: 264,
        items: { meals: [], weights: [], activities: [lift()] },
      }),
      BRIEF,
    );
    renderToday();

    // Do — the plan, in full, before what happened. It is the only list on the page.
    await waitFor(() => expect(screen.getByText('Pull day')).toBeTruthy());
    expect(screen.getByTestId('coach-do-0')).toBeTruthy();
    expect(screen.getByText('Lat Pulldown')).toBeTruthy();
    // Done and Eat are one line each, with a door (user decision 2026-09-01).
    expect(screen.getByTestId('today-done-line')).toHaveTextContent(/1 move/);
    expect(screen.getByTestId('today-eat')).toBeTruthy();
    expect(screen.queryByText('Bench Press')).toBeNull();
    // And the three things that came off the page are off it.
    expect(screen.queryByText('The day so far')).toBeNull();
    expect(screen.queryByText('Body')).toBeNull();
    expect(screen.queryByTestId('coach-context')).toBeNull();
  });

  it('never generates a plan by being opened', async () => {
    // The contract that moved with the plan. Today is a tab; a tab is opened by accident.
    serveWithPlan(makeDay(), BRIEF);
    renderToday();

    await waitFor(() => expect(screen.getByText('Pull day')).toBeTruthy());
    const asked = mockApi.mock.calls.map(([path]) => path);
    expect(asked).not.toContain('/api/coach/next/regenerate');
    // The read is an exists-check: `generate=false` travels in the query, not the path.
    const read = mockApi.mock.calls.find(([path]) => path === '/api/coach/next');
    expect((read?.[1] as { query?: { generate?: boolean } } | undefined)?.query?.generate).toBe(false);
  });

  it('is a quiet food-and-body page on a day nobody started a workout on', async () => {
    // The rest-day expectation, said out loud by the user: meals and weigh-ins work
    // identically whether or not a workout was ever started.
    serveWithPlan(
      makeDay({
        items: {
          meals: [
            {
              id: 'm1',
              logged_at: '2026-08-30T07:30:00.000Z',
              description: 'eggs and toast',
              slot: 'breakfast' as const,
              stated_slot: null,
              kcal: 480,
              protein_g: 32,
              carbs_g: 40,
              fat_g: 20,
              fiber_g: 4,
              evidence: [],
            },
          ],
          weights: [],
          activities: [],
        },
        eaten: 480,
      }),
      null,
    );
    renderToday();

    // No plan was asked for, so the section is one card and a button — not a blank.
    await waitFor(() => expect(screen.getByTestId('coach-no-plan')).toBeTruthy());
    expect(screen.getByText("Start today's workout")).toBeTruthy();
    // And the rest of the day is entirely usable: the meal counted, on one line.
    expect(screen.getByTestId('today-eat-line')).toHaveTextContent(/480 eaten/);
    expect(screen.getByTestId('today-done-line')).toHaveTextContent(/Nothing logged yet/);
  });

  it('has no button to a plan page, because there is no plan page', async () => {
    serveWithPlan(makeDay(), BRIEF);
    renderToday();
    await waitFor(() => expect(screen.getByText('Pull day')).toBeTruthy());
    expect(screen.queryByTestId('coach-button')).toBeNull();
    expect(mockPush).not.toHaveBeenCalledWith('/coach');
  });
});

describe('Today — the doors, and what is no longer on the page', () => {
  // User decision 2026-09-01, from screenshots of the merged page. Three things came off
  // because they were pushing the day off its own screen, and one because it was a second
  // input surface.

  function serveDay(day: unknown) {
    mockApi.mockImplementation((path: string) => {
      if (path.startsWith('/api/day/')) return Promise.resolve(day);
      if (path === '/api/week') return Promise.resolve(makeWeek());
      if (path === '/api/goals') return Promise.resolve({ active: [], history: [], no_goal: true });
      if (path === '/api/profile') return Promise.resolve({ id: 'u', targets: {} });
      return Promise.resolve(null);
    });
  }

  const MEAL: DayMeal = {
    id: 'm1',
    logged_at: '2026-08-30T07:30:00.000Z',
    description: 'eggs and toast',
    slot: 'breakfast',
    stated_slot: null,
    kcal: 480,
    protein_g: 32,
    carbs_g: 40,
    fat_g: 20,
    fiber_g: 4,
    evidence: [],
  };

  it('says how the day is going in one line each, and opens the log on a tap', async () => {
    serveDay(
      makeDay({
        earned: 569,
        eaten: 480,
        allowance: 2865,
        items: { meals: [MEAL], activities: [lift(), lift({ id: 'a2' })], weights: [] },
      }),
    );
    renderToday();

    await waitFor(() => expect(screen.getByTestId('today-done-line')).toHaveTextContent(/569 kcal earned/));
    expect(screen.getByTestId('today-done-line')).toHaveTextContent(/2 moves/);
    fireEvent.press(screen.getByTestId('today-done'));
    expect(mockPush).toHaveBeenCalledWith('/today/training');

    // ONE calorie figure on the Eat line, and it is the day's own arithmetic. The card
    // that used to be here printed it three times and then quoted a different one out of
    // an older brief.
    expect(screen.getByTestId('today-eat-line')).toHaveTextContent('480 eaten · 2,385 left');
    fireEvent.press(screen.getByTestId('today-eat'));
    expect(mockPush).toHaveBeenCalledWith('/today/eating');
  });

  it('counts an over-allowance day as over, not as a negative amount left', async () => {
    serveDay(makeDay({ eaten: 2574, allowance: 2254, items: { meals: [MEAL], activities: [], weights: [] } }));
    renderToday();
    await waitFor(() => expect(screen.getByTestId('today-eat-line')).toHaveTextContent(/over/));
    expect(screen.getByTestId('today-eat-line')).not.toHaveTextContent('-');
  });

  it('draws neither the arc, nor Body, nor a second form anywhere on it', async () => {
    serveDay(makeDay({ arc: [{ at: '2026-08-30T08:10:00.000Z', kind: 'activity', label: 'Bench' }] as never }));
    renderToday();

    await waitFor(() => expect(screen.getByTestId('today-done')).toBeTruthy());
    expect(screen.queryByText('The day so far')).toBeNull();
    expect(screen.queryByText('Body')).toBeNull();
    expect(screen.queryByText('7-day avg')).toBeNull();
    // The one-door law: no input surface but the + (concept-v2 §Principles 7).
    expect(screen.queryByTestId('coach-context')).toBeNull();
    expect(screen.queryByTestId('coach-photo')).toBeNull();
    expect(screen.queryByTestId('coach-type')).toBeNull();
  });
});
