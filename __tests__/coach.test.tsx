import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import React from 'react';

import { ApiError } from '@/lib/api';
import { RECOVERY_DELAYS_MS } from '@/lib/coach-recovery';
import { EatGuidance } from '@/components/eat-guidance';
import { PlanSection as Coach } from '@/components/plan-section';
import type { CoachBrief, CoachNext } from '@/lib/types';
import { makeDay } from './fixtures';

// The plan surface — now the "Do" section of Today rather than a page of its own (user
// decision 2026-09-01). Every contract below is carried over unchanged, and the first one
// is the one that mattered most in the move: opening it generates nothing.
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
  GENERATE_TIMEOUT_MS: 180_000,
  // Declared inside the factory, and read back through the module below: the code under
  // test does `instanceof ApiError`, so the test has to throw the SAME class the code
  // imports, not a look-alike.
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
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
 * The eating half of the brief. It moved out of the plan and in beside the meals on Today
 * (user decision 2026-09-01) — same brief, same arithmetic, drawn where eating is.
 */
function renderEat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <EatGuidance />
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

it('adjusts the plan through the ONE logger, never through a form of its own', async () => {
  // User decision 2026-09-01: "there is only one way to update anything in the app and
  // that is the logger". This section used to carry a text box, Photo/Type tiles and a
  // submit button — a second input surface, which concept-v2 Principles 7 forbids.
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  // There is no box, and no tiles, anywhere on it.
  expect(screen.queryByTestId('coach-context')).toBeNull();
  expect(screen.queryByTestId('coach-photo')).toBeNull();
  expect(screen.queryByTestId('coach-speak')).toBeNull();
  expect(screen.queryByTestId('coach-type')).toBeNull();

  fireEvent.press(screen.getByTestId('coach-adjust'));
  // The + sheet, told plainly that it is adjusting rather than logging.
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { framing: 'plan' } });
  // Opening a door writes nothing.
  expect(asks()).toEqual([]);
});

it("starts the day's workout with no words, and that is the only generator", async () => {
  mockApi.mockRejectedValueOnce(new Error('The coach is unavailable right now.'));
  renderCoach();
  await screen.findByText('The coach is unavailable right now.');

  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-regenerate'));
  });

  // A plain ask: context is TOLD through the +, not typed into a box that lived here.
  await waitFor(() => expect(asks()).toHaveLength(1));
  expect(asks()[0]).toMatchObject({ context: null, revision: null, mode: null });
});

it('keeps the brief on screen while a revision is running, and says it is working', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  let settle: (value: CoachNext) => void = () => {};
  mockApi.mockReturnValueOnce(new Promise<CoachNext>((resolve) => (settle = resolve)));
  fireEvent.press(screen.getByTestId('coach-replace'));
  fireEvent.press(screen.getByTestId('coach-replace'));

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
  fireEvent.press(screen.getByTestId('coach-replace'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-replace'));
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
  fireEvent.press(screen.getByTestId('coach-replace'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-replace'));
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
  renderEat();

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
  renderEat();

  expect(await screen.findByTestId('eat-remaining')).toHaveTextContent('320');
  expect(screen.getByText('kcal over')).toBeTruthy();
  expect(screen.getByTestId('eat-line')).toHaveTextContent(/over today's allowance/);
});

it('still draws an Eat card from an older server that sends no live numbers', async () => {
  mockApi.mockResolvedValue(next());
  renderEat();

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
  expect(screen.getByText('Nothing planned yet')).toBeTruthy();
  // Reads only: nothing was generated by arriving here. The section reads the day too now
  // (the log hangs off the plan), so what matters is that every call is a GET.
  expect(mockApi.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  expect(coachCalls()).toHaveLength(1);
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

it('offers only the generator when there is no plan — no box, no tiles', async () => {
  // The empty-day state. What used to be here was a context box above the button; context
  // is told through the + now, and the button takes no words (user decision 2026-09-01).
  mockApi.mockResolvedValue({ date: '2026-08-30', brief: null, stale: false });
  renderCoach();

  expect(await screen.findByTestId('coach-no-plan')).toBeTruthy();
  expect(screen.queryByTestId('coach-context')).toBeNull();
  expect(screen.queryByTestId('coach-adjust')).toBeNull();
  expect(screen.queryByTestId('coach-replace')).toBeNull();

  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-regenerate'));
  });
  expect(asks()).toEqual([{ tz_offset_min: 0, context: null, revision: null, mode: null }]);
});

it('shows no ask button while the first read is still in flight', async () => {
  mockApi.mockReturnValue(new Promise(() => {}));
  renderCoach();

  expect(await screen.findByTestId('coach-skeleton')).toBeTruthy();
  expect(screen.queryByTestId('coach-no-plan')).toBeNull();
});

// ── Two buttons that say what they do ────────────────────────────────────────────────

it('the adjust door adds; it never replaces', async () => {
  // Append semantics are unchanged — they moved into the logger (app/log.tsx
  // §runAdjustPlan), which is where the words are now said.
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  fireEvent.press(screen.getByTestId('coach-adjust'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/log', params: { framing: 'plan' } });
  // Nothing was asked, and nothing was replaced, by opening a door.
  expect(asks()).toEqual([]);
  expect(screen.getByText('Lat Pulldown')).toBeTruthy();
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

  fireEvent.press(screen.getByTestId('coach-replace'));
  await act(async () => {
    fireEvent.press(screen.getByTestId('coach-replace'));
  });

  // No words needed: rebuilding the session is itself the instruction.
  expect(asks()).toEqual([{ tz_offset_min: 0, context: null, revision: null, mode: 'rewrite' }]);
  // Disarmed again: the next tap is a first tap.
  await waitFor(() => expect(screen.getByText("Replace today's plan")).toBeTruthy());
});

it('disarms Replace when the adjust door is opened instead', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  fireEvent.press(screen.getByTestId('coach-replace'));
  expect(screen.getByText("Replace? This clears today's plan")).toBeTruthy();

  fireEvent.press(screen.getByTestId('coach-adjust'));

  expect(screen.getByText("Replace today's plan")).toBeTruthy();
  expect(asks()).toEqual([]);
});

it('says what each control does without pointing at a box that is not there', async () => {
  mockApi.mockResolvedValue(next());
  renderCoach();
  await screen.findByText('Pull day: back and shoulders');

  const hint = screen.getByTestId('coach-plan-actions-hint');
  expect(hint).toHaveTextContent(/Adjusting opens the logger/);
  expect(hint).not.toHaveTextContent(/Type below/);
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

it('says when the Why was written, so the morning rationale admits its age', async () => {
  // Field report 2026-09-01: "why is it talking about yesterday". Because it was written at
  // 7 am, when yesterday was the most recent thing there was. The card now says so.
  mockApi.mockResolvedValue(next());
  renderCoach();

  await screen.findByText('Pull day: back and shoulders');
  expect(screen.getByTestId('coach-why-eyebrow')).toHaveTextContent(/Why · as of/);
  expect(screen.getByTestId('coach-why-eyebrow')).toHaveTextContent(/\d/);
});

it('falls back to a plain Why on a brief that never recorded when it was asked', async () => {
  const answer = next();
  (answer.brief as { asked_at: string | null }).asked_at = null;
  mockApi.mockResolvedValue(answer);
  renderCoach();

  await screen.findByText('Pull day: back and shoulders');
  expect(screen.getByTestId('coach-why-eyebrow')).toHaveTextContent('Why');
  expect(screen.getByTestId('coach-why-eyebrow')).not.toHaveTextContent('as of');
});

// ── the plan and the log are one section ─────────────────────────────────────────────
// User decision 2026-09-01: "if it's done, it's checked, you can click it, you can see the
// log, everything I logged about it". The Do list and the Done list were two views of the
// same facts — the plan said "Chest Press · 85 lb · 4 × 10", the log said "2 × 10 · 85 lb"
// and "2 × 10 · 70 lb", and the reader had to hold both to see the load had dropped.

describe('the merged training section', () => {
  const CHEST_ID = '33333333-4444-4555-8666-777777777777';

  /** A brief with one prescribed press, and the completion the server matched to it. */
  function planned(records: unknown[], over: Record<string, unknown> = {}) {
    const answer = next();
    answer.brief.workout = {
      type: 'strength',
      targets: ['chest'],
      exercises: [
        {
          name: 'Chest Press Machine',
          exercise_id: CHEST_ID,
          media_count: 0,
          load_lb: 85,
          sets: 4,
          reps: 10,
          minutes: null,
          note: null,
          completion: {
            done: true,
            sets_done: 4,
            sets_prescribed: 4,
            partial: false,
            records,
            ...over,
          },
        },
      ],
      finisher: [],
    } as never;
    return answer;
  }

  const activity = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    logged_at: '2026-08-30T12:02:00.000Z',
    description: '2 × 10 chest press',
    exercise: 'Chest Press Machine',
    exercise_id: CHEST_ID,
    media_count: 0,
    equipment: null,
    category: 'strength',
    muscle_groups: ['chest'],
    sets: 2,
    reps: 10,
    load_lb: 85,
    duration_min: null,
    distance_mi: null,
    kcal: 60,
    source: 'manual',
    confidence: 'high',
    block_id: null,
    delta_vs_last: { text: '-2 sets', direction: 'down', sentiment: 'watch', field: 'sets' },
    evidence: [],
    ...over,
  });

  const record = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    logged_at: '2026-08-30T12:02:00.000Z',
    sets: 2,
    reps: 10,
    load_lb: 85,
    duration_min: null,
    kcal: 60,
    ...over,
  });

  /** The coach payload on its path, the day on its own. */
  function serveBoth(answer: unknown, activities: unknown[], earned = 264) {
    mockApi.mockImplementation((path: string) => {
      if (path.startsWith('/api/day/')) {
        return Promise.resolve(
          makeDay({ earned, items: { meals: [], weights: [], activities: activities as never } }),
        );
      }
      return Promise.resolve(answer);
    });
  }

  it('a done row is a receipt: the prescription is gone and the log is the line', async () => {
    // "it's already done... it should say what weight did I use, when did I do it — that's
    // the main focus" (user decision 2026-09-01).
    serveBoth(planned([record()]), [activity()]);
    renderCoach();

    await screen.findByText('Chest Press Machine');
    expect(screen.getByTestId('coach-truth-0').props.children).toContain('2 × 10 @ 85');
    // What was ASKED for is no longer on the row at all.
    expect(screen.queryByText(/85 lb · 4 × 10/)).toBeNull();
  });

  it('keeps the prescription on a line that is only part done', async () => {
    // The target is still live mid-flight, so both lines are there.
    serveBoth(planned([record()], { done: false, sets_done: 2, partial: true }), [activity()]);
    renderCoach();

    await screen.findByText('Chest Press Machine');
    expect(screen.getByText(/85 lb · 4 × 10/)).toBeTruthy();
    expect(screen.getByTestId('coach-truth-0').props.children).toContain('2 of 4 sets');
  });

  it('puts BOTH halves of a split record on the line, and reaches both', async () => {
    // The drop set, corrected into two rows (migration 0018). One prescribed line, two
    // records, and neither of them is a footnote.
    serveBoth(
      planned([record({ id: 'a1', load_lb: 85 }), record({ id: 'a2', load_lb: 70 })]),
      [activity({ id: 'a1', load_lb: 85 }), activity({ id: 'a2', load_lb: 70, logged_at: '2026-08-30T12:05:00.000Z' })],
    );
    renderCoach();

    await screen.findByTestId('coach-truth-0');
    // Both halves on the ONE line. There is no second row repeating the name — the truth
    // line carries the log (user decision 2026-09-01).
    expect(screen.getByTestId('coach-truth-0').props.children).toContain('2 × 10 @ 85 + 2 × 10 @ 70');
    expect(screen.queryByTestId('coach-records-0')).toBeNull();

    // The ROW opens the logged record, not the how-to sheet.
    fireEvent.press(screen.getByTestId('coach-do-0'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/log',
      params: { editDate: expect.any(String), editId: 'a1', editKind: 'activity' },
    });
  });

  it('sends the NAME of a done row to the record, and the glyph to the how-to sheet', async () => {
    serveBoth(planned([record()]), [activity({ media_count: 2 })]);
    renderCoach();
    await screen.findByText('Chest Press Machine');

    // The name is part of the row now, and the row is the receipt.
    fireEvent.press(screen.getByText('Chest Press Machine'));
    expect(JSON.stringify(mockPush.mock.calls)).toContain('editId');
    expect(JSON.stringify(mockPush.mock.calls)).not.toContain(CHEST_ID);

    // The small trailing door still gets to the photographs and the steps.
    mockPush.mockReset();
    fireEvent.press(screen.getByTestId('coach-do-0-photo'));
    expect(JSON.stringify(mockPush.mock.calls)).toContain(CHEST_ID);
  });

  it('leaves an UNDONE row exactly as it was: prescription, and the name opens the sheet', async () => {
    serveBoth(planned([], { done: false, sets_done: 0, partial: false }), []);
    renderCoach();
    await screen.findByText('Chest Press Machine');

    expect(screen.getByText(/85 lb · 4 × 10/)).toBeTruthy();
    fireEvent.press(screen.getByText('Chest Press Machine'));
    expect(JSON.stringify(mockPush.mock.calls)).toContain(CHEST_ID);
  });

  it('has nothing behind a line nobody has done', async () => {
    serveBoth(planned([], { done: false, sets_done: 0, partial: false }), []);
    renderCoach();
    await screen.findByText('Chest Press Machine');
    expect(screen.queryByTestId('coach-truth-0')).toBeNull();
  });

  it('draws off-plan work as DONE — it is a logged fact, not a pending one', async () => {
    // Field report 2026-09-02: "the way it is listing under also don't show that it is
    // done". Beside plan lines nobody has started, finished work was reading as pending.
    serveBoth(planned([record()]), [
      activity(),
      activity({ id: 'a9', exercise: 'Incline Treadmill Walk', category: 'cardio', kcal: 146 }),
    ]);
    renderCoach();

    await screen.findByTestId('coach-also');
    // The same ✓ a finished plan line carries.
    const row = screen.getByTestId('row-activity-a9');
    expect(within(row).getByText('✓')).toBeTruthy();
    // And the calories are not lost to the tick — they move onto the line.
    expect(within(row).getByText(/146 kcal/)).toBeTruthy();
  });

  it('keeps Also its own group, and out of the N-of-M count', async () => {
    // Done-looking is not the same as planned: freelanced work stays distinguishable, and
    // it never inflates how much of the PLAN has been finished.
    serveBoth(planned([record()]), [
      activity(),
      activity({ id: 'a9', exercise: 'Incline Treadmill Walk', category: 'cardio' }),
    ]);
    renderCoach();

    await screen.findByTestId('coach-also');
    expect(screen.getByText('Also')).toBeTruthy();
    // One prescribed line, one done: the count is about the plan alone.
    expect(screen.getByText('1 of 1 done')).toBeTruthy();
  });

  it('puts off-plan work in the SAME card, under Also', async () => {
    // Nothing the user actually did renders in a second section.
    serveBoth(planned([record()]), [
      activity(),
      activity({
        id: 'a9',
        exercise: 'Incline Treadmill Walk',
        description: 'Incline treadmill walk',
        category: 'cardio',
        muscle_groups: ['calves'],
        sets: null,
        reps: null,
        load_lb: null,
        duration_min: 17,
        kcal: 146,
      }),
    ]);
    renderCoach();

    expect(await screen.findByTestId('coach-also')).toBeTruthy();
    expect(screen.getByText('Incline Treadmill Walk')).toBeTruthy();
    expect(screen.getByTestId('row-activity-a9-delete')).toBeTruthy();
    // The matched press is NOT repeated down there.
    expect(screen.queryByTestId('row-activity-a1')).toBeNull();
  });

  it('carries the day totals on the section header', async () => {
    serveBoth(planned([record()]), [activity()], 569);
    renderCoach();
    await screen.findByText('Training');
    expect(screen.getByText(/569 kcal earned/)).toBeTruthy();
  });

  it('drops the delta chips the merged row makes redundant', async () => {
    // "-2 sets" against last time is a third comparison on a row that already carries the
    // truth line — and under Also, where the logged rows still render in full.
    serveBoth(planned([record()]), [
      activity(),
      activity({ id: 'a9', exercise: 'Incline Treadmill Walk', category: 'cardio' }),
    ]);
    renderCoach();

    await screen.findByTestId('coach-also');
    expect(screen.queryByText('-2 sets')).toBeNull();
  });

  it('still counts the plan off the way it always did', async () => {
    serveBoth(planned([record()], { done: false, sets_done: 2, partial: true }), [activity()]);
    renderCoach();
    await screen.findByTestId('coach-truth-0');
    // The completion math is untouched: the tick and the count still read from it.
    expect(screen.getByTestId('coach-truth-0').props.children).toContain('2 of 4 sets');
  });
});

it('says which movements were already on the plan, when an add was deduplicated', async () => {
  // Field report 2026-09-02: an append returned the five movements already on the plan and
  // stored them all again. The server refuses them now — and the refusal is NAMED, because
  // the user asked for more and got fewer than the model offered.
  mockApi.mockResolvedValue(
    next({ note: 'Lat Pulldown and Barbell Curl are already on the plan, so they were not added again.' }),
  );
  renderCoach();

  await screen.findByText('Pull day: back and shoulders');
  expect(screen.getByTestId('coach-note')).toHaveTextContent(/already on the plan/);
  // It sits above the plan, which is still entirely there.
  expect(screen.getByText('Lat Pulldown')).toBeTruthy();
});

describe('a barbell row says what to put on the bar', () => {
  // Field report 2026-09-02. The total is what the plan and the progression are keyed on;
  // the plates are what the hands do. The row shows both rather than making the user
  // subtract the bar at the rack.

  function barbellPlan(load: number, barbell: boolean, completion?: unknown) {
    const answer = next();
    answer.brief.workout = {
      type: 'strength',
      targets: ['chest'],
      exercises: [
        {
          name: 'Bench Press',
          exercise_id: null,
          media_count: 0,
          barbell,
          load_lb: load,
          sets: 3,
          reps: 8,
          minutes: null,
          note: null,
          ...(completion ? { completion } : {}),
        },
      ],
      finisher: [],
    } as never;
    return answer;
  }

  it('draws the plates beside the prescribed total', async () => {
    mockApi.mockResolvedValue(barbellPlan(115, true));
    renderCoach();
    await screen.findByText('Bench Press');
    // 115 − the 45 lb bar, halved.
    expect(screen.getByText(/115 lb · 35\/side \+ bar/)).toBeTruthy();
  });

  it('prints a half plate as a half, not as a rounded lie', async () => {
    mockApi.mockResolvedValue(barbellPlan(120, true));
    renderCoach();
    await screen.findByText('Bench Press');
    expect(screen.getByText(/37\.5\/side/)).toBeTruthy();
  });

  it('says nothing about sides when the movement is not a barbell', async () => {
    // A dumbbell load is already per hand; a machine's number is the stack.
    mockApi.mockResolvedValue(barbellPlan(115, false));
    renderCoach();
    await screen.findByText('Bench Press');
    expect(screen.getByText(/115 lb/)).toBeTruthy();
    expect(screen.queryByText(/\/side/)).toBeNull();
  });

  it('says nothing about sides for a bar with nothing on it', async () => {
    mockApi.mockResolvedValue(barbellPlan(45, true));
    renderCoach();
    await screen.findByText('Bench Press');
    expect(screen.queryByText(/\/side/)).toBeNull();
  });

  it('carries the plates onto the receipt of a lift that is done', async () => {
    mockApi.mockResolvedValue(
      barbellPlan(115, true, {
        done: true,
        sets_done: 3,
        sets_prescribed: 3,
        partial: false,
        records: [
          {
            id: 'a1',
            logged_at: '2026-08-30T12:02:00.000Z',
            sets: 3,
            reps: 8,
            load_lb: 115,
            duration_min: null,
            kcal: 200,
          },
        ],
      }),
    );
    renderCoach();
    await screen.findByText('Bench Press');
    expect(screen.getByTestId('coach-truth-0').props.children).toContain('35/side + bar');
  });
});

// ── the answer that never came back ──────────────────────────────────────────────────
// Field report 2026-09-02: the user pressed "Start today's workout", watched "Thinking…",
// and watched the page revert to "Nothing planned yet" — while a five-item brief sat
// finished on the server. A model call over a phone connection outran the platform's
// 60-second fetch ceiling, the promise rejected, and the screen said nothing at all.

describe('a generation whose answer is lost', () => {
  const lost = () => Object.assign(new Error('Network request failed'), { name: 'TypeError' });

  /** No plan yet; the generate call drops; then the server admits it has one. */
  function serveLostAnswer({ everFinds = true }: { everFinds?: boolean } = {}) {
    let found = false;
    mockApi.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/coach/next/regenerate' && options?.method === 'POST') {
        // The generation succeeds server-side; the ANSWER is what is lost.
        found = everFinds;
        return Promise.reject(lost());
      }
      if (path === '/api/coach/status') {
        return Promise.resolve({
          date: '2026-08-30',
          has_plan: found,
          headline: found ? 'Pull day: back and shoulders' : null,
          done_count: 0,
          total_count: found ? 5 : 0,
          complete: false,
        });
      }
      if (path === '/api/coach/next') return Promise.resolve(found ? next() : { brief: null, stale: false });
      return Promise.resolve(null);
    });
  }

  // Fake timers go on AFTER the first render has settled: react-query's own scheduling
  // runs on timers too, and freezing them before the page has loaded leaves the button
  // disabled and the press a no-op.
  afterEach(() => jest.useRealTimers());

  async function settleThenFreeze() {
    renderCoach();
    await act(async () => {});
    await waitFor(() => expect(screen.getByTestId('coach-regenerate')).not.toBeDisabled());
    jest.useFakeTimers();
  }

  it('goes looking for the plan instead of reverting to nothing, and draws it when it turns up', async () => {
    serveLostAnswer();
    await settleThenFreeze();

    await act(async () => {
      fireEvent.press(screen.getByTestId('coach-regenerate'));
    });

    // The poll has taken over, and it says so rather than leaving a dead spinner.
    expect(screen.getByTestId('coach-recovering')).toBeTruthy();
    // Status is asked — the endpoint that cannot itself generate.
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(mockApi.mock.calls.some(([path]) => path === '/api/coach/status')).toBe(true);

    // And the plan the server had all along is fetched and drawn.
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    await act(async () => {});
    expect(screen.getByText('Pull day: back and shoulders')).toBeTruthy();
    expect(screen.queryByTestId('coach-recovering')).toBeNull();
    // Exactly one generation was ever asked for.
    expect(asks()).toHaveLength(1);
  });

  it('never ends in silence: it says so in words, with the button back', async () => {
    serveLostAnswer({ everFinds: false });
    await settleThenFreeze();

    await act(async () => {
      fireEvent.press(screen.getByTestId('coach-regenerate'));
    });
    // Run the whole recovery window out. Each wait is created only after the previous one
    // resolves, so the clock has to be advanced with the microtasks flushed between —
    // one big jump would only ever fire the first sleep.
    for (const ms of RECOVERY_DELAYS_MS) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    }

    await act(async () => {});
    const note = screen.getByTestId('coach-note');
    expect(note).toHaveTextContent(/didn’t come back/);
    expect(note).toHaveTextContent(/may still be being written/);
    // It never claims the plan failed, because it does not know that.
    expect(note).not.toHaveTextContent(/failed/i);
    // And the button is pressable again.
    expect(screen.getByTestId('coach-regenerate')).not.toBeDisabled();
  });

  it('will not let a second tap start a second generation while the first is in flight', async () => {
    serveLostAnswer();
    await settleThenFreeze();

    await act(async () => {
      fireEvent.press(screen.getByTestId('coach-regenerate'));
    });
    // Mid-recovery the button is off, and pressing it changes nothing.
    expect(screen.getByTestId('coach-regenerate')).toBeDisabled();
    await act(async () => {
      fireEvent.press(screen.getByTestId('coach-regenerate'));
      fireEvent.press(screen.getByTestId('coach-regenerate'));
    });
    expect(asks()).toHaveLength(1);
  });

  it('says a refusal plainly rather than polling for a plan nobody is writing', async () => {
    // A 503 is an answer. Only a LOST answer is worth waiting on.
    mockApi.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/coach/next/regenerate' && options?.method === 'POST') {
        return Promise.reject(new ApiError(503, 'The coach is unavailable right now.'));
      }
      if (path === '/api/coach/next') return Promise.resolve({ brief: null, stale: false });
      return Promise.resolve(null);
    });
    await settleThenFreeze();

    await act(async () => {
      fireEvent.press(screen.getByTestId('coach-regenerate'));
    });

    await act(async () => {});
    expect(screen.getByTestId('coach-note')).toHaveTextContent(/unavailable right now/);
    expect(screen.queryByTestId('coach-recovering')).toBeNull();
    expect(mockApi.mock.calls.some(([path]) => path === '/api/coach/status')).toBe(false);
  });
});
