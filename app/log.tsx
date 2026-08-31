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
import { Disp, Sub } from '@/components/type';
import { ApiError } from '@/lib/api';
import { recordToResult, resultToPatch, type EditKind } from '@/lib/edit-record';
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
// Speak goes through lib/ports/speech.ts. In Expo Go the native module is absent, the port
// reports unavailable, and the control is simply not drawn: the morning test still logs by
// typing and by photo.
//
// The same sheet is also the **editor**: the DayLog pushes `editDate`/`editId`/`editKind`
// here, the row comes back as a confirm card with its saved values in it, and Save PATCHes
// instead of confirming. One card for "is this right?" and for "that was wrong" — the
// screen the user learned the first time is the screen they get the second time.
//
// One input can be several things. "Ate two eggs, ran 5k, weighed in at 181" comes back as
// three parts, drawn as three cards down the sheet — each editable, each removable with its
// ✕ — under ONE Save, which writes all of them in one transaction (concept-v2 §One input
// mechanism: the user says everything at once and the app sorts it out). "Add more" saves
// the batch and leaves the sheet open for the next thing.

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
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [evidenceParts, setEvidenceParts] = useState<number[]>([]);
  // Every part of what was just read, in the order it was said. One card each, one Save.
  const [results, setResults] = useState<FusionResult[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [dateChoice, setDateChoice] = useState<DateChoice>('proposed');
  const [listening, setListening] = useState(false);
  const [transcribed, setTranscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useAnalyze();
  const confirm = useConfirm();
  const patch = usePatchRecord();

  // Edit mode reads the row back from the same endpoint the DayLog drew it with, rather
  // than being handed it through navigation params: a screen that trusts its params is a
  // screen that shows a stale row after the previous edit.
  const dayLog = useDayLog(editing ? editDate : '');
  const editEntry = editing ? (dayLog.data?.entries.find((entry) => entry.id === editId) ?? null) : null;
  useEffect(() => {
    if (!editEntry || results.length > 0) return;
    const seeded = recordToResult(editEntry.record);
    if (seeded) setResults([seeded]);
    // Only seeds once — after that the card owns the values the user is editing.
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
    setError(null);
  };

  const runAnalyze = async (withText: string, withPhotos: LocalPhoto[]) => {
    if (!withText.trim() && withPhotos.length === 0) return;
    setError(null);
    try {
      const response = await analyze.mutateAsync({
        text: withText.trim() || null,
        photos: withPhotos,
        kindHint: typeof params.hint === 'string' ? params.hint : null,
      });
      // `results` since the mixed-input fix; `result` is the old single-part shape, kept
      // for one release so a phone that has not updated still works against a new server.
      setResults(response.results ?? (response.result ? [response.result] : []));
      setEvidenceIds(response.evidence.map((item) => item.id));
      setEvidenceParts(response.evidence.map((item) => item.part ?? 0));
      // One id per Save, however many parts it holds: a retry after a timeout must replay,
      // not log the meal and the run twice (backend/src/services/fusion/confirm.ts).
      setClientId(Crypto.randomUUID());
      setDateChoice('proposed');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not read that.');
    }
  };

  /** Drops one part, and the photos that were read for it, from the batch. */
  const removePart = (index: number) => {
    setResults((current) => current.filter((_, i) => i !== index));
    setEvidenceIds((current) => current.filter((_, i) => evidenceParts[i] !== index));
    setEvidenceParts((current) =>
      current.filter((part) => part !== index).map((part) => (part > index ? part - 1 : part)),
    );
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
        void runAnalyze(final, photos);
      },
      onError: (message) => {
        setListening(false);
        setError(message);
      },
      onEnd: () => setListening(false),
    });
  };

  const canRead = (text.trim().length > 0 || photos.length > 0) && !analyze.isPending;
  /** The parts that are records rather than questions — what Save would actually write. */
  const savable = results.filter((result) => result.kind !== 'unclear');

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: SPACE.screen,
          paddingTop: insets.top + 8,
          paddingBottom: insets.bottom + 60,
        }}>
        <Pressable
          accessibilityLabel="Close"
          testID="log-close"
          onPress={() => router.back()}
          style={{ alignSelf: 'flex-end', padding: 6 }}>
          <IconClose size={24} color={C.mute} />
        </Pressable>

        <Disp size={34} style={{ marginTop: 4 }}>
          {editing ? 'Fix what was saved' : 'What did you do?'}
        </Disp>

        {editing ? (
          <Sub style={{ marginTop: 10, lineHeight: 18 }}>
            {editEntry?.raw_text
              ? `You said: “${editEntry.raw_text}”`
              : 'Change what was understood; the words that were recorded stay as they were.'}
          </Sub>
        ) : null}

        {editing ? null : (
        <TextInput
          ref={inputRef}
          testID="log-text"
          value={text}
          onChangeText={(next) => {
            setText(next);
            setTranscribed(false);
          }}
          multiline
          placeholder="Shoulder press, three sets of ten at forty pounds…"
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
        )}

        {editing || photos.length === 0 ? null : (
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

        {editing ? null : (
        <View>
        {/* Photo · Speak · Type */}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 18 }}>
          <Control label="Photo" onPress={() => addPhotos('camera')} testID="control-photo">
            <IconCamera size={26} color={C.ink} />
          </Control>
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
          Say it, snap it, or type it — any mix. Same for food, weight, goals.
          {speech.available ? '' : ' (Speaking needs the dev build; typing and photos work here.)'}
        </Sub>

        <View style={{ marginTop: 14 }}>
          <Chips>
            <Chip
              testID="log-read"
              label={analyze.isPending ? 'Reading…' : 'Read it'}
              variant="primary"
              onPress={() => void runAnalyze(text, photos)}
              disabled={!canRead}
            />
            {photos.length < MAX_PHOTOS ? (
              <Chip label="From library" onPress={() => void addPhotos('library')} />
            ) : null}
          </Chips>
        </View>

        </View>
        )}

        {/* The confirm card, in outline, while the read is running: the sheet already
            shows where the answer is going to land. */}
        {analyze.isPending || (editing && !editEntry && dayLog.isLoading) ? (
          <Card testID="log-skeleton" style={{ marginTop: 24 }}>
            <Skeleton width="40%" height={12} />
            <View style={{ marginTop: 14 }}>
              <SkeletonLines lines={3} />
            </View>
          </Card>
        ) : null}

        {error && results.length === 0 ? <Sub style={{ marginTop: 14, color: C.accent }}>{error}</Sub> : null}

        {results.length > 1 ? (
          <Sub style={{ marginTop: 20 }}>
            {`Read ${results.length} things in that. Fix any of them, drop what you did not mean, then Save once.`}
          </Sub>
        ) : null}

        {results.map((result, index) => (
          <ConfirmCard
            key={index}
            testID={index === 0 ? 'confirm-card' : `confirm-card-${index}`}
            result={result}
            onChange={(next) => setResults((current) => current.map((r, i) => (i === index ? next : r)))}
            // Nothing to drop when the whole log is one thing: the ✕ at the top closes it.
            {...(results.length > 1 ? { onRemove: () => removePart(index) } : {})}
            dateChoice={dateChoice}
            onDateChoice={setDateChoice}
            onSave={() => void (editing ? saveEdit() : save(false))}
            onAddMore={() => void save(true)}
            saving={confirm.isPending || patch.isPending}
            {...(index === results.length - 1 ? { error } : {})}
            saveLabel={editing ? 'Save changes' : 'Save'}
            showAddMore={!editing}
            // One Save under the whole stack, not one per card.
            showActions={false}
            eyebrow={editing ? `As recorded · ${editKind}` : undefined}
          />
        ))}

        {results.length > 0 ? (
          <View style={{ marginTop: 18 }}>
            <Chips>
              {savable.length > 0 ? (
                <Chip
                  testID="confirm-save"
                  label={
                    confirm.isPending || patch.isPending
                      ? 'Saving…'
                      : editing
                        ? 'Save changes'
                        : savable.length > 1
                          ? `Save all ${savable.length}`
                          : 'Save'
                  }
                  variant="primary"
                  onPress={() => void (editing ? saveEdit() : save(false))}
                  disabled={confirm.isPending || patch.isPending}
                />
              ) : null}
              {editing ? null : (
                <Chip
                  testID="confirm-add-more"
                  label="Add more"
                  // Nothing to save behind a question: clear it and let them say it again.
                  onPress={() => (savable.length === 0 ? reset() : void save(true))}
                  disabled={confirm.isPending}
                />
              )}
            </Chips>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
