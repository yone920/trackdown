import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import You from '@/app/you';

// The You screen (app/you.tsx): the dossier, the constraints and the account.
//
// The "How you train" / "How you eat" row groups are gone (user decision 2026-08-31) —
// they were a form with the inputs taken out, and the interesting half of a plan is the
// half nobody has said yet. Two generated paragraphs say both halves; everything the rows
// printed is an input to them. NO FORMS still holds and is still asserted here.

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

const DOSSIER = {
  known:
    'You train four days a week at New Millennium and it shows: three or four sessions most '
    + 'weeks for the last month, with the bench moving 130 to 135.',
  missing:
    'I do not have a weekly cardio aim from you. Tell me one and the treadmill work starts '
    + 'counting toward something instead of sitting on its own.',
  model: 'claude-test',
  created_at: '2026-08-31T09:00:00.000Z',
};

function serve(
  profile: Record<string, unknown> = PROFILE,
  you: Record<string, unknown> | null = { date: '2026-08-31', dossier: DOSSIER },
) {
  mockApi.mockImplementation((path: string) => {
    if (path === '/api/profile') return Promise.resolve(profile);
    if (path === '/api/you') return Promise.resolve(you ?? { date: '2026-08-31', dossier: null });
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

describe('You — the dossier', () => {
  it('draws two paragraphs and no rows of label-and-value', async () => {
    serve();
    renderYou();
    await waitFor(() => expect(screen.getByTestId('dossier-known')).toBeTruthy());
    expect(screen.getByTestId('dossier-known').props.children).toContain('four days a week');
    expect(screen.getByTestId('dossier-missing').props.children).toContain('Tell me one');
    expect(screen.getByText('What I know about you')).toBeTruthy();

    // The grid this replaced.
    expect(screen.queryByText('How you train')).toBeNull();
    expect(screen.queryByText('How you eat')).toBeNull();
    expect(screen.queryByText('Days a week')).toBeNull();
    expect(screen.queryByText('Daily target')).toBeNull();
  });

  it('never scolds: the missing half is an invitation with the benefit attached', async () => {
    serve();
    renderYou();
    await waitFor(() => expect(screen.getByTestId('dossier-missing')).toBeTruthy());
    const missing = screen.getByTestId('dossier-missing').props.children as string;
    expect(missing).toMatch(/Tell me/);
    for (const scolding of ['you have not', 'you should', 'you failed', 'missing:'])
      expect(missing.toLowerCase()).not.toContain(scolding);
  });

  it('is a skeleton while it loads and one quiet line when there is none', async () => {
    let resolve: (value: unknown) => void = () => {};
    mockApi.mockImplementation((path: string) => {
      if (path === '/api/profile') return Promise.resolve(PROFILE);
      if (path === '/api/you') return new Promise((done) => { resolve = done; });
      return Promise.resolve(null);
    });
    renderYou();
    await waitFor(() => expect(screen.getByTestId('dossier-skeleton')).toBeTruthy());
    resolve({ date: '2026-08-31', dossier: null });
    await waitFor(() => expect(screen.getByTestId('dossier-empty')).toBeTruthy());
    expect(screen.queryByTestId('dossier-known')).toBeNull();
  });

  // The profile is invalidated after every log; a generated paragraph on it would be a
  // model call per meal (lib/queries.ts §useYou).
  it('reads its own endpoint rather than riding on the profile', async () => {
    const paths: string[] = [];
    mockApi.mockImplementation((path: string) => {
      paths.push(path);
      if (path === '/api/profile') return Promise.resolve(PROFILE);
      if (path === '/api/you') return Promise.resolve({ date: '2026-08-31', dossier: DOSSIER });
      return Promise.resolve(null);
    });
    renderYou();
    await waitFor(() => expect(screen.getByTestId('dossier-known')).toBeTruthy());
    expect(paths).toContain('/api/you');
  });
});

describe('You — the plan and the account', () => {
  it('opens the workings from a quiet row of its own', async () => {
    renderYou();
    await waitFor(() => expect(screen.getByTestId('how-it-works-row')).toBeTruthy());
    fireEvent.press(screen.getByTestId('how-it-works-row'));
    expect(mockPush).toHaveBeenCalledWith('/how-it-works');
  });

  it('renders every section read-only, with one "Tell me" for all of it', async () => {
    serve();
    renderYou();
    await waitFor(() => expect(screen.getByText('bad left knee')).toBeTruthy());
    expect(screen.getByText('Constraints')).toBeTruthy();
    expect(screen.getByText('Health sync')).toBeTruthy();
    expect(screen.getByText('Account')).toBeTruthy();
    // NO FORMS: nothing on this screen is typed into (concept-v2 §Principles 7).
    expect(screen.UNSAFE_queryAllByType(require('react-native').TextInput)).toHaveLength(0);

    expect(screen.getByTestId('health-sync').props.disabled).toBe(true);
    expect(screen.getByText('ada@example.com')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();

    // One button, not one per card: every fact here is changed the same way.
    expect(screen.getAllByText('Tell me')).toHaveLength(1);
    fireEvent.press(screen.getByTestId('tell-me'));
    // The one logger, framed by this door (field report 2026-09-01): same sheet, same
    // routing — it just stops asking what workout you did when you pressed "Tell me".
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { framing: 'about-you' } });
  });
});
