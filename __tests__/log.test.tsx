import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import LogSheet from '@/app/log';
import { ApiError } from '@/lib/api';
import { RECOVERY_DELAYS_MS } from '@/lib/coach-recovery';
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
  // Plain assignment, not TS parameter properties: babel's scope check rejects those
  // inside a jest.mock factory.
  ApiError: class ApiError extends Error {
    status: number;
    code: string | undefined;
    constructor(status: number, message: string, _issues?: unknown, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
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
  // The port is one object shared by every test in this file: without this, "was start called
  // once?" counts the presses of whichever tests ran before it.
  mockSpeech.requestPermission.mockReset();
  mockSpeech.start.mockReset();
  mockSpeech.stop.mockReset();
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

  // Dictating twice is the normal way to log something you have to think about: you say what
  // you can, stop to remember what the machine was called, and carry on. A second dictation
  // that replaced the first made the pause cost the sentence (field report 2026-09-03).
  it('adds a dictation onto what is already in the box', async () => {
    mockSpeech.available = true;
    mockSpeech.requestPermission.mockResolvedValue(true);
    let heard: { onPartial?: (t: string) => void; onResult: (t: string) => void } | null = null;
    mockSpeech.start.mockImplementation(async (events: typeof heard) => {
      heard = events;
    });
    mockUpload.mockResolvedValue(analyzed([meal]));
    renderSheet();

    fireEvent.changeText(screen.getByTestId('log-text'), 'chicken and rice');
    await act(async () => {
      fireEvent.press(screen.getByTestId('control-speak'));
    });

    // Partials replace each other and never the words in front of them.
    act(() => heard!.onPartial!('and'));
    act(() => heard!.onPartial!('and broccoli'));
    expect(screen.getByTestId('log-text').props.value).toBe('chicken and rice and broccoli');

    // And what goes to the reader is everything said so far, not the last burst alone.
    await act(async () => heard!.onResult('and broccoli'));
    expect(mockUpload).toHaveBeenCalledWith(
      '/api/log/analyze',
      expect.arrayContaining([{ name: 'text', value: 'chicken and rice and broccoli' }]),
    );
  });

  it('starts from empty when the box was empty, with no leading space', async () => {
    mockSpeech.available = true;
    mockSpeech.requestPermission.mockResolvedValue(true);
    let heard: { onPartial?: (t: string) => void; onResult: (t: string) => void } | null = null;
    mockSpeech.start.mockImplementation(async (events: typeof heard) => {
      heard = events;
    });
    renderSheet();

    await act(async () => {
      fireEvent.press(screen.getByTestId('control-speak'));
    });
    act(() => heard!.onPartial!('two eggs'));
    expect(screen.getByTestId('log-text').props.value).toBe('two eggs');
  });

  // The 11px word under the tile was the only thing that changed while the mic was open, and
  // it read as a label rather than a state ("small and not intuitive" — same report). The
  // control itself is the indicator now, and it says what pressing it does.
  it('turns the Speak control into a stop button while it is listening', async () => {
    mockSpeech.available = true;
    mockSpeech.requestPermission.mockResolvedValue(true);
    mockSpeech.start.mockImplementation(async () => {});
    renderSheet();

    const speak = screen.getByTestId('control-speak');
    expect(speak.props.accessibilityLabel).toBe('Speak');
    expect(speak.props.accessibilityState.selected).toBe(false);

    await act(async () => {
      fireEvent.press(speak);
    });

    expect(screen.getByTestId('control-speak').props.accessibilityLabel).toBe('Stop');
    expect(screen.getByTestId('control-speak').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText('Stop')).toBeTruthy();

    // And pressing it again stops the recogniser rather than starting a second one.
    await act(async () => {
      fireEvent.press(screen.getByTestId('control-speak'));
    });
    expect(mockSpeech.stop).toHaveBeenCalled();
    expect(mockSpeech.start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('control-speak').props.accessibilityLabel).toBe('Speak');
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

// ── the tap that did nothing ─────────────────────────────────────────────────────────
// Field bug 2026-09-02: the user typed "I just the same bawl of the lunch I had earlier",
// tapped Log, and the screen did not move — no review card, no error, no question, their
// words still in the box. A response with no parts in it took this branch, and this branch
// did not exist: the handler set its state and fell off the end.
//
// The server refuses to send that shape now, but this is the half that holds whatever
// server the phone is talking to.

describe('a response with nothing in it', () => {
  it('says so, instead of leaving the screen exactly as it was', async () => {
    mockParams = {};
    renderSheet();
    mockUpload.mockResolvedValueOnce(analyzed([]));

    fireEvent.changeText(screen.getByTestId('log-text'), 'I just the same bawl of the lunch I had earlier');
    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });

    // A line the user can act on…
    expect(await screen.findByText("That didn't get read. Nothing was lost — try again.")).toBeTruthy();
    // …no card pretending there is something to confirm…
    expect(screen.queryByTestId('confirm-card')).toBeNull();
    // …and their words are still theirs to send again.
    expect(screen.getByTestId('log-text').props.value).toBe('I just the same bawl of the lunch I had earlier');
  });
});

describe('when the reader fails', () => {
  // Field reports 2026-09-02, two days running: a 529 arrived on screen as the SDK's own
  // JSON — status, error type and request id — under the input box; then, once THAT status
  // had been humanised by name, a 400 saying "Your credit balance is too low" arrived in
  // the same place. The app renders by CODE now, from a closed table, and anything it does
  // not recognise gets the generic line (lib/errors.ts).

  const failure = (status: number, message: string, code?: string) =>
    new ApiError(status, message, undefined, code);

  async function submitAnd(rejection: unknown): Promise<void> {
    mockParams = {};
    renderSheet();
    mockUpload.mockRejectedValueOnce(rejection);
    fireEvent.changeText(screen.getByTestId('log-text'), 'barbell curl 3x10 at 50');
    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });
  }

  it('says the busy line, and keeps what was typed', async () => {
    await submitAnd(failure(503, 'ignored server prose', 'provider_overloaded'));

    expect(await screen.findByText('The reader is busy right now — try again in a few seconds.')).toBeTruthy();
    expect(screen.queryByText(/529|request_id|overloaded_error|\{|ignored server prose/)).toBeNull();
    // And the words are still in the box, ready to send again.
    expect(screen.getByTestId('log-text').props.value).toBe('barbell curl 3x10 at 50');
  });

  // The failure this policy exists for: an exhausted credit balance is not the user's
  // input, is not going to clear in five seconds, and is none of their business.
  it('says the reader is down when the provider cannot serve at all', async () => {
    await submitAnd(
      failure(503, '400 {"type":"error","error":{"message":"Your credit balance is too low"}}', 'reader_unavailable'),
    );

    expect(
      await screen.findByText('The reader is down right now. Your words are kept — try again in a bit.'),
    ).toBeTruthy();
    expect(screen.queryByText(/credit balance|400|\{|request_id/)).toBeNull();
    expect(screen.getByTestId('log-text').props.value).toBe('barbell curl 3x10 at 50');
  });

  it('says an unusable answer plainly', async () => {
    await submitAnd(failure(502, 'fake-model returned no structured output', 'reader_failed'));

    expect(await screen.findByText("That didn't get read. Nothing was lost — try again.")).toBeTruthy();
    expect(screen.queryByText(/fake-model|structured output/)).toBeNull();
  });

  // The whole point of a closed table: the shape nobody planned for is the one most likely
  // to be developer talk, so it gets the generic line rather than the passthrough.
  it.each([
    ['an unknown code', failure(500, 'some new prose nobody wrote copy for', 'brand_new_code')],
    ['a bare 500 with a stack-ish message', failure(500, 'TypeError: cannot read property x of undefined')],
    ['a thrown string', 'kaboom'],
    ['a thrown object', { weird: true }],
    ['a raw provider error', failure(500, '400 {"type":"error","error":{"type":"invalid_request_error"}}')],
  ])('renders the generic line for %s, never the raw text', async (_name, rejection) => {
    await submitAnd(rejection);

    expect(await screen.findByText(/That didn't get read|Could not read that/)).toBeTruthy();
    expect(screen.queryByText(/TypeError|kaboom|invalid_request_error|\{|brand_new_code|some new prose/)).toBeNull();
    // Typed input survives every one of them.
    expect(screen.getByTestId('log-text').props.value).toBe('barbell curl 3x10 at 50');
  });

  // Our OWN routes write sentences about the request itself, and those are worth showing:
  // replacing "Could not understand that." with a shrug hides something fixable.
  // An unknown code on a 503 still means "come back later", so it says that rather than
  // falling through to the prose the server sent with it.
  it('reads an unknown code on a 503 as come-back-later, not as text to print', async () => {
    await submitAnd(failure(503, 'brand new server prose', 'brand_new_code'));
    expect(await screen.findByText('The reader is busy right now — try again in a few seconds.')).toBeTruthy();
    expect(screen.queryByText(/brand new server prose|brand_new_code/)).toBeNull();
  });

  it("keeps our own server's sentence about the request", async () => {
    await submitAnd(failure(422, 'Could not understand that.'));
    expect(await screen.findByText('Could not understand that.')).toBeTruthy();
  });
});

// ── generating a session, with or without a word about it ────────────────────────────
//
// User decision 2026-09-03: "Generate today's workout" opens this sheet instead of firing.
// "The form opens and I can say anything — shorter or longer, or if I'm interested in
// something different — so my preferences are added for that day."
//
// The law it must not break is the one that made this app: **no forms**. The box is an
// offer to speak, so pressing Generate with nothing in it is a complete, first-class
// answer — it runs exactly the generation the button used to run, with no nag and no
// required field.

describe('the plan-new door', () => {
  /** What the sheet needs to answer while it generates. */
  function serveGeneration(read: FusionResult[] = []): { path: string; body?: Record<string, unknown> }[] {
    const calls: { path: string; body?: Record<string, unknown> }[] = [];
    mockApi.mockImplementation((path: string, options?: { body?: Record<string, unknown> }) => {
      calls.push({ path, ...(options ?? {}) });
      if (path === '/api/coach/next/regenerate') return Promise.resolve({ brief: { headline: 'Pull day' } });
      if (path === '/api/log/confirm') return Promise.resolve({ ok: true });
      return Promise.resolve(null);
    });
    // Words are classified before they are used, so a standing preference said while asking
    // for a session is kept as one (app/log.tsx §saveStandingPreferences).
    mockUpload.mockResolvedValue(analyzed(read));
    return calls;
  }

  it('offers Generate on an empty box, and says nothing about needing words', async () => {
    mockParams = { framing: 'plan-new' };
    serveGeneration();
    renderSheet();

    expect(screen.getByText('What should today be?')).toBeTruthy();
    expect(screen.getByTestId('log-framing-note').props.children).toMatch(/say nothing/i);
    // Enabled with an empty box: this is the normal way to use it.
    expect(screen.getByTestId('log-submit').props.accessibilityState?.disabled).toBeFalsy();
  });

  it('generates the plain session when nothing is said', async () => {
    mockParams = { framing: 'plan-new' };
    const calls = serveGeneration();
    renderSheet();

    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });

    // The generation ran…
    expect(calls.some((call) => call.path === '/api/coach/next/regenerate')).toBe(true);
    // …and nothing was written as context, because nothing was said.
    expect(calls.some((call) => call.path === '/api/log/confirm')).toBe(false);
    expect(mockBack).toHaveBeenCalled();
  });

  it('sends what was said as the ask’s own context, in one call', async () => {
    mockParams = { framing: 'plan-new' };
    const calls = serveGeneration();
    renderSheet();

    fireEvent.changeText(screen.getByTestId('log-text'), 'only 30 minutes and my knee is sore');
    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });

    const ask = calls.find((call) => call.path === '/api/coach/next/regenerate');
    expect(ask).toBeTruthy();
    // `context` — "a fact about today the next brief should account for" — and never
    // `revision`, which is an instruction about a brief that does not exist yet.
    expect(ask!.body!.context).toBe('only 30 minutes and my knee is sore');
    expect(ask!.body!.revision).toBeNull();
    // Nothing was saved as standing: "only 30 minutes" is about today, and the reader said
    // so by classifying it as nothing standing.
    expect(calls.filter((call) => call.path === '/api/log/confirm')).toHaveLength(0);
    expect(mockBack).toHaveBeenCalled();
  });

  it('writes no meal, no set and no weigh-in — this door logs nothing', async () => {
    mockParams = { framing: 'plan-new' };
    // The reader classifies a meal out of the words; the generate door must not save it.
    const calls = serveGeneration([
      { kind: 'meal', description: 'eggs', kcal: 200, protein_g: 12, carbs_g: 2, fat_g: 14, fiber_g: 0, items: [], meal_type: null, confidence: 'high', sources: {}, consistency: null } as unknown as FusionResult,
    ]);
    renderSheet();

    fireEvent.changeText(screen.getByTestId('log-text'), 'something with the bands');
    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });

    // Only standing preferences are saved from this door; a record is not one.
    expect(calls.some((call) => call.path === '/api/log/confirm')).toBe(false);
    expect(calls.some((call) => call.path === '/api/coach/next/regenerate')).toBe(true);
  });

  // The other half of the field report: a preference said while asking for a session is
  // still a preference, and it shapes every plan from now on.
  it('keeps a standing preference said while asking, and still generates today', async () => {
    mockParams = { framing: 'plan-new' };
    const calls = serveGeneration([
      { kind: 'preference', text: 'rotate my cardio and keep introducing me to new exercises' } as unknown as FusionResult,
    ]);
    renderSheet();

    fireEvent.changeText(screen.getByTestId('log-text'), 'rotate my cardio and keep introducing me to new exercises');
    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });

    const saved = calls.find((call) => call.path === '/api/log/confirm');
    expect(saved).toBeTruthy();
    expect((saved!.body!.results as { kind: string }[])[0]!.kind).toBe('preference');
    // And today still gets it, as the ask's own context.
    const ask = calls.find((call) => call.path === '/api/coach/next/regenerate');
    expect(ask!.body!.context).toContain('rotate my cardio');
  });
});

// ── the answer that never came back ──────────────────────────────────────────────────
// Field report 2026-09-02: the user asked for a session, watched "Thinking…", and watched
// the page revert to "Nothing planned yet" — while a five-item brief sat finished on the
// server. A model call over a phone connection outran the platform's 60-second fetch
// ceiling, the promise rejected, and the screen said nothing at all.
//
// The recovery that answers that lives in `useStartWorkout`, and since 2026-09-03 the
// generation runs from THIS sheet — so this is where the machinery is held to its promises:
// it polls rather than reverting, it never ends in silence, and one tap is one generation.

describe('a generation whose answer is lost', () => {
  const lost = () => Object.assign(new Error('Network request failed'), { name: 'TypeError' });

  /** The generate call drops; then the server admits it has a plan after all. */
  function serveLostAnswer({ everFinds = true }: { everFinds?: boolean } = {}) {
    let found = false;
    mockApi.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/coach/next/regenerate' && options?.method === 'POST') {
        // The generation succeeds server-side; the ANSWER is what is lost.
        found = everFinds;
        return Promise.reject(lost());
      }
      if (path === '/api/coach/status') {
        return Promise.resolve({ date: '2026-08-30', has_plan: found, done_count: 0, total_count: found ? 5 : 0, complete: false });
      }
      return Promise.resolve(null);
    });
  }

  const asks = () =>
    mockApi.mock.calls.filter(([path, options]) => path === '/api/coach/next/regenerate' && options?.method === 'POST');

  afterEach(() => jest.useRealTimers());

  /** Let the sheet settle before freezing the clock, or the press lands on a dead button. */
  async function settleThenFreeze() {
    mockParams = { framing: 'plan-new' };
    renderSheet();
    await act(async () => {});
    jest.useFakeTimers();
  }

  it('polls for the plan instead of giving up, and closes when it turns up', async () => {
    serveLostAnswer();
    await settleThenFreeze();

    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });

    // The poll took over rather than the sheet reverting or closing on nothing.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_000);
    });
    expect(mockApi.mock.calls.some(([path]) => path === '/api/coach/status')).toBe(true);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_000);
    });
    // The plan the server had all along was found, so the sheet gets out of the way.
    expect(mockBack).toHaveBeenCalled();
    // Exactly one generation was ever asked for.
    expect(asks()).toHaveLength(1);
  });

  it('never ends in silence: it says so in words, and the sheet stays open', async () => {
    serveLostAnswer({ everFinds: false });
    await settleThenFreeze();

    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });
    // Each wait is created after the previous one resolves, so the clock has to be advanced
    // with the microtasks flushed between — one big jump only ever fires the first sleep.
    for (const ms of RECOVERY_DELAYS_MS) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });
    }
    await act(async () => {});

    const said = screen.getByTestId('log-error');
    expect(said).toHaveTextContent(/didn’t come back/);
    expect(said).toHaveTextContent(/may still be being written/);
    // It never claims the plan failed, because it does not know that.
    expect(said).not.toHaveTextContent(/failed/i);
    // The sheet is still here, with the words still in it, so nothing was lost.
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('will not let a second tap start a second generation while the first is in flight', async () => {
    serveLostAnswer();
    await settleThenFreeze();

    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
      fireEvent.press(screen.getByTestId('log-submit'));
    });
    expect(asks()).toHaveLength(1);
  });

  it('says a refusal plainly rather than polling for a plan nobody is writing', async () => {
    // A 503 is an answer. Only a LOST answer is worth waiting on.
    mockApi.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/api/coach/next/regenerate' && options?.method === 'POST') {
        return Promise.reject(new ApiError(503, 'The reader is down right now.', undefined, 'reader_unavailable'));
      }
      return Promise.resolve(null);
    });
    await settleThenFreeze();

    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });
    await act(async () => {});

    expect(screen.getByTestId('log-error')).toHaveTextContent(
      'The reader is down right now. Your words are kept — try again in a bit.',
    );
    expect(mockApi.mock.calls.some(([path]) => path === '/api/coach/status')).toBe(false);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

// ── the preference typed into the adjust door ────────────────────────────────────────
// Field report 2026-09-03, with a screenshot: the user typed "I want variety — rotate my
// cardio... keep introducing me to new exercises" into *Adjust the plan* and got "Could
// not adjust the plan." It is a standing preference, not a change to one session — the
// adjust endpoint had nothing to append it to — and a dead end is what they got for saying
// something sensible in the one place this app promises they can say anything.

describe('the adjust door', () => {
  function serveAdjust(read: FusionResult[], { adjustFails = false } = {}) {
    const calls: { path: string; body?: Record<string, unknown> }[] = [];
    mockApi.mockImplementation((path: string, options?: { body?: Record<string, unknown> }) => {
      calls.push({ path, ...(options ?? {}) });
      if (path === '/api/coach/next/regenerate') {
        return adjustFails
          ? Promise.reject(new ApiError(422, 'Nothing to adjust.'))
          : Promise.resolve({ brief: { headline: 'Pull day' } });
      }
      return Promise.resolve({ ok: true });
    });
    mockUpload.mockResolvedValue(analyzed(read));
    return calls;
  }

  const PREFERENCE = [
    { kind: 'preference', text: 'rotate my cardio and keep introducing me to new exercises' } as unknown as FusionResult,
  ];

  async function adjust(said: string) {
    mockParams = { framing: 'plan' };
    renderSheet();
    fireEvent.changeText(screen.getByTestId('log-text'), said);
    await act(async () => {
      fireEvent.press(screen.getByTestId('log-submit'));
    });
  }

  it('saves a standing preference and says what it changed, instead of a dead end', async () => {
    // The adjust itself fails, exactly as it did in the report: there is nothing on today's
    // plan for "rotate my cardio" to append to.
    const calls = serveAdjust(PREFERENCE, { adjustFails: true });
    await adjust('I want variety — rotate my cardio, keep introducing me to new exercises');

    const saved = calls.find((call) => call.path === '/api/log/confirm');
    expect(saved).toBeTruthy();
    expect((saved!.body!.results as { kind: string }[])[0]!.kind).toBe('preference');

    // What the user sees is what happened, not what failed.
    expect(await screen.findByTestId('log-notice')).toHaveTextContent(
      'Saved as a standing preference — it shapes every plan from now on.',
    );
    expect(screen.queryByTestId('log-error')).toBeNull();
  });

  it('still adjusts today when the plan can take it', async () => {
    const calls = serveAdjust(PREFERENCE);
    await adjust('rotate my cardio');

    // Both halves: saved standing, and today's plan asked to take it as an append.
    expect(calls.some((call) => call.path === '/api/log/confirm')).toBe(true);
    const ask = calls.find((call) => call.path === '/api/coach/next/regenerate');
    expect(ask!.body).toMatchObject({ revision: 'rotate my cardio', mode: 'append' });
    expect(mockBack).toHaveBeenCalled();
  });

  // A plain day-change is not a preference and must not become one.
  it('leaves a change about today to the adjust, saving nothing standing', async () => {
    const calls = serveAdjust([
      { kind: 'coach_context', text: 'only 30 minutes today' } as unknown as FusionResult,
    ]);
    await adjust('only 30 minutes today');

    expect(calls.some((call) => call.path === '/api/log/confirm')).toBe(false);
    const ask = calls.find((call) => call.path === '/api/coach/next/regenerate');
    expect(ask!.body).toMatchObject({ revision: 'only 30 minutes today', mode: 'append' });
  });

  it('shows our own 4xx sentence when the server wrote one', async () => {
    // "Nothing to adjust." is this server's own words about the request, and those are
    // still shown (lib/errors.ts): the policy replaces machine prose, not plain English.
    serveAdjust([{ kind: 'coach_context', text: 'add some core' } as unknown as FusionResult], { adjustFails: true });
    await adjust('add some core');
    expect(await screen.findByTestId('log-error')).toHaveTextContent('Nothing to adjust.');
  });

  it('names a way forward when the failure says nothing usable', async () => {
    const calls: { path: string }[] = [];
    mockApi.mockImplementation((path: string) => {
      calls.push({ path });
      // A network throw: no code, no status, nothing the policy table can speak to — which
      // is where the caller's own sentence is the one the user gets.
      if (path === '/api/coach/next/regenerate') return Promise.reject(new Error('Network request failed'));
      return Promise.resolve({ ok: true });
    });
    mockUpload.mockResolvedValue(analyzed([{ kind: 'coach_context', text: 'add some core' } as unknown as FusionResult]));
    await adjust('add some core');

    const said = await screen.findByTestId('log-error');
    // A dead end that at least names the way out.
    expect(said).toHaveTextContent(/Could not adjust the plan/);
    expect(said).toHaveTextContent(/add some core|make it shorter/);
  });
});
