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

/**
 * The same record told again as a drop set. One record carries ONE load, so this comes back
 * as TWO — the revision's "split" (field report 2026-09-01).
 */
const SPLIT: FusionResult = {
  kind: 'activities',
  items: [
    {
      exercise: 'Chest-Supported Row',
      equipment: 'chest-supported row machine',
      description: 'chest-supported row, first two sets',
      category: 'strength',
      muscle_groups: ['back'],
      sets: 2,
      reps: 12,
      load_lb: 45,
      duration_min: null,
      distance_mi: null,
      kcal: 60,
      confidence: 'high',
      sources: null,
    },
    {
      exercise: 'Chest-Supported Row',
      equipment: 'chest-supported row machine',
      description: 'chest-supported row, last two sets — dropped to 35',
      category: 'strength',
      muscle_groups: ['back'],
      sets: 2,
      reps: 12,
      load_lb: 35,
      duration_min: null,
      distance_mi: null,
      kcal: 60,
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

describe('a told change that will not fit in the record it is about', () => {
  it('replaces the record with the parts, in one call, instead of saving half of it', async () => {
    // The old path took `items[0]` and PATCHed it: the second half of the drop set was
    // dropped on the floor with no error and no warning. A record carries one load.
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('confirm-card')).toBeTruthy());

    fireEvent.press(screen.getByTestId('log-make-change'));
    mockUpload.mockResolvedValueOnce({
      results: [SPLIT],
      evidence: [],
      context: { local_date: '2026-08-29', tz_offset_min: 0 },
    });
    const said = 'the last two sets I dropped the load to 35';
    fireEvent.changeText(screen.getByTestId('log-text'), said);
    fireEvent.press(screen.getByTestId('log-submit'));

    // Both halves are on the card, to be looked at before anything is written. They are
    // two items of ONE part, which is why nothing that indexes by part had to move.
    await waitFor(() => expect(screen.getByTestId('activity-load-1')).toBeTruthy());
    expect(screen.getByTestId('activity-load-0')).toHaveTextContent('45');
    expect(screen.getByTestId('activity-load-1')).toHaveTextContent('35');

    fireEvent.press(screen.getByTestId('confirm-save'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());

    // One POST to the split endpoint — not a PATCH, and not two writes the day could
    // end up holding one of.
    const patched = mockApi.mock.calls.filter(
      (call) => (call[1] as { method?: string } | undefined)?.method === 'PATCH',
    );
    expect(patched).toHaveLength(0);
    const posted = mockApi.mock.calls.find(([path]) => String(path).endsWith('/split')) as [
      string,
      { method?: string; body: { parts: Record<string, unknown>[]; correction_instruction: string } },
    ];
    expect(posted[0]).toBe('/api/entries/movement/a1/split');
    expect(posted[1].method).toBe('POST');
    expect(posted[1].body.correction_instruction).toBe(said);
    expect(posted[1].body.parts).toHaveLength(2);
    // The parts SUM to what was done — four sets, not the original three plus two more.
    expect(posted[1].body.parts.reduce((sum, part) => sum + (part.sets as number), 0)).toBe(4);
    expect(posted[1].body.parts.map((part) => part.load_lb)).toEqual([45, 35]);
    // And each half is still the movement it always was.
    expect(posted[1].body.parts.every((part) => part.muscle_groups as string[])).toBe(true);
  });

  it('still PATCHes when the change fits in the record', async () => {
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('confirm-card')).toBeTruthy());
    fireEvent.press(screen.getByTestId('log-make-change'));
    mockUpload.mockResolvedValueOnce({
      results: [REVISED],
      evidence: [],
      context: { local_date: '2026-08-29', tz_offset_min: 0 },
    });
    fireEvent.changeText(screen.getByTestId('log-text'), 'reps were 4');
    fireEvent.press(screen.getByTestId('log-submit'));
    await waitFor(() => expect(screen.getByTestId('activity-reps-0')).toHaveTextContent('4'));

    fireEvent.press(screen.getByTestId('confirm-save'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockApi.mock.calls.find(([path]) => String(path).endsWith('/split'))).toBeUndefined();
  });
});

// Reported 2026-08-31: the record screen quoted the words and showed none of the photos
// the record was made from — half the evidence. And the order was wrong: the quote (which
// can be a paragraph) sat above the thing the user came to look at.
describe('the record, and how it came to be recorded', () => {
  const WITH_PHOTOS: DayLogEntry = {
    ...ENTRY,
    icon: 'camera',
    evidence: [
      { id: 'ev-1', kind: 'photo', text: null, mime: 'image/jpeg', width: 1280, height: 960 },
      { id: 'ev-2', kind: 'photo', text: null, mime: 'image/jpeg', width: 1280, height: 960 },
      { id: 'ev-3', kind: 'transcript', text: 'chest supported row…', mime: null, width: null, height: null },
    ],
  };

  const serveEntry = (entry: DayLogEntry) =>
    mockApi.mockImplementation(async (path: string) =>
      path.startsWith('/api/day/') ? { date: '2026-08-29', entries: [entry] } : {},
    );

  it('draws the photos the record was made from, under the record', async () => {
    serveEntry(WITH_PHOTOS);
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('record-photos')).toBeTruthy());

    // Two photos, and the transcript is not one of them.
    expect(screen.getByTestId('evidence-ev-1')).toBeTruthy();
    expect(screen.getByTestId('evidence-ev-2')).toBeTruthy();
    expect(screen.queryByTestId('evidence-ev-3')).toBeNull();

    // Tapping one opens it full size; nothing here removes it.
    expect(screen.queryByTestId('evidence-ev-1-remove')).toBeNull();
    fireEvent.press(screen.getByTestId('evidence-ev-1'));
    expect(screen.getByTestId('photo-full')).toBeTruthy();
    fireEvent.press(screen.getByTestId('photo-close'));
    await waitFor(() => expect(screen.queryByTestId('photo-full')).toBeNull());
  });

  it('puts the record first and the provenance below it', async () => {
    serveEntry(WITH_PHOTOS);
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('record-provenance')).toBeTruthy());

    expect(screen.getByText('How this was recorded')).toBeTruthy();
    expect(screen.getByText(/^You said: /)).toBeTruthy();
    // The quote is inside the provenance section, not above the card.
    const provenance = screen.getByTestId('record-provenance');
    expect(provenance.findAllByType('Text' as never).some((node: { props: { children?: unknown } }) =>
      String(node.props.children).startsWith('You said'),
    )).toBe(true);
  });

  it('says so plainly when there were no words at all', async () => {
    serveEntry({ ...WITH_PHOTOS, raw_text: null });
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('record-provenance')).toBeTruthy());
    expect(screen.getByText(/Logged without words/)).toBeTruthy();
  });
});

// Reported 2026-08-31, the other half of the same screen: the user told a lunch "the carbs
// look wrong", the app read it again and wrote 89 — and nothing anywhere said so. The
// provenance list was built to take appended entries; migration 0015 supplies them.
describe('the corrections, in the provenance list', () => {
  const CORRECTED: DayLogEntry = {
    ...ENTRY,
    raw_text: 'tuna, two eggs, quarter onion, a chilli, two cups of vegetables, four slices of this bread',
    corrections: [
      {
        id: 'c1',
        instruction: 'the carbs look wrong',
        changes: [{ field: 'carbs_g', from: 398, to: 89 }],
        created_at: '2026-08-29T13:45:00.000Z',
      },
      {
        id: 'c2',
        instruction: 'it was closer to 880 calories',
        changes: [
          { field: 'kcal', from: 918, to: 880 },
          { field: 'meal_type', from: 'dinner', to: 'lunch' },
        ],
        created_at: '2026-08-29T14:10:00.000Z',
      },
    ],
  };

  const serveEntry = (entry: DayLogEntry) =>
    mockApi.mockImplementation(async (path: string) =>
      path.startsWith('/api/day/') ? { date: '2026-08-29', entries: [entry] } : {},
    );

  it('appends every told change under the words, oldest first, with what it moved', async () => {
    serveEntry(CORRECTED);
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('record-provenance')).toBeTruthy());

    const lines = screen
      .getAllByTestId('provenance-correction')
      .map((node: { props: { children?: unknown } }) => String(node.props.children));
    expect(lines).toHaveLength(2);
    // The user's own sentence, quoted, and the field-level diff beside it.
    expect(lines[0]).toContain('the carbs look wrong');
    expect(lines[0]).toContain('carbs 398 → 89');
    // Chronological, and a column name is never printed at anybody.
    expect(lines[1]).toContain('kcal 918 → 880');
    expect(lines[1]).toContain('meal dinner → lunch');
    expect(lines.join(' ')).not.toContain('carbs_g');
  });

  it('draws nothing at all for a record nobody has corrected', async () => {
    serveEntry({ ...ENTRY, corrections: [] });
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('record-provenance')).toBeTruthy());
    expect(screen.queryAllByTestId('provenance-correction')).toHaveLength(0);
  });

  it('survives a server that has never heard of corrections', async () => {
    // One release of compatibility: the field is simply absent, not empty.
    serveEntry(ENTRY);
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('provenance-said')).toBeTruthy());
    expect(screen.queryAllByTestId('provenance-correction')).toHaveLength(0);
  });

  it('sends what the user SAID with the PATCH, so the server can file the correction', async () => {
    serveEntry(ENTRY);
    renderSheet();
    await waitFor(() => expect(screen.getByTestId('confirm-card')).toBeTruthy());

    fireEvent.press(screen.getByTestId('log-make-change'));
    mockUpload.mockResolvedValueOnce({
      results: [REVISED],
      corrections: [
        { part: 0, item: 0, instruction: 'reps were 4', changes: [{ field: 'reps', from: 12, to: 4 }] },
      ],
      evidence: [],
      context: { local_date: '2026-08-29', tz_offset_min: 0 },
    });
    fireEvent.changeText(screen.getByTestId('log-text'), 'reps were 4 and it was 50 pounds');
    fireEvent.press(screen.getByTestId('log-submit'));

    await waitFor(() => expect(screen.getByTestId('confirm-save')).toHaveTextContent('Save changes'));
    fireEvent.press(screen.getByTestId('confirm-save'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());

    const patch = mockApi.mock.calls.find(
      (call) => (call[1] as { method?: string } | undefined)?.method === 'PATCH',
    ) as [string, { body: Record<string, unknown> }];
    // The instruction, not the diff: a saved row's diff is the server's own, taken between
    // the row before and the row after.
    expect(patch[1].body.correction_instruction).toBe('reps were 4 and it was 50 pounds');
  });
});
