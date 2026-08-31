import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconChevronLeft } from '@/components/icons';
import { Card, Section, Skeleton, SkeletonLines } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { authHeaders, exerciseMediaUrl } from '@/lib/api';
import { formVideoUrl, NO_EXERCISE_ID } from '@/lib/exercise';
import { useExercise } from '@/lib/queries';
import { C, FONT, RADIUS, SPACE } from '@/lib/theme';

// The exercise sheet: what the movement is, in pictures and in words.
//
// Reached by tapping an exercise name anywhere it is drawn — the coach's Do list, Today,
// Day, the DayLog. It is a *reference*, not a record: nothing here is about this user, so
// there is no goal, no verdict and nothing to confirm.
//
// Two positions, the steps, the muscles, the kit. The photographs and the steps come from
// free-exercise-db and are served from our own storage by GET /api/exercises/:id/media/:n
// — authenticated, like every other image in this app, which is why they carry the
// session's bearer token.
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

/** Underscores are how the catalogue spells a two-word muscle ("lower_back"). */
function words(value: string): string {
  return value.replace(/_/g, ' ');
}

export default function ExerciseSheetScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; name?: string }>();

  const id = typeof params.id === 'string' && params.id ? params.id : NO_EXERCISE_ID;
  const passedName = typeof params.name === 'string' ? params.name : '';

  const exercise = useExercise(id);
  const sheet = exercise.data ?? null;
  // The name travelled with the tap, so the title is right on the first frame — the fetch
  // only ever adds to it.
  const name = sheet?.name ?? passedName;
  const media = sheet?.media ?? [];

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

      {/* The two positions, side by side. While the row is being fetched they are two
          skeleton tiles the same size and shape, so the sheet does not jump when they
          arrive — the screen is already the right screen, it is only missing pixels. */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
        {exercise.isLoading ? (
          [0, 1].map((index) => (
            <View key={index} style={{ flex: 1, aspectRatio: 4 / 3 }}>
              <Skeleton
                testID={`exercise-photo-skeleton-${index}`}
                height="100%"
                radius={RADIUS.tile}
              />
            </View>
          ))
        ) : media.length > 0 ? (
          media.slice(0, 2).map((frame) => (
            <View
              key={frame.index}
              testID={`exercise-photo-${frame.index}`}
              style={{
                flex: 1,
                aspectRatio: 4 / 3,
                borderRadius: RADIUS.tile,
                overflow: 'hidden',
                backgroundColor: C.track,
              }}>
              <Image
                source={{ uri: exerciseMediaUrl(id, frame.index), headers: authHeaders() }}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                transition={140}
                // The frames are immutable and the route says so for a year; keeping them
                // on disk means the second look at an exercise costs no request at all.
                cachePolicy="disk"
                recyclingKey={`${id}-${frame.index}`}
                accessibilityLabel={`${name}, position ${frame.index + 1}`}
              />
            </View>
          ))
        ) : (
          <View
            testID="exercise-photos-empty"
            style={{
              flex: 1,
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

      {/* The steps */}
      <Section title="How to do it">
        <Card>
          {exercise.isLoading ? (
            <SkeletonLines testID="exercise-steps-skeleton" lines={4} />
          ) : sheet && sheet.instructions.length > 0 ? (
            sheet.instructions.map((step, index) => (
              <View
                key={`${index}-${step.slice(0, 12)}`}
                testID={`exercise-step-${index}`}
                style={{ flexDirection: 'row', marginTop: index === 0 ? 0 : 12 }}>
                <Disp size={18} style={{ width: 26, color: C.mute }}>
                  {String(index + 1)}
                </Disp>
                <Body style={{ flex: 1, lineHeight: 15 * 1.55 }}>{step}</Body>
              </View>
            ))
          ) : (
            <Sub style={{ lineHeight: 18 }}>
              No written steps for this one — the form video below is the best guide.
            </Sub>
          )}
        </Card>
      </Section>

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
        <Sub style={{ marginTop: 14, textAlign: 'center' }}>
          {`Photos and steps: ${sheet.source.dataset}`}
        </Sub>
      ) : null}
    </ScrollView>
  );
}
