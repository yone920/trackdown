import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { WeighIns } from '@/components/weigh-ins';
import type { WeighIn } from '@/lib/types';

// The weigh-ins got their surface back (field report 2026-09-02). They lost it when Today's
// Body section came off in the Train/Eat/Home restructure: the numbers went on feeding the
// 7-day average, the goal card and the week, while the ROWS were unreachable — so somebody
// who logged 110 when they meant 210 could see the consequences everywhere and correct them
// nowhere. Loud and untouchable is the worst shape a record can be in.

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

/** A local timestamp on the given calendar day, so the row's date label is predictable. */
function at(daysAgo: number, hour = 8): string {
  const when = new Date();
  when.setDate(when.getDate() - daysAgo);
  when.setHours(hour, 41, 0, 0);
  return when.toISOString();
}

function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ROWS: WeighIn[] = [
  { id: 'w1', weight_lb: 110, logged_at: at(0), confidence: 'low' },
  { id: 'w2', weight_lb: 212, logged_at: at(2) },
];

function serve(rows: WeighIn[] = ROWS) {
  mockApi.mockImplementation((path: string, options?: { method?: string }) => {
    if (options?.method === 'DELETE') return Promise.resolve(undefined);
    if (path === '/api/weight') return Promise.resolve(rows);
    return Promise.resolve(null);
  });
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <WeighIns />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  serve();
});

describe('the weigh-ins list', () => {
  it('draws every reading with its weight and when it was taken, newest first', async () => {
    renderList();

    await waitFor(() => expect(screen.getByTestId('row-weight-w1')).toBeTruthy());
    expect(screen.getByText('110.0 lb')).toBeTruthy();
    expect(screen.getByText('212.0 lb')).toBeTruthy();
    // Dated the way a person says it.
    expect(screen.getByText('today')).toBeTruthy();
  });

  it('marks the reading the app doubted, so the wrong one is the obvious one', async () => {
    renderList();
    await waitFor(() => expect(screen.getByTestId('row-weight-w1')).toBeTruthy());
    expect(screen.getByText('check')).toBeTruthy();
  });

  it('opens a weigh-in for correction, dated the day it was LOGGED', async () => {
    // Not today: the sheet reads the record back out of that day's own log.
    renderList();
    await waitFor(() => expect(screen.getByTestId('row-weight-w2')).toBeTruthy());

    fireEvent.press(screen.getByTestId('row-weight-w2'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/log',
      params: { editDate: localDate(ROWS[1]!.logged_at), editId: 'w2', editKind: 'weight' },
    });
  });

  it('takes one back in two taps, like every other logged row', async () => {
    renderList();
    await waitFor(() => expect(screen.getByTestId('row-weight-w1')).toBeTruthy());

    fireEvent.press(screen.getByTestId('row-weight-w1-delete'));
    expect(screen.getByText('Delete?')).toBeTruthy();
    expect(mockApi.mock.calls.some(([, o]) => (o as { method?: string })?.method === 'DELETE')).toBe(false);

    fireEvent.press(screen.getByTestId('row-weight-w1-delete-confirm'));
    await waitFor(() =>
      expect(mockApi.mock.calls.some(([path, o]) => path === '/api/weight/w1' && (o as { method?: string })?.method === 'DELETE')).toBe(true),
    );
  });

  it('keeps a long history behind one chip rather than a wall of rows', async () => {
    serve(Array.from({ length: 14 }, (_, i) => ({ id: `w${i}`, weight_lb: 210 - i, logged_at: at(i) })));
    renderList();

    await waitFor(() => expect(screen.getByTestId('weigh-ins-more')).toBeTruthy());
    expect(screen.queryByTestId('row-weight-w12')).toBeNull();

    fireEvent.press(screen.getByTestId('weigh-ins-more'));
    expect(screen.getByTestId('row-weight-w12')).toBeTruthy();
  });

  it('says so plainly when there are none', async () => {
    serve([]);
    renderList();
    await waitFor(() => expect(screen.getByTestId('weigh-ins-empty')).toBeTruthy());
  });
});

describe('a corrected weigh-in stops showing the old number', () => {
  // Field report 2026-09-02: the correction saved (the record card showed 210 with its
  // "weight 110 → 210" audit line) and this list went on reading 110. The mutation was
  // invalidating day/week/goals/training — but not the weigh-ins list itself.

  it('refetches the list after a delete, so the row actually leaves', async () => {
    let rows: WeighIn[] = [
      { id: 'w1', weight_lb: 110, logged_at: at(0), confidence: 'low' },
      { id: 'w2', weight_lb: 212, logged_at: at(2) },
    ];
    mockApi.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === 'DELETE') {
        const gone = path.split('/').pop();
        rows = rows.filter((row) => row.id !== gone);
        return Promise.resolve(undefined);
      }
      if (path === '/api/weight') return Promise.resolve(rows);
      return Promise.resolve(null);
    });

    renderList();
    await waitFor(() => expect(screen.getByText('110.0 lb')).toBeTruthy());

    fireEvent.press(screen.getByTestId('row-weight-w1-delete'));
    fireEvent.press(screen.getByTestId('row-weight-w1-delete-confirm'));

    // The list is re-read and the stale row is gone — not merely absent from the server.
    await waitFor(() => expect(screen.queryByText('110.0 lb')).toBeNull());
    expect(screen.getByText('212.0 lb')).toBeTruthy();
    expect(mockApi.mock.calls.filter(([path]) => path === '/api/weight').length).toBeGreaterThan(1);
  });
});
