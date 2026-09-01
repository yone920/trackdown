import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import Coach from '@/app/coach';
import type { CoachBrief, CoachNext } from '@/lib/types';

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
  exerciseMediaUrl: (id: string, n: number, w?: number) =>
    `http://test/api/exercises/${id}/media/${n}${w ? `?w=${w}` : ''}`,
  SHEET_PHOTO_WIDTH: 640,
  THUMB_PHOTO_WIDTH: 320,
  API_URL: 'http://test',
  ApiError: class extends Error {},
  setUnauthorizedHandler: () => {},
}));

// `mock`-prefixed so jest lets the factory close over it: the prefetch is fire-and-forget
// and the only way to see it happen is to watch the call.
const mockPrefetch = jest.fn(async (_url: string, _options?: unknown) => true);
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: Object.assign(View, { prefetch: (url: string, options?: unknown) => mockPrefetch(url, options) }) };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
}));

/**
 * A response with a brief in it. `CoachNext.brief` is nullable now — the page load can
 * legitimately answer "no plan today" — so the fixture narrows it back for the tests that
 * are about a brief being on screen. The null case has its own tests, below.
 */
function next(overrides: Partial<CoachNext> = {}): CoachNext & { brief: CoachBrief } {
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
            exercise_id: LAT_PULLDOWN_ID,
            media_count: 2,
            load_lb: 110,
            sets: 3,
            reps: 10,
            minutes: null,
            note: null,
          },
          {
            // A movement the catalogue knows and has no picture of: tappable, no glyph.
            name: 'Farmer Carry',
            exercise_id: FARMER_CARRY_ID,
            media_count: 0,
            load_lb: 50,
            sets: 3,
            reps: null,
            minutes: null,
            note: null,
          },
        ],
        // The stretch nobody catalogued. It was a dead row until 2026-09-01.
        finisher: [
          { name: 'Doorway Chest Stretch', minutes: 2, note: 'Both sides.', exercise_id: null, media_count: 0 },
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
  } as CoachNext & { brief: CoachBrief };
}

const LAT_PULLDOWN_ID = '11111111-2222-4333-8444-555555555555';
const FARMER_CARRY_ID = '22222222-3333-4444-8555-666666666666';

function renderCoach() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <Coach />
    </QueryClientProvider>,
  );
}

/**
 * Calls to `api()` that were about the coach. The catalogue prefetch (lib/queries.ts
 * §usePrefetchExercises) also goes through `api`, and it is deliberately not counted here:
 * these tests are about how many times the coach is *asked*, and warming an exercise sheet
 * is not asking the coach anything.
 */
function coachCalls(): [string, Record<string, unknown> | undefined][] {
  return mockApi.mock.calls.filter(([path]: [string]) => path.startsWith('/api/coach/'));
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
  mockPrefetch.mockClear();
});

it('asks once on open and draws the brief', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();

  expect(await screen.findByText('Pull day: back and shoulders')).toBeTruthy();
  expect(screen.getByText('Lat Pulldown')).toBeTruthy();
  // One GET, and nothing else: the coach is a button.
  expect(coachCalls()).toHaveLength(1);
  expect(coachCalls()[0]?.[0]).toBe('/api/coach/next');
  // And that GET may not generate. Opening a page is not asking a question (user decision
  // 2026-08-31 §2) — this flag is the whole of the promise.
  expect(coachCalls()[0]?.[1]?.query).toMatchObject({ generate: false });
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
  // No `mode`: the box does not pretend to know whether this adds to the plan or replaces
  // it — the server asks the model, whose default there is to add.
  expect(asks()).toEqual([
    { tz_offset_min: 0, context: null, revision: 'make it 8 exercises', mode: null },
  ]);
  // One POST for the tap — no GET fired alongside it.
  expect(coachCalls()).toHaveLength(2);
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
  fireEvent.changeText(screen.getByTestId('coach-context'), 'harder');
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

// ── The plan, ticked off ─────────────────────────────────────────────────────────────
// The brief is a plan for the day and stays on screen all day (user decision 2026-08-31
// §A). Nothing here is a verdict: a done item is dimmed and kept, a half-done one says how
// far in it is, and a finished plan says so above a list that is still complete.

function planned(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Lat Pulldown',
    exercise_id: 'ex-1',
    load_lb: 110,
    sets: 3,
    reps: 10,
    minutes: null,
    note: null,
    is_new: false,
    added_at: null,
    completion: { done: false, sets_done: 0, sets_prescribed: 3, partial: false },
    ...overrides,
  };
}

it('ticks a done line, counts a partial one, and keeps every item on screen', async () => {
  const answer = next();
  answer.brief.workout = {
    type: 'strength',
    targets: ['back'],
    exercises: [
      planned({ completion: { done: true, sets_done: 3, sets_prescribed: 3, partial: false } }),
      planned({
        name: 'Overhead Press',
        completion: { done: false, sets_done: 2, sets_prescribed: 3, partial: true },
      }),
      planned({ name: 'Face Pull' }),
    ],
    finisher: [],
    complete: false,
  };
  mockApi.mockResolvedValue(answer);
  renderCoach();

  await screen.findByText('Lat Pulldown');
  // All three, whatever their state — a plan does not shrink as it is worked through.
  expect(screen.getByText('Overhead Press')).toBeTruthy();
  expect(screen.getByText('Face Pull')).toBeTruthy();

  expect(screen.getByText('✓')).toBeTruthy();
  expect(screen.getByText('2/3')).toBeTruthy();
  expect(screen.getByText('1 of 3 done')).toBeTruthy();
  // The untouched line carries no mark at all: nothing is owed.
  expect(screen.queryByText('0/3')).toBeNull();
  expect(screen.queryByTestId('coach-plan-complete')).toBeNull();
});

it('says the plan is complete without taking the plan away', async () => {
  const answer = next();
  answer.brief.workout = {
    type: 'strength',
    targets: ['back'],
    exercises: [planned({ completion: { done: true, sets_done: 3, sets_prescribed: 3, partial: false } })],
    finisher: [],
    complete: true,
  };
  mockApi.mockResolvedValue(answer);
  renderCoach();

  expect(await screen.findByTestId('coach-plan-complete')).toHaveTextContent(/Plan complete/);
  expect(screen.getByText('Lat Pulldown')).toBeTruthy();
  expect(screen.queryByTestId('coach-do-empty')).toBeNull();
});

it('draws appended items under their own "added" divider', async () => {
  const answer = next();
  answer.brief.workout = {
    type: 'strength',
    targets: ['back', 'core'],
    exercises: [
      planned(),
      planned({ name: 'Plank', added_at: '2:05p' }),
      planned({ name: 'Hanging Leg Raise', added_at: '2:05p' }),
    ],
    finisher: [],
    complete: false,
  };
  mockApi.mockResolvedValue(answer);
  renderCoach();

  await screen.findByText('Lat Pulldown');
  // One divider for the group, not one per item.
  expect(screen.getAllByTestId('coach-added-2:05p')).toHaveLength(1);
  expect(screen.getByText('Added 2:05p')).toBeTruthy();
  expect(screen.getByText('Plank')).toBeTruthy();
});

it('marks the one new movement and opens its sheet from the chip', async () => {
  const answer = next();
  answer.brief.workout = {
    type: 'strength',
    targets: ['back'],
    exercises: [planned(), planned({ name: 'Face Pull', exercise_id: 'ex-9', is_new: true })],
    finisher: [],
    complete: false,
  };
  mockApi.mockResolvedValue(answer);
  renderCoach();

  await screen.findByText('Face Pull');
  expect(screen.queryByTestId('coach-new-0')).toBeNull();
  fireEvent.press(screen.getByTestId('coach-new-1'));
  expect(mockPush).toHaveBeenCalled();
  expect(JSON.stringify(mockPush.mock.calls[0])).toContain('ex-9');
});

it('draws the stretch finisher under the session', async () => {
  const answer = next();
  answer.brief.workout = {
    type: 'strength',
    targets: ['back'],
    exercises: [planned()],
    finisher: [
      { name: 'Lat Stretch', minutes: 2, note: 'Both sides.' },
      { name: 'Thread the Needle', minutes: 1, note: null },
    ],
    complete: false,
  };
  mockApi.mockResolvedValue(answer);
  renderCoach();

  expect(await screen.findByTestId('coach-finisher')).toBeTruthy();
  expect(screen.getByText('Lat Stretch')).toBeTruthy();
  expect(screen.getByText('2 min · Both sides.')).toBeTruthy();
});

it('draws the Eat card from what is LEFT of the day, not from the brief target', async () => {
  const answer = next();
  answer.brief.nutrition_now = {
    remaining_kcal: 412,
    eaten_kcal: 1842,
    allowance_kcal: 2254,
    remaining_protein_g: 38,
    eaten_protein_g: 122,
    protein_target_g: 160,
    past_target: false,
    line: '412 kcal left · 38 g of protein to go.',
  };
  mockApi.mockResolvedValue(answer);
  renderCoach();

  expect(await screen.findByTestId('eat-remaining')).toHaveTextContent('412');
  expect(screen.getByText('kcal left')).toBeTruthy();
  expect(screen.getByTestId('eat-line')).toHaveTextContent(/38 g of protein to go/);
  expect(screen.getByText('1842 eaten of 2254 · ≤ 250 g carbs')).toBeTruthy();
  // The day's target is not what the card counts down.
  expect(screen.queryByText('2254')).toBeNull();
});

it('states a day past its allowance flatly, with nothing to do about it', async () => {
  const answer = next();
  answer.brief.nutrition_now = {
    remaining_kcal: -320,
    eaten_kcal: 2574,
    allowance_kcal: 2254,
    remaining_protein_g: 0,
    eaten_protein_g: 170,
    protein_target_g: 160,
    past_target: true,
    line: "320 kcal over today's allowance · protein is there.",
  };
  mockApi.mockResolvedValue(answer);
  renderCoach();

  expect(await screen.findByTestId('eat-remaining')).toHaveTextContent('320');
  expect(screen.getByText('kcal over')).toBeTruthy();
  expect(screen.getByTestId('eat-line')).toHaveTextContent(/over today's allowance/);
});

it('still draws an Eat card from an older server that sends no live numbers', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();

  expect(await screen.findByTestId('eat-remaining')).toHaveTextContent('2254');
  expect(screen.getByText('kcal')).toBeTruthy();
  expect(screen.getByTestId('eat-line')).toHaveTextContent(/160 g protein/);
});

// ── Opening the page never generates ─────────────────────────────────────────────────
// The GET used to write the day's brief when there was not one, so *looking* was the act
// that answered the question. It answers `brief: null` now, and the screen asks for a tap.

it('draws the ask button over an empty day, and posts nothing until it is pressed', async () => {
  mockApi.mockResolvedValue(next({ brief: null }));
  renderCoach();

  expect(await screen.findByTestId('coach-no-plan')).toBeTruthy();
  expect(screen.getByText('No plan yet today')).toBeTruthy();
  // One read, no write: nothing was generated by arriving here.
  expect(mockApi).toHaveBeenCalledTimes(1);
  expect(asks()).toEqual([]);

  mockApi.mockResolvedValue(next());
  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-regenerate'));
  });

  await screen.findByText('Pull day: back and shoulders');
  expect(asks()).toEqual([{ tz_offset_min: 0, context: null, revision: null, mode: null }]);
  // And the button that asked is gone, because there is a plan now.
  expect(screen.queryByTestId('coach-no-plan')).toBeNull();
});

it('sends what is typed with the first ask as context, not as a revision', async () => {
  mockApi.mockResolvedValue(next({ brief: null }));
  renderCoach();
  await screen.findByTestId('coach-no-plan');

  mockApi.mockResolvedValue(next());
  fireEvent.changeText(screen.getByTestId('coach-context'), 'only 30 minutes');
  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-regenerate'));
  });

  await waitFor(() => expect(asks()).toHaveLength(1));
  expect(asks()[0]).toMatchObject({ context: 'only 30 minutes', revision: null, mode: null });
});

it('shows no ask button while the first read is still in flight', async () => {
  mockApi.mockReturnValue(new Promise(() => {}));
  renderCoach();

  expect(await screen.findByTestId('coach-skeleton')).toBeTruthy();
  expect(screen.queryByTestId('coach-no-plan')).toBeNull();
});

// ── Two buttons that say what they do ────────────────────────────────────────────────

it('adds to the plan explicitly, and keeps everything above', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  fireEvent.changeText(screen.getByTestId('coach-context'), 'twenty minutes of core');
  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-add'));
  });

  expect(asks()).toEqual([
    { tz_offset_min: 0, context: null, revision: 'twenty minutes of core', mode: 'append' },
  ]);
});

it('adds with an empty box too, because "more" is a complete instruction', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-add'));
  });

  expect(asks()).toHaveLength(1);
  expect(asks()[0]).toMatchObject({ mode: 'append' });
  expect(String(asks()[0]?.revision)).toContain('add to the plan');
});

it('will not replace the plan on one tap', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  fireEvent.press(screen.getByTestId('coach-replace'));

  // Armed, said out loud, and nothing sent.
  expect(screen.getByText("Replace? This clears today's plan")).toBeTruthy();
  expect(screen.getByTestId('coach-plan-actions-hint')).toHaveTextContent(/Everything above goes/);
  expect(asks()).toEqual([]);
  // The plan is still exactly where it was while the question is being asked.
  expect(screen.getByText('Lat Pulldown')).toBeTruthy();
});

it('replaces the plan on the second tap, and says it is a rewrite', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  fireEvent.changeText(screen.getByTestId('coach-context'), 'switch to legs');
  fireEvent.press(screen.getByTestId('coach-replace'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-replace'));
  });

  expect(asks()).toEqual([
    { tz_offset_min: 0, context: null, revision: 'switch to legs', mode: 'rewrite' },
  ]);
  // Disarmed again: the next tap is a first tap.
  await waitFor(() => expect(screen.getByText("Replace today's plan")).toBeTruthy());
});

it('disarms Replace when anything else is pressed', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  fireEvent.press(screen.getByTestId('coach-replace'));
  expect(screen.getByText("Replace? This clears today's plan")).toBeTruthy();

  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-add'));
  });

  expect(screen.getByText("Replace today's plan")).toBeTruthy();
  expect(asks()).toHaveLength(1);
  expect(asks()[0]).toMatchObject({ mode: 'append' });
});

it('will not let an empty box quietly regenerate the plan', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  // It used to say "Ask again" here and send a plain regenerate — the least explicit
  // control on the page, replacing the plan without saying so.
  const adjust = screen.getByTestId('coach-regenerate');
  expect(adjust).toBeDisabled();
  fireEvent.press(adjust);
  expect(asks()).toEqual([]);

  fireEvent.changeText(screen.getByTestId('coach-context'), 'harder');
  expect(screen.getByTestId('coach-regenerate')).not.toBeDisabled();
});


// ── no dead taps, and an underline that says what it will get ────────────────────────
// Field report 2026-09-01, with screenshots: the finisher's items did not open at all,
// and nothing on the plan said which names had a picture behind them.

it('opens the sheet from a plan row, by the id the server resolved', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  fireEvent.press(screen.getByText('Lat Pulldown'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/exercise/[id]',
    // The count travels with the tap, so the sheet draws two photo boxes on frame one.
    params: { id: LAT_PULLDOWN_ID, name: 'Lat Pulldown', media: '2' },
  });
});

it('opens the finisher too — a stretch with no catalogue row is a name-only sheet, not a dead row', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  fireEvent.press(screen.getByText('Doorway Chest Stretch'));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: '/exercise/[id]',
    // No id, and a count of zero: the sheet skips straight to "no photos for this one"
    // and still offers the form video, which is a search.
    params: { id: 'unknown', name: 'Doorway Chest Stretch', media: '0' },
  });
});

it('draws the photo glyph only beside the names that have one', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  expect(screen.getByTestId('coach-do-0-photo')).toBeTruthy();
  // Farmer Carry and the stretch are tappable and say nothing they cannot deliver.
  expect(screen.queryByTestId('coach-do-1-photo')).toBeNull();
  expect(screen.queryByTestId('coach-finisher-0-photo')).toBeNull();
});

it('warms every plan row and asks for the first photo at the width the sheet uses', async () => {
  mockApi.mockImplementation((path: string) =>
    path === '/api/coach/next'
      ? Promise.resolve(next())
      : Promise.resolve({
          id: LAT_PULLDOWN_ID,
          name: 'Lat Pulldown',
          aliases: [],
          category: 'strength',
          primary_muscles: ['lats'],
          secondary_muscles: [],
          equipment: ['cable'],
          instructions: [],
          level: null,
          media: [{ index: 0, url: '' }, { index: 1, url: '' }],
          source: null,
        }),
  );
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  // Both catalogued rows get their sheet warmed — the report was that the plan felt slow,
  // and a prefetch that only covered Progress would have explained exactly that.
  await waitFor(() =>
    expect(mockApi).toHaveBeenCalledWith(`/api/exercises/${LAT_PULLDOWN_ID}`),
  );
  await waitFor(() => expect(mockApi).toHaveBeenCalledWith(`/api/exercises/${FARMER_CARRY_ID}`));

  // The width is in the URL, so a prefetch at any other size would warm a cache entry the
  // sheet never reads.
  await waitFor(() =>
    expect(mockPrefetch).toHaveBeenCalledWith(
      `http://test/api/exercises/${LAT_PULLDOWN_ID}/media/0?w=640`,
      expect.anything(),
    ),
  );
  // Farmer Carry said it has no photographs, so no image was asked for at all.
  for (const [url] of mockPrefetch.mock.calls as unknown as [string][]) {
    expect(url).not.toContain(FARMER_CARRY_ID);
  }
});
