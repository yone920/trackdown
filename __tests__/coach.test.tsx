import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Coach from '@/app/coach';
import type { CoachNext } from '@/lib/types';

// The Coach screen, and the two things the field report broke.
//
//   1. **A revision, not a second question.** Once there is a brief, what the user types
//      into the box is a change to *that brief* — it goes out as `revision` and the server
//      hands the model the brief being revised.
//   2. **The brief never leaves the screen.** Not while a new one is being written, not
//      when the new one fails. Asking for a better answer must not cost you the one you
//      already have — and the old screen did exactly that, because the typed line was part
//      of the query key, so every Ask started a fresh, empty cache entry (and fired a GET
//      *and* a POST — two model calls for one tap).

const mockApi = jest.fn();
jest.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  upload: jest.fn(),
  tzOffsetMin: () => 0,
  authHeaders: () => ({ Authorization: 'Bearer test' }),
  evidenceUrl: (id: string) => `http://test/api/evidence/${id}`,
  exerciseMediaUrl: (id: string, n: number) => `http://test/api/exercises/${id}/media/${n}`,
  API_URL: 'http://test',
  ApiError: class extends Error {},
  setUnauthorizedHandler: () => {},
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
}));

function next(overrides: Partial<CoachNext> = {}): CoachNext {
  return {
    brief: {
      id: 'brief-1',
      asked_at: '2026-08-31T09:00:00.000Z',
      cached: false,
      headline: 'Pull day: back and shoulders',
      why: 'Back is five days since its last session.',
      workout: {
        type: 'strength',
        targets: ['back'],
        exercises: [
          {
            name: 'Lat Pulldown',
            exercise_id: null,
            load_lb: 110,
            sets: 3,
            reps: 10,
            minutes: null,
            note: null,
          },
        ],
      },
      nutrition: { kcal: 2254, protein_g: 160, carbs_max_g: 250, ideas: [], why: 'Steady.' },
      nudge: 'Weigh in tomorrow.',
      nudge_action: null,
    },
    stale: false,
    note: null,
    gap: null,
    nudge_action: null,
    goals: [],
    ...overrides,
  };
}

function renderCoach() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Coach />
    </QueryClientProvider>,
  );
}

/** Calls to `api()` that were a POST to the regenerate endpoint. */
function asks(): Record<string, unknown>[] {
  return mockApi.mock.calls
    .filter(([path, options]) => path === '/api/coach/next/regenerate' && options?.method === 'POST')
    .map(([, options]) => options.body as Record<string, unknown>);
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
});

it('asks once on open and draws the brief', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();

  expect(await screen.findByText('Pull day: back and shoulders')).toBeTruthy();
  expect(screen.getByText('Lat Pulldown')).toBeTruthy();
  // One GET, and nothing else: the coach is a button.
  expect(mockApi).toHaveBeenCalledTimes(1);
  expect(mockApi.mock.calls[0]?.[0]).toBe('/api/coach/next');
});

it('sends what you type as a revision once there is a brief, and only asks once', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  // The box says what it is for now.
  expect(screen.getByPlaceholderText("Adjust it — 'make it 8 exercises', 'switch to legs'…")).toBeTruthy();

  mockApi.mockResolvedValue(
    next({ brief: { ...next().brief, id: 'brief-2', headline: 'Full body: eight movements' } }),
  );
  fireEvent.changeText(screen.getByTestId('coach-context'), 'make it 8 exercises');
  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-regenerate'));
  });

  await screen.findByText('Full body: eight movements');
  expect(asks()).toEqual([{ tz_offset_min: 0, context: null, revision: 'make it 8 exercises' }]);
  // One POST for the tap — no GET fired alongside it.
  expect(mockApi).toHaveBeenCalledTimes(2);
});

it('sends the first typed line as context, because there is no brief to revise yet', async () => {
  mockApi.mockRejectedValueOnce(new Error('The coach is unavailable right now.'));
  renderCoach();
  await screen.findByText('The coach is unavailable right now.');

  expect(screen.getByPlaceholderText('Only 30 minutes · knee hurts today')).toBeTruthy();

  mockApi.mockResolvedValue(next());
  fireEvent.changeText(screen.getByTestId('coach-context'), 'only 30 minutes');
  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-regenerate'));
  });

  await waitFor(() => expect(asks()).toHaveLength(1));
  expect(asks()[0]).toMatchObject({ context: 'only 30 minutes', revision: null });
});

it('keeps the brief on screen while a revision is running, and says it is working', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  let settle: (value: CoachNext) => void = () => {};
  mockApi.mockReturnValueOnce(new Promise<CoachNext>((resolve) => (settle = resolve)));
  fireEvent.changeText(screen.getByTestId('coach-context'), 'switch to legs');
  fireEvent.press(screen.getByTestId('coach-regenerate'));

  // Mid-flight: the answer the user is reading is still there.
  expect(await screen.findByTestId('coach-working')).toBeTruthy();
  expect(screen.getByText('Pull day: back and shoulders')).toBeTruthy();
  expect(screen.getByText('Lat Pulldown')).toBeTruthy();

  await act(async () => {
    settle(next({ brief: { ...next().brief, id: 'brief-3', headline: 'Leg day: quads and hamstrings' } }));
  });
  await screen.findByText('Leg day: quads and hamstrings');
  expect(screen.queryByTestId('coach-working')).toBeNull();
});

it('keeps the brief and prints the note when the revision could not be made', async () => {
  mockApi.mockResolvedValueOnce(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  mockApi.mockResolvedValueOnce(
    next({ stale: true, note: 'That change came back with nothing to do, twice — this is still your last brief.' }),
  );
  fireEvent.changeText(screen.getByTestId('coach-context'), 'make it 8 exercises');
  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-regenerate'));
  });

  expect(await screen.findByTestId('coach-note')).toBeTruthy();
  expect(screen.getByText(/still your last brief/)).toBeTruthy();
  // The brief is exactly where it was.
  expect(screen.getByText('Pull day: back and shoulders')).toBeTruthy();
  expect(screen.getByText('Lat Pulldown')).toBeTruthy();
});

it('keeps the brief and says so when the ask itself fails', async () => {
  mockApi.mockResolvedValueOnce(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  mockApi.mockRejectedValueOnce(new Error('Request failed (503).'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-regenerate'));
  });

  expect(await screen.findByText('Request failed (503).')).toBeTruthy();
  expect(screen.getByText('Pull day: back and shoulders')).toBeTruthy();
});

it('never draws an empty Do list without saying why', async () => {
  const empty = next();
  empty.brief.headline = 'Push day';
  empty.brief.workout = { type: 'strength', targets: ['chest'], exercises: [] };
  mockApi.mockResolvedValue(empty);
  renderCoach();

  await screen.findByText('Push day');
  expect(screen.getByTestId('coach-do-empty')).toHaveTextContent(/No exercises came back/);
});

it('draws a rest day as a rest day', async () => {
  const rest = next();
  rest.brief.headline = 'Rest — three days running';
  rest.brief.workout = { type: 'rest', targets: ['recovery'], exercises: [] };
  mockApi.mockResolvedValue(rest);
  renderCoach();

  await screen.findByText('Rest — three days running');
  expect(screen.getByTestId('coach-do-empty')).toHaveTextContent(/Rest today/);
});

it('routes the cold-start nudge to the Log sheet, where a statement is said', async () => {
  mockApi.mockResolvedValue(
    next({ nudge_action: { kind: 'tell_background', goal_id: null, label: 'Tell me your background' } }),
  );
  renderCoach();

  fireEvent.press(await screen.findByTestId('nudge-action'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { hint: 'statement' } });
});
