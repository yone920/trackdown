import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import You from '@/app/you';

// The You screen (app/you.tsx): the plan the coach reads, and the account. It was the
// bottom half of the Goals tab until Goals and Progress merged (user decision 2026-08-31),
// and every row on it is read-only — NO FORMS, so the only way to change any of this is to
// say it again through the Log sheet.

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
  targets: { source: 'derived', eat_target: 2254, eatback: 'half' },
};

function serve(profile: Record<string, unknown> = PROFILE) {
  mockApi.mockImplementation((path: string) => {
    if (path === '/api/profile') return Promise.resolve(profile);
    return Promise.resolve(null);
  });
}

function renderYou() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <You />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
});

describe('You — the place they train', () => {
  it('names the gym and the tally when there is one', async () => {
    serve(
      { ...PROFILE, place: { id: 'p1', name: 'New Millennium', kind: 'gym', equipment_count: 14 } },
    );
    renderYou();
    await waitFor(() => expect(screen.getByText('New Millennium · 14 machines seen')).toBeTruthy());
  });

  it('says one machine, singular, and falls back to the stated date with no place', async () => {
    serve(
      { ...PROFILE, place: { id: 'p1', name: 'The garage', kind: 'home', equipment_count: 1 } },
    );
    renderYou();
    await waitFor(() => expect(screen.getByText('The garage · 1 machine seen')).toBeTruthy());

    mockApi.mockReset();
    serve();
    renderYou();
    await waitFor(() => expect(screen.getAllByText('How you train').length).toBeGreaterThan(0));
    expect(screen.queryByText(/machines seen/)).toBeNull();
  });
});

// "Daily target 2100 · From stated", on an account that had stated nothing (field report
// 2026-08-31). 2100 is the `daily_calorie_target` column's DEFAULT; the server now says
// where the number came from and this row says it in words.
describe('You — where the daily target came from', () => {
  const targets = (source: string, eat_target: number | null = 2100) => ({
    ...PROFILE,
    targets: { source, eat_target, eatback: 'half' },
  });

  it('says the stats worked it out', async () => {
    serve(targets('derived', 2254));
    renderYou();
    await waitFor(() => expect(screen.getByText('From your stats')).toBeTruthy());
    expect(screen.getByText('2254')).toBeTruthy();
  });

  it('says a default is a default, not something the user stated', async () => {
    serve(targets('default'));
    renderYou();
    await waitFor(() => expect(screen.getByText('Default until you tell me more')).toBeTruthy());
    expect(screen.queryByText('From stated')).toBeNull();
  });

  it('still credits a number the user did state', async () => {
    serve(targets('stated'));
    renderYou();
    await waitFor(() => expect(screen.getByText('From stated')).toBeTruthy());
  });

  it('asks for the missing facts when there is no target at all', async () => {
    serve(targets('none', null));
    renderYou();
    await waitFor(() => expect(screen.getByText('Tell me your height, age and weight')).toBeTruthy());
  });
});

describe('You — the plan and the account', () => {
  it('renders every section read-only, and every "Tell me" opens the Log sheet', async () => {
    serve();
    renderYou();
    await waitFor(() => expect(screen.getByText('bad left knee')).toBeTruthy());
    expect(screen.getByText('How you train')).toBeTruthy();
    expect(screen.getByText('How you eat')).toBeTruthy();
    expect(screen.getByText('Constraints')).toBeTruthy();
    expect(screen.getByText('lower carb')).toBeTruthy();
    // NO FORMS: nothing on this screen is typed into (concept-v2 §Principles 7).
    expect(screen.UNSAFE_queryAllByType(require('react-native').TextInput)).toHaveLength(0);

    expect(screen.getByTestId('health-sync').props.disabled).toBe(true);
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();

    fireEvent.press(screen.getByTestId('tell-training'));
    expect(mockPush).toHaveBeenCalledWith('/log');
  });
});
