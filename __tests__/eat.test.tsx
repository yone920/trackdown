import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Eat from '@/app/(tabs)/eat';
import type { DayMeal, EatingView } from '@/lib/types';

// The Eat tab: four layers, and the order is the argument. Today's own numbers, the week
// COMPUTED, the direction WRITTEN, then the log. Facts are computed and advice is generated
// (concept-v2 §Principles 4) — so nothing in the middle layer may come out of a model, and
// the paragraph under it must never turn into a meal plan.

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
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

const MEAL: DayMeal = {
  id: 'm1',
  logged_at: '2026-09-01T12:30:00.000Z',
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

const macro = (eaten: number | null, target: number | null) => ({ eaten, target, note: null });

function view(over: Partial<EatingView> = {}): EatingView {
  return {
    date: '2026-09-01',
    today: {
      eaten: 480,
      target: 2400,
      allowance: 2865,
      remaining: 2385,
      status: 'on_track',
      macros: {
        protein_g: macro(32, 160),
        carbs_g: macro(40, 150),
        fat_g: macro(20, 70),
        fiber_g: macro(4, 25),
      },
      meals: [MEAL],
      eating_pattern: null,
    },
    week: {
      days: [],
      days_logged: 5,
      avg_kcal: 2050,
      protein: { avg_per_day: 118, target: 160, direction: 'at_least', source: 'stated' },
      carbs: { avg_per_day: 182, target: 150, direction: 'at_most', source: 'stated' },
      fat: { avg_per_day: 74, target: null, direction: 'at_least', source: 'none' },
      fiber: { avg_per_day: 16, target: 25, direction: 'at_least', source: 'guideline' },
      outliers: ['32 g over your carb aim on 2026-08-31'],
    },
    direction: {
      kind: 'eating_direction',
      text: 'Protein is the one to move — another 40 g a day across the meals you already eat.',
      next_action: null,
      actions: [],
      inputs_hash: 'abc',
      model: 'test',
      created_at: '2026-09-01T09:00:00.000Z',
    },
    ...over,
  } as EatingView;
}

function serve(data: unknown) {
  mockApi.mockImplementation((path: string) =>
    path === '/api/eating' ? Promise.resolve(data) : Promise.resolve(null),
  );
}

function renderEat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Eat />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
});

// User request 2026-09-02: "the train only shows today … there should be some sort of
// calendar so anyone can easily go back and see what they did last week or a specific day.
// Same for the eat." One sheet, opened from either header (components/calendar-sheet.tsx).
describe('the Eat header calendar', () => {
  it('offers a way back to any day, and opens the month on a tap', async () => {
    serve(view());
    renderEat();

    await waitFor(() => expect(screen.getByTestId('eat-calendar')).toBeTruthy());
    expect(screen.queryByTestId('calendar-grid')).toBeNull();

    fireEvent.press(screen.getByTestId('eat-calendar'));
    await waitFor(() => expect(screen.getByTestId('calendar-grid')).toBeTruthy());
    expect(screen.getByTestId('calendar-title')).toBeTruthy();
  });
});

describe('the Eat page', () => {
  it('reads the whole page from one request, and generates nothing by opening', async () => {
    serve(view());
    renderEat();

    await waitFor(() => expect(screen.getByTestId('eat-remaining')).toBeTruthy());
    // One GET. The direction is a cached reading, so opening the page writes nothing.
    expect(mockApi.mock.calls.filter(([path]) => path === '/api/eating')).toHaveLength(1);
    expect(mockApi.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  });

  it('leads with ONE authoritative figure — the day\'s own arithmetic', async () => {
    serve(view());
    renderEat();

    await waitFor(() => expect(screen.getByTestId('eat-remaining')).toHaveTextContent('2,385'));
    expect(screen.getByText('kcal left')).toBeTruthy();
  });

  it('says "over" rather than a negative number left', async () => {
    serve(view({ today: { ...view().today, eaten: 2574, remaining: -320 } }));
    renderEat();
    await waitFor(() => expect(screen.getByText('kcal over')).toBeTruthy());
    expect(screen.getByTestId('eat-remaining')).toHaveTextContent('320');
    expect(screen.getByTestId('eat-remaining')).not.toHaveTextContent('-');
  });

  it('draws the computed week against its targets, and says where each target came from', async () => {
    serve(view());
    renderEat();

    await waitFor(() => expect(screen.getByTestId('eat-week-days')).toHaveTextContent('5 of 7 days logged'));
    expect(screen.getByText('The week')).toBeTruthy();
    expect(screen.getByTestId('eat-week-Protein')).toHaveTextContent(/118 g/);
    expect(screen.getByTestId('eat-week-Protein')).toHaveTextContent(/160 g/);
    // A ceiling reads as a ceiling, a floor as a floor.
    expect(screen.getByTestId('eat-week-Protein')).toHaveTextContent(/≥/);
    expect(screen.getByTestId('eat-week-Carbs')).toHaveTextContent(/≤ 150 g/);
    // A guideline says it is standing in, so a default is never handed back as their aim.
    expect(screen.getByTestId('eat-week-Fibre')).toHaveTextContent(/guideline/);
    // And a macro nobody has a target for says so rather than inventing one.
    expect(screen.getByTestId('eat-week-Fat')).toHaveTextContent(/no target set/);
  });

  it('names what stood out, when something did', async () => {
    serve(view());
    renderEat();
    await waitFor(() => expect(screen.getByTestId('eat-outliers')).toBeTruthy());
    expect(screen.getByText(/32 g over your carb aim/)).toBeTruthy();
  });

  it('flags a thin week rather than passing two days off as a trend', async () => {
    serve(view({ week: { ...view().week, days_logged: 2 } }));
    renderEat();
    await waitFor(() => expect(screen.getByTestId('eat-week-days')).toHaveTextContent(/a thin week/));
  });

  it('draws the direction as a reading, and the food log under it', async () => {
    serve(view());
    renderEat();

    await waitFor(() => expect(screen.getByText('The direction')).toBeTruthy());
    expect(screen.getByText(/Protein is the one to move/)).toBeTruthy();
    expect(screen.getByText('eggs and toast')).toBeTruthy();
    expect(screen.getByText('Breakfast')).toBeTruthy();
  });

  it('opens a meal for correction and takes one back in two taps', async () => {
    serve(view());
    renderEat();
    await waitFor(() => expect(screen.getByText('eggs and toast')).toBeTruthy());

    fireEvent.press(screen.getByTestId('row-meal-m1'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/log',
      params: { editDate: expect.any(String), editId: 'm1', editKind: 'meal' },
    });
    // The ✕ is there, and one tap only arms it.
    expect(screen.getByTestId('row-meal-m1-delete')).toBeTruthy();
  });

  it('has no way to log anything on it — the + is the one door', async () => {
    serve(view());
    renderEat();
    await waitFor(() => expect(screen.getByTestId('eat-remaining')).toBeTruthy());
    expect(screen.queryByTestId('log-fab')).toBeNull();
    expect(screen.queryByPlaceholderText(/./)).toBeNull();
  });
});

describe('the Eat page with nothing on it', () => {
  it('says the plate is empty with a wink, and draws no zero macro rows', async () => {
    serve(
      view({
        today: { ...view().today, eaten: 0, meals: [], remaining: 2865 },
      }),
    );
    renderEat();

    await waitFor(() => expect(screen.getByTestId('eat-empty-today')).toBeTruthy());
    expect(screen.queryByTestId('macro-Protein')).toBeNull();
    expect(screen.getByTestId('eat-empty-log')).toBeTruthy();
  });

  it('explains the empty week instead of averaging zeros into it', async () => {
    serve(
      view({
        week: {
          days: [],
          days_logged: 0,
          avg_kcal: null,
          protein: { avg_per_day: null, target: null, direction: 'at_least', source: 'none' },
          carbs: { avg_per_day: null, target: null, direction: 'at_most', source: 'none' },
          fat: { avg_per_day: null, target: null, direction: 'at_least', source: 'none' },
          fiber: { avg_per_day: null, target: 25, direction: 'at_least', source: 'guideline' },
          outliers: [],
        },
        direction: null,
      }),
    );
    renderEat();

    await waitFor(() => expect(screen.getByTestId('eat-empty-week')).toBeTruthy());
    expect(screen.getByText(/left out of them rather than counted as a zero/)).toBeTruthy();
    // No paragraph invents a concern about a week that has not happened.
    expect(screen.queryByText('The direction')).toBeNull();
  });

  it('says there is no target rather than drawing a bar against nothing', async () => {
    serve(view({ today: { ...view().today, allowance: null, remaining: null } }));
    renderEat();
    await waitFor(() => expect(screen.getByText('no target set')).toBeTruthy());
  });
});
