import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Day from '@/app/day/[date]';
import { makeDay } from './fixtures';
import { C } from '@/lib/theme';

// The Day screen against a fixture day: the verdict, the reading, the three stats, and
// each of the four sections built from what `GET /api/day/:date` returned.

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
  useLocalSearchParams: () => ({ date: '2026-08-29' }),
}));

const CLOSED = makeDay({
  date: '2026-08-29',
  is_today: false,
  closed_at: '2026-08-30T00:05:00.000Z',
  verdict: 'served',
  verdict_words: 'Served your goal',
  verdict_why: '340 under your allowance',
  day_number: 11,
  goal: {
    id: 'g1',
    kind: 'lose_fat',
    title: 'Get to 170 lb',
    metrics: [],
    priority: 1,
    status: 'active',
    active_from: '2026-07-01',
    active_to: null,
  },
  reading: {
    kind: 'in_short',
    text: 'A solid push day and you stayed under the allowance.',
    next_action: null,
    actions: [],
    inputs_hash: 'x',
    model: 'test',
    created_at: '2026-08-30T00:05:00.000Z',
  },
  muscle_summary: [{ muscle: 'chest', sets: 6, exercises: ['Bench Press'] }],
  weight: { day: 181.4, avg_7d: 181.9, trend_per_week: -0.9 },
  items: {
    meals: [
      {
        id: 'm1',
        logged_at: '2026-08-29T12:30:00.000Z',
        description: 'chicken and rice',
        slot: 'lunch',
        stated_slot: null,
        kcal: 700,
        protein_g: 55,
        carbs_g: 70,
        fat_g: 18,
        fiber_g: 6,
        evidence: [],
      },
    ],
    activities: [
      {
        id: 'a1',
        logged_at: '2026-08-29T18:10:00.000Z',
        description: '3 × 8 bench at 135 lb',
        exercise: 'Bench Press',
        exercise_id: '11111111-2222-4333-8444-555555555555',
        equipment: null,
        category: 'strength',
        muscle_groups: ['chest'],
        sets: 3,
        reps: 8,
        load_lb: 135,
        duration_min: null,
        distance_mi: null,
        kcal: 120,
        source: 'manual',
        confidence: 'high',
        block_id: null,
        delta_vs_last: {
          text: '+5 lb',
          direction: 'up',
          field: 'load_lb',
          load_lb: 5,
          sets: null,
          reps: null,
          previous: { logged_at: '2026-08-22T18:00:00.000Z', load_lb: 130, sets: 3, reps: 8 },
        },
        evidence: [{ id: 'e1', kind: 'photo', mime: 'image/jpeg', width: 1280, height: 960 }],
      },
      {
        id: 'a2',
        logged_at: '2026-08-29T08:00:00.000Z',
        description: 'Morning walk',
        exercise: 'Walk',
        exercise_id: null,
        equipment: null,
        category: 'cardio',
        muscle_groups: [],
        sets: null,
        reps: null,
        load_lb: null,
        duration_min: 42,
        distance_mi: 2.1,
        kcal: 160,
        source: 'health',
        confidence: null,
        block_id: null,
        delta_vs_last: null,
        evidence: [],
      },
    ],
    weights: [],
  },
});

function renderDay() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Day />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  mockApi.mockImplementation((path: string) =>
    path.startsWith('/api/day/') ? Promise.resolve(CLOSED) : Promise.resolve(null),
  );
});

describe('Day', () => {
  it('asks for the date in the route, not for today', async () => {
    renderDay();
    await waitFor(() => expect(screen.getByText('Served your goal')).toBeTruthy());
    expect(mockApi).toHaveBeenCalledWith('/api/day/2026-08-29', expect.anything());
  });

  it('shows the verdict, the goal that was active and the day number', async () => {
    renderDay();
    await waitFor(() => expect(screen.getByText('Served your goal')).toBeTruthy());
    expect(screen.getByText(/340 under your allowance/)).toBeTruthy();
    expect(screen.getByText(/Goal · Get to 170 lb/)).toBeTruthy();
    expect(screen.getByText(/Day 11/)).toBeTruthy();
  });

  it('reads the In short paragraph and the three stats', async () => {
    renderDay();
    await waitFor(() => expect(screen.getByText('In short')).toBeTruthy());
    expect(screen.getByText(/solid push day/)).toBeTruthy();
    expect(screen.getByText('Eaten')).toBeTruthy();
    expect(screen.getByText('Earned')).toBeTruthy();
    expect(screen.getByText('Allowance')).toBeTruthy();
  });

  it('groups training by muscle group, with the delta and the evidence', async () => {
    renderDay();
    await waitFor(() => expect(screen.getByText('Training')).toBeTruthy());
    expect(screen.getByText('chest')).toBeTruthy();
    expect(screen.getByText('6 sets')).toBeTruthy();
    expect(screen.getByText('Bench Press')).toBeTruthy();
    expect(screen.getByText('3 × 8 · 135 lb')).toBeTruthy();
    expect(screen.getByText('+5 lb')).toBeTruthy();
  });

  it('colours the delta by whether it was progress, not by which way the number went', async () => {
    // The field report at the end of its journey: on an assisted machine the load is the
    // help the machine gives, so "-5 lb" is five pounds less help and reads green.
    const assisted = JSON.parse(JSON.stringify(CLOSED)) as typeof CLOSED;
    const lift = assisted.items.activities[0]!;
    lift.exercise = 'Assisted Chin-Up';
    lift.load_lb = 50;
    lift.delta_vs_last = {
      text: '-5 lb',
      direction: 'down',
      sentiment: 'good',
      field: 'load_lb',
      load_lb: -5,
      sets: null,
      reps: null,
      previous: { logged_at: '2026-08-22T18:00:00.000Z', load_lb: 55, sets: 3, reps: 8 },
    };
    mockApi.mockImplementation((path: string) =>
      path.startsWith('/api/day/') ? Promise.resolve(assisted) : Promise.resolve(null),
    );

    renderDay();
    await waitFor(() => expect(screen.getByText('-5 lb')).toBeTruthy());
    const style = screen.getByText('-5 lb').props.style as unknown[];
    expect(JSON.stringify(style)).toContain(C.good);

    // The same text with the resistance reading is the one to look at, not the good news.
    lift.delta_vs_last.sentiment = 'watch';
    screen.unmount();
    renderDay();
    await waitFor(() => expect(screen.getByText('-5 lb')).toBeTruthy());
    expect(JSON.stringify(screen.getByText('-5 lb').props.style)).toContain(C.accent);
  });

  it('keeps a Health row out of the muscle groups and badges it instead', async () => {
    renderDay();
    await waitFor(() => expect(screen.getByText('Health')).toBeTruthy());
    expect(screen.getByText(/160 kcal from Health/)).toBeTruthy();
  });

  it('shows eating as macros against targets, the pattern line and the meals by slot', async () => {
    renderDay();
    await waitFor(() => expect(screen.getByText('Eating')).toBeTruthy());
    expect(screen.getByText('Protein')).toBeTruthy();
    expect(screen.getByText('120 of 160 g · under')).toBeTruthy();
    expect(screen.getByText(/Back-loaded/)).toBeTruthy();
    expect(screen.getByText('Lunch')).toBeTruthy();
    expect(screen.getByText('chicken and rice')).toBeTruthy();
  });

  // The field report (2026-08-31): after the profile was wiped the protein, carb and fat
  // bars all drew a full-width empty groove — grams ÷ a target nobody set is a zero-width
  // fill, which reads as broken rather than as unset.
  describe('a macro with no target', () => {
    const withMacros = (macros: Partial<(typeof CLOSED)['macros']>) => {
      const day = JSON.parse(JSON.stringify(CLOSED)) as typeof CLOSED;
      day.macros = { ...day.macros, ...macros };
      mockApi.mockImplementation((path: string) =>
        path.startsWith('/api/day/') ? Promise.resolve(day) : Promise.resolve(null),
      );
    };

    it('draws the bar as it always did when a target exists', async () => {
      withMacros({
        protein_g: { eaten: 120, target: 160, note: 'under' },
        carbs_g: { eaten: 130, target: 200, note: 'under' },
        fat_g: { eaten: 55, target: 70, note: 'under' },
      });
      renderDay();
      await waitFor(() => expect(screen.getByText('Protein')).toBeTruthy());
      expect(screen.getByTestId('macro-track-Protein')).toBeTruthy();
      expect(screen.getByTestId('macro-track-Carbs')).toBeTruthy();
      expect(screen.queryByTestId('macro-hint')).toBeNull();
    });

    it('draws no track at all, and says why once, when nothing is set', async () => {
      withMacros({
        protein_g: { eaten: 120, target: null, note: null },
        carbs_g: { eaten: 130, target: null, note: null },
        fat_g: { eaten: 55, target: null, note: null },
      });
      renderDay();
      await waitFor(() => expect(screen.getByText('Protein')).toBeTruthy());
      expect(screen.queryByTestId('macro-track-Protein')).toBeNull();
      expect(screen.queryByTestId('macro-track-Carbs')).toBeNull();
      expect(screen.queryByTestId('macro-track-Fat')).toBeNull();
      // The grams are still drawn: they are measured.
      expect(screen.getByText('120 g')).toBeTruthy();
      expect(screen.getByTestId('macro-hint').props.children).toBe(
        'No targets set — tell me your protein and carb aims and these become bars.',
      );
    });

    it('mixes: the one with a target keeps its bar, and the line names the rest', async () => {
      withMacros({
        protein_g: { eaten: 120, target: 160, note: 'under' },
        carbs_g: { eaten: 130, target: null, note: null },
        fat_g: { eaten: 55, target: null, note: null },
      });
      renderDay();
      await waitFor(() => expect(screen.getByText('Protein')).toBeTruthy());
      expect(screen.getByTestId('macro-track-Protein')).toBeTruthy();
      expect(screen.queryByTestId('macro-track-Carbs')).toBeNull();
      expect(screen.getByTestId('macro-hint').props.children).toBe(
        'No target for carbs and fat — tell me what you are aiming for and these become bars.',
      );
    });
  });

  it('shows the body numbers and the footer', async () => {
    renderDay();
    await waitFor(() => expect(screen.getByText('Body')).toBeTruthy());
    expect(screen.getByText('7-day avg')).toBeTruthy();
    expect(screen.getByText('181.9')).toBeTruthy();
    expect(screen.getByTestId('open-day-log')).toBeTruthy();
    expect(screen.getByTestId('export-day')).toBeTruthy();
  });

  it('opens a row of a closed day for correction, dated that day and not today', async () => {
    renderDay();
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());
    fireEvent.press(screen.getByTestId('row-activity-a1-open'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/log',
      params: { editDate: '2026-08-29', editId: 'a1', editKind: 'activity' },
    });

    mockPush.mockReset();
    fireEvent.press(screen.getByTestId('row-meal-m1-open'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/log',
      params: { editDate: '2026-08-29', editId: 'm1', editKind: 'meal' },
    });
  });

  it('deletes a lift and a meal from a closed day, asking in the row first', async () => {
    renderDay();
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());

    fireEvent.press(screen.getByTestId('row-activity-a1-delete'));
    expect(screen.getByText('Delete?')).toBeTruthy();
    fireEvent.press(screen.getByTestId('row-activity-a1-delete-confirm'));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('/api/entries/movement/a1', { method: 'DELETE' }),
    );

    fireEvent.press(screen.getByTestId('row-meal-m1-delete'));
    fireEvent.press(screen.getByTestId('row-meal-m1-delete-confirm'));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('/api/entries/meals/m1', { method: 'DELETE' }),
    );
  });
});
