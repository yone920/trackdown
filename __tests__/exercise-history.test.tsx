import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import ExerciseHistoryScreen from '@/app/history/[exercise]';
import Lifts from '@/app/lifts';
import { historyPoints, sessionLine, sparseNote, stateLine } from '@/lib/exercise-history';
import type { ExerciseHistory, TrainingBoard } from '@/lib/types';
import { BENCH, CHIN, makeBoard, makeHistory } from './fixtures';

// One exercise, all of it (user field report 2026-09-02, on All lifts: "60 lb · today …
// doesn't have enough detail … the historic loads, the progress of the load … which
// direction I'm going").
//
// Two contracts are worth pinning here. The first is the SCREEN: the coach's own state line
// at the top, dots for the sessions, a line only once there are three of them, and a row per
// session that opens the record it came from. The second is the TAP: the row is the new
// door, and the NAME is still the old one — a name anywhere in this app opens the how-to
// sheet, and a new screen does not get to bend that.

const mockApi = jest.fn();
jest.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
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
let mockParams: Record<string, string> = { exercise: 'Lat Pulldown' };
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => mockParams,
}));

function serve(history: ExerciseHistory | null, board: TrainingBoard = makeBoard()) {
  const calls: { path: string; query?: Record<string, unknown> }[] = [];
  mockApi.mockImplementation((path: string, options?: { query?: Record<string, unknown> }) => {
    calls.push({ path, ...(options ?? {}) });
    if (path === '/api/training/exercise') {
      return history ? Promise.resolve(history) : Promise.reject(Object.assign(new Error('nope'), { status: 404 }));
    }
    if (path === '/api/training/board') return Promise.resolve(board);
    return Promise.resolve(null);
  });
  return calls;
}

function show(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  mockParams = { exercise: 'Lat Pulldown' };
});

describe('what the history says', () => {
  it('formats a session in the movement’s own currency', () => {
    const [newest] = makeHistory().sessions;
    expect(sessionLine(newest!)).toBe('4 × 15 @ 65 lb');

    // A band or a bodyweight movement has no pound to print, and inventing one would be a
    // lie about the work (the band pack, same day).
    expect(sessionLine({ ...newest!, load_lb: null })).toBe('4 × 15');

    // On an assisted machine the load is the HELP, and it says so.
    expect(sessionLine({ ...newest!, load_lb: 55 }, { loadDirection: 'assistance' })).toBe(
      '4 × 15 @ 55 lb of assistance',
    );

    // Cardio is minutes, miles and a pace — never a load.
    expect(
      sessionLine({ ...newest!, load_lb: null, sets: null, reps: null, duration_min: 20, distance_mi: 1.2, pace_min_mi: 16.7 }),
    ).toBe('20 min · 1.2 mi · 16.7 min/mi');
  });

  it('plots the load oldest-first, and minutes when that is the currency', () => {
    const lift = historyPoints(makeHistory());
    expect(lift.unit).toBe('lb');
    expect(lift.points.map((point) => point.value)).toEqual([55, 60, 65]);

    const walk = historyPoints(
      makeHistory({
        sessions: makeHistory().sessions.map((session) => ({ ...session, load_lb: null, duration_min: 20 })),
      }),
    );
    expect(walk.unit).toBe('min');
  });

  it('refuses to draw a trend out of one or two sessions', () => {
    expect(sparseNote(1)).toBe('First session — the line starts when there are three.');
    expect(sparseNote(2)).toBe('First sessions — the line starts when there are three.');
    expect(sparseNote(3)).toBeNull();
    expect(sparseNote(0)).toBe('Nothing logged yet.');
  });

  it('takes the state line from the coach and adds no opinion of its own', () => {
    expect(stateLine(makeHistory())).toEqual({ text: '65 → 70 lb next', why: 'Two sessions at target reps.' });
    expect(stateLine(makeHistory({ next: null }))).toBeNull();
  });
});

describe('the history screen, for a lift', () => {
  it('leads with the coach’s own next step and why', async () => {
    serve(makeHistory());
    show(<ExerciseHistoryScreen />);

    await waitFor(() => expect(screen.getByTestId('history-state')).toBeTruthy());
    expect(screen.getByTestId('history-state').props.children).toBe('65 → 70 lb next');
    expect(screen.getByTestId('history-why').props.children).toBe('Two sessions at target reps.');
    // The muscle eyebrow and the name.
    expect(screen.getByText('lats · biceps')).toBeTruthy();
    expect(screen.getByText('Lat Pulldown')).toBeTruthy();
  });

  it('charts the load over its sessions, with the dates either side', async () => {
    serve(makeHistory());
    show(<ExerciseHistoryScreen />);

    await waitFor(() => expect(screen.getByTestId('history-chart')).toBeTruthy());
    expect(screen.getByTestId('history-latest').props.children).toBe('65');
    expect(screen.getByTestId('history-best').props.children.join('')).toContain('65');
    expect(screen.getByTestId('history-from').props.children).toBe('Tue, Aug 18');
    expect(screen.getByTestId('history-to').props.children).toBe('Tue, Sep 1');
    // Three sessions is a line, so no apology under it.
    expect(screen.queryByTestId('history-sparse')).toBeNull();
  });

  it('lists every session, newest first, in what was actually done', async () => {
    serve(makeHistory());
    show(<ExerciseHistoryScreen />);

    await waitFor(() => expect(screen.getByTestId('history-sessions')).toBeTruthy());
    expect(screen.getByTestId('history-session-2026-09-01')).toBeTruthy();
    expect(screen.getByTestId('history-session-2026-08-25')).toBeTruthy();
    expect(screen.getByTestId('history-session-2026-08-18')).toBeTruthy();
    expect(screen.getByText('4 × 15 @ 65 lb')).toBeTruthy();
  });

  it('opens the logged record from a session row', async () => {
    serve(makeHistory());
    show(<ExerciseHistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-session-2026-08-25')).toBeTruthy());

    fireEvent.press(screen.getByTestId('history-session-2026-08-25-open'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/log',
      params: { editDate: '2026-08-25', editId: 'a2', editKind: 'activity' },
    });
  });

  // The how-to sheet is still reachable — it is just not what the row does any more.
  it('keeps a door to how it is done', async () => {
    serve(makeHistory());
    show(<ExerciseHistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-how-to')).toBeTruthy());

    fireEvent.press(screen.getByTestId('history-how-to'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/exercise/[id]',
      params: { id: 'ex-pulldown', name: 'Lat Pulldown', media: '2' },
    });
  });

  it('says the per-side plates where the barbell helper applies, and not otherwise', async () => {
    serve(makeHistory({ equipment: ['barbell'], sessions: [{ ...makeHistory().sessions[0]!, load_lb: 135 }] }));
    show(<ExerciseHistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-sessions')).toBeTruthy());
    expect(screen.getByText(/\/side \+ bar/)).toBeTruthy();
  });
});

describe('the history screen, for cardio', () => {
  it('answers in minutes and pace, with the next prescription', async () => {
    mockParams = { exercise: 'Incline Treadmill Walk' };
    serve(
      makeHistory({
        exercise: 'Incline Treadmill Walk',
        category: 'cardio',
        muscle_groups: [],
        equipment: ['treadmill'],
        best_load_lb: null,
        sessions: [
          { date: '2026-09-01', id: 'c2', logged_at: '2026-09-01T07:00:00.000Z', load_lb: null, sets: null, reps: null, duration_min: 20, distance_mi: 1.2, pace_min_mi: 16.7, kcal: 120, entries: 1 },
          { date: '2026-08-30', id: 'c1', logged_at: '2026-08-30T07:00:00.000Z', load_lb: null, sets: null, reps: null, duration_min: 15, distance_mi: 0.9, pace_min_mi: 16.7, kcal: 90, entries: 1 },
        ],
        next: { rule: 'cardio', minutes: 22, text: '22 min next', eta: null, why: '30 of 150 min this week.' } as ExerciseHistory['next'],
        sessions_count: 2,
      }),
    );
    show(<ExerciseHistoryScreen />);

    await waitFor(() => expect(screen.getByTestId('history-state')).toBeTruthy());
    expect(screen.getByTestId('history-state').props.children).toBe('22 min next');
    expect(screen.getByText('Minutes')).toBeTruthy();
    expect(screen.getByText('20 min · 1.2 mi · 16.7 min/mi')).toBeTruthy();
    // Never a pound on a cardio screen.
    expect(screen.queryByTestId('history-best')).toBeNull();
  });
});

describe('a movement with one session on it', () => {
  it('draws the dot and says the line is not a line yet', async () => {
    serve(makeHistory({ sessions: [makeHistory().sessions[0]!], sessions_count: 1, next: null }));
    show(<ExerciseHistoryScreen />);

    await waitFor(() => expect(screen.getByTestId('history-chart')).toBeTruthy());
    expect(screen.getByTestId('history-sparse').props.children).toBe(
      'First session — the line starts when there are three.',
    );
    // One point has no span to date, so there are no end labels to mislead anybody.
    expect(screen.queryByTestId('history-from')).toBeNull();
  });

  it('says so plainly when the server has nothing for this name', async () => {
    serve(null);
    show(<ExerciseHistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-error')).toBeTruthy());
  });
});

// ── the tap contract, on the lists ───────────────────────────────────────────────────

describe('name versus row, on All lifts', () => {
  it('opens the history from the row and the how-to sheet from the name', async () => {
    mockApi.mockImplementation((path: string) => {
      if (path === '/api/training/board') return Promise.resolve(makeBoard({ lifts: [BENCH, CHIN] }));
      return Promise.resolve(null);
    });
    show(<Lifts />);
    await waitFor(() => expect(screen.getByTestId('all-lift-Bench Press')).toBeTruthy());

    fireEvent.press(screen.getByTestId('all-lift-Bench Press'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/history/[exercise]',
      params: { exercise: 'Bench Press' },
    });

    mockPush.mockClear();
    fireEvent.press(screen.getByText('Bench Press'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/exercise/[id]',
      params: { id: 'ex-bench', name: 'Bench Press', media: '2' },
    });
    expect(mockPush).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/history/[exercise]' }));
  });
});
