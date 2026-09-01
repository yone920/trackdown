import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Today from '@/app/(tabs)/index';
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
    expect(screen.getByTestId('metric-weight-trend')).toBeTruthy();
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
  it('asks about today when there is no plan, workout logged or not', async () => {
    serve();
    renderToday();
    await waitFor(() => expect(screen.getByTestId('coach-button')).toBeTruthy());
    expect(screen.getByText("Get today's plan")).toBeTruthy();
    expect(screen.queryByTestId('coach-button-sub')).toBeNull();

    mockApi.mockReset();
    serve({ day: makeDay({ workout_done: true }) });
    const again = renderToday();
    await waitFor(() => expect(again.getByText("Get today's plan")).toBeTruthy());
    expect(again.queryByText('What should I do tomorrow?')).toBeNull();
  });

  // ── The button reflects the day (user decision 2026-08-31 §1) ──────────────────────
  // Asking somebody who already has a plan what they should do today is the app forgetting
  // its own answer. The status behind this is an exists-check on the server: drawing the
  // button costs nothing and generates nothing.

  it('reads the plan from the status endpoint and never asks for a brief', async () => {
    serve({ coach: noPlan({ has_plan: true, headline: 'Pull day', total_count: 4 }) });
    renderToday();

    await waitFor(() => expect(screen.getByText("Today's plan")).toBeTruthy());
    expect(screen.getByTestId('coach-button-sub')).toHaveTextContent('4 moves');
    // The two endpoints that generate a brief are not touched by drawing a button.
    const paths = mockApi.mock.calls.map(([path]) => path);
    expect(paths).toContain('/api/coach/status');
    expect(paths).not.toContain('/api/coach/next');
    expect(paths).not.toContain('/api/coach/next/regenerate');
  });

  it('counts the plan off underneath the label', async () => {
    serve({ coach: noPlan({ has_plan: true, headline: 'Pull day', done_count: 2, total_count: 4 }) });
    renderToday();

    await waitFor(() => expect(screen.getByText("Today's plan")).toBeTruthy());
    expect(screen.getByTestId('coach-button-sub')).toHaveTextContent('2 of 4 done');
  });

  it('says the plan is complete rather than asking the question again', async () => {
    serve({
      coach: noPlan({ has_plan: true, headline: 'Pull day', done_count: 4, total_count: 4, complete: true }),
    });
    renderToday();

    await waitFor(() => expect(screen.getByTestId('coach-button-sub')).toHaveTextContent('Plan complete ✓'));
    expect(screen.getByText("Today's plan")).toBeTruthy();
    expect(screen.queryByText("Get today's plan")).toBeNull();
  });

  it('draws no count under a rest day, which has nothing to tick', async () => {
    serve({ coach: noPlan({ has_plan: true, headline: 'Rest today', total_count: 0 }) });
    renderToday();

    await waitFor(() => expect(screen.getByText("Today's plan")).toBeTruthy());
    expect(screen.queryByTestId('coach-button-sub')).toBeNull();
  });

  it('falls back to the question when the status cannot be read', async () => {
    mockApi.mockImplementation((path: string) => {
      if (path === '/api/coach/status') return Promise.reject(new Error('offline'));
      if (path.startsWith('/api/day/')) return Promise.resolve(makeDay());
      if (path === '/api/week') return Promise.resolve(makeWeek());
      if (path === '/api/goals') return Promise.resolve({ active: [], history: [], no_goal: true });
      return Promise.resolve({ id: 'u', targets: {} });
    });
    renderToday();

    await waitFor(() => expect(screen.getByTestId('coach-button')).toBeTruthy());
    // The half of the pair that promises nothing that might not be there.
    expect(screen.getByText("Get today's plan")).toBeTruthy();
  });

  it('opens the coach page and generates nothing, either way', async () => {
    serve({ coach: noPlan({ has_plan: true, headline: 'Pull day', done_count: 1, total_count: 3 }) });
    renderToday();

    await waitFor(() => expect(screen.getByText("Today's plan")).toBeTruthy());
    fireEvent.press(screen.getByTestId('coach-button'));
    expect(mockPush).toHaveBeenCalledWith('/coach');
    expect(mockApi.mock.calls.map(([path]) => path)).not.toContain('/api/coach/next/regenerate');
  });

  it('marks an estimated block "est." on the training line and on the block itself', async () => {
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
    serve({ day: makeDay({ blocks: [block], earned: 264 }) });
    renderToday();

    await waitFor(() => expect(screen.getByText('Chest & Triceps')).toBeTruthy());
    expect(screen.getByText(/264 kcal earned/)).toBeTruthy();
    // Once on the section's earned line, once on the block's own header.
    expect(screen.getAllByText('est.')).toHaveLength(2);
  });

  it('leaves a block that reported its own calories unmarked', async () => {
    const block = {
      id: 'b1',
      title: 'Walk',
      start: '2026-08-30T08:00:00.000Z',
      end: '2026-08-30T08:40:00.000Z',
      minutes: 40,
      kcal: 180,
      kcal_from_health: false,
      kcal_estimated: false,
      exercise_count: 1,
      activity_ids: ['a1'],
      muscle_groups: [],
      category: 'cardio' as const,
      health: null,
    };
    serve({ day: makeDay({ blocks: [block], earned: 180 }) });
    renderToday();

    await waitFor(() => expect(screen.getByText('Walk')).toBeTruthy());
    expect(screen.queryByText('est.')).toBeNull();
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

  it('deletes a logged exercise in two taps and the totals follow', async () => {
    const calls = serveDeletable();
    renderToday();
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());
    expect(screen.getByText(/264 kcal earned/)).toBeTruthy();

    // One tap arms, and asks in the row itself.
    fireEvent.press(screen.getByTestId('row-activity-a1-delete'));
    expect(screen.getByText('Delete?')).toBeTruthy();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    fireEvent.press(screen.getByTestId('row-activity-a1-delete-confirm'));
    await waitFor(() => expect(screen.getByText('Nothing yet')).toBeTruthy());

    expect(calls).toContainEqual({ path: '/api/entries/movement/a1', method: 'DELETE' });
    expect(screen.queryByText('Bench Press')).toBeNull();
    expect(screen.queryByText(/264 kcal earned/)).toBeNull();
    expect(screen.getByText('No exercise logged today.')).toBeTruthy();
  });

  it('deletes a meal the same way, and the second tap is what does it', async () => {
    const calls = serveDeletable();
    renderToday();
    await waitFor(() => expect(screen.getByText('eggs and toast')).toBeTruthy());

    // Armed, then taken back by a scroll — there is no cancel button beside the pill, and
    // that is the point of the redesign (components/kit.tsx §DeleteControl).
    fireEvent.press(screen.getByTestId('row-meal-m1-delete'));
    fireEvent(screen.getByTestId('today-scroll'), 'scrollBeginDrag', { nativeEvent: {} });
    expect(screen.queryByText('Delete?')).toBeNull();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    fireEvent.press(screen.getByTestId('row-meal-m1-delete'));
    fireEvent.press(screen.getByTestId('row-meal-m1-delete-confirm'));
    await waitFor(() => expect(screen.getByText('Nothing eaten yet today.')).toBeTruthy());
    expect(calls).toContainEqual({ path: '/api/entries/meals/m1', method: 'DELETE' });
  });

  it('opens a training row for correction, and its name still opens the exercise', async () => {
    serveDeletable();
    renderToday();
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());

    // The row body is the correction — the same screen the record view routes to.
    fireEvent.press(screen.getByTestId('row-activity-a1-open'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/log',
      params: { editDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), editId: 'a1', editKind: 'activity' },
    });

    // The name inside it is still its own target, and it is not the correction.
    mockPush.mockReset();
    fireEvent.press(screen.getByLabelText('Bench Press — how it is done'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0]?.[0]).not.toMatchObject({ pathname: '/log' });
  });

  it('opens a meal row for correction', async () => {
    serveDeletable();
    renderToday();
    await waitFor(() => expect(screen.getByText('eggs and toast')).toBeTruthy());
    fireEvent.press(screen.getByTestId('row-meal-m1-open'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/log',
      params: { editDate: expect.any(String), editId: 'm1', editKind: 'meal' },
    });
  });

  it('shows one meal for one meal, and nothing about a dinner nobody ate', async () => {
    serve({
      day: makeDay({
        items: { meals: [MEAL], activities: [], weights: [] },
        // The server still computes it; no screen renders it (user decision 2026-08-31).
        expected: [{ kind: 'meal', slot: 'dinner', label: 'Dinner' }],
      }),
    });
    renderToday();
    await waitFor(() => expect(screen.getByText('eggs and toast')).toBeTruthy());
    expect(screen.getByText('Breakfast')).toBeTruthy();
    expect(screen.queryByText('Dinner')).toBeNull();
    expect(screen.queryByText('Expected')).toBeNull();
    expect(screen.queryByText('Not logged yet')).toBeNull();
  });

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

// Reported 2026-08-31: a row read "Lat Pulldown" over "4 × 15 lat pulldown at 60 lb" — the
// name twice and the numbers about to be shown again. The sub-line is structured facts
// (lib/row-facts.ts), and the sentence only when it still says something.
describe('Today — a row never repeats itself', () => {
  const lift = (over: Partial<DayActivity>): DayActivity => ({
    id: 'a9',
    logged_at: '2026-08-30T08:10:00.000Z',
    description: '4 × 15 lat pulldown at 60 lb',
    exercise: 'Lat Pulldown',
    exercise_id: null,
    equipment: null,
    category: 'strength',
    muscle_groups: ['lats'],
    sets: 4,
    reps: 15,
    load_lb: 60,
    duration_min: null,
    distance_mi: null,
    kcal: 90,
    source: 'manual',
    confidence: 'high',
    block_id: null,
    delta_vs_last: null,
    evidence: [],
    ...over,
  });

  const show = (activity: DayActivity) => {
    serve({ day: makeDay({ items: { meals: [], activities: [activity], weights: [] }, earned: 90 }) });
    renderToday();
  };

  it('prints the facts once, and not the sentence they came from', async () => {
    show(lift({}));
    await waitFor(() => expect(screen.getByText('Lat Pulldown')).toBeTruthy());
    expect(screen.getByText('4 × 15 · 60 lb')).toBeTruthy();
    expect(screen.queryByText('4 × 15 lat pulldown at 60 lb')).toBeNull();
  });

  it('keeps the words when they carry something the fields cannot', async () => {
    show(lift({ description: '4 × 15 lat pulldown at 60 lb, last set was ugly' }));
    await waitFor(() => expect(screen.getByText('Lat Pulldown')).toBeTruthy());
    expect(screen.getByText(/last set was ugly/)).toBeTruthy();
  });
});


// ── no dead taps on Today ────────────────────────────────────────────────────────────
// Field report 2026-09-01: rows whose movement the catalogue never resolved did nothing
// when their name was pressed. A name-only sheet — a title and a form video that is a
// YouTube search — is a better answer than nothing at all.

describe("Today's exercise names", () => {
  const NAMELESS: DayActivity = {
    id: 'a9',
    logged_at: '2026-08-30T09:00:00.000Z',
    description: 'that inclined machine I lay on my tummy for',
    exercise: null,
    exercise_id: null,
    media_count: 0,
    equipment: 'chest-supported row machine',
    category: 'strength',
    muscle_groups: ['back'],
    sets: 3,
    reps: 12,
    load_lb: 45,
    duration_min: null,
    distance_mi: null,
    kcal: 90,
    source: 'fused',
    confidence: 'low',
    block_id: null,
    delta_vs_last: null,
    evidence: [],
  };

  function serveActivities(activities: DayActivity[]) {
    mockApi.mockImplementation((path: string) => {
      if (path.startsWith('/api/day/')) {
        return Promise.resolve(
          makeDay({ blocks: [], earned: 90, eaten: 0, items: { meals: [], activities, weights: [] } }),
        );
      }
      if (path === '/api/week') return Promise.resolve(makeWeek());
      if (path === '/api/goals') return Promise.resolve({ active: [], history: [], no_goal: true });
      if (path === '/api/profile') return Promise.resolve({ id: 'u', targets: {} });
      return Promise.resolve(null);
    });
  }

  beforeEach(() => {
    mockApi.mockReset();
    mockPush.mockReset();
  });

  it('opens a row the catalogue never resolved, by its own description', async () => {
    serveActivities([NAMELESS]);
    renderToday();
    await waitFor(() =>
      expect(screen.getByText('that inclined machine I lay on my tummy for')).toBeTruthy(),
    );

    fireEvent.press(screen.getByText('that inclined machine I lay on my tummy for'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/exercise/[id]',
      params: {
        id: 'unknown',
        name: 'that inclined machine I lay on my tummy for',
        media: '0',
      },
    });
  });

  it('draws the glyph on the row that has pictures and not on the one that does not', async () => {
    serveActivities([
      {
        ...NAMELESS,
        id: 'a8',
        exercise: 'Bench Press',
        exercise_id: 'ex-bench',
        media_count: 2,
        description: '3 × 8 bench at 135 lb',
      },
      NAMELESS,
    ]);
    renderToday();
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());

    expect(screen.getByTestId('row-activity-a8-photo')).toBeTruthy();
    expect(screen.queryByTestId('row-activity-a9-photo')).toBeNull();
  });
});
