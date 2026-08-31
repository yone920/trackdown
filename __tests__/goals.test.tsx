import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Goals from '@/app/(tabs)/goals';
import { makeGoal, makeMetric } from './fixtures';

// The Goals tab's three states: none, one running, and one the measure thinks is done.
// A goal is never closed by the app (concept-v2 §Goals) — the prompt is a question and
// the PATCH only happens on a tap.

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

jest.mock('@/lib/auth', () => ({
  useSession: () => ({ session: { user: { id: 'u', email: 'ada@example.com', name: 'ada' } }, loading: false }),
  signOut: jest.fn(),
}));

const PROFILE = {
  id: 'u',
  display_name: null,
  units: 'imperial',
  training_days: 4,
  diet_style: 'lower carb',
  environment: 'gym',
  equipment: ['dumbbells'],
  constraints: ['bad left knee'],
  preferences: [],
  stated_at: { training_days: '2026-08-01T00:00:00.000Z' },
  targets: { source: 'computed', eat_target: 2254, eatback: 'half' },
};

function serve(goals: unknown, profile: Record<string, unknown> = PROFILE) {
  mockApi.mockImplementation((path: string) => {
    if (path === '/api/goals') return Promise.resolve(goals);
    if (path === '/api/profile') return Promise.resolve(profile);
    return Promise.resolve(null);
  });
}

function renderGoals() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Goals />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
});

describe('Goals — empty', () => {
  it('invites the user to say what they are after, and opens the Log sheet in goal mode', async () => {
    serve({ active: [], history: [], no_goal: true });
    renderGoals();
    await waitFor(() => expect(screen.getByTestId('goals-empty')).toBeTruthy());
    expect(screen.getByText('No goal yet')).toBeTruthy();
    // The eyebrow says it too, which is the point: no goal is a state, not an error.
    expect(screen.getAllByText(/Training for consistency/).length).toBeGreaterThan(1);

    fireEvent.press(screen.getByTestId('tell-me'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { hint: 'goal' } });
  });
});

describe('Goals — active', () => {
  it('draws the ring, the pace line and the plan rows', async () => {
    serve({
      active: [makeGoal('lose_fat', [makeMetric({ current: 181.4, target: 170, unit: 'lb' })])],
      history: [],
      no_goal: false,
    });
    renderGoals();
    await waitFor(() => expect(screen.getByText('Get to 170 lb')).toBeTruthy());
    expect(screen.getByText('Goal · primary')).toBeTruthy();
    expect(screen.getByText('43%')).toBeTruthy();
    expect(screen.getByText(/181\.4 → 170 lb · by /)).toBeTruthy();

    // The plan and the account rows live under the goals.
    expect(screen.getByText('How you train')).toBeTruthy();
    expect(screen.getByText('How you eat')).toBeTruthy();
    expect(screen.getByText('Constraints')).toBeTruthy();
    expect(screen.getByText('bad left knee')).toBeTruthy();
    expect(screen.getByTestId('health-sync')).toBeTruthy();
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('lists what has ended, with the outcome', async () => {
    const past = { ...makeGoal('build_strength'), id: 'old', title: 'Bench 185', status: 'reached', active_to: '2026-06-30', outcome: 'reached' };
    serve({ active: [], history: [past], no_goal: true });
    renderGoals();
    await waitFor(() => expect(screen.getByText('Bench 185')).toBeTruthy());
    expect(screen.getByText(/^Reached · /)).toBeTruthy();
  });
});

describe('Goals — the measure says it is done', () => {
  function reachedGoal() {
    return { ...makeGoal('lose_fat'), reached_candidate_at: '2026-08-29T00:05:00.000Z' };
  }

  it('asks rather than closing it, and PATCHes only when the user says so', async () => {
    serve({ active: [reachedGoal()], history: [], no_goal: false });
    renderGoals();
    await waitFor(() => expect(screen.getByTestId('goal-reached-goal-1')).toBeTruthy());
    expect(screen.getByText('Looks like you reached it — mark done?')).toBeTruthy();
    // Nothing has been written just by looking at it.
    expect(mockApi).not.toHaveBeenCalledWith('/api/goals/goal-1', expect.anything());

    fireEvent.press(screen.getByText('Mark reached'));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        '/api/goals/goal-1',
        expect.objectContaining({ method: 'PATCH', body: expect.objectContaining({ status: 'reached' }) }),
      ),
    );
  });

  it('lets "Not yet" put the prompt away without touching the goal', async () => {
    serve({ active: [reachedGoal()], history: [], no_goal: false });
    renderGoals();
    await waitFor(() => expect(screen.getByTestId('goal-reached-goal-1')).toBeTruthy());
    fireEvent.press(screen.getByText('Not yet'));
    await waitFor(() => expect(screen.queryByTestId('goal-reached-goal-1')).toBeNull());
    expect(mockApi).not.toHaveBeenCalledWith('/api/goals/goal-1', expect.anything());
  });

  it('offers to adjust a stalled goal instead', async () => {
    serve({
      active: [{ ...makeGoal('lose_fat'), stalled_since: '2026-08-08' }],
      history: [],
      no_goal: false,
    });
    renderGoals();
    await waitFor(() => expect(screen.getByTestId('goal-stalled-goal-1')).toBeTruthy());
    expect(screen.getByText(/Stalled — adjust\?/)).toBeTruthy();
    fireEvent.press(screen.getByText('Adjust it'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { hint: 'goal' } });
  });
});

// Where they train, and what has been seen there — accrued from their own logs rather than
// filled in on a form (migration 0012).
describe('Goals — the place they train', () => {
  it('names the gym and the tally when there is one', async () => {
    serve(
      { active: [], history: [], no_goal: true },
      { ...PROFILE, place: { id: 'p1', name: 'New Millennium', kind: 'gym', equipment_count: 14 } },
    );
    renderGoals();
    await waitFor(() => expect(screen.getByText('New Millennium · 14 machines seen')).toBeTruthy());
  });

  it('says one machine, singular, and falls back to the stated date with no place', async () => {
    serve(
      { active: [], history: [], no_goal: true },
      { ...PROFILE, place: { id: 'p1', name: 'The garage', kind: 'home', equipment_count: 1 } },
    );
    renderGoals();
    await waitFor(() => expect(screen.getByText('The garage · 1 machine seen')).toBeTruthy());

    mockApi.mockReset();
    serve({ active: [], history: [], no_goal: true });
    renderGoals();
    await waitFor(() => expect(screen.getAllByText('How you train').length).toBeGreaterThan(0));
    expect(screen.queryByText(/machines seen/)).toBeNull();
  });
});
