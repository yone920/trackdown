import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import React from 'react';

import Lifts from '@/app/lifts';
import type { BoardLift, TrainingBoard } from '@/lib/types';

// All lifts (app/lifts.tsx) — the half of the board Progress does not draw. Grouped by the
// muscle each movement is mostly about, two lines a row, and no advice: the next step is
// the sentence Progress prints for the six that are in play, and twenty of them is a to-do
// list nobody wrote (concept-v2 §Principles 8).

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
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
}));

const lift = (over: Partial<BoardLift> & { exercise: string }): BoardLift => ({
  exercise_id: `ex-${over.exercise}`,
  category: 'strength',
  muscle_groups: ['chest'],
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
  series: [],
  next: { rule: 'hold', load_lb: 135, sets: 3, reps: 8, text: 'Hold 135 lb until 3 × 8 twice', eta: '~1 wk', why: '' },
  ...over,
});

const LIFTS: BoardLift[] = [
  lift({ exercise: 'Bench Press', muscle_groups: ['chest', 'triceps'], days_since: 1 }),
  lift({ exercise: 'Incline Press', muscle_groups: ['chest'], days_since: 5 }),
  lift({ exercise: 'Lat Pulldown', muscle_groups: ['lats'], days_since: 3 }),
  lift({
    exercise: 'Assisted Chin-Up',
    muscle_groups: ['lats'],
    days_since: 4,
    load_direction: 'assistance',
    load_text: '55 lb of assistance',
    delta_text: '5 lb less help',
    sentiment: 'good',
  }),
  lift({ exercise: 'Calf Raise', muscle_groups: ['calves'], days_since: 18, sentiment: 'watch', delta_text: '−10 lb in four weeks' }),
];

function board(lifts: BoardLift[]): TrainingBoard {
  return {
    date: '2026-08-31',
    lifts,
    frequency: {
      weeks: [],
      sessions_this_week: 0,
      average_per_week: 0,
      training_days_target: null,
      muscles: [],
      coverage: [],
    },
    cardio: {
      weeks: [],
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
  };
}

function serve(lifts: BoardLift[] = LIFTS) {
  mockApi.mockImplementation((path: string) =>
    path === '/api/training/board' ? Promise.resolve(board(lifts)) : Promise.resolve(null),
  );
}

function renderLifts() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Lifts />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
});

describe('All lifts', () => {
  it('groups by the muscle each one is mostly about, freshest group first', async () => {
    serve();
    renderLifts();
    await waitFor(() => expect(screen.getByTestId('lift-group-chest')).toBeTruthy());

    expect(screen.getByText('5 in four weeks')).toBeTruthy();
    expect(within(screen.getByTestId('lift-group-chest')).getByText('Bench Press')).toBeTruthy();
    expect(within(screen.getByTestId('lift-group-chest')).getByText('Incline Press')).toBeTruthy();
    expect(within(screen.getByTestId('lift-group-lats')).getByText('Lat Pulldown')).toBeTruthy();
    expect(screen.getByText('Chest')).toBeTruthy();
    expect(screen.getByText('Lats')).toBeTruthy();
  });

  it('folds anything untouched for a fortnight into its own group at the end', async () => {
    serve();
    renderLifts();
    await waitFor(() => expect(screen.getByTestId('lift-group-stale')).toBeTruthy());
    expect(screen.getByText('Not trained lately')).toBeTruthy();
    expect(within(screen.getByTestId('lift-group-stale')).getByText('Calf Raise')).toBeTruthy();
    // And it is not also filed under calves.
    expect(screen.queryByTestId('lift-group-calves')).toBeNull();
  });

  it('is two lines and a dot — the load, when, and which way it went', async () => {
    serve();
    renderLifts();
    await waitFor(() => expect(screen.getByTestId('all-lift-Bench Press')).toBeTruthy());

    const row = within(screen.getByTestId('all-lift-Bench Press'));
    expect(row.getByText('135 lb · 1d ago')).toBeTruthy();
    // No advice line anywhere on this screen: that is Progress's job for the live six.
    expect(screen.queryByText('Hold 135 lb until 3 × 8 twice')).toBeNull();
    expect(screen.queryByText(/~1 wk/)).toBeNull();

    // Green for progress, and on an assisted machine that is the *server's* sentiment
    // rather than which way the number went.
    expect(screen.getByTestId('all-lift-dot-Assisted Chin-Up').props.style).toMatchObject({
      backgroundColor: '#3DD68C',
    });
    expect(screen.getByTestId('all-lift-dot-Assisted Chin-Up').props.accessibilityLabel).toBe(
      '5 lb less help',
    );
    expect(screen.getByTestId('all-lift-dot-Calf Raise').props.style).toMatchObject({
      backgroundColor: '#FF7A1A',
    });
    expect(within(screen.getByTestId('all-lift-Assisted Chin-Up')).getByText(/55 lb of assistance/)).toBeTruthy();
  });

  it('opens the exercise sheet from a name', async () => {
    serve();
    renderLifts();
    await waitFor(() => expect(screen.getByText('Lat Pulldown')).toBeTruthy());
    fireEvent.press(screen.getByText('Lat Pulldown'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/exercise/[id]',
      params: { id: 'ex-Lat Pulldown', name: 'Lat Pulldown' },
    });
  });

  it('says one quiet line on an account with nothing in four weeks', async () => {
    serve([]);
    renderLifts();
    await waitFor(() => expect(screen.getByTestId('lifts-all-empty')).toBeTruthy());
    expect(screen.getByText('Nothing lifted in the last four weeks.')).toBeTruthy();
    expect(screen.getByText('Nothing in four weeks')).toBeTruthy();
  });
});
