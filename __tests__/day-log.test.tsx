import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import DayLog from '@/app/day/[date]/log';
import { recordToResult, resultToPatch } from '@/lib/edit-record';
import type { DayLogEntry } from '@/lib/types';

// "The log, as recorded" and the round trip behind its "tap → correct": a saved row
// becomes a confirm card, and the edited card becomes the patch its endpoint takes.

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
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ date: '2026-08-29' }),
}));

const ACTIVITY: DayLogEntry = {
  id: 'a1',
  kind: 'activity',
  logged_at: '2026-08-29T18:10:00.000Z',
  raw_text: 'bench press, three sets of eight at one thirty five',
  icon: 'mic',
  evidence: [{ id: 'e1', kind: 'transcript', text: 'bench press…', mime: null, width: null, height: null }],
  source: 'fused',
  confidence: 'high',
  understood: 'Bench Press · 3 × 8 · 135 lb · 120 kcal',
  editable: true,
  record: {
    kind: 'activity',
    description: '3 × 8 bench at 135 lb',
    exercise: 'Bench Press',
    exercise_id: 'ex-bench',
    category: 'strength',
    muscle_groups: ['chest'],
    sets: 3,
    reps: 8,
    load_lb: 135,
    duration_min: null,
    distance_mi: null,
    kcal: 120,
  },
};

const STATEMENT: DayLogEntry = {
  id: 'e9',
  kind: 'statement',
  logged_at: '2026-08-29T09:00:00.000Z',
  raw_text: 'knee hurts today',
  icon: 'keyboard',
  evidence: [{ id: 'e9', kind: 'text', text: 'knee hurts today', mime: null, width: null, height: null }],
  source: null,
  confidence: null,
  understood: 'Saved to your plan',
  editable: false,
  record: { kind: 'statement', text: 'knee hurts today' },
};

function renderLog() {
  mockApi.mockImplementation((path: string) =>
    path.startsWith('/api/day/')
      ? Promise.resolve({ date: '2026-08-29', tz_offset_min: 0, entries: [STATEMENT, ACTIVITY] })
      : Promise.resolve(null),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <DayLog />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
});

describe('DayLog', () => {
  it('quotes what was said and says what it became', async () => {
    renderLog();
    await waitFor(() => expect(screen.getByTestId('log-entry-a1')).toBeTruthy());
    expect(screen.getByText('The log, as recorded')).toBeTruthy();
    expect(screen.getByText('“bench press, three sets of eight at one thirty five”')).toBeTruthy();
    expect(screen.getByText(/read from evidence · Bench Press · 3 × 8 · 135 lb · 120 kcal · high confidence/)).toBeTruthy();
  });

  it('opens the Log sheet in edit mode for a row that can be corrected', async () => {
    renderLog();
    await waitFor(() => expect(screen.getByTestId('log-entry-a1')).toBeTruthy());
    fireEvent.press(screen.getByTestId('log-entry-a1'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/log',
      params: { editDate: '2026-08-29', editId: 'a1', editKind: 'activity' },
    });
  });

  it('does not offer to correct a statement, which has no row to patch', async () => {
    renderLog();
    await waitFor(() => expect(screen.getByTestId('log-entry-e9')).toBeTruthy());
    fireEvent.press(screen.getByTestId('log-entry-e9'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText('Kept on your plan')).toBeTruthy();
  });
});

describe('edit-record — the round trip', () => {
  it('turns an activity into a confirm card and back into its patch', () => {
    const result = recordToResult(ACTIVITY.record)!;
    expect(result.kind).toBe('activities');
    if (result.kind !== 'activities') throw new Error('expected activities');
    expect(result.items[0]).toMatchObject({ exercise: 'Bench Press', sets: 3, reps: 8, load_lb: 135 });
    // A correction is the most confident fact in the system: the user just said it.
    expect(result.items[0]!.confidence).toBe('high');

    const edited = { ...result, items: [{ ...result.items[0]!, load_lb: 140 }] };
    expect(resultToPatch('activity', edited)).toMatchObject({ load_lb: 140, exercise: 'Bench Press', kcal: 120 });
  });

  it('has nothing to patch for a statement', () => {
    expect(recordToResult(STATEMENT.record)).toBeNull();
  });

  it('patches only the weight of a weigh-in', () => {
    const result = recordToResult({ kind: 'weight', weight_lb: 181.4 })!;
    expect(resultToPatch('weight', result)).toEqual({ weight_lb: 181.4 });
  });
});
