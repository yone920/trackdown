import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

import ExerciseSheet from '@/app/exercise/[id]';
import Day from '@/app/day/[date]';
import { formVideoUrl } from '@/lib/exercise';
import type { ExerciseSheet as ExerciseSheetView } from '@/lib/types';
import { makeDay } from './fixtures';

// The exercise sheet, and the tap that opens it.
//
// Two things have to hold. A catalogued exercise draws its photos, its numbered steps,
// its muscles and its kit. An exercise the catalogue has never heard of still opens, with
// the form video working — that is every sport and most cardio machines, and it is why
// the video is a search rather than a link.

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

// `mock`-prefixed, because jest refuses a mock factory that closes over anything else.
const mockPush = jest.fn();
const mockParams: { id?: string; name?: string; date?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => mockParams,
}));

const BENCH: ExerciseSheetView = {
  id: '11111111-2222-4333-8444-555555555555',
  name: 'Bench Press',
  aliases: ['bench', 'flat bench'],
  category: 'strength',
  primary_muscles: ['chest'],
  secondary_muscles: ['triceps', 'shoulders'],
  equipment: ['barbell', 'bench'],
  instructions: [
    'Lie back on a flat bench holding the bar with a medium grip.',
    'Lower the bar to your middle chest.',
    'Press it back to the start.',
  ],
  level: 'beginner',
  media: [
    { index: 0, url: '/api/exercises/11111111-2222-4333-8444-555555555555/media/0' },
    { index: 1, url: '/api/exercises/11111111-2222-4333-8444-555555555555/media/1' },
  ],
  source: { dataset: 'free-exercise-db', slug: 'Barbell_Bench_Press_-_Medium_Grip' },
};

function renderWith(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  for (const key of Object.keys(mockParams)) delete (mockParams as Record<string, unknown>)[key];
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the exercise sheet', () => {
  it('draws the two photos, the numbered steps, the muscles and the kit', async () => {
    mockParams.id = BENCH.id;
    mockParams.name = 'Bench Press';
    mockApi.mockResolvedValue(BENCH);

    renderWith(<ExerciseSheet />);

    // The name is on screen before the fetch — it travelled with the tap.
    expect(screen.getByText('Bench Press')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('exercise-step-0')).toBeTruthy());

    expect(mockApi).toHaveBeenCalledWith(`/api/exercises/${BENCH.id}`);
    expect(screen.getByText('strength · beginner')).toBeTruthy();
    expect(screen.getByText(/Also called bench, flat bench/)).toBeTruthy();

    // Every step, numbered, in order.
    for (const [index, step] of BENCH.instructions.entries()) {
      expect(screen.getByTestId(`exercise-step-${index}`)).toBeTruthy();
      expect(screen.getByText(step)).toBeTruthy();
      expect(screen.getByText(String(index + 1))).toBeTruthy();
    }

    expect(screen.getByTestId('exercise-photo-0')).toBeTruthy();
    expect(screen.getByTestId('exercise-photo-1')).toBeTruthy();
    expect(screen.queryByTestId('exercise-photos-empty')).toBeNull();

    expect(screen.getByText('chest')).toBeTruthy();
    expect(screen.getByText('triceps')).toBeTruthy();
    expect(screen.getByText('Equipment · barbell, bench')).toBeTruthy();
    expect(screen.getByText(/free-exercise-db/)).toBeTruthy();
  });

  it('builds the form video as a search for the name', async () => {
    mockParams.id = BENCH.id;
    mockParams.name = 'Bench Press';
    mockApi.mockResolvedValue(BENCH);

    renderWith(<ExerciseSheet />);
    fireEvent.press(screen.getByTestId('exercise-video'));

    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://www.youtube.com/results?search_query=Bench+Press+proper+form',
    );
  });

  it('escapes a name that would break the query', () => {
    expect(formVideoUrl("Farmer's Carry & Sled Push")).toBe(
      "https://www.youtube.com/results?search_query=Farmer's+Carry+%26+Sled+Push+proper+form",
    );
  });

  it('falls back to name-only for an exercise that is not in the catalogue', async () => {
    mockParams.id = 'unknown';
    mockParams.name = 'Pickleball';

    renderWith(<ExerciseSheet />);

    // No id, so nothing is fetched — a request that can only 404 is not worth making.
    expect(mockApi).not.toHaveBeenCalled();
    expect(screen.getByText('Pickleball')).toBeTruthy();
    expect(screen.getByTestId('exercise-photos-empty')).toBeTruthy();
    expect(screen.getByText(/No written steps/)).toBeTruthy();

    // The video still works: it is a search, not a lookup.
    fireEvent.press(screen.getByTestId('exercise-video'));
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://www.youtube.com/results?search_query=Pickleball+proper+form',
    );
  });

  it('shows no photos when the catalogue row has none', async () => {
    mockParams.id = BENCH.id;
    mockParams.name = 'Yoga';
    mockApi.mockResolvedValue({ ...BENCH, name: 'Yoga', instructions: [], media: [], source: null });

    renderWith(<ExerciseSheet />);
    await waitFor(() => expect(screen.getByText('No photos for this one')).toBeTruthy());
    expect(screen.getByTestId('exercise-photos-empty')).toBeTruthy();
    expect(screen.getByText(/No written steps/)).toBeTruthy();
  });
});

describe('opening it from a screen', () => {
  it('navigates by the id the server resolved, not by the name', async () => {
    mockParams.date = '2026-08-29';
    mockApi.mockImplementation((path: string) =>
      path.startsWith('/api/day/')
        ? Promise.resolve(
            makeDay({
              date: '2026-08-29',
              is_today: false,
              muscle_summary: [{ muscle: 'chest', sets: 6, exercises: ['Bench Press'] }],
              items: {
                meals: [],
                weights: [],
                activities: [
                  {
                    id: 'a1',
                    logged_at: '2026-08-29T18:10:00.000Z',
                    description: '3 × 8 bench at 135 lb',
                    exercise: 'Bench Press',
                    exercise_id: BENCH.id,
                    equipment: null,
                    category: 'strength',
                    muscle_groups: ['chest'],
                    sets: 3,
                    reps: 8,
                    load_lb: 135,
                    duration_min: null,
                    distance_mi: null,
                    kcal: 120,
                    source: 'fused',
                    confidence: 'high',
                    block_id: null,
                    delta_vs_last: null,
                    evidence: [],
                  },
                ],
              },
            }),
          )
        : Promise.resolve(null),
    );

    renderWith(<Day />);
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());
    fireEvent.press(screen.getByText('Bench Press'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/exercise/[id]',
      params: { id: BENCH.id, name: 'Bench Press' },
    });
  });
});
