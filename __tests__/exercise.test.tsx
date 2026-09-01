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
// Three things have to hold. The screen is the right screen on the FIRST frame — title,
// eyebrow, video, and two photo skeletons of exactly the size the photographs will be — so
// nothing moves when the fetch lands. A catalogued exercise then draws its photographs, its
// muscles and its kit, and **no written steps**: they were dropped on 2026-08-31 (user
// decision), because four paragraphs of dataset prose is the last thing anybody reads on a
// phone in a gym and they sat where the pictures should be. And an exercise the catalogue
// has never heard of still opens with the form video working — that is every sport and most
// cardio machines, and it is why the video is a search rather than a link.

const mockApi = jest.fn();
jest.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  upload: jest.fn(),
  tzOffsetMin: () => 0,
  authHeaders: () => ({ Authorization: 'Bearer test' }),
  evidenceUrl: (id: string) => `http://test/api/evidence/${id}`,
  exerciseMediaUrl: (id: string, n: number, w?: number) =>
    `http://test/api/exercises/${id}/media/${n}${w ? `?w=${w}` : ''}`,
  SHEET_PHOTO_WIDTH: 640,
  THUMB_PHOTO_WIDTH: 320,
  API_URL: 'http://test',
  ApiError: class extends Error {},
  setUnauthorizedHandler: () => {},
}));

// `mock`-prefixed, because jest refuses a mock factory that closes over anything else.
const mockPush = jest.fn();
const mockParams: { id?: string; name?: string; date?: string; media?: string } = {};
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
  it('is the right screen on the first frame, with two skeletons the size of the photos', () => {
    mockParams.id = BENCH.id;
    mockParams.name = 'Bench Press';
    mockApi.mockReturnValue(new Promise(() => {}));

    renderWith(<ExerciseSheet />);

    // Everything that came with the tap, before anything has been fetched.
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByTestId('exercise-video')).toBeTruthy();
    expect(screen.getByTestId('exercise-photo-skeleton-0')).toBeTruthy();
    expect(screen.getByTestId('exercise-photo-skeleton-1')).toBeTruthy();
    // The tiles are the shape the photographs will be, so the sheet does not jump.
    expect(screen.getByTestId('exercise-photo-skeleton-0').props.style).toMatchObject({
      height: '100%',
    });
  });

  it('draws the two photos, the muscles and the kit — and no steps section at all', async () => {
    mockParams.id = BENCH.id;
    mockParams.name = 'Bench Press';
    mockApi.mockResolvedValue(BENCH);

    renderWith(<ExerciseSheet />);

    // The name is on screen before the fetch — it travelled with the tap.
    expect(screen.getByText('Bench Press')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('exercise-photo-0')).toBeTruthy());

    expect(mockApi).toHaveBeenCalledWith(`/api/exercises/${BENCH.id}`);
    expect(screen.getByText('strength · beginner')).toBeTruthy();
    expect(screen.getByText(/Also called bench, flat bench/)).toBeTruthy();

    // Dropped on 2026-08-31: no heading, no numbers, and none of the prose.
    expect(screen.queryByText('How to do it')).toBeNull();
    expect(screen.queryByTestId('exercise-step-0')).toBeNull();
    for (const step of BENCH.instructions) expect(screen.queryByText(step)).toBeNull();

    expect(screen.getByTestId('exercise-photo-1')).toBeTruthy();
    expect(screen.queryByTestId('exercise-photos-empty')).toBeNull();

    expect(screen.getByText('chest')).toBeTruthy();
    expect(screen.getByText('triceps')).toBeTruthy();
    expect(screen.getByText('Equipment · barbell, bench')).toBeTruthy();
    expect(screen.getByText(/free-exercise-db/)).toBeTruthy();
  });

  it('opens a photo full screen on a tap, and closes it again', async () => {
    mockParams.id = BENCH.id;
    mockParams.name = 'Bench Press';
    mockApi.mockResolvedValue(BENCH);

    renderWith(<ExerciseSheet />);
    await waitFor(() => expect(screen.getByTestId('exercise-photo-0')).toBeTruthy());
    expect(screen.queryByTestId('exercise-photo-zoom')).toBeNull();

    fireEvent.press(screen.getByTestId('exercise-photo-0'));
    await waitFor(() => expect(screen.getByTestId('exercise-photo-zoom')).toBeTruthy());

    fireEvent.press(screen.getByTestId('exercise-photo-zoom'));
    await waitFor(() => expect(screen.queryByTestId('exercise-photo-zoom')).toBeNull());
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
    // Straight to the empty state: there is nothing to load, so nothing pretends to.
    expect(screen.getByTestId('exercise-photos-empty')).toBeTruthy();
    expect(screen.queryByTestId('exercise-photo-skeleton-0')).toBeNull();

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


// ── instant open ─────────────────────────────────────────────────────────────────────
// Field report 2026-09-01, on one bar of cellular: the sheet's data and its two photos
// were three sequential round trips and the photos were the dataset's originals.

describe('the first frame', () => {
  it('draws exactly as many skeletons as the tap said there were photos', () => {
    mockParams.id = BENCH.id;
    mockParams.name = 'Bench Press';
    mockParams.media = '2';
    mockApi.mockReturnValue(new Promise(() => {}));

    renderWith(<ExerciseSheet />);
    expect(screen.getByTestId('exercise-photo-skeleton-0')).toBeTruthy();
    expect(screen.getByTestId('exercise-photo-skeleton-1')).toBeTruthy();
  });

  it('promises no photos at all when the tap said there are none', () => {
    mockParams.id = BENCH.id;
    mockParams.name = 'Doorway Chest Stretch';
    mockParams.media = '0';
    mockApi.mockReturnValue(new Promise(() => {}));

    renderWith(<ExerciseSheet />);
    // Straight to the empty state while the row is still in flight: two grey boxes that
    // turn out to be nothing is the small lie this parameter exists to stop telling.
    expect(screen.queryByTestId('exercise-photo-skeleton-0')).toBeNull();
    expect(screen.getByTestId('exercise-photos-empty')).toBeTruthy();
    // The title and the video are already right — the name travelled with the tap.
    expect(screen.getByText('Doorway Chest Stretch')).toBeTruthy();
    expect(screen.getByTestId('exercise-video')).toBeTruthy();
  });

  it('falls back to two skeletons when nobody said — an older server, or a link', () => {
    mockParams.id = BENCH.id;
    mockParams.name = 'Bench Press';
    mockApi.mockReturnValue(new Promise(() => {}));

    renderWith(<ExerciseSheet />);
    expect(screen.getByTestId('exercise-photo-skeleton-0')).toBeTruthy();
    expect(screen.getByTestId('exercise-photo-skeleton-1')).toBeTruthy();
  });

  it('draws a prefetched sheet with no skeleton and no request at all', async () => {
    mockParams.id = BENCH.id;
    mockParams.name = 'Bench Press';
    mockParams.media = '2';
    // What `usePrefetchExercises` and lib/exercise-cache.ts leave behind: the row already
    // in the query cache, `staleTime: Infinity`, so the screen never enters a loading
    // state and there is no spinner to see.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
    });
    client.setQueryData(['exercise', BENCH.id], BENCH);

    render(
      <QueryClientProvider client={client}>
        <ExerciseSheet />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('exercise-photo-skeleton-0')).toBeNull();
    expect(screen.getByTestId('exercise-photo-0')).toBeTruthy();
    expect(screen.getByText('chest')).toBeTruthy();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('asks for the photos at 640 and the full-screen zoom at full size', async () => {
    mockParams.id = BENCH.id;
    mockParams.name = 'Bench Press';
    mockApi.mockResolvedValue(BENCH);

    renderWith(<ExerciseSheet />);
    await waitFor(() => expect(screen.getByTestId('exercise-photo-0')).toBeTruthy());

    const tile = screen.getByTestId('exercise-photo-0').findByProps({ contentFit: 'cover' });
    expect(tile.props.source.uri).toBe(`http://test/api/exercises/${BENCH.id}/media/0?w=640`);

    fireEvent.press(screen.getByTestId('exercise-photo-0'));
    const zoom = await screen.findByTestId('exercise-photo-zoom');
    // The zoom is the one place the pixels are the point, so it asks for the original.
    expect(zoom.findByProps({ contentFit: 'contain' }).props.source.uri).toBe(
      `http://test/api/exercises/${BENCH.id}/media/0`,
    );
  });
});
