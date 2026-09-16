import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';

import {
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconMic,
  IconStop,
  IconTrain,
  IconTrendDown,
  IconTrendUp,
} from '@/components/icons';
import { Chip } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { authHeaders, exerciseMediaUrl, THUMB_PHOTO_WIDTH } from '@/lib/api';
import { readerLine } from '@/lib/errors';
import { openExercise } from '@/lib/exercise';
import { MAX_PHOTOS, pickPhotos, takePhoto, type LocalPhoto } from '@/lib/photos';
import { perSideNote } from '@/lib/plates';
import { truthLine } from '@/lib/plan-truth';
import { getSpeech } from '@/lib/ports/speech';
import { useAnalyze, useConfirm } from '@/lib/queries';
import { C, RADIUS, TABULAR } from '@/lib/theme';
import type { ActivityItem, BriefExercise, FusionResult } from '@/lib/types';

// The today's-plan card (user decision 2026-09-17). Four states, one row type:
//
//   collapsed (not done) -> open -> open + composer -> collapsed (done)
//
// Two zones, never blurred together: the header bar (`track`-shaded, rounded top corners
// only) is ONE tap target for open/close — the whole strip, not just the chevron. The
// photo moved OUT of the bar entirely, into its own "View photo" chip in the body, so it
// never competes with the toggle for a tap (field report 2026-09-17: "if we make the top
// header clickable at the same time... it might be, it might not be a good experience").
//
// The composer never navigates anywhere — Log slides its own field in, above the SAME
// button, inside the same card. One button, always labelled "Log", never "Log as
// prescribed": an empty field logs exactly what was prescribed, with no LLM call at all
// (the numbers are already known); typed or spoken words are sent through the log's own
// reader — quietly prefixed with the exercise's name, so the amendment never needs to say
// it twice — and THAT confirms instead.

type Props = {
  exercise: BriefExercise;
  index: number;
  open: boolean;
  onToggle: () => void;
  /** The row's own record, so a tap on a DONE card opens the correction sheet — unchanged behaviour. */
  onCorrect: (recordId: string) => void;
  firstRecordId: string | null;
  /** After a successful log, so the parent can refetch the day and the brief. */
  onLogged: () => void;
};

/** One dictation joined onto whatever was in the field — same rule as the full logger. */
function continued(spoken: string, base: string): string {
  const heard = spoken.trim();
  if (!base) return heard;
  if (!heard) return base;
  return `${base.replace(/\s+$/, '')} ${heard}`;
}

export function PlanExerciseCard({ exercise, index, open, onToggle, onCorrect, firstRecordId, onLogged }: Props) {
  const router = useRouter();
  const analyze = useAnalyze();
  const confirm = useConfirm();
  const speech = useMemo(() => getSpeech(), []);

  const [composerOpen, setComposerOpen] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const speechBase = useRef('');
  const transcribed = useRef(false);

  const done = Boolean(exercise.completion?.done);

  // Closing the card discards the draft — logging an exercise is a fresh ask each time,
  // not a form that remembers what you almost typed for a different one.
  useEffect(() => {
    if (!open) {
      setComposerOpen(false);
      setText('');
      setPhotos([]);
      setError(null);
      transcribed.current = false;
    }
  }, [open]);

  const openPhoto = () =>
    openExercise(router, { id: exercise.exercise_id, name: exercise.name, mediaCount: exercise.media_count });

  const toggleVoice = async () => {
    if (listening) {
      speech.stop();
      setListening(false);
      return;
    }
    const granted = await speech.requestPermission();
    if (!granted) {
      setError('Microphone permission was refused.');
      return;
    }
    speechBase.current = text.trim();
    setListening(true);
    transcribed.current = true;
    await speech.start({
      onPartial: (partial) => setText(continued(partial, speechBase.current)),
      onResult: (final) => {
        setText(continued(final, speechBase.current));
        setListening(false);
      },
      onError: () => {
        setListening(false);
        setError('Could not hear that — try typing instead.');
      },
      onEnd: () => setListening(false),
    });
  };

  const addPhoto = async (from: 'camera' | 'library') => {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) return;
    const taken = from === 'camera' ? await takePhoto() : await pickPhotos(remaining);
    if (taken.length > 0) setPhotos((current) => [...current, ...taken].slice(0, MAX_PHOTOS));
  };

  const asPrescribed = (): FusionResult[] => {
    const item: ActivityItem = {
      exercise: exercise.name,
      equipment: null,
      description: exercise.name,
      category: exercise.load_lb == null && exercise.minutes != null ? 'cardio' : 'strength',
      muscle_groups: null,
      sets: exercise.sets,
      reps: exercise.reps,
      load_lb: exercise.load_lb,
      duration_min: exercise.minutes ?? null,
      distance_mi: null,
      kcal: null,
      confidence: 'high',
      sources: null,
    };
    return [{ kind: 'activities', items: [item] }];
  };

  const submit = async () => {
    setError(null);
    const said = text.trim();
    try {
      // Nothing to interpret — every field is already known, so this never calls the
      // model at all (services/fusion is for words; this is a direct confirm).
      const results =
        said.length === 0 && photos.length === 0
          ? asPrescribed()
          : await (async () => {
              // The name rides along silently so the amendment is never made to say it
              // twice ("did 4 sets" is enough — this door already knows which exercise).
              const seeded = said.length > 0 ? `${exercise.name}: ${said}` : exercise.name;
              const read = await analyze.mutateAsync({ text: seeded, photos, kindHint: 'activities' });
              return read.results ?? (read.result ? [read.result] : []);
            })();
      await confirm.mutateAsync({
        clientId: Crypto.randomUUID(),
        results,
        text: said || null,
        textKind: transcribed.current ? 'transcript' : 'text',
      });
      setComposerOpen(false);
      setText('');
      setPhotos([]);
      onLogged();
    } catch (caught) {
      setError(readerLine(caught, 'Could not log that.'));
    }
  };

  const pending = analyze.isPending || confirm.isPending;

  // ── Done: inert, no toggle. The row opens what was actually logged (unchanged
  // behaviour); the trailing door still reaches the how-to photos, same as it always
  // could (user decision 2026-09-01 — the name is the receipt, the glyph is the sheet). ──
  if (done) {
    return (
      <Pressable
        testID={`plan-card-${index}`}
        onPress={firstRecordId ? () => onCorrect(firstRecordId) : undefined}
        style={{
          backgroundColor: C.track,
          borderRadius: RADIUS.tile + 2,
          padding: 13,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          opacity: 0.55,
        }}>
        <Thumbnail exercise={exercise} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Disp size={17}>{exercise.name}</Disp>
          <Sub testID={`plan-card-${index}-truth`} style={[{ color: C.good, marginTop: 1 }, TABULAR]}>
            {truthLine(exercise.completion, exercise.barbell) ?? 'Logged'}
          </Sub>
        </View>
        <Pressable testID={`plan-card-${index}-photo`} onPress={openPhoto} hitSlop={10} style={{ padding: 2 }}>
          <IconCamera size={16} color={C.mute} strokeWidth={1.8} />
        </Pressable>
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: C.good,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <IconCheck size={12} color={C.bg} strokeWidth={3} />
        </View>
      </Pressable>
    );
  }

  // ── Collapsed: the whole bar is the tap target ──────────────────────────────────────
  if (!open) {
    return (
      <Pressable
        testID={`plan-card-${index}`}
        onPress={onToggle}
        style={{
          backgroundColor: C.track,
          borderRadius: RADIUS.tile + 2,
          padding: 13,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}>
        <Thumbnail exercise={exercise} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Disp size={17}>{exercise.name}</Disp>
            {exercise.is_new ? (
              <Chip testID={`plan-card-${index}-new`} label="New to you" onPress={openPhoto} />
            ) : null}
          </View>
          <Sub style={[{ marginTop: 1 }, TABULAR]}>{statLine(exercise)}</Sub>
          {exercise.completion?.partial && truthLine(exercise.completion, exercise.barbell) ? (
            <Sub testID={`plan-card-${index}-truth`} style={[{ marginTop: 1, color: C.good }, TABULAR]}>
              {truthLine(exercise.completion, exercise.barbell)}
            </Sub>
          ) : null}
        </View>
        {exercise.completion?.partial && exercise.completion.sets_prescribed != null ? (
          <Eyebrow style={{ color: C.good }}>
            {exercise.completion.sets_done}/{exercise.completion.sets_prescribed}
          </Eyebrow>
        ) : null}
        <IconChevronDown size={18} color={C.mute} strokeWidth={2} />
      </Pressable>
    );
  }

  // ── Open (± composer): shaded header bar, body underneath in the card colour ────────
  return (
    <View style={{ borderRadius: RADIUS.card, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,122,26,0.35)' }}>
      <Pressable
        testID={`plan-card-${index}-header`}
        onPress={onToggle}
        style={{ backgroundColor: C.track, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Thumbnail exercise={exercise} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Disp size={19}>{exercise.name}</Disp>
        </View>
        <IconChevronUp size={18} color={C.ink} strokeWidth={2.2} />
      </Pressable>

      <View style={{ backgroundColor: C.card, padding: 16, paddingTop: 14, gap: 12 }}>
        {exercise.is_new ? (
          <View style={{ alignSelf: 'flex-start' }}>
            <Chip testID={`plan-card-${index}-new-open`} label="New to you" onPress={openPhoto} />
          </View>
        ) : null}

        <Pressable
          testID={`plan-card-${index}-photo`}
          onPress={openPhoto}
          style={{
            alignSelf: 'flex-start',
            height: 44,
            paddingHorizontal: 16,
            paddingLeft: 12,
            borderRadius: 22,
            backgroundColor: C.track,
            borderWidth: 1,
            borderColor: C.line,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}>
          <IconCamera size={17} color={C.accent} />
          <Body style={{ fontSize: 14 }}>View photo</Body>
        </Pressable>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {exercise.minutes != null ? (
            // Cardio and holds carry minutes, never a load or a rep scheme (BriefExercise's
            // own contract) — one tile that says the thing that's actually true, not two
            // that say nothing.
            <StatTile label="Duration" value={`${exercise.minutes} min`} progression={exercise.progression} />
          ) : (
            <>
              <StatTile
                label="Load"
                value={exercise.load_lb != null ? `${exercise.load_lb} lb` : '—'}
                note={exercise.barbell ? perSideNote(exercise.load_lb, ['barbell']) : null}
                progression={exercise.progression}
              />
              <StatTile
                label="Sets × Reps"
                value={exercise.sets != null && exercise.reps != null ? `${exercise.sets} × ${exercise.reps}` : '—'}
              />
            </>
          )}
        </View>

        {composerOpen ? (
          <>
            <View
              style={{
                backgroundColor: C.bg,
                borderRadius: 14,
                borderWidth: 1.5,
                borderStyle: 'dashed',
                borderColor: 'rgba(255,122,26,0.55)',
                padding: 14,
                paddingBottom: 10,
              }}>
              <TextInput
                testID={`plan-card-${index}-input`}
                value={text}
                onChangeText={setText}
                placeholder="As prescribed — type or say what was different"
                placeholderTextColor={C.dim}
                multiline
                style={{ fontFamily: undefined, fontSize: 15, color: C.ink, minHeight: 44 }}
              />
              {photos.length > 0 ? (
                <Sub style={{ marginTop: 6 }}>{photos.length} photo{photos.length === 1 ? '' : 's'} attached</Sub>
              ) : null}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
                <Pressable
                  testID={`plan-card-${index}-voice`}
                  onPress={toggleVoice}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: listening ? C.accent : C.track,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  {listening ? (
                    <IconStop size={15} color={C.bg} />
                  ) : (
                    <IconMic size={15} color={C.mute} strokeWidth={1.8} />
                  )}
                </Pressable>
                <Pressable
                  testID={`plan-card-${index}-camera`}
                  onPress={() => void addPhoto('camera')}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    backgroundColor: C.track,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                  <IconCamera size={15} color={C.mute} strokeWidth={1.8} />
                </Pressable>
              </View>
            </View>
            {error ? <Sub style={{ color: C.accent }}>{error}</Sub> : null}
          </>
        ) : null}

        <Pressable
          testID={`plan-card-${index}-log`}
          onPress={() => (composerOpen ? void submit() : setComposerOpen(true))}
          disabled={pending}
          style={{
            height: 48,
            borderRadius: RADIUS.pill,
            backgroundColor: C.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pending ? 0.6 : 1,
          }}>
          {pending ? <ActivityIndicator color={C.bg} /> : <Disp size={17} weight="semi" style={{ color: C.bg }}>Log</Disp>}
        </Pressable>
      </View>
    </View>
  );
}

// A generic mark until the real photo loads behind "View photo" — not an attempt at a
// per-exercise glyph (the catalogue's own illustration is what that door is for).
// The catalogue's own photo of the movement — genuinely distinct per exercise, unlike any
// icon set this app could hand-draw for 166 names. Falls back to a generic mark only when
// there is truly nothing to show (field report 2026-09-17: "I thought each workout will
// have unique icons" — a real photo is the honest version of that, not a bigger icon set).
export function Thumbnail({ exercise }: { exercise: { exercise_id?: string | null; media_count?: number } }) {
  const hasPhoto = Boolean(exercise.exercise_id) && (exercise.media_count ?? 0) > 0;
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 10,
        backgroundColor: C.card,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      {hasPhoto ? (
        <Image
          source={{ uri: exerciseMediaUrl(exercise.exercise_id as string, 0, THUMB_PHOTO_WIDTH), headers: authHeaders() }}
          style={{ width: 40, height: 40 }}
          contentFit="cover"
          transition={120}
          cachePolicy="disk"
          recyclingKey={`${exercise.exercise_id}-0-${THUMB_PHOTO_WIDTH}`}
        />
      ) : (
        <IconTrain size={20} color={C.mute} strokeWidth={1.6} />
      )}
    </View>
  );
}

function StatTile({
  label,
  value,
  note,
  progression,
}: {
  label: string;
  value: string;
  note?: string | null;
  progression?: BriefExercise['progression'];
}) {
  return (
    <View style={{ flex: 1, backgroundColor: C.track, borderRadius: 12, padding: 10, paddingHorizontal: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <Eyebrow style={{ color: C.dim }}>{label}</Eyebrow>
        {progression === 'step_up' || progression === 'step_down' ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 2,
              backgroundColor: 'rgba(255,122,26,0.18)',
              borderRadius: 8,
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}>
            {progression === 'step_up' ? (
              <IconTrendUp size={10} color={C.accent} strokeWidth={3} />
            ) : (
              <IconTrendDown size={10} color={C.accent} strokeWidth={3} />
            )}
          </View>
        ) : null}
      </View>
      <Disp size={20} style={[{ marginTop: 2 }, TABULAR]}>{value}</Disp>
      {note ? <Sub style={[{ marginTop: 1 }, TABULAR]}>{note}</Sub> : null}
    </View>
  );
}

/** The collapsed row's one line — total, plates, sets×reps, all run together. */
function statLine(exercise: BriefExercise): string {
  return [
    exercise.load_lb != null
      ? [`${exercise.load_lb} lb`, exercise.barbell ? perSideNote(exercise.load_lb, ['barbell']) : null]
          .filter(Boolean)
          .join(' · ')
      : null,
    exercise.sets != null && exercise.reps != null ? `${exercise.sets} × ${exercise.reps}` : null,
    exercise.minutes != null ? `${exercise.minutes} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
