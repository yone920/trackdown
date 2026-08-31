import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

import Coach from '@/app/coach';
import Day from '@/app/day/[date]';
import DayLog from '@/app/day/[date]/log';
import ExerciseSheet from '@/app/exercise/[id]';
import LogSheet from '@/app/log';
import Days from '@/app/(tabs)/days';
import Progress from '@/app/(tabs)/progress';
import Today from '@/app/(tabs)/index';
import You from '@/app/you';
import { STATUS_BAR_MIN } from '@/lib/screen';
import { makeDay, makeWeek } from './fixtures';

// Every screen draws its own top inset, because the app has no navigation header to draw
// it for them (`headerShown: false` in app/_layout.tsx, and the tab bar is at the bottom).
// A screen that forgets it puts its eyebrow under the clock — which is exactly what the
// field report was: "1 ACTIVE" beside the status bar on Goals.
//
// So this file is the rule, asserted once per screen: the scroller the screen is built in
// starts below `insets.top`. It is a cheap test and it is the only thing standing between
// a new screen and the same bug.

const TOP = 59;
const INSETS = { top: TOP, bottom: 34, left: 0, right: 0 };

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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ date: '2026-08-29', id: 'ex-1' }),
}));

jest.mock('@/lib/auth', () => ({
  useSession: () => ({ session: { user: { id: 'u', email: 'ada@example.com', name: 'ada' } }, loading: false }),
  signOut: jest.fn(),
}));

jest.mock('@/lib/ports/speech', () => ({
  getSpeech: () => ({ available: false, requestPermission: jest.fn(), start: jest.fn(), stop: jest.fn() }),
}));

beforeEach(() => {
  mockApi.mockReset();
  mockApi.mockImplementation((path: string) => {
    if (path.startsWith('/api/day/') && path.endsWith('/log')) return Promise.resolve({ entries: [] });
    if (path.startsWith('/api/day/')) return Promise.resolve(makeDay());
    if (path === '/api/week') return Promise.resolve(makeWeek());
    if (path === '/api/goals') return Promise.resolve({ active: [], history: [], no_goal: true });
    if (path === '/api/profile') return Promise.resolve({ id: 'u', stated_at: {}, targets: {} });
    if (path.startsWith('/api/days')) return Promise.resolve({ days: [], next_before: null });
    if (path.startsWith('/api/coach')) return Promise.resolve({ brief: null, nudge: null, goals: [] });
    if (path === '/api/training/board')
      return Promise.resolve({
        date: '2026-08-29',
        lifts: [],
        frequency: { weeks: [], sessions_this_week: 0, average_per_week: 0, training_days_target: null, muscles: [] },
        cardio: { weeks: [], minutes_this_week: 0, weekly_target_min: 150, short_by_min: 150, last: null, best: null },
        body: { latest: null, latest_date: null, avg_7d: null, trend_per_week: null, series: [] },
      });
    return Promise.resolve(null);
  });
});

/** Every screen, and the testID of the scroller it is built in. */
const SCREENS: [name: string, Screen: () => React.ReactElement, testID: string][] = [
  ['Today', Today, 'today-scroll'],
  ['Days', Days, 'days-list'],
  ['Progress', Progress, 'progress-scroll'],
  ['You', You, 'you-scroll'],
  ['Coach', Coach, 'coach-scroll'],
  ['Log', LogSheet, 'log-scroll'],
  ['Day', Day, 'day-scroll'],
  ['DayLog', DayLog, 'day-log-scroll'],
  ['Exercise', ExerciseSheet, 'exercise-scroll'],
];

async function paddingTopOf(Screen: () => React.ReactElement, testID: string, insets: EdgeInsets) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <SafeAreaInsetsContext.Provider value={insets}>
      <QueryClientProvider client={client}>
        <Screen />
      </QueryClientProvider>
    </SafeAreaInsetsContext.Provider>,
  );
  const style = (await screen.findByTestId(testID)).props.contentContainerStyle;
  return (Array.isArray(style) ? Object.assign({}, ...style) : style).paddingTop as number;
}

describe.each(SCREENS)('%s', (_name, Screen, testID) => {
  it('starts its content below the status bar', async () => {
    expect(await paddingTopOf(Screen, testID, INSETS)).toBeGreaterThanOrEqual(TOP);
  });

  // The provider reports zero before it has measured, and on any host that has no insets
  // to give. lib/screen.ts floors the top so a header still cannot land under the clock.
  it('clears the status bar even when the platform reports no inset', async () => {
    const padding = await paddingTopOf(Screen, testID, { ...INSETS, top: 0 });
    expect(padding).toBeGreaterThanOrEqual(STATUS_BAR_MIN);
  });
});
