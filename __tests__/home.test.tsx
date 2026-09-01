import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Home, { cardioEquivalent, planLabel, planProgress, sessionsUnit } from '@/app/(tabs)/index';
import type { CoachStatus, TrainingBoard } from '@/lib/types';
import { makeGoal, makeMetric } from './fixtures';

// Home — where you are, in general (user decision 2026-09-01). The page the app lands on,
// and the one rule that governs everything on it: **it cannot generate a plan**. The big
// button is a door to Today, which is where the one generator in the app lives.

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

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

function noPlan(overrides: Partial<CoachStatus> = {}): CoachStatus {
  return {
    date: '2026-09-01',
    has_plan: false,
    headline: null,
    done_count: 0,
    total_count: 0,
    complete: false,
    ...overrides,
  };
}

function board(overrides: Partial<TrainingBoard> = {}): unknown {
  return {
    frequency: {
      weeks: [],
      sessions_this_week: 3,
      average_per_week: 2.5,
      training_days_target: 4,
      muscles: [],
      coverage: [],
    },
    cardio: {
      weeks: [],
      minutes_this_week: 60,
      equiv_minutes_this_week: 85,
      weekly_target_min: 150,
      short_by_min: 65,
      last: null,
      best: null,
    },
    body: { latest: 191.2, latest_date: '2026-09-01', avg_7d: 191.8, trend_per_week: -0.6, series: [] },
    lifts: [],
    ...overrides,
  };
}

function serve({ coach = noPlan(), goals = { active: [], history: [], no_goal: true }, training = board() } = {}) {
  mockApi.mockImplementation((path: string) => {
    if (path === '/api/coach/status') return Promise.resolve(coach);
    if (path === '/api/goals') return Promise.resolve(goals);
    if (path === '/api/training/board') return Promise.resolve(training);
    return Promise.resolve(null);
  });
}

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Home />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
});

describe('Home', () => {
  it('never generates a plan, whatever it draws', async () => {
    // The contract carried over from the coach page, and it matters more here than it did
    // there: this is the page the app opens on, dozens of times a day, often by accident.
    serve({ coach: noPlan({ has_plan: true, headline: 'Pull day', done_count: 2, total_count: 6 }) });
    renderHome();

    await waitFor(() => expect(screen.getByTestId('home-today')).toBeTruthy());
    const asked = mockApi.mock.calls.map(([path]) => path);
    expect(asked).toContain('/api/coach/status');
    // The two endpoints that can write a brief are not among them.
    expect(asked).not.toContain('/api/coach/next');
    expect(asked).not.toContain('/api/coach/next/regenerate');
  });

  it('invites you to start when there is no plan, and only opens Today', async () => {
    serve();
    renderHome();

    await waitFor(() => expect(screen.getByText("Start today's workout")).toBeTruthy());
    expect(screen.queryByTestId('home-today-sub')).toBeNull();

    fireEvent.press(screen.getByTestId('home-today'));
    expect(mockPush).toHaveBeenCalledWith('/today');
    expect(mockApi.mock.calls.map(([path]) => path)).not.toContain('/api/coach/next/regenerate');
  });

  it('counts the plan off once there is one', async () => {
    serve({ coach: noPlan({ has_plan: true, headline: 'Pull day', done_count: 2, total_count: 6 }) });
    renderHome();

    await waitFor(() => expect(screen.getByText('Today')).toBeTruthy());
    expect(screen.getByTestId('home-today-sub')).toHaveTextContent('2 of 6 done');
  });

  it('says the plan is complete rather than asking the question again', async () => {
    serve({
      coach: noPlan({ has_plan: true, headline: 'Pull day', done_count: 4, total_count: 4, complete: true }),
    });
    renderHome();

    await waitFor(() => expect(screen.getByTestId('home-today-sub')).toHaveTextContent('Plan complete ✓'));
    expect(screen.queryByText("Start today's workout")).toBeNull();
  });

  it('falls back to the invitation when the status cannot be read', async () => {
    mockApi.mockImplementation((path: string) => {
      if (path === '/api/coach/status') return Promise.reject(new Error('offline'));
      if (path === '/api/goals') return Promise.resolve({ active: [], history: [], no_goal: true });
      if (path === '/api/training/board') return Promise.resolve(board());
      return Promise.resolve(null);
    });
    renderHome();

    // The half of the pair that promises nothing that might not be there.
    await waitFor(() => expect(screen.getByText("Start today's workout")).toBeTruthy());
  });

  it('shows the week and the trend, not today’s numbers', async () => {
    serve({ goals: { active: [makeGoal('lose_fat', [makeMetric()])], history: [], no_goal: false } as never });
    renderHome();

    await waitFor(() => expect(screen.getByText('of 4 planned')).toBeTruthy());
    expect(screen.getByText('This week')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    // Cardio is counted in EQUIVALENT minutes, which is what the target is measured in.
    expect(screen.getByText('85')).toBeTruthy();
    expect(screen.getByText('of 150 equiv min')).toBeTruthy();
    // The body, over a week — never today's reading on its own.
    expect(screen.getByText('191.8')).toBeTruthy();
    expect(screen.getByText('−0.6')).toBeTruthy();
  });

  it('says so plainly when nobody has weighed in', async () => {
    serve({ training: board({ body: { latest: null, latest_date: null, avg_7d: null, trend_per_week: null, series: [] } }) as never });
    renderHome();
    await waitFor(() => expect(screen.getByTestId('home-weight-empty')).toBeTruthy());
  });

  it('has no way to log anything on it — the + is the one door', async () => {
    serve();
    renderHome();
    await waitFor(() => expect(screen.getByTestId('home-today')).toBeTruthy());
    expect(screen.queryByTestId('log-fab')).toBeNull();
    expect(mockPush).not.toHaveBeenCalledWith('/log');
  });
});

describe('what the button says', () => {
  it('invites, then reports', () => {
    expect(planLabel(null)).toBe("Start today's workout");
    expect(planLabel(noPlan())).toBe("Start today's workout");
    expect(planLabel(noPlan({ has_plan: true }))).toBe('Today');
  });

  it('counts only when there is something to count', () => {
    expect(planProgress(null)).toBeNull();
    // A rest day has a plan and nothing to tick.
    expect(planProgress(noPlan({ has_plan: true, total_count: 0 }))).toBeNull();
    expect(planProgress(noPlan({ has_plan: true, total_count: 5 }))).toBe('5 moves');
    expect(planProgress(noPlan({ has_plan: true, done_count: 2, total_count: 5 }))).toBe('2 of 5 done');
    expect(planProgress(noPlan({ has_plan: true, done_count: 5, total_count: 5, complete: true }))).toBe(
      'Plan complete ✓',
    );
  });
});

describe('the week, in the units the targets use', () => {
  it('counts cardio in equivalent minutes, and falls back to raw ones', () => {
    const withEquiv = board() as TrainingBoard;
    expect(cardioEquivalent(withEquiv)).toBe(85);
    // An older server does not send them; raw minutes are the honest fallback.
    const older = board() as TrainingBoard;
    delete (older.cardio as { equiv_minutes_this_week?: number }).equiv_minutes_this_week;
    expect(cardioEquivalent(older)).toBe(60);
  });

  it('names a training target only when one was stated', () => {
    expect(sessionsUnit(board() as TrainingBoard)).toBe('of 4 planned');
    const none = board() as TrainingBoard;
    none.frequency.training_days_target = null;
    expect(sessionsUnit(none)).toBe('sessions');
  });
});
