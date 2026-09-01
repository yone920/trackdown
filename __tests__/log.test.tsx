import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import LogSheet from '@/app/log';
import { keyboardPadding } from '@/lib/keyboard';
import type { ActivityItem, FusionResult } from '@/lib/types';

// The log sheet end to end against a fake API: say it → review it → log it, and "Make a
// change" instead of a field (concept-v2 §Principles 7 — NO FORMS, user decision
// 2026-08-31). And the Expo Go rule — when the speech port reports unavailable the Speak
// control is not drawn at all (docs/build-plan.md §Morning test).

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

// The sheet reads its own params (plan-adjust mode, edit mode), so this file brings its
// own router rather than riding on the global mock's fixed empty params.
let mockParams: Record<string, string> = {};
const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
    replace: jest.fn(),
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => mockParams,
}));

const mockSpeech = { available: false, requestPermission: jest.fn(), start: jest.fn(), stop: jest.fn() };
jest.mock('@/lib/ports/speech', () => ({ getSpeech: () => mockSpeech }));

// The camera and the library are the phone's; what this file is about is what the sheet
// does with what comes back.
jest.mock('@/lib/photos', () => ({
  MAX_PHOTOS: 4,
  takePhoto: async () => [{ uri: 'file:///a.jpg', filename: 'a.jpg', type: 'image/jpeg' }],
  pickPhotos: async () => [{ uri: 'file:///b.jpg', filename: 'b.jpg', type: 'image/jpeg' }],
}));

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

const workout: FusionResult = {
  kind: 'activities',
  items: [
    {
      exercise: 'Chest-Supported Row',
      equipment: 'chest-supported row machine',
      description: '3 × 12 chest-supported row at 45 lb',
      category: 'strength',
      muscle_groups: ['back'],
      sets: 3,
      reps: 12,
      load_lb: 45,
      duration_min: null,
      distance_mi: null,
      kcal: 120,
      confidence: 'low',
      sources: null,
    },
  ],
};

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <LogSheet />
    </QueryClientProvider>,
  );
}

/** Type something and press Log — the first half of every test below. */
async function logIt(said: string) {
  fireEvent.changeText(screen.getByTestId('log-text'), said);
  fireEvent.press(screen.getByTestId('log-submit'));
  await waitFor(() => expect(screen.getByTestId('confirm-card')).toBeTruthy());
}

const analyzed = (results: FusionResult[], evidence: unknown[] = []) => ({
  results,
  evidence,
  context: { local_date: '2026-08-30', tz_offset_min: 0 },
});

beforeEach(() => {
  mockParams = {};
  mockBack.mockReset();
  mockPush.mockReset();
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

  it('calls its primary button Log, and shows a review page when it has read something', async () => {
    mockUpload.mockResolvedValue(analyzed([meal]));
    renderSheet();
    expect(screen.getByTestId('log-submit')).toHaveTextContent('Log');

    await logIt('chicken, rice and broccoli');

    // Its own page: the headline asks, and the box that was typed into is gone.
    expect(screen.getByText('Does this look right?')).toBeTruthy();
    expect(screen.queryByTestId('log-text')).toBeNull();
    expect(screen.getByTestId('confirm-save')).toHaveTextContent('Log it');
    expect(screen.getByTestId('log-make-change')).toBeTruthy();
  });

  it('draws the parts read-only — there is no field anywhere on the review page', async () => {
    mockUpload.mockResolvedValue(analyzed([workout]));
    renderSheet();
    await logIt('three sets of twelve at forty-five');

    // The numbers are there, as text.
    expect(screen.getByTestId('activity-sets-0')).toHaveTextContent('3');
    expect(screen.getByTestId('activity-reps-0')).toHaveTextContent('12');
    expect(screen.getByTestId('activity-load-0')).toHaveTextContent('45');
    expect(screen.getByTestId('activity-equipment-line-0')).toHaveTextContent('chest-supported row machine');
    // And nothing on the page can be typed into.
    expect(screen.root.findAllByType('TextInput' as never)).toHaveLength(0);
  });

  it('saves what the user approved, on one client id', async () => {
    mockUpload.mockResolvedValue(analyzed([meal]));
    mockApi.mockResolvedValue({ kind: 'meal', kinds: ['meal'], replayed: false });

    renderSheet();
    await logIt('chicken, rice and broccoli');
    expect(mockUpload).toHaveBeenCalledWith(
      '/api/log/analyze',
      expect.arrayContaining([{ name: 'text', value: 'chicken, rice and broccoli' }]),
    );

    fireEvent.press(screen.getByTestId('confirm-save'));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    const [path, options] = mockApi.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(path).toBe('/api/log/confirm');
    // The uuid is minted once per Save, so a retry replays rather than logging twice.
    expect(options.body.client_id).toBe('00000000-0000-4000-8000-000000000000');
    expect(options.body.results).toMatchObject([{ kind: 'meal', kcal: 620 }]);
    expect(options.body.tz_offset_min).toBe(0);
  });

  // The heart of the work package: a correction is TOLD, and the parts come back revised.
  it('takes a change in words and redraws the review with the answer', async () => {
    mockUpload.mockResolvedValueOnce(analyzed([workout]));
    renderSheet();
    await logIt('three sets of twelve at forty-five on the row machine');
    expect(screen.getByTestId('activity-reps-0')).toHaveTextContent('12');

    fireEvent.press(screen.getByTestId('log-make-change'));

    // Back at the input, with the parts still pending and the box asking for the change.
    const input = screen.getByTestId('log-text');
    expect(input.props.placeholder).toBe('Tell me what to change — “reps were 3, not 4”…');
    expect(screen.queryByTestId('confirm-save')).toBeNull();

    const revised: FusionResult = {
      kind: 'activities',
      items: [{ ...(workout as { kind: 'activities'; items: ActivityItem[] }).items[0]!, reps: 4, load_lb: 50 }],
    };
    mockUpload.mockResolvedValueOnce(analyzed([revised]));

    fireEvent.changeText(input, 'reps were 4 and it was 50 pounds');
    fireEvent.press(screen.getByTestId('log-submit'));

    await waitFor(() => expect(screen.getByTestId('activity-reps-0')).toHaveTextContent('4'));
    expect(screen.getByTestId('activity-load-0')).toHaveTextContent('50');
    // The sets nobody mentioned are still on screen.
    expect(screen.getByTestId('activity-sets-0')).toHaveTextContent('3');
    expect(screen.getByText('Does this look right?')).toBeTruthy();

    // What went out: the parts on screen plus the instruction, on the same endpoint.
    const parts = mockUpload.mock.calls[1]![1] as { name: string; value: string }[];
    const revise = JSON.parse(parts.find((part) => part.name === 'revise')!.value) as {
      instruction: string;
      results: FusionResult[];
    };
    expect(revise.instruction).toBe('reps were 4 and it was 50 pounds');
    expect(revise.results).toHaveLength(1);
    expect(revise.results[0]).toMatchObject({ kind: 'activities' });
    // The instruction is not a second log.
    expect(parts.some((part) => part.name === 'text')).toBe(false);
  });

  it('confirms with the words that were said, not with the instruction that changed them', async () => {
    mockUpload.mockResolvedValueOnce(analyzed([meal]));
    mockApi.mockResolvedValue({ kind: 'meal', kinds: ['meal'], replayed: false });
    renderSheet();
    await logIt('chicken and rice');

    fireEvent.press(screen.getByTestId('log-make-change'));
    mockUpload.mockResolvedValueOnce(analyzed([{ ...meal, kcal: 700 }]));
    fireEvent.changeText(screen.getByTestId('log-text'), 'make it 700 calories');
    fireEvent.press(screen.getByTestId('log-submit'));

    await waitFor(() => expect(screen.getByTestId('meal-kcal')).toHaveTextContent('700'));
    fireEvent.press(screen.getByTestId('confirm-save'));

    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    const [, options] = mockApi.mock.calls[0] as [string, { body: Record<string, unknown> }];
    // The DayLog quotes this back at the user. It is the log, not the correction.
    expect(options.body.text).toBe('chicken and rice');
  });

  it('lets a change be abandoned without losing what was read', async () => {
    mockUpload.mockResolvedValue(analyzed([meal]));
    renderSheet();
    await logIt('chicken and rice');

    fireEvent.press(screen.getByTestId('log-make-change'));
    fireEvent.press(screen.getByTestId('revise-cancel'));
    expect(screen.getByText('Does this look right?')).toBeTruthy();
    expect(screen.getByTestId('confirm-save')).toBeTruthy();
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('offers no Log it for an unclear reading, only the question', async () => {
    mockUpload.mockResolvedValue(analyzed([{ kind: 'unclear', question: 'Machine or free weights?' }]));
    renderSheet();
    fireEvent.changeText(screen.getByTestId('log-text'), 'did the thing');
    fireEvent.press(screen.getByTestId('log-submit'));

    await waitFor(() => expect(screen.getByText('Machine or free weights?')).toBeTruthy());
    // A question is not a review: the box is still there to answer it in.
    expect(screen.queryByTestId('confirm-save')).toBeNull();
    expect(screen.getByTestId('log-text')).toBeTruthy();
  });

  // One sentence, several things (backend Field fixes, mixed input): a card per part on
  // the review page, each removable, one Log it for all of them.
  it('stacks a card per part, drops one on ✕, and logs the rest in one call', async () => {
    const run: FusionResult = {
      kind: 'activities',
      items: [
        {
          exercise: 'Treadmill Run',
          equipment: null,
          description: '5 km run',
          category: null,
          muscle_groups: null,
          sets: null,
          reps: null,
          load_lb: null,
          duration_min: 28,
          distance_mi: 3.11,
          kcal: 300,
          confidence: 'medium',
          sources: null,
        },
      ],
    };
    const weight: FusionResult = { kind: 'weight', weight_lb: 181, confidence: 'high', sources: null };
    mockUpload.mockResolvedValue(
      analyzed(
        [meal, run, weight],
        [
          { id: 'e1', kind: 'photo', mime: 'image/jpeg', width: 10, height: 10, url: '/x', part: 0 },
          { id: 'e2', kind: 'photo', mime: 'image/jpeg', width: 10, height: 10, url: '/y', part: 1 },
        ],
      ),
    );
    mockApi.mockResolvedValue({ kind: 'meal', kinds: ['meal', 'weight'], replayed: false });

    renderSheet();
    await logIt('ate this, ran 5k, weighed 181');

    expect(screen.getByTestId('confirm-card-1')).toBeTruthy();
    expect(screen.getByTestId('confirm-card-2')).toBeTruthy();
    expect(screen.getByTestId('confirm-save')).toHaveTextContent('Log all 3');

    // The run was not what they meant: drop it, and the photo read for it goes too.
    fireEvent.press(screen.getByTestId('confirm-card-1-remove'));
    await waitFor(() => expect(screen.queryByTestId('confirm-card-2')).toBeNull());

    fireEvent.press(screen.getByTestId('confirm-save'));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    const [, options] = mockApi.mock.calls[0] as [string, { body: Record<string, unknown> }];
    // One call, one client_id, the two parts that are left — the meal and the weigh-in.
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(options.body.results).toMatchObject([{ kind: 'meal' }, { kind: 'weight' }]);
    expect(options.body.evidence_ids).toEqual(['e1']);
    expect(options.body.evidence_parts).toEqual([0]);
  });

  // The clarify loop (backend Field fixes). A question is not a dead end: the sheet keeps
  // what it asked about and what it asked, so a one-word answer resolves.
  it('remembers the question, asks for the answer, and sends both back', async () => {
    mockUpload.mockResolvedValueOnce(analyzed([{ kind: 'unclear', question: 'Was that a bench press?' }]));
    renderSheet();
    fireEvent.changeText(screen.getByTestId('log-text'), 'did the thing');
    fireEvent.press(screen.getByTestId('log-submit'));

    await waitFor(() => expect(screen.getByText('Was that a bench press?')).toBeTruthy());
    // The box is emptied for the answer and says what it now wants.
    const input = screen.getByTestId('log-text');
    expect(input.props.value).toBe('');
    expect(input.props.placeholder).toBe('Answer the question…');

    mockUpload.mockResolvedValueOnce(analyzed([workout]));
    fireEvent.changeText(input, 'yes');
    fireEvent.press(screen.getByTestId('log-submit'));

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2));
    const parts = mockUpload.mock.calls[1]![1] as { name: string; value?: string }[];
    expect(parts).toEqual(
      expect.arrayContaining([
        { name: 'text', value: 'yes' },
        { name: 'clarify_original', value: 'did the thing' },
        { name: 'clarify_question', value: 'Was that a bench press?' },
      ]),
    );

    // Resolved: the review page is drawn and the round is over.
    await waitFor(() => expect(screen.getByText('Does this look right?')).toBeTruthy());
  });

  it('sends no clarify round on an ordinary log', async () => {
    mockUpload.mockResolvedValue(analyzed([meal]));
    renderSheet();
    await logIt('chicken and rice');
    const parts = mockUpload.mock.calls[0]![1] as { name: string }[];
    expect(parts.map((part) => part.name)).not.toContain('clarify_original');
  });
});

// The keyboard bug: the input hid behind it and nothing scrolled far enough to bring it
// back. The rule is one function because using both compensations at once is the bug.
describe('the keyboard inset', () => {
  it('adds nothing on iOS, where the scroll view has already been inset', () => {
    expect(keyboardPadding(336, 'ios')).toBe(0);
    expect(keyboardPadding(0, 'ios')).toBe(0);
  });

  it('adds the keyboard height on Android, which has no such inset', () => {
    expect(keyboardPadding(336, 'android')).toBe(336);
    expect(keyboardPadding(0, 'android')).toBe(0);
  });
});

// The primary action, reported 2026-08-31: it was a `Chip` the same size and shape as
// "From library" beside it, and greyed out until there was something to read — the user
// could not tell what to press. It is a button now, at one size, in every state.
describe('the primary action is the biggest thing on the sheet', () => {
  it('is a full-size button, disabled but never shrunk, before anything is said', () => {
    renderSheet();
    const button = screen.getByTestId('log-submit');
    expect(button).toHaveTextContent('Log');
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    // Still the same 56 pt accent button, at reduced opacity.
    expect(button.props.style).toMatchObject({ height: 56, opacity: 0.45 });

    fireEvent.changeText(screen.getByTestId('log-text'), 'chicken and rice');
    expect(screen.getByTestId('log-submit').props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByTestId('log-submit').props.style).toMatchObject({ height: 56, opacity: 1 });
  });

  it('keeps its shape while the read is running, and says what it is doing', async () => {
    let resolve: ((value: unknown) => void) | null = null;
    mockUpload.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderSheet();
    fireEvent.changeText(screen.getByTestId('log-text'), 'chicken and rice');
    fireEvent.press(screen.getByTestId('log-submit'));

    await waitFor(() => expect(screen.getByTestId('log-submit')).toHaveTextContent('Reading…'));
    expect(screen.getByTestId('log-submit').props.style).toMatchObject({ height: 56 });

    await waitFor(() => expect(resolve).not.toBeNull());
    resolve!(analyzed([meal]));
    await waitFor(() => expect(screen.getByTestId('confirm-card')).toBeTruthy());
  });

  it('lives in a bar pinned below the scroller, so it is reachable with the keyboard up', async () => {
    mockUpload.mockResolvedValue(analyzed([meal]));
    renderSheet();
    expect(screen.getByTestId('log-actions')).toBeTruthy();
    // "From library" is beside it and stays a small chip.
    expect(screen.getByText('From library')).toBeTruthy();

    await logIt('chicken, rice and broccoli');
    // On the review step the same bar carries "Log it".
    expect(screen.getByTestId('confirm-save')).toHaveTextContent('Log it');
    expect(screen.getByTestId('confirm-save').props.style).toMatchObject({ height: 56 });
  });

  it('caps how tall the compose box can grow', () => {
    renderSheet();
    const style = screen.getByTestId('log-text').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
    expect(flat.maxHeight).toBeGreaterThan(0);
    expect(flat.maxHeight).toBeLessThan(flat.minHeight * 8);
  });
});

// Photo thumbnails: tapping the image used to delete it, with no affordance at all.
describe('an attached photo is removed by its badge and by nothing else', () => {
  const attach = async () => {
    renderSheet();
    fireEvent.press(screen.getByTestId('control-photo'));
    await waitFor(() => expect(screen.getByTestId('photo-file:///a.jpg')).toBeTruthy());
  };

  it('draws a ✕ badge on each thumbnail, and only the badge removes', async () => {
    await attach();
    // The image itself is not the delete button any more.
    fireEvent.press(screen.getByTestId('photo-file:///a.jpg'));
    expect(screen.getByTestId('photo-file:///a.jpg')).toBeTruthy();

    fireEvent.press(screen.getByTestId('photo-file:///a.jpg-remove'));
    await waitFor(() => expect(screen.queryByTestId('photo-file:///a.jpg')).toBeNull());
  });
});

// The history of a change told BEFORE anything was saved (migration 0015). The parts have
// no ids yet, so the server measures the diff, hands it back with the revised parts, and
// the sheet gives it straight back on the confirm — which writes it against the rows the
// parts turn into.
describe('a change told to a pending log ends up in the record', () => {
  const carbsFixed = { part: 0, item: null, instruction: 'the carbs look wrong', changes: [{ field: 'carbs_g', from: 398, to: 89 }] };

  it('relays every correction the server measured, in the order they were told', async () => {
    mockUpload.mockResolvedValueOnce(analyzed([meal]));
    mockApi.mockResolvedValue({ kind: 'meal', kinds: ['meal'], replayed: false });
    renderSheet();
    await logIt('tuna, eggs and four slices of this bread');

    fireEvent.press(screen.getByTestId('log-make-change'));
    mockUpload.mockResolvedValueOnce({ ...analyzed([{ ...meal, carbs_g: 89 }]), corrections: [carbsFixed] });
    fireEvent.changeText(screen.getByTestId('log-text'), 'the carbs look wrong');
    fireEvent.press(screen.getByTestId('log-submit'));
    await waitFor(() => expect(screen.getByTestId('confirm-save')).toBeTruthy());

    // A second told change, on the same preview.
    fireEvent.press(screen.getByTestId('log-make-change'));
    mockUpload.mockResolvedValueOnce({
      ...analyzed([{ ...meal, carbs_g: 89, kcal: 880 }]),
      corrections: [{ part: 0, item: null, instruction: 'about 880 calories', changes: [{ field: 'kcal', from: 620, to: 880 }] }],
    });
    fireEvent.changeText(screen.getByTestId('log-text'), 'about 880 calories');
    fireEvent.press(screen.getByTestId('log-submit'));
    await waitFor(() => expect(screen.getByTestId('meal-kcal')).toHaveTextContent('880'));

    fireEvent.press(screen.getByTestId('confirm-save'));
    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    const [, options] = mockApi.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body.corrections).toEqual([
      carbsFixed,
      { part: 0, item: null, instruction: 'about 880 calories', changes: [{ field: 'kcal', from: 620, to: 880 }] },
    ]);
  });

  it('sends none at all for a log nobody corrected', async () => {
    mockUpload.mockResolvedValue(analyzed([meal]));
    mockApi.mockResolvedValue({ kind: 'meal', kinds: ['meal'], replayed: false });
    renderSheet();
    await logIt('chicken and rice');
    fireEvent.press(screen.getByTestId('confirm-save'));

    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    const [, options] = mockApi.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body.corrections).toEqual([]);
  });

  it('drops the history of a part the user then removed with its ✕', async () => {
    mockUpload.mockResolvedValueOnce(analyzed([workout, meal]));
    mockApi.mockResolvedValue({ kind: 'meal', kinds: ['meal'], replayed: false });
    renderSheet();
    await logIt('rows, then dinner');

    fireEvent.press(screen.getByTestId('log-make-change'));
    mockUpload.mockResolvedValueOnce({
      ...analyzed([workout, { ...meal, carbs_g: 89 }]),
      // The meal is part 1 here.
      corrections: [{ ...carbsFixed, part: 1 }],
    });
    fireEvent.changeText(screen.getByTestId('log-text'), 'the carbs look wrong');
    fireEvent.press(screen.getByTestId('log-submit'));
    await waitFor(() => expect(screen.getByTestId('confirm-card-1')).toBeTruthy());

    // Drop the meal. Its history goes with it rather than sliding onto the workout.
    fireEvent.press(screen.getByTestId('confirm-card-1-remove'));
    fireEvent.press(screen.getByTestId('confirm-save'));

    await waitFor(() => expect(mockApi).toHaveBeenCalled());
    const [, options] = mockApi.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body.corrections).toEqual([]);
  });
});

describe('the logger, adjusting the plan', () => {
  // User decision 2026-09-01: "there is only one way to update anything in the app and
  // that is the logger". The plan's own text box is gone; adjusting it opens THIS sheet
  // with `adjustPlan`, and the words go to the coach instead of through the reader.

  it('says plainly that it is not logging anything, and sends the words to the coach', async () => {
    mockParams = { adjustPlan: '1' };
    renderSheet();

    expect(screen.getByText("Adjust today's plan")).toBeTruthy();
    expect(screen.getByTestId('log-adjust-plan-note')).toHaveTextContent(/does not log anything you did/);
    // The same three affordances as any other log — one door, one panel.
    expect(screen.getByTestId('control-type')).toBeTruthy();
    expect(screen.getByTestId('log-text')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('log-text'), 'add twenty minutes of core');
    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });

    // Straight to the coach's adjust endpoint, appending — never through /api/log/analyze,
    // because this is not a record of something that happened.
    const posted = mockApi.mock.calls.find(([path]) => path === '/api/coach/next/regenerate');
    expect(posted).toBeTruthy();
    expect((posted![1] as { body: Record<string, unknown> }).body).toMatchObject({
      revision: 'add twenty minutes of core',
      mode: 'append',
      context: null,
    });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });

  it('is an ordinary log when nobody asked it to adjust anything', async () => {
    mockParams = {};
    renderSheet();
    expect(screen.queryByTestId('log-adjust-plan-note')).toBeNull();
    expect(screen.getByText('What did you do?')).toBeTruthy();
  });
});
