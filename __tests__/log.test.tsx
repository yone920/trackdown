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
      result: meal,
      evidence: [],
      context: { local_date: '2026-08-30', tz_offset_min: 0 },
    });
    mockApi.mockResolvedValue({ kind: 'meal', replayed: false });

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
    // The uuid is minted once per card, so a retry replays rather than logging twice.
    expect(options.body.client_id).toBe('00000000-0000-4000-8000-000000000000');
    expect(options.body.result).toMatchObject({ kind: 'meal', kcal: 700 });
    expect(options.body.tz_offset_min).toBe(0);
  });

  it('offers no Save for an unclear reading, only the question', async () => {
    mockUpload.mockResolvedValue({
      result: { kind: 'unclear', question: 'Machine or free weights?' },
      evidence: [],
      context: { local_date: '2026-08-30', tz_offset_min: 0 },
    });
    renderSheet();
    fireEvent.changeText(screen.getByTestId('log-text'), 'did the thing');
    fireEvent.press(screen.getByTestId('log-read'));

    await waitFor(() => expect(screen.getByText('Machine or free weights?')).toBeTruthy());
    expect(screen.queryByTestId('confirm-save')).toBeNull();
  });
});
