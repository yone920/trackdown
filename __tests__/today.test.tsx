import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Today from '@/app/(tabs)/index';
import type { DayActivity, DayMeal } from '@/lib/types';
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

function renderToday() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Today />
    </QueryClientProvider>,
  );
}

function serve({
  day = makeDay(),
  week = makeWeek(),
  goals = { active: [], history: [], no_goal: true },
}: { day?: unknown; week?: unknown; goals?: unknown } = {}) {
  mockApi.mockImplementation((path: string) => {
    if (path.startsWith('/api/day/')) return Promise.resolve(day);
    if (path === '/api/week') return Promise.resolve(week);
    if (path === '/api/goals') return Promise.resolve(goals);
    if (path === '/api/profile') return Promise.resolve({ id: 'u', targets: {} });
    return Promise.resolve(null);
  });
}

beforeEach(() => mockApi.mockReset());

describe('Today', () => {
  it('shows the day number, the status and the no-goal banner', async () => {
    serve();
    renderToday();
    await waitFor(() => expect(screen.getByText(/Day 12/)).toBeTruthy());
    expect(screen.getByText('on track')).toBeTruthy();
    expect(screen.getByText('No goal set')).toBeTruthy();
    expect(screen.getByText('Training for consistency')).toBeTruthy();
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

  it('flips the coach button once the day has a workout in it', async () => {
    serve();
    renderToday();
    await waitFor(() => expect(screen.getByTestId('coach-button')).toBeTruthy());
    expect(screen.getByText('What should I do today?')).toBeTruthy();

    mockApi.mockReset();
    serve({ day: makeDay({ workout_done: true }) });
    const again = renderToday();
    await waitFor(() => expect(again.getByText('What should I do tomorrow?')).toBeTruthy());
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
    exercise_id: null,
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

    fireEvent.press(screen.getByTestId('row-activity-a1-delete-yes'));
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

    // Armed, then taken back: nothing is sent.
    fireEvent.press(screen.getByTestId('row-meal-m1-delete'));
    fireEvent.press(screen.getByTestId('row-meal-m1-delete-no'));
    expect(screen.queryByText('Delete?')).toBeNull();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    fireEvent.press(screen.getByTestId('row-meal-m1-delete'));
    fireEvent.press(screen.getByTestId('row-meal-m1-delete-yes'));
    await waitFor(() => expect(screen.getByText('Nothing eaten yet today.')).toBeTruthy());
    expect(calls).toContainEqual({ path: '/api/entries/meals/m1', method: 'DELETE' });
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

  it('shows the Right now reading and its action chips', async () => {
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
    expect(screen.getByText('Log dinner')).toBeTruthy();
    expect(screen.getByText('Weigh in')).toBeTruthy();
  });
});
