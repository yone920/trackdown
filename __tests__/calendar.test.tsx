import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { CalendarSheet } from '@/components/calendar-sheet';
import {
  daysInMonth,
  dotTone,
  monthGrid,
  monthOf,
  monthTitle,
  monthWindow,
  rowsByDate,
  shiftMonth,
} from '@/lib/calendar';
import { makeDayRow } from './fixtures';

// The way back to any day (user request 2026-09-02: "the train only shows today … there
// should be some sort of calendar so anyone can easily go back and see what they did last
// week or a specific day. Same for the eat").
//
// One sheet, shared by the Train and Eat headers. The grid arithmetic is tested without a
// renderer, the way every other calculation in this app is, and the component is tested for
// the four things a person does with it: read the dots, tap a day, page the month, and fail
// to tap a day that has not happened.

const mockApi = jest.fn();
jest.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  tzOffsetMin: () => 0,
  authHeaders: () => ({}),
  API_URL: 'http://test',
  ApiError: class extends Error {},
  setUnauthorizedHandler: () => {},
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

/** The day the app thinks it is, as `localDateKey()` reads the device clock. */
function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

describe('the month, as arithmetic', () => {
  it('lays a month out Monday-first, padded to whole weeks', () => {
    // September 2026 starts on a Tuesday, so one padding cell leads it.
    const weeks = monthGrid('2026-09', '2026-09-02');
    expect(weeks[0]).toHaveLength(7);
    expect(weeks[0]![0]).toMatchObject({ date: null, day: null });
    expect(weeks[0]![1]).toMatchObject({ date: '2026-09-01', day: 1 });
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().filter((cell) => cell.date !== null)).toHaveLength(30);
  });

  it('knows today, and that tomorrow has not happened', () => {
    const cells = monthGrid('2026-09', '2026-09-02').flat();
    expect(cells.find((cell) => cell.date === '2026-09-02')).toMatchObject({ isToday: true, future: false });
    expect(cells.find((cell) => cell.date === '2026-09-01')).toMatchObject({ isToday: false, future: false });
    expect(cells.find((cell) => cell.date === '2026-09-03')).toMatchObject({ isToday: false, future: true });
  });

  it('counts the days a month has, February included', () => {
    expect(daysInMonth('2026-09')).toBe(30);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-12')).toBe(31);
  });

  it('steps months and rolls the year over', () => {
    expect(shiftMonth('2026-09', -1)).toBe('2026-08');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthTitle('2026-09')).toBe('September 2026');
    expect(monthOf('2026-09-02')).toBe('2026-09');
  });

  // `before` is exclusive on GET /api/days, so the first of the NEXT month covers this one
  // exactly — which is why this needed no new endpoint.
  it('asks for a month with the existing endpoint’s own window', () => {
    expect(monthWindow('2026-09')).toEqual({ before: '2026-10-01', limit: 31 });
    expect(monthWindow('2026-12')).toEqual({ before: '2027-01-01', limit: 31 });
  });

  it('keeps only the days that belong to the month the window spilled around', () => {
    const rows = [makeDayRow({ date: '2026-09-01' }), makeDayRow({ date: '2026-08-31' })];
    expect([...rowsByDate(rows, '2026-09').keys()]).toEqual(['2026-09-01']);
  });
});

describe('the dot under a date', () => {
  it('is the day’s own verdict, in the Days list’s colours', () => {
    expect(dotTone(makeDayRow({ verdict: 'served' }))).toBe('good');
    expect(dotTone(makeDayRow({ verdict: 'missed' }))).toBe('accent');
  });

  it('is a quiet mark for a day that was logged but not judged', () => {
    expect(dotTone(makeDayRow({ verdict: 'none', closed: false, eaten: 1200 }))).toBe('mute');
    expect(dotTone(makeDayRow({ verdict: 'unlogged', closed: false, eaten: null, earned: 250 }))).toBe('mute');
  });

  it('is nothing at all on a day with nothing on it', () => {
    expect(dotTone(undefined)).toBeNull();
    expect(
      dotTone(
        makeDayRow({
          verdict: 'none',
          closed: false,
          eaten: null,
          earned: null,
          weight_lb: null,
          muscle_groups: [],
        }),
      ),
    ).toBeNull();
  });
});

describe('the calendar sheet', () => {
  const today = todayKey();
  const month = monthOf(today);
  const first = `${month}-01`;
  const second = `${month}-02`;

  function serve(days: unknown[] = []) {
    const calls: string[] = [];
    mockApi.mockImplementation((path: string, options?: { query?: Record<string, unknown> }) => {
      calls.push(`${path}?before=${String(options?.query?.before ?? '')}`);
      if (path.startsWith('/api/days')) return Promise.resolve({ days, next_before: null });
      return Promise.resolve(null);
    });
    return calls;
  }

  function show() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return render(
      <QueryClientProvider client={client}>
        <CalendarSheet visible onClose={jest.fn()} />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    mockApi.mockReset();
    mockPush.mockReset();
  });

  it('opens on this month, with a cell per day', async () => {
    serve();
    show();
    await waitFor(() => expect(screen.getByTestId('calendar-grid')).toBeTruthy());
    expect(screen.getByTestId('calendar-title').props.children).toBe(monthTitle(month));
    expect(screen.getByTestId(`calendar-day-${first}`)).toBeTruthy();
    expect(screen.getByTestId(`calendar-day-${today}`)).toBeTruthy();
  });

  it('marks the days that have something on them, and only those', async () => {
    serve([
      makeDayRow({ date: first, verdict: 'served' }),
      makeDayRow({ date: second, verdict: 'missed' }),
    ]);
    show();

    await waitFor(() => expect(screen.getByTestId(`calendar-dot-${first}`)).toBeTruthy());
    expect(screen.getByTestId(`calendar-dot-${first}`).props.style.backgroundColor).toBe('#3DD68C');
    expect(screen.getByTestId(`calendar-dot-${second}`).props.style.backgroundColor).toBe('#FF7A1A');
    // A day the server said nothing about carries no dot at all.
    expect(screen.queryByTestId(`calendar-dot-${month}-28`)).toBeNull();
  });

  it('opens the day it was tapped on', async () => {
    serve([makeDayRow({ date: first, verdict: 'served' })]);
    show();
    await waitFor(() => expect(screen.getByTestId(`calendar-day-${first}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId(`calendar-day-${first}`));
    expect(mockPush).toHaveBeenCalledWith(`/day/${first}`);
  });

  it('refuses a day that has not happened yet', async () => {
    serve();
    show();
    const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
    // Only meaningful when today is not the last of the month; on the 31st there is no
    // future day in this grid to refuse.
    if (last === today) return;

    await waitFor(() => expect(screen.getByTestId(`calendar-day-${last}`)).toBeTruthy());
    const cell = screen.getByTestId(`calendar-day-${last}`);
    expect(cell.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(cell);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('pages back a month, and asks the server for that month', async () => {
    const calls = serve();
    show();
    await waitFor(() => expect(screen.getByTestId('calendar-title')).toBeTruthy());

    fireEvent.press(screen.getByTestId('calendar-prev'));
    const previous = shiftMonth(month, -1);
    await waitFor(() => expect(screen.getByTestId('calendar-title').props.children).toBe(monthTitle(previous)));
    expect(calls.some((call) => call.includes(`before=${monthWindow(previous).before}`))).toBe(true);

    // And forward again — but never past the month we are living in.
    fireEvent.press(screen.getByTestId('calendar-next'));
    await waitFor(() => expect(screen.getByTestId('calendar-title').props.children).toBe(monthTitle(month)));
    expect(screen.getByTestId('calendar-next').props.accessibilityState).toMatchObject({ disabled: true });
  });
});
