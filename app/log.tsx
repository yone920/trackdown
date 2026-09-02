import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { ConfirmCard, type DateChoice } from '@/components/confirm-card';
import { Control } from '@/components/control';
import { EvidenceThumbs, LocalThumbs } from '@/components/evidence';
import { IconCamera, IconClose, IconKeyboard, IconMic } from '@/components/icons';
import { BigButton, Card, Chip, Chips, Skeleton, SkeletonLines } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { ApiError, BUSY_MESSAGE, isBusyError } from '@/lib/api';
import {
  recordToResult,
  resultToPatch,
  resultToSplit,
  savableCorrections,
  type EditKind,
} from '@/lib/edit-record';
import { correctionLine } from '@/lib/format';
import { copyFor, framingOf } from '@/lib/log-framing';
import { composeMaxHeight, footerLift, keyboardPadding, useKeyboardHeight } from '@/lib/keyboard';
import { MAX_PHOTOS, pickPhotos, takePhoto, type LocalPhoto } from '@/lib/photos';
import { getSpeech } from '@/lib/ports/speech';
import { useAnalyze, useAskCoach, useConfirm, useDayLog, usePatchRecord, useSplitRecord } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, RADIUS, SPACE } from '@/lib/theme';
import type { FusionResult, PartCorrection } from '@/lib/types';

// The log sheet (docs/design-system.md §Log). One screen for everything you can tell the
// app — an exercise, a plate, a weigh-in, a goal, a constraint, or a sentence for the
// coach — because concept-v2 §Principles 7 is that there is one input mechanism and the
// classifier routes it.
//
// **Two steps, and no form in either of them** (concept-v2 §Principles 7, NO FORMS, user
// decision 2026-08-31):
//
//   SAY IT     the text box, the photos, Speak — and one button, "Log".
//   REVIEW     "Does this look right?" — what was understood, as read-only cards, each
//              droppable with its ✕. "Log it" saves. "Make a change" goes back to the box.
//
// "Make a change" is the whole point. The user does not correct a number by typing into a
// field, because there are no fields: they say what is wrong — "reps were 3, not 4",
// "that meal was lunch not dinner" — and the same parts come back revised
// (`POST /api/log/analyze` with `revise`). One input mechanism, for logging and for
// correcting, exactly as the concept says.
//
// Speak goes through lib/ports/speech.ts. In Expo Go the native module is absent, the port
// reports unavailable, and the control is simply not drawn: the morning test still logs by
// typing and by photo.
//
// The same sheet is also the **corrector**: the DayLog pushes `editDate`/`editId`/
// `editKind` here, the row comes back as a read-only card, and "Make a change" tells it
// what to change — the revised values go out as a PATCH instead of a confirm.
//
// One input can be several things. "Ate two eggs, ran 5k, weighed in at 181" comes back as
// three parts, drawn as three cards on the review step — each removable with its ✕ — under
// ONE "Log it", which writes all of them in one transaction.

/** The two steps. The review step is its own page: it is the thing being confirmed. */
type Step = 'say' | 'review';

export default function LogSheet() {
  const router = useRouter();
  const insets = useScreenInsets();
  const params = useLocalSearchParams<{
    hint?: string;
    editDate?: string;
    editId?: string;
    editKind?: string;
    framing?: string;
  }>();
  /**
   * How this sheet introduces itself, decided by the door that opened it
   * (lib/log-framing.ts). It changes the WORDS and nothing else — same say / type / snap,
   * same reader, same routing — because there is exactly one input surface in this app
   * (concept-v2 §Principles 7) and a second one dressed as a helpful shortcut is still a
   * second one.
   *
   * `plan` is the one framing that also changes where the words GO: it is not a record of
   * something that happened, so nothing is analysed and nothing is confirmed, and the
   * sentence goes to the coach's adjust endpoint instead. Every other framing is the
   * ordinary path with different copy on it.
   */
  const framing = framingOf(params.framing);
  const copy = copyFor(framing);
  const adjustingPlan = framing === 'plan';
  const editId = typeof params.editId === 'string' ? params.editId : null;
  const editKind = (typeof params.editKind === 'string' ? params.editKind : null) as EditKind | null;
  const editDate = typeof params.editDate === 'string' ? params.editDate : '';
  const editing = !!editId && !!editKind;
  const inputRef = useRef<TextInput>(null);

  const speech = useMemo(() => getSpeech(), []);
  const [step, setStep] = useState<Step>(editing ? 'review' : 'say');
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [evidenceParts, setEvidenceParts] = useState<number[]>([]);
  // Every part of what was just read, in the order it was said. One card each, one Log it.
  const [results, setResults] = useState<FusionResult[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [dateChoice, setDateChoice] = useState<DateChoice>('proposed');
  // The question the last read came back with, and the words it was about. Kept so that
  // "yes" means something: an answer with no question attached is not a log (concept-v2
  // §One input mechanism — the app remembers what it asked).
  const [clarify, setClarify] = useState<{ originalText: string; question: string } | null>(null);
  // The words the log was MADE from, kept apart from what is in the box. "Make a change"
  // empties the box and puts an instruction in it, and an instruction is not the log: the
  // DayLog has to go on quoting what the user actually said (design-system §DayLog).
  const [said, setSaid] = useState<{ text: string; transcribed: boolean } | null>(null);
  // True from "Make a change" until the change is told: the box is then an instruction
  // about the parts on screen, not a new log.
  const [revising, setRevising] = useState(false);
  // A correction has something to save only once something has actually been changed.
  const [changed, setChanged] = useState(false);
  // Every told change this preview has been through, as the server measured it. They ride
  // along to the confirm, which writes them against the rows the parts turn into
  // (migration 0015) — a pending part has no id to file a correction against yet.
  const [corrections, setCorrections] = useState<PartCorrection[]>([]);
  // The last thing the user told a SAVED row to change. Sent with the PATCH so the server
  // can file the correction with its own diff of the row before and after.
  const [told, setTold] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribed, setTranscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useAnalyze();
  const askCoach = useAskCoach();
  const confirm = useConfirm();
  const patch = usePatchRecord();
  const split = useSplitRecord();
  const keyboard = useKeyboardHeight();
  const window = useWindowDimensions();
  // A compose box that grows for ever buries its own caret under the keyboard.
  const maxHeight = composeMaxHeight(window.height, insets.top);

  // Edit mode reads the row back from the same endpoint the DayLog drew it with, rather
  // than being handed it through navigation params: a screen that trusts its params is a
  // screen that shows a stale row after the previous edit.
  const dayLog = useDayLog(editing ? editDate : '');
  const editEntry = editing ? (dayLog.data?.entries.find((entry) => entry.id === editId) ?? null) : null;
  useEffect(() => {
    if (!editEntry || results.length > 0) return;
    const seeded = recordToResult(editEntry.record);
    if (seeded) setResults([seeded]);
    // Only seeds once — after that the screen owns the part the user is correcting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editEntry]);

  const reset = () => {
    setText('');
    setPhotos([]);
    setEvidenceIds([]);
    setEvidenceParts([]);
    setResults([]);
    setClientId(null);
    setDateChoice('proposed');
    setTranscribed(false);
    setClarify(null);
    setSaid(null);
    setRevising(false);
    setChanged(false);
    setCorrections([]);
    setTold(null);
    setError(null);
    setStep('say');
  };

  const runAnalyze = async (withText: string, withPhotos: LocalPhoto[]) => {
    if (!withText.trim() && withPhotos.length === 0) return;
    setError(null);
    try {
      const response = await analyze.mutateAsync({
        text: withText.trim() || null,
        photos: withPhotos,
        kindHint: adjustingPlan ? 'coach_context' : typeof params.hint === 'string' ? params.hint : null,
        clarify,
      });
      // `results` since the mixed-input fix; `result` is the old single-part shape, kept
      // for one release so a phone that has not updated still works against a new server.
      const read = response.results ?? (response.result ? [response.result] : []);
      setResults(read);
      // A question comes back with the words it was asked about, so the next Log can
      // resolve a one-word answer. Anything else clears the round: it was understood.
      const question = read.find((result) => result.kind === 'unclear');
      if (question?.kind === 'unclear') {
        setClarify({ originalText: clarify?.originalText ?? withText.trim(), question: question.question });
        // The box is emptied for the answer; the words it was asked about are kept here.
        setText('');
      } else {
        setClarify(null);
        // The words that produced these parts, kept for the confirm even after a change
        // has been told into the same box.
        setSaid({ text: withText.trim(), transcribed });
      }
      setEvidenceIds(response.evidence.map((item) => item.id));
      setEvidenceParts(response.evidence.map((item) => item.part ?? 0));
      // One id per Save, however many parts it holds: a retry after a timeout must replay,
      // not log the meal and the run twice (backend/src/services/fusion/confirm.ts).
      setClientId(Crypto.randomUUID());
      setDateChoice('proposed');
      // A question stays on the say-it step: there is nothing to review yet.
      if (read.length > 0 && !question) setStep('review');
    } catch (caught) {
      setError(readerError(caught, 'Could not read that.'));
    }
  };

  /**
   * The told change. The parts on screen and the instruction go to the same endpoint; what
   * comes back is the same parts, revised, and the review step redraws.
   */
  const runRevise = async (instruction: string) => {
    const said = instruction.trim();
    if (!said || results.length === 0) return;
    setError(null);
    try {
      const response = await analyze.mutateAsync({
        // One saved row goes as `record`, a pending preview as `results` — the same
        // instruction, told about the two things it can be told about.
        revise: editing ? { record: results[0]!, instruction: said } : { results, instruction: said },
      });
      const read = response.results ?? (response.result ? [response.result] : []);
      if (read.length > 0) setResults(read);
      // The record's own history, appended in the order the changes were told. A change
      // that moved nothing comes back as nothing, and nothing is what gets recorded.
      setCorrections((current) => [...current, ...(response.corrections ?? [])]);
      setTold(said);
      setText('');
      setTranscribed(false);
      setRevising(false);
      setChanged(true);
      setStep('review');
    } catch (caught) {
      setError(readerError(caught, 'Could not make that change.'));
    }
  };

  /**
   * Adjusting today's plan. The words are an instruction about the plan, so they go to the
   * coach rather than through the reader: there is no record to preview and nothing to
   * confirm. Append semantics, unchanged — replacing a plan is a separate, deliberate act
   * with its own confirmation, and it never happens by typing a sentence.
   *
   * A PHOTO is the exception, and it takes the road it always took: it is saved against
   * today as coach context, which every later ask reads back. The coach's adjust endpoint
   * has nowhere to put an image.
   */
  const runAdjustPlan = async (instruction: string) => {
    const line = instruction.trim();
    if (!line) return;
    setError(null);
    try {
      await askCoach.mutateAsync({ revision: line, mode: 'append' });
      router.back();
    } catch (caught) {
      setError(readerError(caught, 'Could not adjust the plan.'));
    }
  };

  /** Log, or Change it: the same button, doing the thing the step is for. */
  const submit = () => {
    if (revising) void runRevise(text);
    // Words about the plan go to the coach; a photo is context and goes the usual way.
    else if (adjustingPlan && photos.length === 0) void runAdjustPlan(text);
    else void runAnalyze(text, photos);
  };

  /** Drops one part, and the photos that were read for it, from the log. */
  const removePart = (index: number) => {
    const remaining = results.length - 1;
    setResults((current) => current.filter((_, i) => i !== index));
    setEvidenceIds((current) => current.filter((_, i) => evidenceParts[i] !== index));
    setEvidenceParts((current) =>
      current.filter((part) => part !== index).map((part) => (part > index ? part - 1 : part)),
    );
    // A dropped part takes its history with it, and everything after it moves up one.
    setCorrections((current) =>
      current
        .filter((correction) => correction.part !== index)
        .map((correction) =>
          correction.part > index ? { ...correction, part: correction.part - 1 } : correction,
        ),
    );
    // Nothing left to review is the say-it step again, with the words still in the box.
    if (remaining === 0) setStep('say');
  };

  const saveEdit = async () => {
    const result = results[0];
    if (!result || !editing || !editKind) return;
    setError(null);
    // A told change that could not fit in the record it was about: the revision came back
    // with SEVERAL records where one went in, because a record carries one load and the
    // load changed partway through the sets (field report 2026-09-01). That is a replace,
    // not a patch, and it is one transaction on the server so the day never holds half of
    // it. The row keeps its id — it becomes the first part — so nothing it already carries
    // is lost in the name of correcting it.
    const parts = resultToSplit(editKind, result);
    try {
      if (parts) {
        await split.mutateAsync({ id: editId!, parts, instruction: told ?? 'split this record' });
        router.back();
        return;
      }
      const body = resultToPatch(editKind, result);
      if (!body) return;
      await patch.mutateAsync({ kind: editKind, id: editId!, patch: body, instruction: told });
      router.back();
    } catch (caught) {
      setError(readerError(caught, 'Could not save that change.'));
    }
  };

  const save = async (keepOpen: boolean) => {
    // An unclear reading is a question, not a record; it goes no further than the card.
    const toSave = results.filter((result) => result.kind !== 'unclear');
    if (toSave.length === 0 || !clientId) return;
    setError(null);
    try {
      await confirm.mutateAsync({
        clientId,
        results: toSave,
        evidenceIds,
        evidenceParts,
        // What was said, not what is in the box: after a revision the box held the
        // instruction and was emptied, and neither of those is the log.
        text: said?.text || text.trim() || null,
        textKind: (said ? said.transcribed : transcribed) ? 'transcript' : 'text',
        source: evidenceIds.length > 0 ? 'fused' : 'manual',
        // Only the corrections to parts that are still on screen: a part dropped with its
        // ✕ takes its history with it, and the ones after it have moved up an index.
        corrections: savableCorrections(corrections, results),
        ...(toSave.some((result) => result.kind === 'goal')
          ? { confirmDate: dateChoice === 'confirm_date', noDate: dateChoice === 'no_date' }
          : {}),
      });
      if (keepOpen) reset();
      else router.back();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save that.');
    }
  };

  const addPhotos = async (from: 'camera' | 'library') => {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    const taken = from === 'camera' ? await takePhoto() : await pickPhotos(remaining);
    if (taken.length > 0) setPhotos((current) => [...current, ...taken].slice(0, MAX_PHOTOS));
  };

  const toggleSpeak = async () => {
    if (listening) {
      speech.stop();
      setListening(false);
      return;
    }
    const granted = await speech.requestPermission();
    if (!granted) {
      setError('Microphone or speech permission was refused.');
      return;
    }
    setListening(true);
    setTranscribed(true);
    await speech.start({
      onPartial: (partial) => setText(partial),
      onResult: (final) => {
        setText(final);
        setListening(false);
        // Spoken, in either mode: a change can be told out loud too.
        if (revising) void runRevise(final);
        else void runAnalyze(final, photos);
      },
      onError: (message) => {
        setListening(false);
        setError(message);
      },
      onEnd: () => setListening(false),
    });
  };

  const canSubmit = (text.trim().length > 0 || (!revising && photos.length > 0)) && !analyze.isPending;
  /** The parts that are records rather than questions — what "Log it" would write. */
  const savable = results.filter((result) => result.kind !== 'unclear');
  const busy = confirm.isPending || patch.isPending;

  const makeAChange = () => {
    setRevising(true);
    setText('');
    setError(null);
    setStep('say');
  };

  /**
   * What the pinned bar holds. One dominant button and, beside it, the small things.
   *
   * The rule the bug was: the primary action is a *button*, at one size, in every state.
   * Disabled is the same button at reduced opacity and pending is the same button with a
   * spinner in it — it never becomes a chip, and it is never the same shape as "From
   * library" (reported 2026-08-31).
   */
  type Action = {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    pending?: boolean;
    pendingLabel?: string;
    testID?: string;
  };

  const primary: Action | null =
    step === 'say'
      ? {
          testID: 'log-submit',
          label: revising ? 'Change it' : (copy.submit ?? 'Log'),
          pendingLabel: revising ? 'Changing…' : adjustingPlan ? 'Adjusting…' : 'Reading…',
          pending: analyze.isPending || askCoach.isPending,
          disabled: !canSubmit,
          onPress: submit,
        }
      : editing
        ? changed
          ? {
              testID: 'confirm-save',
              label: 'Save changes',
              pendingLabel: 'Saving…',
              pending: busy,
              onPress: () => void saveEdit(),
            }
          : // Nothing has been changed yet, so telling it what to change IS the action.
            { testID: 'log-make-change', label: 'Make a change', disabled: busy, onPress: makeAChange }
        : savable.length > 0
          ? {
              testID: 'confirm-save',
              label: savable.length > 1 ? `Log all ${savable.length}` : 'Log it',
              pendingLabel: 'Saving…',
              pending: busy,
              onPress: () => void save(false),
            }
          : null;

  const secondary: Action[] =
    step === 'say'
      ? revising
        ? [
            {
              testID: 'revise-cancel',
              label: 'Never mind',
              disabled: analyze.isPending,
              onPress: () => {
                setRevising(false);
                setText('');
                setStep('review');
              },
            },
          ]
        : photos.length < MAX_PHOTOS
          ? [{ label: 'From library', onPress: () => void addPhotos('library') }]
          : []
      : [
          ...(editing && !changed
            ? []
            : [{ testID: 'log-make-change', label: 'Make a change', disabled: busy, onPress: makeAChange }]),
          ...(editing
            ? []
            : [
                {
                  testID: 'confirm-add-more',
                  label: 'Add more',
                  disabled: busy,
                  onPress: () => (savable.length === 0 ? reset() : void save(true)),
                },
              ]),
        ];

  return (
    // The keyboard, and the bug that hid the input behind it (lib/keyboard.ts): on iOS the
    // ScrollView's own `automaticallyAdjustKeyboardInsets` does the work, because inside a
    // modal presentation only UIKit knows this sheet's offset from the window — a
    // `keyboardVerticalOffset` here would be a guess, and applying both compensations at
    // once pushes the content up twice as far as the keyboard is tall. Android has no such
    // inset, so it gets the classic behaviour and the padding below.
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? undefined : 'height'}
      keyboardVerticalOffset={0}
      style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        testID="log-scroll"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          paddingHorizontal: SPACE.screen,
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 60 + keyboardPadding(keyboard),
        }}>
        <Pressable
          accessibilityLabel="Close"
          testID="log-close"
          onPress={() => router.back()}
          style={{ alignSelf: 'flex-end', padding: 6 }}>
          <IconClose size={24} color={C.mute} />
        </Pressable>

        <Disp size={34} style={{ marginTop: 4 }}>
          {step === 'review'
            ? editing
              ? 'This is what was saved'
              : 'Does this look right?'
            : revising
              ? 'What should I change?'
              : editing
                ? 'Fix what was saved'
                : copy.title}
        </Disp>

        {/* Said plainly, because every door opens the same sheet and it is not always
            obvious which act you are in the middle of (user decision 2026-09-01). Null for
            the + itself, where there is nothing to disambiguate. */}
        {step === 'say' && !revising && !editing && copy.note ? (
          <Sub testID="log-framing-note" style={{ marginTop: 10, lineHeight: 18 }}>
            {copy.note}
          </Sub>
        ) : null}

        {/* The record itself is the headline; on a fresh log this line is the instruction.
            What the user *said* is provenance and it goes below the card (user decision
            2026-08-31) — it can be a paragraph, and it is not what they came to look at. */}
        {step === 'review' ? (
          <Sub style={{ marginTop: 10, lineHeight: 18 }}>
            {editing
              ? 'Tell me what to change; the words that were recorded stay as they were.'
              : savable.length > 1
                ? `${savable.length} things. Drop what you did not mean, then log them all at once.`
                : 'Log it, or tell me what to change.'}
          </Sub>
        ) : null}

        {step === 'review' && !editing ? <LocalThumbs testID="review-photos" photos={photos} /> : null}

        {/* ── Say it ─────────────────────────────────────────────────────────────── */}
        {step === 'say' ? (
          <View>
            {revising ? (
              <Sub style={{ marginTop: 10, lineHeight: 18 }}>
                Say what is wrong with it and I will read it again. Nothing has been saved yet.
              </Sub>
            ) : null}

            <TextInput
              ref={inputRef}
              testID="log-text"
              value={text}
              onChangeText={(next) => {
                setText(next);
                setTranscribed(false);
              }}
              multiline
              placeholder={
                revising
                  ? 'Tell me what to change — “reps were 3, not 4”…'
                  : clarify
                    ? 'Answer the question…'
                    : copy.placeholder
              }
              placeholderTextColor={C.dim}
              style={{
                marginTop: 18,
                minHeight: 110,
                maxHeight,
                fontFamily: FONT.dispSemi,
                fontSize: 20,
                lineHeight: 26,
                color: C.ink,
                backgroundColor: C.card,
                borderRadius: RADIUS.card,
                padding: SPACE.card,
              }}
            />

            {/* The ✕ badge is the only thing that removes a photo. Tapping the image
                itself used to delete it with no affordance at all, which is how a user
                found out (reported 2026-08-31); now it opens the photo. */}
            <LocalThumbs
              testID="log-photos"
              photos={photos}
              onRemove={(uri) => setPhotos((current) => current.filter((photo) => photo.uri !== uri))}
            />

            {/* Photo · Speak · Type. A revision is words, so there is nothing to photograph. */}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 18 }}>
              {revising ? null : (
                <Control label="Photo" onPress={() => addPhotos('camera')} testID="control-photo">
                  <IconCamera size={26} color={C.ink} />
                </Control>
              )}
              {speech.available ? (
                <Control label={listening ? 'Listening' : 'Speak'} filled onPress={toggleSpeak} testID="control-speak">
                  <IconMic size={26} color={C.bg} />
                </Control>
              ) : null}
              <Control label="Type" onPress={() => inputRef.current?.focus()} testID="control-type">
                <IconKeyboard size={26} color={C.ink} />
              </Control>
            </View>

            <Sub style={{ marginTop: 12, lineHeight: 18 }}>
              {revising ? 'Say it or type it — the numbers you do not mention stay as they are.' : copy.hint}
              {speech.available ? '' : ' (Speaking needs the dev build; typing and photos work here.)'}
            </Sub>

          </View>
        ) : null}

        {/* The card, in outline, while the read is running: the sheet already shows where
            the answer is going to land. */}
        {analyze.isPending || (editing && !editEntry && dayLog.isLoading) ? (
          <Card testID="log-skeleton" style={{ marginTop: 24 }}>
            <Skeleton width="40%" height={12} />
            <View style={{ marginTop: 14 }}>
              <SkeletonLines lines={3} />
            </View>
          </Card>
        ) : null}

        {error && step === 'say' ? <Sub style={{ marginTop: 14, color: C.accent }}>{error}</Sub> : null}

        {/* The question, on the say-it step, where the answer to it is typed. */}
        {step === 'say'
          ? results
              .filter((result) => result.kind === 'unclear')
              .map((result, index) => <ConfirmCard key={index} result={result} testID="confirm-card" />)
          : null}

        {/* ── Review ─────────────────────────────────────────────────────────────── */}
        {step === 'review' ? (
          <View>
            {results.map((result, index) => (
              <ConfirmCard
                key={index}
                testID={index === 0 ? 'confirm-card' : `confirm-card-${index}`}
                result={result}
                // The refinement chip's one tap. There is no field on the card.
                onChange={(next) => {
                  setResults((current) => current.map((r, i) => (i === index ? next : r)));
                  setChanged(true);
                }}
                // A correction has one row and it is already saved: dropping it here would
                // mean deleting it, which is a different verb and not this screen's.
                {...(editing ? {} : { onRemove: () => removePart(index) })}
                dateChoice={dateChoice}
                {...(editing ? {} : { onDateChoice: setDateChoice })}
                eyebrow={editing ? `As recorded · ${editKind}` : undefined}
              />
            ))}

            {error ? <Sub style={{ marginTop: 14, color: C.accent }}>{error}</Sub> : null}

            <Body style={{ marginTop: 16, color: C.mute, fontSize: 13, lineHeight: 19 }}>
              Nothing to type: tell me what is wrong and I will read it again.
            </Body>

            {/* How it came to be recorded, quietly, under the record. A vertical list of
                provenance entries — the words first, with whatever was photographed
                attached to them. Corrections will append here as further entries when the
                server starts emitting them; the shape is a list so that costs no redesign
                (user decision 2026-08-31). */}
            {editing && editEntry ? (
              <View testID="record-provenance" style={{ marginTop: 26 }}>
                <Eyebrow>How this was recorded</Eyebrow>
                <View
                  style={{
                    marginTop: 12,
                    borderLeftWidth: 2,
                    borderLeftColor: C.track,
                    paddingLeft: 12,
                  }}>
                  <Sub testID="provenance-said" style={{ lineHeight: 19 }}>
                    {editEntry.raw_text
                      ? `You said: “${editEntry.raw_text}”`
                      : 'Logged without words — from a photo, or from Health.'}
                  </Sub>
                  {/* A record's photos are the other half of what it says: a transcript
                      with no picture of the tuna label is half the evidence (reported
                      2026-08-31). Tap one to see it full size. Nothing here removes
                      anything — a saved photo is part of a saved record. */}
                  <EvidenceThumbs testID="record-photos" photos={editEntry.evidence} zoomable />
                  {/* And every told change since, in the order it was told (migration
                      0015). This is the list the component was built to take: the words
                      first, then what was corrected about them — so a number nobody
                      recognises can say when it changed and what it used to be. */}
                  {editEntry.corrections?.map((correction) => (
                    <Sub
                      key={correction.id}
                      testID="provenance-correction"
                      style={{ marginTop: 10, lineHeight: 19 }}>
                      {correctionLine(correction)}
                    </Sub>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {/* The action bar is pinned rather than scrolled: the thing the sheet is FOR must
          never be somewhere the user has to dismiss the keyboard to reach (reported
          2026-08-31). On iOS it is lifted by the keyboard's own height — the ScrollView's
          `automaticallyAdjustKeyboardInsets` moves the content, not a sibling below it —
          and on Android the KeyboardAvoidingView has already shrunk the container. */}
      <View
        testID="log-actions"
        style={{
          paddingHorizontal: SPACE.screen,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          marginBottom: footerLift(keyboard),
          borderTopWidth: 1,
          borderTopColor: C.line,
          backgroundColor: C.bg,
        }}>
        {primary ? (
          <BigButton
            testID={primary.testID}
            label={primary.label}
            pending={primary.pending}
            pendingLabel={primary.pendingLabel}
            disabled={primary.disabled}
            onPress={primary.onPress}
          />
        ) : null}
        {secondary.length > 0 ? (
          <View style={{ marginTop: primary ? 12 : 0 }}>
            <Chips>
              {secondary.map((chip) => (
                <Chip
                  key={chip.label}
                  testID={chip.testID}
                  label={chip.label}
                  onPress={chip.onPress}
                  disabled={chip.disabled}
                />
              ))}
            </Chips>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * What went wrong, in the user's language.
 *
 * A busy provider is the one failure this app hits that is nobody's fault and fixes itself,
 * so it gets its own sentence — and never the SDK's, which arrived on screen once as
 * `529 {"type":"error",...,"request_id":...}` under the input box (field report
 * 2026-09-02). The typed text is kept either way; it always was.
 */
function readerError(caught: unknown, fallback: string): string {
  if (isBusyError(caught)) return BUSY_MESSAGE;
  return caught instanceof ApiError ? caught.message : fallback;
}
