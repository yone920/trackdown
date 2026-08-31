import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmCard, type DateChoice } from '@/components/confirm-card';
import { Control } from '@/components/control';
import { IconCamera, IconClose, IconKeyboard, IconMic } from '@/components/icons';
import { Card, Chip, Chips, Skeleton, SkeletonLines } from '@/components/kit';
import { Body, Disp, Sub } from '@/components/type';
import { ApiError } from '@/lib/api';
import { recordToResult, resultToPatch, type EditKind } from '@/lib/edit-record';
import { keyboardPadding, useKeyboardHeight } from '@/lib/keyboard';
import { MAX_PHOTOS, pickPhotos, takePhoto, type LocalPhoto } from '@/lib/photos';
import { getSpeech } from '@/lib/ports/speech';
import { useAnalyze, useConfirm, useDayLog, usePatchRecord } from '@/lib/queries';
import { C, FONT, RADIUS, SPACE } from '@/lib/theme';
import type { FusionResult } from '@/lib/types';

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
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    hint?: string;
    editDate?: string;
    editId?: string;
    editKind?: string;
  }>();
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
  // True from "Make a change" until the change is told: the box is then an instruction
  // about the parts on screen, not a new log.
  const [revising, setRevising] = useState(false);
  // A correction has something to save only once something has actually been changed.
  const [changed, setChanged] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribed, setTranscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useAnalyze();
  const confirm = useConfirm();
  const patch = usePatchRecord();
  const keyboard = useKeyboardHeight();

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
    setRevising(false);
    setChanged(false);
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
        kindHint: typeof params.hint === 'string' ? params.hint : null,
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
      setError(caught instanceof ApiError ? caught.message : 'Could not read that.');
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
      setText('');
      setTranscribed(false);
      setRevising(false);
      setChanged(true);
      setStep('review');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not make that change.');
    }
  };

  /** Log, or Change it: the same button, doing the thing the step is for. */
  const submit = () => {
    if (revising) void runRevise(text);
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
    // Nothing left to review is the say-it step again, with the words still in the box.
    if (remaining === 0) setStep('say');
  };

  const saveEdit = async () => {
    const result = results[0];
    if (!result || !editing || !editKind) return;
    const body = resultToPatch(editKind, result);
    if (!body) return;
    setError(null);
    try {
      await patch.mutateAsync({ kind: editKind, id: editId!, patch: body });
      router.back();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save that change.');
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
        text: text.trim() || null,
        textKind: transcribed ? 'transcript' : 'text',
        source: evidenceIds.length > 0 ? 'fused' : 'manual',
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
                : 'What did you do?'}
        </Disp>

        {step === 'review' ? (
          <Sub style={{ marginTop: 10, lineHeight: 18 }}>
            {editing
              ? editEntry?.raw_text
                ? `You said: “${editEntry.raw_text}”`
                : 'Tell me what to change; the words that were recorded stay as they were.'
              : savable.length > 1
                ? `${savable.length} things. Drop what you did not mean, then log them all at once.`
                : 'Log it, or tell me what to change.'}
          </Sub>
        ) : null}

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
                    : 'Shoulder press, three sets of ten at forty pounds…'
              }
              placeholderTextColor={C.dim}
              style={{
                marginTop: 18,
                minHeight: 110,
                fontFamily: FONT.dispSemi,
                fontSize: 20,
                lineHeight: 26,
                color: C.ink,
                backgroundColor: C.card,
                borderRadius: RADIUS.card,
                padding: SPACE.card,
              }}
            />

            {photos.length === 0 ? null : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingTop: 12 }}>
                {photos.map((photo) => (
                  <Pressable
                    key={photo.uri}
                    onPress={() => setPhotos((current) => current.filter((p) => p.uri !== photo.uri))}
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: RADIUS.thumb,
                      overflow: 'hidden',
                      backgroundColor: C.track,
                    }}>
                    <Image source={{ uri: photo.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                  </Pressable>
                ))}
              </ScrollView>
            )}

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
              {revising
                ? 'Say it or type it — the numbers you do not mention stay as they are.'
                : 'Say it, snap it, or type it — any mix. Same for food, weight, goals.'}
              {speech.available ? '' : ' (Speaking needs the dev build; typing and photos work here.)'}
            </Sub>

            <View style={{ marginTop: 14 }}>
              <Chips>
                <Chip
                  testID="log-submit"
                  label={analyze.isPending ? (revising ? 'Changing…' : 'Reading…') : revising ? 'Change it' : 'Log'}
                  variant="primary"
                  onPress={submit}
                  disabled={!canSubmit}
                />
                {revising ? (
                  <Chip
                    testID="revise-cancel"
                    label="Never mind"
                    onPress={() => {
                      setRevising(false);
                      setText('');
                      setStep('review');
                    }}
                    disabled={analyze.isPending}
                  />
                ) : photos.length < MAX_PHOTOS ? (
                  <Chip label="From library" onPress={() => void addPhotos('library')} />
                ) : null}
              </Chips>
            </View>
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

            <View style={{ marginTop: 18 }}>
              <Chips>
                {editing ? (
                  changed ? (
                    <Chip
                      testID="confirm-save"
                      label={busy ? 'Saving…' : 'Save changes'}
                      variant="primary"
                      onPress={() => void saveEdit()}
                      disabled={busy}
                    />
                  ) : null
                ) : savable.length > 0 ? (
                  <Chip
                    testID="confirm-save"
                    label={busy ? 'Saving…' : savable.length > 1 ? `Log all ${savable.length}` : 'Log it'}
                    variant="primary"
                    onPress={() => void save(false)}
                    disabled={busy}
                  />
                ) : null}
                <Chip
                  testID="log-make-change"
                  label="Make a change"
                  variant={editing && !changed ? 'primary' : 'secondary'}
                  onPress={() => {
                    setRevising(true);
                    setText('');
                    setError(null);
                    setStep('say');
                  }}
                  disabled={busy}
                />
                {editing ? null : (
                  <Chip
                    testID="confirm-add-more"
                    label="Add more"
                    onPress={() => (savable.length === 0 ? reset() : void save(true))}
                    disabled={busy}
                  />
                )}
              </Chips>
            </View>

            <Body style={{ marginTop: 16, color: C.mute, fontSize: 13, lineHeight: 19 }}>
              Nothing to type: tell me what is wrong and I will read it again.
            </Body>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
