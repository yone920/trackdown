import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconChevronLeft } from '@/components/icons';
import { Card, Chip, Chips, GroupHeading, Row, Section } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { useCoachNext, useRegenerateCoach } from '@/lib/queries';
import { C, FONT, RADIUS, SPACE } from '@/lib/theme';

// The brief, on demand. WP6b gives this screen its full design (docs/design-system.md
// §Coach — the "why" expanded, previous briefs); this is enough of it for the morning
// test: ask, read, add a line of context, regenerate.
//
// Nothing here schedules anything. The coach is a button (concept-v2 §Principles 5).

export default function Coach() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [context, setContext] = useState('');
  const [asked, setAsked] = useState<string | null>(null);

  const coach = useCoachNext(asked);
  const regenerate = useRegenerateCoach();
  const brief = coach.data?.brief ?? null;
  const busy = coach.isLoading || coach.isFetching || regenerate.isPending;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}
      keyboardShouldPersistTaps="handled">
      <Pressable
        onPress={() => router.back()}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 }}>
        <IconChevronLeft size={18} color={C.mute} />
        <Sub>Today</Sub>
      </Pressable>

      <Eyebrow>The coach</Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        {brief?.headline ?? 'What should I do?'}
      </Disp>

      {busy && !brief ? (
        <View style={{ marginTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={C.mute} />
        </View>
      ) : null}

      {coach.error && !brief ? (
        <Card style={{ marginTop: 18 }}>
          <Sub style={{ color: C.accent }}>{(coach.error as Error).message}</Sub>
        </Card>
      ) : null}

      {brief?.why ? (
        <Card style={{ marginTop: 18 }}>
          <Eyebrow>Why</Eyebrow>
          <Body style={{ marginTop: 8, lineHeight: 15 * 1.55 }}>{brief.why}</Body>
        </Card>
      ) : null}

      {brief?.workout ? (
        <Section title="Workout" summary={brief.workout.targets?.join(' · ') ?? null}>
          <Card style={{ paddingVertical: 4 }}>
            <GroupHeading label={brief.workout.type ?? 'Session'} />
            {(brief.workout.exercises ?? []).map((exercise, index, all) => (
              <Row
                key={`${exercise.name}-${index}`}
                title={exercise.name}
                sub={[
                  exercise.sets != null && exercise.reps != null ? `${exercise.sets} × ${exercise.reps}` : null,
                  exercise.minutes != null ? `${exercise.minutes} min` : null,
                  exercise.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={exercise.load_lb != null ? `${exercise.load_lb}` : null}
                divider={index < all.length - 1}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {brief?.nutrition ? (
        <Section title="Eating">
          <Card>
            <Disp size={34}>{brief.nutrition.kcal ?? '—'}</Disp>
            <Sub style={{ marginTop: 4 }}>
              {[
                brief.nutrition.protein_g != null ? `${brief.nutrition.protein_g} g protein` : null,
                brief.nutrition.carbs_max_g != null ? `≤ ${brief.nutrition.carbs_max_g} g carbs` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Sub>
            {brief.nutrition.ideas && brief.nutrition.ideas.length > 0 ? (
              <Sub style={{ marginTop: 10, lineHeight: 19 }}>{brief.nutrition.ideas.join(' · ')}</Sub>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {brief?.nudge ? (
        <Card style={{ marginTop: 20, borderLeftWidth: 3, borderLeftColor: C.accent }}>
          <Eyebrow>One thing</Eyebrow>
          <Body style={{ marginTop: 8 }}>{brief.nudge}</Body>
        </Card>
      ) : null}

      <Section title="Anything I should know?">
        <TextInput
          value={context}
          onChangeText={setContext}
          placeholder="Only 30 minutes · knee hurts today"
          placeholderTextColor={C.dim}
          multiline
          style={{
            minHeight: 70,
            fontFamily: FONT.medium,
            fontSize: 15,
            color: C.ink,
            backgroundColor: C.card,
            borderRadius: RADIUS.card,
            padding: SPACE.card,
          }}
        />
        <View style={{ marginTop: 12 }}>
          <Chips>
            <Chip
              label="Ask again"
              variant="primary"
              disabled={busy}
              onPress={() => {
                setAsked(context.trim() || null);
                regenerate.mutate(context.trim() || null);
              }}
            />
          </Chips>
        </View>
      </Section>
    </ScrollView>
  );
}
