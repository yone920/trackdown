import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import LogSheet from '@/app/log';
import type { FusionResult } from '@/lib/types';

// The log sheet end to end against a fake API: type, analyze, edit, save. And the Expo Go
// rule — when the speech port reports unavailable the Speak control is not drawn at all
// (docs/build-plan.md §Morning test).

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

const mockSpeech = { available: false, requestPermission: jest.fn(), start: jest.fn(), stop: jest.fn() };
jest.mock('@/lib/ports/speech', () => ({ getSpeech: () => mockSpeech }));

const meal: FusionResult = {
  kind: 'meal',
  description: 'Chicken, rice and broccoli',
  meal_type: 'dinner',
  kcal: 620,
  protein_g: 45,
  carbs_g: 60,
  fat_g: 18,
  fiber_g: 6,
  items: [],
  confidence: 'medium',
  sources: null,
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
  mockSpeech.available = false;
});

describe('the log sheet', () => {
  it('hides Speak when the speech port is unavailable, and says why', () => {
    renderSheet();
    expect(screen.queryByTestId('control-speak')).toBeNull();
    expect(screen.getByTestId('control-photo')).toBeTruthy();
    expect(screen.getByTestId('control-type')).toBeTruthy();
    expect(screen.getByText(/needs the dev build/)).toBeTruthy();
  });

  it('shows Speak when an adapter is there', () => {
    mockSpeech.available = true;
    renderSheet();
    expect(screen.getByTestId('control-speak')).toBeTruthy();
  });

  it('analyses typed text and saves the confirmed card', async () => {
    mockUpload.mockResolvedValue({
      results: [meal],
      result: meal,
      evidence: [],
      context: { local_date: '2026-08-30', tz_offset_min: 0 },
    });
    mockApi.mockResolvedValue({ kind: 'meal', kinds: ['meal'], replayed: false });

    renderSheet();
    fireEvent.changeText(screen.getByTestId('log-text'), 'chicken, rice and broccoli');
    fireEvent.press(screen.getByTestId('log-read'));

    await waitFor(() => expect(screen.getByTestId('confirm-card')).toBeTruthy());
    expect(mockUpload).toHaveBeenCalledWith(
      '/api/log/analyze',
      expect.arrayContaining([{ name: 'text', value: 'chicken, rice and broccoli' }]),
    );

    fireEvent.changeText(screen.getByTestId('meal-kcal'), '700');
    fireEvent.press(screen.getByTestId('confirm-save'));

    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    const [path, options] = mockApi.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(path).toBe('/api/log/confirm');
    // The uuid is minted once per Save, so a retry replays rather than logging twice.
    expect(options.body.client_id).toBe('00000000-0000-4000-8000-000000000000');
    expect(options.body.results).toMatchObject([{ kind: 'meal', kcal: 700 }]);
    expect(options.body.tz_offset_min).toBe(0);
  });

  it('offers no Save for an unclear reading, only the question', async () => {
    mockUpload.mockResolvedValue({
      results: [{ kind: 'unclear', question: 'Machine or free weights?' }],
      evidence: [],
      context: { local_date: '2026-08-30', tz_offset_min: 0 },
    });
    renderSheet();
    fireEvent.changeText(screen.getByTestId('log-text'), 'did the thing');
    fireEvent.press(screen.getByTestId('log-read'));

    await waitFor(() => expect(screen.getByText('Machine or free weights?')).toBeTruthy());
    expect(screen.queryByTestId('confirm-save')).toBeNull();
  });

  // One sentence, several things (backend Field fixes, mixed input): a card per part,
  // each removable, one Save for all of them.
  it('stacks a card per part, drops one on ✕, and saves the rest in one call', async () => {
    const run: FusionResult = {
      kind: 'activities',
      items: [
        {
          exercise: 'Treadmill Run',
          equipment: null,
          description: '5 km run',
          category: null,
          muscle_groups: null,
          sets: null,
          reps: null,
          load_lb: null,
          duration_min: 28,
          distance_mi: 3.11,
          kcal: 300,
          confidence: 'medium',
          sources: null,
        },
      ],
    };
    const weight: FusionResult = { kind: 'weight', weight_lb: 181, confidence: 'high', sources: null };
    mockUpload.mockResolvedValue({
      results: [meal, run, weight],
      evidence: [
        { id: 'e1', kind: 'photo', mime: 'image/jpeg', width: 10, height: 10, url: '/x', part: 0 },
        { id: 'e2', kind: 'photo', mime: 'image/jpeg', width: 10, height: 10, url: '/y', part: 1 },
      ],
      context: { local_date: '2026-08-30', tz_offset_min: 0 },
    });
    mockApi.mockResolvedValue({ kind: 'meal', kinds: ['meal', 'weight'], replayed: false });

    renderSheet();
    fireEvent.changeText(screen.getByTestId('log-text'), 'ate this, ran 5k, weighed 181');
    fireEvent.press(screen.getByTestId('log-read'));

    // One card per part, and the count is said out loud rather than left to be counted.
    await waitFor(() => expect(screen.getByTestId('confirm-card')).toBeTruthy());
    expect(screen.getByTestId('confirm-card-1')).toBeTruthy();
    expect(screen.getByTestId('confirm-card-2')).toBeTruthy();
    expect(screen.getByText(/Read 3 things in that/)).toBeTruthy();

    // The run was not what they meant: drop it, and the photo read for it goes too.
    fireEvent.press(screen.getByTestId('confirm-card-1-remove'));
    await waitFor(() => expect(screen.queryByTestId('confirm-card-2')).toBeNull());

    fireEvent.press(screen.getByTestId('confirm-save'));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    const [, options] = mockApi.mock.calls[0] as [string, { body: Record<string, unknown> }];
    // One call, one client_id, the two parts that are left — the meal and the weigh-in.
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(options.body.results).toMatchObject([{ kind: 'meal' }, { kind: 'weight' }]);
    expect(options.body.evidence_ids).toEqual(['e1']);
    expect(options.body.evidence_parts).toEqual([0]);
  });

  // The clarify loop (backend Field fixes). A question is not a dead end: the sheet keeps
  // what it asked about and what it asked, so a one-word answer resolves.
  it('remembers the question, asks for the answer, and sends both back', async () => {
    mockUpload.mockResolvedValueOnce({
      results: [{ kind: 'unclear', question: 'Was that a bench press?' }],
      evidence: [],
      context: { local_date: '2026-08-30', tz_offset_min: 0 },
    });
    renderSheet();
    fireEvent.changeText(screen.getByTestId('log-text'), 'did the thing');
    fireEvent.press(screen.getByTestId('log-read'));

    await waitFor(() => expect(screen.getByText('Was that a bench press?')).toBeTruthy());
    // The box is emptied for the answer and says what it now wants.
    const input = screen.getByTestId('log-text');
    expect(input.props.value).toBe('');
    expect(input.props.placeholder).toBe('Answer the question…');

    const bench: FusionResult = {
      kind: 'activities',
      items: [
        {
          exercise: 'Bench Press',
          equipment: null,
          description: 'bench press',
          category: null,
          muscle_groups: null,
          sets: null,
          reps: null,
          load_lb: null,
          duration_min: null,
          distance_mi: null,
          kcal: 60,
          confidence: 'medium',
          sources: null,
        },
      ],
    };
    mockUpload.mockResolvedValueOnce({
      results: [bench],
      evidence: [],
      context: { local_date: '2026-08-30', tz_offset_min: 0 },
    });
    fireEvent.changeText(input, 'yes');
    fireEvent.press(screen.getByTestId('log-read'));

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
    const parts = mockUpload.mock.calls[1]![1] as { name: string; value?: string }[];
    expect(parts).toEqual(
      expect.arrayContaining([
        { name: 'text', value: 'yes' },
        { name: 'clarify_original', value: 'did the thing' },
        { name: 'clarify_question', value: 'Was that a bench press?' },
      ]),
    );

    // Resolved: the card is a workout and the round is over.
    await waitFor(() => expect(screen.getByTestId('confirm-card')).toBeTruthy());
    expect(screen.getByTestId('log-text').props.placeholder).not.toBe('Answer the question…');
  });

  it('sends no clarify round on an ordinary log', async () => {
    mockUpload.mockResolvedValue({
      results: [meal],
      evidence: [],
      context: { local_date: '2026-08-30', tz_offset_min: 0 },
    });
    renderSheet();
    fireEvent.changeText(screen.getByTestId('log-text'), 'chicken and rice');
    fireEvent.press(screen.getByTestId('log-read'));
    await waitFor(() => expect(screen.getByTestId('confirm-card')).toBeTruthy());
    const parts = mockUpload.mock.calls[0]![1] as { name: string }[];
    expect(parts.map((part) => part.name)).not.toContain('clarify_original');
  });
});
