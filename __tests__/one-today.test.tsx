import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Coach from '@/app/coach';
import TodayRoute from '@/app/today';
import DaysRoute from '@/app/days';
import Day from '@/app/day/[date]';
import Progress from '@/app/(tabs)/progress';
import { makeDayRow, makeWeek } from './fixtures';

// One living page for the open day (user decision 2026-09-01). The Today tab is it; the
// day page is the archival reading of a day that has closed. Two live pages for the same
// day was the confusion — the Days list and any deep link have to agree about that.

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
const mockReplace = jest.fn();
let mockRouteDate = '2026-08-29';
const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => {
    mockRedirect(props.href);
    return null;
  },
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ date: mockRouteDate }),
}));

/** The date the app calls today, as `localDateKey()` computes it from the device clock. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function wrap(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  mockReplace.mockReset();
  mockRedirect.mockReset();
  mockRouteDate = '2026-08-29';
});

describe('the Days list', () => {
  function serveDays(rows: unknown[]) {
    mockApi.mockImplementation((path: string) => {
      if (path.startsWith('/api/days')) return Promise.resolve({ days: rows, next_before: null });
      if (path === '/api/week') return Promise.resolve(makeWeek());
      if (path === '/api/goals') return Promise.resolve({ active: [], history: [], no_goal: true });
      return Promise.resolve(null);
    });
  }

  it("sends today's row to the Today tab, not to a second copy of today", async () => {
    const today = todayKey();
    serveDays([makeDayRow({ date: today, is_today: true })]);
    wrap(<Progress />);

    await waitFor(() => expect(screen.getByTestId(`day-${today}`)).toBeTruthy());
    fireEvent.press(screen.getByTestId(`day-${today}`));
    expect(mockPush).toHaveBeenCalledWith('/train');
    expect(mockPush).not.toHaveBeenCalledWith(`/day/${today}`);
  });

  it('still opens a closed day on its own page', async () => {
    serveDays([makeDayRow({ date: '2026-08-29', is_today: false })]);
    wrap(<Progress />);

    await waitFor(() => expect(screen.getByTestId('day-2026-08-29')).toBeTruthy());
    fireEvent.press(screen.getByTestId('day-2026-08-29'));
    expect(mockPush).toHaveBeenCalledWith('/day/2026-08-29');
  });
});

describe('a deep link to /day/<today>', () => {
  it('redirects to the Today tab and never asks for the day', async () => {
    mockRouteDate = todayKey();
    mockApi.mockResolvedValue(null);
    wrap(<Day />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/train'));
    // Nothing is drawn and nothing is fetched: the tab is about to answer for this day.
    expect(screen.queryByTestId('day-scroll')).toBeNull();
    expect(mockApi.mock.calls.filter(([path]) => String(path).startsWith('/api/day/'))).toHaveLength(0);
  });

  it('leaves a closed day exactly where it was', async () => {
    mockRouteDate = '2026-08-29';
    mockApi.mockResolvedValue(null);
    wrap(<Day />);

    await waitFor(() => expect(screen.getByTestId('day-scroll')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalledWith('/train');
  });
});

describe('Days, folded into Progress', () => {
  // User decision 2026-09-01: five tabs, not six — the list of closed days is a section of
  // Progress rather than a destination of its own. Every row, verdict and tap survived.
  it('redirects /days to Progress — no dead route', () => {
    render(<DaysRoute />);
    expect(mockRedirect).toHaveBeenCalledWith('/progress');
  });
});

describe('the old Today route', () => {
  // Today became TRAIN (user decision 2026-09-01): each tab owns one verb and this one owns
  // the session. Anything still pointing at /today lands where it meant to.
  it('redirects /today to Train — no dead route', () => {
    render(<TodayRoute />);
    expect(mockRedirect).toHaveBeenCalledWith('/train');
  });
});

describe('the old coach page', () => {
  it('redirects into Today, where the plan lives now — no dead route', () => {
    // The plan is the "Do" section of Today (user decision 2026-09-01). Anything that
    // still points at /coach — an older build, a link in a brief — lands where it meant to.
    render(<Coach />);
    expect(mockRedirect).toHaveBeenCalledWith('/train');
  });
});
