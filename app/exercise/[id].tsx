import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, View } from 'react-native';

import { IconChevronLeft, IconClose } from '@/components/icons';
import { Card, Section, Skeleton } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { authHeaders, exerciseMediaUrl, SHEET_PHOTO_WIDTH } from '@/lib/api';
import { formVideoUrl, NO_EXERCISE_ID } from '@/lib/exercise';
import { useExercise } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, RADIUS, SPACE } from '@/lib/theme';

// The exercise sheet: what the movement is, in pictures.
//
// Reached by tapping an exercise name anywhere it is drawn — the coach's Do list, Today,
// Day, the DayLog. It is a *reference*, not a record: nothing here is about this user, so
// there is no goal, no verdict and nothing to confirm.
//
// **It renders on the first frame** (user decision 2026-08-31). The name travels with the
// tap, so the title, the eyebrow and the video button are all correct before any request
// has finished; the photographs are skeleton tiles of exactly the right size until their
// bytes arrive, so nothing on the screen moves when they do. The catalogue row is cached
// for the session and across launches (lib/exercise-cache.ts), and the rows for everything
// on the coach's plan and the lifts board are prefetched, so a tap on any of those is a
// screen that was already there — and a prefetched sheet draws with no spinner at all,
// because `useExercise` finds its data in the cache and never enters a loading state.
//
// **The count travels too** (field report 2026-09-01). `media` on the params is how many
// photographs this exercise has, read from the same row the tapped screen was drawing.
// With it the skeleton is the right skeleton: two boxes for a bench press, none at all for
// a stretch, rather than two boxes that turn out to be nothing. Without it — an older
// server, a link from somewhere that does not know — it falls back to two, which is what
// it always drew.
//
// **The photographs are asked for at 640 px** (`SHEET_PHOTO_WIDTH`), which is retina for a
// full-width 4:3 tile on every phone this ships to and a fraction of the bytes of the
// dataset's original. The full-screen zoom asks for the original, because that is the one
// place the pixels are the point.
//
// **The written steps are gone.** They were four numbered paragraphs of free-exercise-db
// prose above the muscles and the kit — the thing a person is least likely to read on a
// phone in a gym, sitting where the pictures should be. Two photographs and a form video
// answer "how does this go" faster than any paragraph, and the video is a search, so it
// works for the movements the dataset never described.
//
// **Name-only mode** is the point of the fallback: an exercise the catalogue has never
// heard of, or one it has no illustration for (every sport, most cardio machines), still
// opens. It shows the name and the form video, because a search engine knows what a
// kettlebell swing looks like even when we do not.

/** A muscle or a piece of kit, as a pill. Not `Chip` — nothing here is pressable. */
function Pill({ label, strong = false }: { label: string; strong?: boolean }) {
  return (
    <View
      style={{
        borderRadius: RADIUS.pill,
        paddingHorizontal: 12,
        paddingVertical: 7,
        backgroundColor: strong ? C.ink : 'transparent',
        borderWidth: strong ? 0 : 1,
        borderColor: C.track,
      }}>
      <Body style={{ fontFamily: FONT.semi, fontSize: 12, color: strong ? C.bg : C.ink }}>
        {label}
      </Body>
    </View>
  );
}

/** Every catalogued exercise the import matched has two frames; it is the honest guess. */
const DEFAULT_PHOTO_COUNT = 2;

/** The sheet draws a start position and an end position. A third would be scrolling. */
const MAX_PHOTOS = 2;

/** How many photographs the tapped row promised. `null` when it did not say. */
function countParam(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? Math.min(count, MAX_PHOTOS) : null;
}

/** Underscores are how the catalogue spells a two-word muscle ("lower_back"). */
function words(value: string): string {
  return value.replace(/_/g, ' ');
}

export default function ExerciseSheetScreen() {
  const router = useRouter();
  const insets = useScreenInsets();
  const params = useLocalSearchParams<{ id?: string; name?: string; media?: string }>();

  const id = typeof params.id === 'string' && params.id ? params.id : NO_EXERCISE_ID;
  const passedName = typeof params.name === 'string' ? params.name : '';
  // How many photographs the tapped row said there were. `null` is "nobody told us".
  const passedMedia = countParam(params.media);

  const exercise = useExercise(id);
  const sheet = exercise.data ?? null;
  // The name travelled with the tap, so the title is right on the first frame — the fetch
  // only ever adds to it.
  const name = sheet?.name ?? passedName;
  const media = sheet?.media ?? [];
  // The skeleton's shape, before there is anything to draw: what the tap said, or the
  // two-photograph guess when it said nothing.
  const skeletons = passedMedia ?? DEFAULT_PHOTO_COUNT;
  // Which photograph is open full-screen. A picture of a movement is the whole reason for
  // this screen and a 160 px tile is not enough of one.
  const [zoomed, setZoomed] = useState<number | null>(null);

  return (
    <ScrollView
      testID="exercise-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}>
      <Pressable
        testID="exercise-back"
        accessibilityLabel="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 }}>
        <IconChevronLeft size={18} color={C.mute} />
        <Sub>Back</Sub>
      </Pressable>

      <Eyebrow>
        {[sheet?.category, sheet?.level].filter(Boolean).join(' · ') || 'Exercise'}
      </Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        {name || 'Exercise'}
      </Disp>
      {sheet && sheet.aliases.length > 0 ? (
        <Sub testID="exercise-aliases" style={{ marginTop: 6, lineHeight: 18 }}>
          {`Also called ${sheet.aliases.slice(0, 3).join(', ')}`}
        </Sub>
      ) : null}

      {/* The two positions, full width and stacked — the pictures are the sheet. While the
          row is being fetched they are skeleton tiles of exactly this size, so nothing
          moves when the bytes land: the screen is already the right screen and is only
          missing pixels.

          How MANY tiles is what the tap said (`media`), so an exercise with no pictures
          goes straight to the empty state instead of promising two that never arrive, and
          one with two draws two. A sheet reached with no catalogue id has nothing to fetch
          at all, so it never gets here in a loading state. */}
      <View style={{ gap: 10, marginTop: 18 }}>
        {exercise.isLoading && skeletons > 0 ? (
          Array.from({ length: skeletons }, (_unused, index) => index).map((index) => (
            <View key={index} style={{ width: '100%', aspectRatio: 4 / 3 }}>
              <Skeleton
                testID={`exercise-photo-skeleton-${index}`}
                height="100%"
                radius={RADIUS.tile}
              />
            </View>
          ))
        ) : media.length > 0 ? (
          media.slice(0, MAX_PHOTOS).map((frame) => (
            <Pressable
              key={frame.index}
              testID={`exercise-photo-${frame.index}`}
              accessibilityRole="imagebutton"
              accessibilityLabel={`${name}, position ${frame.index + 1} — tap to enlarge`}
              onPress={() => setZoomed(frame.index)}
              style={{
                width: '100%',
                aspectRatio: 4 / 3,
                borderRadius: RADIUS.tile,
                overflow: 'hidden',
                backgroundColor: C.track,
              }}>
              <Image
                source={{
                  uri: exerciseMediaUrl(id, frame.index, SHEET_PHOTO_WIDTH),
                  headers: authHeaders(),
                }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                transition={140}
                // The frames are immutable and the route says so for a year; keeping them
                // on disk means the second look at an exercise costs no request at all.
                cachePolicy="disk"
                recyclingKey={`${id}-${frame.index}-${SHEET_PHOTO_WIDTH}`}
              />
            </Pressable>
          ))
        ) : (
          <View
            testID="exercise-photos-empty"
            style={{
              width: '100%',
              aspectRatio: 16 / 6,
              borderRadius: RADIUS.tile,
              borderWidth: 1,
              borderColor: C.track,
              borderStyle: 'dashed',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Sub>No photos for this one</Sub>
          </View>
        )}
      </View>

      {/* Muscles and kit */}
      {sheet && (sheet.primary_muscles.length > 0 || sheet.secondary_muscles.length > 0) ? (
        <Section title="Muscles worked">
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {sheet.primary_muscles.map((muscle) => (
                <Pill key={`p-${muscle}`} label={words(muscle)} strong />
              ))}
              {sheet.secondary_muscles.map((muscle) => (
                <Pill key={`s-${muscle}`} label={words(muscle)} />
              ))}
            </View>
            {sheet.equipment.length > 0 ? (
              <Sub testID="exercise-equipment" style={{ marginTop: 14, lineHeight: 18 }}>
                {`Equipment · ${sheet.equipment.map(words).join(', ')}`}
              </Sub>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {/* The video is a search, so it works for everything — including the exercises we
          have no pictures of at all. */}
      <Pressable
        testID="exercise-video"
        accessibilityRole="link"
        disabled={!name}
        onPress={() => Linking.openURL(formVideoUrl(name))}
        style={({
          marginTop: 26,
          borderRadius: RADIUS.pill,
          backgroundColor: C.accent,
          paddingVertical: 16,
          alignItems: 'center',
          opacity: 1,
        })}>
        <Body style={{ fontFamily: FONT.semi, color: C.bg }}>Watch form video →</Body>
      </Pressable>

      {sheet?.source ? (
        <Sub style={{ marginTop: 14, textAlign: 'center' }}>{`Photos: ${sheet.source.dataset}`}</Sub>
      ) : null}

      {/* Full screen, on a tap. A `Modal` and nothing else — the same one the Log sheet's
          lightbox uses (components/evidence.tsx), so there is no new dependency here. */}
      <Modal
        visible={zoomed != null}
        transparent
        animationType="fade"
        onRequestClose={() => setZoomed(null)}>
        <Pressable
          testID="exercise-photo-zoom"
          accessibilityLabel="Close photo"
          onPress={() => setZoomed(null)}
          style={{ flex: 1, backgroundColor: '#000000EE', alignItems: 'center', justifyContent: 'center' }}>
          {zoomed == null ? null : (
            <Image
              source={{ uri: exerciseMediaUrl(id, zoomed), headers: authHeaders() }}
              style={{ width: '100%', height: '70%' }}
              contentFit="contain"
              cachePolicy="disk"
              recyclingKey={`${id}-${zoomed}-zoom`}
              accessibilityLabel={`${name}, position ${zoomed + 1}`}
            />
          )}
          <View style={{ position: 'absolute', top: insets.top + 12, right: SPACE.screen }}>
            <IconClose size={22} color={C.ink} />
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
