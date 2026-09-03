import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Home, { cardioEquivalent, planLabel, planProgress, sessionsUnit } from '@/app/(tabs)/index';
import { makeDay } from './fixtures';
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

function serve({
  coach = noPlan(),
  goals = { active: [], history: [], no_goal: true },
  training = board(),
  day = makeDay(),
}: { coach?: unknown; goals?: unknown; training?: unknown; day?: unknown } = {}) {
  mockApi.mockImplementation((path: string) => {
    if (path === '/api/coach/status') return Promise.resolve(coach);
    if (path === '/api/goals') return Promise.resolve(goals);
    if (path === '/api/training/board') return Promise.resolve(training);
    if (path.startsWith('/api/day/')) return Promise.resolve(day);
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

  // User decision 2026-09-03: the invitation opens the ONE logger sheet in plan-new
  // framing, so a session can be shaped before it is written. It still generates nothing
  // by itself — the generation is on the far side of the sheet's own Generate button.
  it('invites you to shape today when there is no plan, and generates nothing', async () => {
    serve();
    renderHome();

    await waitFor(() => expect(screen.getByText("Generate today's workout")).toBeTruthy());
    expect(screen.queryByTestId('home-today-sub')).toBeNull();

    fireEvent.press(screen.getByTestId('home-today'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { framing: 'plan-new' } });
    expect(mockApi.mock.calls.map(([path]) => path)).not.toContain('/api/coach/next/regenerate');
  });

  it('counts the plan off once there is one', async () => {
    serve({ coach: noPlan({ has_plan: true, headline: 'Pull day', done_count: 2, total_count: 6 }) });
    renderHome();

    await waitFor(() => expect(screen.getByTestId('home-today-sub')).toHaveTextContent('2 of 6 done'));
    expect(screen.getByText('Today’s session')).toBeTruthy();
  });

  it('says the plan is complete rather than asking the question again', async () => {
    serve({
      coach: noPlan({ has_plan: true, headline: 'Pull day', done_count: 4, total_count: 4, complete: true }),
    });
    renderHome();

    await waitFor(() => expect(screen.getByTestId('home-today-sub')).toHaveTextContent('Plan complete ✓'));
    expect(screen.queryByText("Generate today's workout")).toBeNull();
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
    await waitFor(() => expect(screen.getByText("Generate today's workout")).toBeTruthy());
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

  it('opens the weigh-ins from the weight card', async () => {
    // Field report 2026-09-02: a mistyped reading fed every average and could be corrected
    // nowhere. An average you cannot get underneath is an average you cannot fix.
    serve();
    renderHome();

    await waitFor(() => expect(screen.getByTestId('home-weight')).toBeTruthy());
    expect(screen.getByTestId('home-weight-door')).toHaveTextContent(/every weigh-in/);
    fireEvent.press(screen.getByTestId('home-weight'));
    expect(mockPush).toHaveBeenCalledWith('/progress');
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
    expect(planLabel(null)).toBe("Generate today's workout");
    expect(planLabel(noPlan())).toBe("Generate today's workout");
    expect(planLabel(noPlan({ has_plan: true }))).toBe('Today’s session');
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

// ── the only page that thinks in whole days ──────────────────────────────────────────
// User decision 2026-09-01: every other tab owns one verb, so the day number, the verdict,
// the Right-now reading that reads food and training together, and the calories glance all
// live here — and nowhere else.

describe('Home — the whole day', () => {
  const ACTIVITY = {
    id: 'a1',
    logged_at: '2026-09-01T12:10:00.000Z',
    description: '3 × 8 bench',
    exercise: 'Bench Press',
    exercise_id: 'ex-bench',
    media_count: 0,
    equipment: null,
    category: 'strength' as const,
    muscle_groups: ['chest'],
    sets: 3,
    reps: 8,
    load_lb: 135,
    duration_min: null,
    distance_mi: null,
    kcal: 264,
    source: 'manual' as const,
    confidence: 'high' as const,
    block_id: null,
    delta_vs_last: null,
    evidence: [],
  };

  const READING = {
    kind: 'right_now' as const,
    text: 'A solid push day; 700 under your allowance with dinner still to come.',
    next_action: null,
    actions: [],
    inputs_hash: 'x',
    model: 'test',
    created_at: '2026-09-01T12:00:00.000Z',
  };

  it('says the day and its verdict once something has happened', async () => {
    serve({
      day: makeDay({
        day_number: 12,
        status: 'on_track',
        items: { meals: [], weights: [], activities: [ACTIVITY] },
      }),
    });
    renderHome();

    await waitFor(() => expect(screen.getByTestId('home-verdict')).toHaveTextContent('on track'));
    expect(screen.getByText(/Day/)).toBeTruthy();
    expect(screen.getByText(/12/)).toBeTruthy();
  });

  it('carries NO verdict on a day that has not happened', async () => {
    // 0 eaten is trivially "under allowance", and a green "on track" at 6 am judges a day
    // nobody has lived yet. The rule came with the header when it moved here.
    serve({ day: makeDay({ day_number: 12, items: { meals: [], weights: [], activities: [] } }) });
    renderHome();

    await waitFor(() => expect(screen.getByText(/Day/)).toBeTruthy());
    expect(screen.queryByTestId('home-verdict')).toBeNull();
    expect(screen.queryByText('on track')).toBeNull();
  });

  it('draws the Right-now reading, which reads food and training together', async () => {
    serve({ day: makeDay({ reading: READING as never }) });
    renderHome();

    await waitFor(() => expect(screen.getByText('Right now')).toBeTruthy());
    expect(screen.getByText(/700 under your allowance/)).toBeTruthy();
  });

  it('glances at the food in one line, and opens the tab that owns it', async () => {
    serve({ day: makeDay({ eaten: 1180, allowance: 2385 }) });
    renderHome();

    await waitFor(() => expect(screen.getByTestId('home-eat-line')).toHaveTextContent('1,180 eaten · 1,205 left'));
    fireEvent.press(screen.getByTestId('home-eat'));
    expect(mockPush).toHaveBeenCalledWith('/eat');
  });

  it('says "over" rather than a negative amount left', async () => {
    serve({ day: makeDay({ eaten: 2574, allowance: 2254 }) });
    renderHome();
    await waitFor(() => expect(screen.getByTestId('home-eat-line')).toHaveTextContent(/320 over/));
    expect(screen.getByTestId('home-eat-line')).not.toHaveTextContent('-');
  });

  it('has both doors on it — the session and the food — and generates neither', async () => {
    serve({ coach: noPlan({ has_plan: true, done_count: 2, total_count: 6 }), day: makeDay() });
    renderHome();

    // Wait for the STATUS, not just the button: with a plan the button is a door to Today,
    // and before the status lands it is the invitation instead.
    await waitFor(() => expect(screen.getByTestId('home-today-sub')).toBeTruthy());
    fireEvent.press(screen.getByTestId('home-today'));
    expect(mockPush).toHaveBeenCalledWith('/train');

    const asked = mockApi.mock.calls.map(([path]) => path);
    expect(asked).not.toContain('/api/coach/next');
    expect(asked).not.toContain('/api/coach/next/regenerate');
    expect(mockApi.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });
});
