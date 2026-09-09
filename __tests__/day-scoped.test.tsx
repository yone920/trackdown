import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import TrainDay from '@/app/day/[date]/train';
import type { DayActivity, DayView } from '@/lib/types';
import { makeDay } from './fixtures';

// History is domain-scoped (user decision 2026-09-02, on the shipped calendar: "in train it
// should show me only the train … they have their own page — the historic data should also
// have their own page").
//
// This file holds `/day/<date>/train` to its scope: the session and nothing else, and it
// carries no verdict — a verdict is a judgement about a whole day, and half a day cannot be
// judged. The whole-day archive behind Progress is unchanged and is tested by day.test.tsx.

const mockApi = jest.fn();
jest.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  upload: jest.fn(),
  tzOffsetMin: () => 0,
  authHeaders: () => ({}),
  evidenceUrl: (id: string) => `http://test/api/evidence/${id}`,
  exerciseMediaUrl: (id: string, n: number) => `http://test/api/exercises/${id}/media/${n}`,
  SHEET_PHOTO_WIDTH: 640,
  THUMB_PHOTO_WIDTH: 320,
  API_URL: 'http://test',
  ApiError: class extends Error {},
  setUnauthorizedHandler: () => {},
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockRouteDate = '2026-08-29';
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ date: mockRouteDate }),
}));

const LIFT: DayActivity = {
  id: 'a1',
  logged_at: '2026-08-29T17:30:00.000Z',
  description: 'bench press 3x8 at 135',
  exercise: 'Bench Press',
  exercise_id: 'ex-bench',
  category: 'strength',
  muscle_groups: ['chest'],
  equipment: 'barbell',
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

/** A second movement, later in the session — one timestamp is a moment, two are a span. */
const ROW: DayActivity = {
  ...LIFT,
  id: 'a2',
  logged_at: '2026-08-29T18:05:00.000Z',
  description: 'seated row 3x10 at 120',
  exercise: 'Seated Row',
  exercise_id: 'ex-row',
  load_lb: 120,
  reps: 10,
  kcal: 180,
};

/** A closed day with two lifts on it — enough for the scope to show, or hide. */
function day(overrides: Partial<DayView> = {}): DayView {
  return makeDay({
    date: '2026-08-29',
    is_today: false,
    closed_at: '2026-08-30T05:00:00.000Z',
    verdict: 'served',
    verdict_words: 'Served your goal',
    reading: { text: 'A steady day: chest and triceps, and a weigh-in this morning.', at: '2026-08-30T05:00:00.000Z' },
    earned: 264,
    items: { activities: [LIFT, ROW], weights: [] },
    muscle_summary: [{ muscle: 'chest', sets: 6, exercises: ['Bench Press', 'Seated Row'] }],
    blocks: [{ id: 'b1', kind: 'strength', started_at: '2026-08-29T17:15:00.000Z', ended_at: '2026-08-29T18:05:00.000Z', kcal: 264, kcal_estimated: true }],
    ...overrides,
  } as Partial<DayView>);
}

function serve(view: DayView) {
  mockApi.mockImplementation((path: string) => {
    if (path.startsWith('/api/day/')) return Promise.resolve(view);
    return Promise.resolve(null);
  });
}

function show(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  mockReplace.mockReset();
  mockRouteDate = '2026-08-29';
});

describe('a past day, in Train', () => {
  it('shows the session and not one crumb of the whole day', async () => {
    serve(day());
    show(<TrainDay />);

    await waitFor(() => expect(screen.getByTestId('day-training')).toBeTruthy());
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('chest')).toBeTruthy();

    // No body, no verdict, no In short.
    expect(screen.queryByText('Body')).toBeNull();
    expect(screen.queryByText('Served your goal')).toBeNull();
    expect(screen.queryByText('In short')).toBeNull();
  });

  it('heads the page with the date, what was earned and how long it took', async () => {
    serve(day());
    show(<TrainDay />);

    await waitFor(() => expect(screen.getByTestId('train-day-line')).toBeTruthy());
    expect(screen.getByTestId('train-day-eyebrow').props.children).toBe('Training');
    expect(screen.getByTestId('train-day-title').props.children).toBe('Sat, Aug 29');
    const line = screen.getByTestId('train-day-line').props.children as string;
    expect(line).toContain('264 kcal earned');
    // The session's own span — the same `sessionSpan` the Train tab prints, which is null
    // for a single movement and a range once there are two.
    expect(line).toMatch(/\d{1,2}:\d{2}\w?–\d{1,2}:\d{2}\w?/);
  });

  it('keeps a row correctable and deletable, exactly as the whole-day page does', async () => {
    serve(day());
    show(<TrainDay />);
    await waitFor(() => expect(screen.getByTestId('day-training')).toBeTruthy());

    // The row body is the correction door; the NAME is the exercise sheet's, as everywhere.
    fireEvent.press(screen.getByTestId('row-activity-a1-open'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/log',
      params: { editDate: '2026-08-29', editId: 'a1', editKind: 'activity' },
    });
  });

  it('says the quiet true thing on a day with no session on it', async () => {
    serve(day({ items: { activities: [], weights: [] }, earned: 0, blocks: [] }));
    show(<TrainDay />);
    await waitFor(() => expect(screen.getByTestId('training-empty')).toBeTruthy());
  });
});

describe('browsing stays in its own domain', () => {
  it('steps a day without leaving the scope it was opened in', async () => {
    serve(day());
    show(<TrainDay />);
    await waitFor(() => expect(screen.getByTestId('train-day-prev')).toBeTruthy());

    fireEvent.press(screen.getByTestId('train-day-prev'));
    expect(mockReplace).toHaveBeenCalledWith('/day/2026-08-28/train');

    fireEvent.press(screen.getByTestId('train-day-next'));
    expect(mockReplace).toHaveBeenCalledWith('/day/2026-08-30/train');
  });

  // The scope is a scope, not a wall: the whole-day reading is one tap away.
  it('offers the whole day, which is where the verdict lives', async () => {
    serve(day());
    show(<TrainDay />);
    await waitFor(() => expect(screen.getByTestId('train-day-whole')).toBeTruthy());

    fireEvent.press(screen.getByTestId('train-day-whole'));
    expect(mockPush).toHaveBeenCalledWith('/day/2026-08-29');
  });

  // The open day has one live page per domain, and it is the tab.
  it('sends today to the tab that owns it rather than drawing it twice', async () => {
    const now = new Date();
    mockRouteDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    serve(day());
    show(<TrainDay />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/train'));
    expect(screen.queryByTestId('train-day-scroll')).toBeNull();
    expect(mockApi.mock.calls.filter(([path]) => String(path).startsWith('/api/day/'))).toHaveLength(0);
  });
});
