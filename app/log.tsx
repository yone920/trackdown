import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmCard, type DateChoice } from '@/components/confirm-card';
import { IconCamera, IconClose, IconKeyboard, IconMic } from '@/components/icons';
import { Chip, Chips } from '@/components/kit';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { ApiError } from '@/lib/api';
import { MAX_PHOTOS, pickPhotos, takePhoto, type LocalPhoto } from '@/lib/photos';
import { getSpeech } from '@/lib/ports/speech';
import { useAnalyze, useConfirm } from '@/lib/queries';
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

export default function LogSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ hint?: string }>();
  const inputRef = useRef<TextInput>(null);

  const speech = useMemo(() => getSpeech(), []);
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [result, setResult] = useState<FusionResult | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [dateChoice, setDateChoice] = useState<DateChoice>('proposed');
  const [listening, setListening] = useState(false);
  const [transcribed, setTranscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useAnalyze();
  const confirm = useConfirm();

  const reset = () => {
    setText('');
    setPhotos([]);
    setEvidenceIds([]);
    setResult(null);
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
      setResult(response.result);
      setEvidenceIds(response.evidence.map((item) => item.id));
      // One id per confirm card: a retry after a timeout must replay, not log twice
      // (backend/src/services/fusion/confirm.ts).
      setClientId(Crypto.randomUUID());
      setDateChoice('proposed');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not read that.');
    }
  };

  const save = async (keepOpen: boolean) => {
    if (!result || !clientId) return;
    setError(null);
    try {
      await confirm.mutateAsync({
        clientId,
        result,
        evidenceIds,
        text: text.trim() || null,
        textKind: transcribed ? 'transcript' : 'text',
        source: evidenceIds.length > 0 ? 'fused' : 'manual',
        ...(result.kind === 'goal'
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
          What did you do?
        </Disp>

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

        {photos.length > 0 ? (
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
        ) : null}

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

        {analyze.isPending ? (
          <View style={{ marginTop: 24, alignItems: 'center' }}>
            <ActivityIndicator color={C.mute} />
          </View>
        ) : null}

        {error && !result ? <Sub style={{ marginTop: 14, color: C.accent }}>{error}</Sub> : null}

        {result ? (
          <ConfirmCard
            result={result}
            onChange={setResult}
            dateChoice={dateChoice}
            onDateChoice={setDateChoice}
            onSave={() => void save(false)}
            // "Add more" saves and keeps the sheet; an unclear reading has nothing to save.
            onAddMore={() => {
              if (result.kind === 'unclear') setResult(null);
              else void save(true);
            }}
            saving={confirm.isPending}
            error={error}
          />
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** One of the three 76px controls. Speak is the filled one when it is available. */
function Control({
  label,
  onPress,
  filled = false,
  testID,
  children,
}: {
  label: string;
  onPress: () => void;
  filled?: boolean;
  testID?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => ({
          width: 76,
          height: 76,
          borderRadius: RADIUS.tile,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: filled ? C.ink : C.card,
          opacity: pressed ? 0.8 : 1,
        })}>
        {children}
      </Pressable>
      <Eyebrow>{label}</Eyebrow>
    </View>
  );
}
