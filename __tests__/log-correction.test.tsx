import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import LogSheet from '@/app/log';
import type { DayLogEntry, FusionResult } from '@/lib/types';

// "Tap → correct" from the DayLog (docs/design-system.md §DayLog), after NO FORMS
// (concept-v2 §Principles 7, user decision 2026-08-31). It used to be the confirm card
// with the saved values in editable fields. It is now the same review-and-tell as a fresh
// log: the row read back read-only, "Make a change", say what is wrong, and the revised
// values go out as a PATCH.

const mockApi = jest.fn();
const mockUpload = jest.fn();
jest.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  upload: (...args: unknown[]) => mockUpload(...args),
  tzOffsetMin: () => 0,
  authHeaders: () => ({}),
  evidenceUrl: (id: string) => `http://test/api/evidence/${id}`,
  API_URL: 'http://test',
  ApiError: class extends Error {},
  setUnauthorizedHandler: () => {},
}));

jest.mock('@/lib/ports/speech', () => ({
  getSpeech: () => ({ available: false, requestPermission: jest.fn(), start: jest.fn(), stop: jest.fn() }),
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: (...args: unknown[]) => mockBack(...args), replace: jest.fn() }),
  useLocalSearchParams: () => ({ editDate: '2026-08-29', editId: 'a1', editKind: 'activity' }),
}));

const ENTRY: DayLogEntry = {
  id: 'a1',
  kind: 'activity',
  logged_at: '2026-08-29T18:10:00.000Z',
  raw_text: 'chest supported row, three sets of twelve at forty five',
  icon: 'mic',
  evidence: [],
  source: 'fused',
  confidence: 'low',
  understood: 'Chest-Supported Row · 3 × 12 at 45 lb',
  editable: true,
  record: {
    kind: 'activity',
    exercise: 'Chest-Supported Row',
    exercise_id: null,
    equipment: 'chest-supported row machine',
    description: '3 × 12 chest-supported row at 45 lb',
    category: 'strength',
    muscle_groups: ['back'],
    sets: 3,
    reps: 12,
    load_lb: 45,
    duration_min: null,
    distance_mi: null,
    kcal: 120,
  },
};

const REVISED: FusionResult = {
  kind: 'activities',
  items: [
    {
      exercise: 'Chest-Supported Row',
      equipment: 'chest-supported row machine',
      description: '3 × 4 chest-supported row at 50 lb',
      category: 'strength',
      muscle_groups: ['back'],
      sets: 3,
      reps: 4,
      load_lb: 50,
      duration_min: null,
      distance_mi: null,
      kcal: 120,
      confidence: 'high',
      sources: null,
    },
  ],
};

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <LogSheet />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockUpload.mockReset();
  mockBack.mockReset();
  mockApi.mockImplementation(async (path: string) =>
    path.startsWith('/api/day/') ? { date: '2026-08-29', entries: [ENTRY] } : {},
  );
});

describe('correcting a row that is already in the log', () => {
  it('shows what was saved, read-only, with nothing to save until something changes', async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('confirm-card')).toBeTruthy());

    expect(screen.getByText('This is what was saved')).toBeTruthy();
    expect(screen.getByText(/chest supported row, three sets/)).toBeTruthy();
    expect(screen.getByTestId('activity-reps-0')).toHaveTextContent('12');
    // No field, and nothing to press but "Make a change": a PATCH of the values it
    // already has is not a correction.
    expect(screen.root.findAllByType('TextInput' as never)).toHaveLength(0);
    expect(screen.queryByTestId('confirm-save')).toBeNull();
    expect(screen.getByTestId('log-make-change')).toBeTruthy();
  });

  it('takes the change in words and PATCHes the revised values', async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('confirm-card')).toBeTruthy());

    fireEvent.press(screen.getByTestId('log-make-change'));
    const input = screen.getByTestId('log-text');
    expect(input.props.placeholder).toBe('Tell me what to change — “reps were 3, not 4”…');

    mockUpload.mockResolvedValueOnce({
      results: [REVISED],
      evidence: [],
      context: { local_date: '2026-08-29', tz_offset_min: 0 },
    });
    fireEvent.changeText(input, 'reps were 4 and it was 50 pounds');
    fireEvent.press(screen.getByTestId('log-submit'));

    // One saved row goes out as `record` — the shape the endpoint takes for exactly this.
    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    const parts = mockUpload.mock.calls[0]![1] as { name: string; value: string }[];
    const revise = JSON.parse(parts.find((part) => part.name === 'revise')!.value) as {
      record: FusionResult;
      instruction: string;
    };
    expect(revise.instruction).toBe('reps were 4 and it was 50 pounds');
    expect(revise.record).toMatchObject({ kind: 'activities' });

    // Back on the review page with the new numbers, and now there is something to save.
    await waitFor(() => expect(screen.getByTestId('activity-reps-0')).toHaveTextContent('4'));
    expect(screen.getByTestId('activity-load-0')).toHaveTextContent('50');
    expect(screen.getByTestId('confirm-save')).toHaveTextContent('Save changes');

    fireEvent.press(screen.getByTestId('confirm-save'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const patch = mockApi.mock.calls.find(
      (call) => (call[1] as { method?: string } | undefined)?.method === 'PATCH',
    ) as [string, { body: Record<string, unknown> }];
    expect(patch[0]).toBe('/api/entries/movement/a1');
    expect(patch[1].body).toMatchObject({
      reps: 4,
      load_lb: 50,
      sets: 3,
      // The muscle groups the revision was never asked about are still on the row.
      muscle_groups: ['back'],
      equipment: 'chest-supported row machine',
    });
  });
});
