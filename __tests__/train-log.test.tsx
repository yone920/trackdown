import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import TrainingLog from '@/app/train/log';
import { clock } from '@/lib/format';
import type { DayActivity, DayMeal } from '@/lib/types';
import { makeDay } from './fixtures';

// The training log Today hides behind a door on a no-plan day. Everything the rows could
// do on Today they still do here — the grouping, the deletes, the corrections, the names.
//
// The eating half moved to the Eat tab (user decision 2026-09-01) and is tested there.

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
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({}),
}));

/** One logged exercise. */
function lift(overrides: Partial<DayActivity> = {}): DayActivity {
  return {
    id: 'a1',
    logged_at: '2026-08-30T08:10:00.000Z',
    description: '3 × 8 bench at 135 lb',
    exercise: 'Bench Press',
    exercise_id: 'ex-bench',
    media_count: 0,
    equipment: null,
    category: 'strength',
    muscle_groups: ['chest'],
    sets: 3,
    reps: 8,
    load_lb: 135,
    duration_min: null,
    distance_mi: null,
    kcal: 264,
    source: 'manual',
    confidence: 'high',
    block_id: 'b1',
    delta_vs_last: null,
    evidence: [],
    ...overrides,
  };
}

const MEAL: DayMeal = {
  id: 'm1',
  logged_at: '2026-08-30T07:30:00.000Z',
  description: 'eggs and toast',
  slot: 'breakfast',
  stated_slot: null,
  kcal: 480,
  protein_g: 32,
  carbs_g: 40,
  fat_g: 20,
  fiber_g: 4,
  evidence: [],
};

function serve({ day = makeDay() }: { day?: unknown } = {}) {
  mockApi.mockImplementation((path: string) => {
    if (path.startsWith('/api/day/')) return Promise.resolve(day);
    return Promise.resolve(null);
  });
}

function wrap(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const renderTraining = () => wrap(<TrainingLog />);

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  serve();
});

describe('The Done log — grouped the way the closed Day groups it', () => {
  // User decision 2026-09-01: Today is the only page for the open day, and it files
  // training the way Day does — Cardio first with its minutes, then muscle headings with
  // set counts. It used to group by auto-block, so the same workout read two ways.

  const PRESS = lift({ id: 'a1', exercise: 'Bench Press', muscle_groups: ['chest', 'triceps'] });
  const WALK = lift({
    id: 'a2',
    exercise: 'Incline Treadmill Walk',
    description: 'Incline treadmill walk',
    category: 'cardio',
    muscle_groups: ['calves', 'glutes'],
    duration_min: 17,
    sets: null,
    reps: null,
    load_lb: null,
    logged_at: '2026-08-30T08:35:00.000Z',
    kcal: 146,
  });
  const BIKE = lift({
    id: 'a4',
    exercise: 'Stationary Bike',
    description: 'Stationary bike',
    category: 'cardio',
    muscle_groups: [],
    duration_min: 23,
    sets: null,
    reps: null,
    load_lb: null,
    logged_at: '2026-08-30T08:20:00.000Z',
    kcal: 120,
  });
  const YOGA = lift({
    id: 'a3',
    exercise: 'Yoga class',
    description: 'Yoga class',
    category: null,
    muscle_groups: [],
    sets: null,
    reps: null,
    load_lb: null,
    kcal: 0,
  });

  function serveTraining(activities: DayActivity[], muscles: { muscle: string; sets: number }[]) {
    serve({
      day: makeDay({
        earned: 410,
        items: { meals: [], weights: [], activities },
        muscle_summary: muscles.map((group) => ({ ...group, exercises: [] })),
      }),
    });
  }

  it('draws Cardio first with its minutes, then the muscle groups with their set counts', async () => {
    serveTraining([PRESS, WALK, BIKE], [{ muscle: 'chest', sets: 6 }]);
    renderTraining();

    await waitFor(() => expect(screen.getByText('Cardio')).toBeTruthy());
    // The heading carries the day's cardio TOTAL — 17 + 23 — which no single row prints.
    expect(screen.getByText('40 min')).toBeTruthy();
    expect(screen.getByText('chest')).toBeTruthy();
    expect(screen.getByText('6 sets')).toBeTruthy();
    expect(screen.getByText('Bench Press')).toBeTruthy();
  });

  it('draws a logged cardio activity once, under Cardio, never under its muscle tags', async () => {
    // The same regression the Day page carries (field report 2026-09-01: one treadmill
    // walk drawn under both "calves" and "glutes").
    serveTraining(
      [PRESS, WALK],
      [
        { muscle: 'chest', sets: 6 },
        { muscle: 'calves', sets: 0 },
        { muscle: 'glutes', sets: 0 },
      ],
    );
    renderTraining();

    await waitFor(() => expect(screen.getByText('Cardio')).toBeTruthy());
    expect(screen.getAllByText('Incline Treadmill Walk')).toHaveLength(1);
    expect(screen.queryByText('calves')).toBeNull();
    expect(screen.queryByText('glutes')).toBeNull();
  });

  it('files a lift under the FIRST heading that claims it, and not under both', async () => {
    serveTraining(
      [PRESS],
      [
        { muscle: 'chest', sets: 6 },
        { muscle: 'triceps', sets: 6 },
      ],
    );
    renderTraining();

    await waitFor(() => expect(screen.getByText('chest')).toBeTruthy());
    expect(screen.getAllByText('Bench Press')).toHaveLength(1);
    expect(screen.queryByText('triceps')).toBeNull();
  });

  it('puts a movement no heading knows under "Also" rather than losing it', async () => {
    serveTraining([PRESS, YOGA], [{ muscle: 'chest', sets: 6 }]);
    renderTraining();

    await waitFor(() => expect(screen.getByText('Also')).toBeTruthy());
    expect(screen.getByText('Yoga class')).toBeTruthy();
  });

  it('keeps the session span as a note on the header, not as the grouping', async () => {
    // When a workout happened is a fact about it, not a way to file it. The block titles
    // that used to be the headings are gone.
    serveTraining([PRESS, WALK], [{ muscle: 'chest', sets: 6 }]);
    renderTraining();

    const span = `${clock(PRESS.logged_at)}–${clock(WALK.logged_at)}`;
    await waitFor(() => expect(screen.getByText(new RegExp(span))).toBeTruthy());
  });
});
describe('The Done log — a row never repeats itself', () => {
  const lift = (over: Partial<DayActivity>): DayActivity => ({
    id: 'a9',
    logged_at: '2026-08-30T08:10:00.000Z',
    description: '4 × 15 lat pulldown at 60 lb',
    exercise: 'Lat Pulldown',
    exercise_id: null,
    equipment: null,
    category: 'strength',
    muscle_groups: ['lats'],
    sets: 4,
    reps: 15,
    load_lb: 60,
    duration_min: null,
    distance_mi: null,
    kcal: 90,
    source: 'manual',
    confidence: 'high',
    block_id: null,
    delta_vs_last: null,
    evidence: [],
    ...over,
  });

  const show = (activity: DayActivity) => {
    serve({ day: makeDay({ items: { meals: [], activities: [activity], weights: [] }, earned: 90 }) });
    renderTraining();
  };

  it('prints the facts once, and not the sentence they came from', async () => {
    show(lift({}));
    await waitFor(() => expect(screen.getByText('Lat Pulldown')).toBeTruthy());
    expect(screen.getByText('4 × 15 · 60 lb')).toBeTruthy();
    expect(screen.queryByText('4 × 15 lat pulldown at 60 lb')).toBeNull();
  });

  it('keeps the words when they carry something the fields cannot', async () => {
    show(lift({ description: '4 × 15 lat pulldown at 60 lb, last set was ugly' }));
    await waitFor(() => expect(screen.getByText('Lat Pulldown')).toBeTruthy());
    expect(screen.getByText(/last set was ugly/)).toBeTruthy();
  });
});
describe("The Done log's exercise names", () => {
  const NAMELESS: DayActivity = {
    id: 'a9',
    logged_at: '2026-08-30T09:00:00.000Z',
    description: 'that inclined machine I lay on my tummy for',
    exercise: null,
    exercise_id: null,
    media_count: 0,
    equipment: 'chest-supported row machine',
    category: 'strength',
    muscle_groups: ['back'],
    sets: 3,
    reps: 12,
    load_lb: 45,
    duration_min: null,
    distance_mi: null,
    kcal: 90,
    source: 'fused',
    confidence: 'low',
    block_id: null,
    delta_vs_last: null,
    evidence: [],
  };

  function serveActivities(activities: DayActivity[]) {
    mockApi.mockImplementation((path: string) => {
      if (path.startsWith('/api/day/')) {
        return Promise.resolve(
          makeDay({ blocks: [], earned: 90, eaten: 0, items: { meals: [], activities, weights: [] } }),
        );
      }
      return Promise.resolve(null);
    });
  }

  beforeEach(() => {
    mockApi.mockReset();
    mockPush.mockReset();
  });

  it('opens a row the catalogue never resolved, by its own description', async () => {
    serveActivities([NAMELESS]);
    renderTraining();
    await waitFor(() =>
      expect(screen.getByText('that inclined machine I lay on my tummy for')).toBeTruthy(),
    );

    fireEvent.press(screen.getByText('that inclined machine I lay on my tummy for'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/exercise/[id]',
      params: {
        id: 'unknown',
        name: 'that inclined machine I lay on my tummy for',
        media: '0',
      },
    });
  });

  it('draws the glyph on the row that has pictures and not on the one that does not', async () => {
    serveActivities([
      {
        ...NAMELESS,
        id: 'a8',
        exercise: 'Bench Press',
        exercise_id: 'ex-bench',
        media_count: 2,
        description: '3 × 8 bench at 135 lb',
      },
      NAMELESS,
    ]);
    renderTraining();
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());

    expect(screen.getByTestId('row-activity-a8-photo')).toBeTruthy();
    expect(screen.queryByTestId('row-activity-a9-photo')).toBeNull();
  });
});

describe('taking something back, from the log it is in', () => {
  /** The API before and after the row is gone, the way the server behaves. */
  function serveDeletable() {
    const calls: { path: string; method?: string }[] = [];
    let gone = false;
    mockApi.mockImplementation((path: string, options?: { method?: string }) => {
      calls.push({ path, method: options?.method });
      if (options?.method === 'DELETE') {
        gone = true;
        return Promise.resolve(undefined);
      }
      if (path.startsWith('/api/day/')) {
        return Promise.resolve(
          gone
            ? makeDay({ earned: 0, eaten: 0, items: { meals: [], activities: [], weights: [] } })
            : makeDay({
                earned: 264,
                eaten: 480,
                items: { meals: [MEAL], activities: [lift()], weights: [] },
              }),
        );
      }
      return Promise.resolve(null);
    });
    return calls;
  }

  it('deletes a logged exercise in two taps and the totals follow', async () => {
    const calls = serveDeletable();
    renderTraining();
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());

    // One tap arms, and asks in the row itself.
    fireEvent.press(screen.getByTestId('row-activity-a1-delete'));
    expect(screen.getByText('Delete?')).toBeTruthy();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    fireEvent.press(screen.getByTestId('row-activity-a1-delete-confirm'));
    await waitFor(() => expect(screen.getByTestId('training-log-empty')).toBeTruthy());

    expect(calls).toContainEqual({ path: '/api/entries/movement/a1', method: 'DELETE' });
    expect(screen.queryByText('Bench Press')).toBeNull();
  });


  it('opens a training row for correction, dated today', async () => {
    serve({ day: makeDay({ items: { meals: [], activities: [lift()], weights: [] } }) });
    renderTraining();
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());

    fireEvent.press(screen.getByTestId('row-activity-a1'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/log',
      params: { editDate: expect.any(String), editId: 'a1', editKind: 'activity' },
    });
  });



});
