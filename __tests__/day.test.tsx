import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Day from '@/app/day/[date]';
import { makeDay } from './fixtures';
import { C } from '@/lib/theme';

// The Day screen against a fixture day: the verdict, the reading, the Earned stat, and
// each of the sections built from what `GET /api/day/:date` returned.

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
  verdict_why: 'Trained today.',
  day_number: 11,
  goal: {
    id: 'g1',
    kind: 'custom',
    title: 'Get to 170 lb',
    metrics: [],
    priority: 1,
    status: 'active',
    active_from: '2026-07-01',
    active_to: null,
  },
  reading: {
    kind: 'in_short',
    text: 'A solid push day, chest and triceps, with a weigh-in this morning.',
    next_action: null,
    actions: [],
    inputs_hash: 'x',
    model: 'test',
    created_at: '2026-08-30T00:05:00.000Z',
  },
  muscle_summary: [{ muscle: 'chest', sets: 6, exercises: ['Bench Press'] }],
  weight: { day: 181.4, avg_7d: 181.9, trend_per_week: -0.9 },
  items: {
    activities: [
      {
        id: 'a1',
        logged_at: '2026-08-29T18:10:00.000Z',
        description: '3 × 8 bench at 135 lb',
        exercise: 'Bench Press',
        exercise_id: '11111111-2222-4333-8444-555555555555',
        media_count: 2,
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
    expect(screen.getByText(/Trained today/)).toBeTruthy();
    expect(screen.getByText(/Goal · Get to 170 lb/)).toBeTruthy();
    expect(screen.getByText(/Day 11/)).toBeTruthy();
  });

  it('reads the In short paragraph and the Earned stat', async () => {
    renderDay();
    await waitFor(() => expect(screen.getByText('In short')).toBeTruthy());
    expect(screen.getByText(/solid push day/)).toBeTruthy();
    expect(screen.getByText('Earned')).toBeTruthy();
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

  it('draws a logged cardio activity once, under Cardio, never under its muscle tags', async () => {
    // Field report 2026-09-01: one treadmill walk was drawn twice — once under "calves"
    // and once under "glutes" — because the muscle fan-out drew an activity under every
    // heading it touched. Cardio's muscle tags credit the body map; they do not file it.
    const walked = JSON.parse(JSON.stringify(CLOSED)) as typeof CLOSED;
    walked.items.activities.push({
      ...walked.items.activities[1]!,
      id: 'a3',
      description: 'Incline treadmill walk',
      exercise: 'Incline Treadmill Walk',
      muscle_groups: ['calves', 'glutes'],
      duration_min: 17,
      kcal: 146,
      source: 'manual',
    });
    walked.muscle_summary = [
      ...walked.muscle_summary,
      { muscle: 'calves', sets: 0, exercises: [] },
      { muscle: 'glutes', sets: 0, exercises: [] },
    ];
    mockApi.mockImplementation((path: string) =>
      path.startsWith('/api/day/') ? Promise.resolve(walked) : Promise.resolve(null),
    );

    renderDay();
    await waitFor(() => expect(screen.getByText('Training')).toBeTruthy());
    expect(screen.getAllByText('Incline Treadmill Walk')).toHaveLength(1);
    expect(screen.getByText('Cardio')).toBeTruthy();
    expect(screen.getByText('17 min')).toBeTruthy();
    // The strength lift still files under its muscle; the cardio-only muscles draw no heading.
    expect(screen.getByText('chest')).toBeTruthy();
    expect(screen.queryByText('calves')).toBeNull();
    expect(screen.queryByText('glutes')).toBeNull();
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
  });

  it('deletes a lift from a closed day, asking in the row first', async () => {
    renderDay();
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());

    fireEvent.press(screen.getByTestId('row-activity-a1-delete'));
    expect(screen.getByText('Delete?')).toBeTruthy();
    fireEvent.press(screen.getByTestId('row-activity-a1-delete-confirm'));
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('/api/entries/movement/a1', { method: 'DELETE' }),
    );
  });
});

// ── the exercise name, on Day ────────────────────────────────────────────────────────
// Field report 2026-09-01.

describe('the names on a Day', () => {
  beforeEach(() => {
    mockApi.mockReset();
    mockPush.mockReset();
    mockApi.mockImplementation((path: string) =>
      path.startsWith('/api/day/') ? Promise.resolve(CLOSED) : Promise.resolve(null),
    );
  });

  it('takes its photo count with it into the sheet, and draws the glyph beside the name', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
        <Day />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('Bench Press')).toBeTruthy());

    expect(screen.getByTestId('row-activity-a1-photo')).toBeTruthy();
    fireEvent.press(screen.getByText('Bench Press'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/exercise/[id]',
      params: {
        id: '11111111-2222-4333-8444-555555555555',
        name: 'Bench Press',
        media: '2',
      },
    });
  });
});
