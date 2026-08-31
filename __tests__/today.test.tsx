import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Today from '@/app/(tabs)/index';
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
