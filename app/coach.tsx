import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Control } from '@/components/control';
import { IconCamera, IconChevronLeft, IconKeyboard, IconMic } from '@/components/icons';
import { Card, Chip, Chips, GroupHeading, Row, Section } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { clock } from '@/lib/format';
import { getSpeech } from '@/lib/ports/speech';
import { localDateKey, useCoachNext, useRegenerateCoach, useUpdateGoal } from '@/lib/queries';
import { C, FONT, RADIUS, SPACE, TABULAR } from '@/lib/theme';
import type { CoachBrief } from '@/lib/types';

// The coach (docs/concept-v2.md §Coach; docs/design-system.md §Today — the accent pill
// that leads here). A button, and nothing else: no schedule, no notification, no second
// place that generates advice. The brief is cached for the day on the server, so asking
// twice is consistent and free, and *Regenerate* is explicit.
//
// Context comes the usual way (concept-v2 §Principles 7): the same Photo / Speak / Type
// panel. Typed context is a query parameter on this ask; a photo or a spoken line goes
// through the Log sheet in `coach_context` mode, which saves it against today and every
// later ask reads it back.
//
// The nudge's button is not generated. `nudge_action` is chosen by
// backend/src/services/coach/rules.ts and only ever routes — the coach proposes, the
// user's tap is what changes anything.

export default function Coach() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const speech = useMemo(() => getSpeech(), []);

  const [context, setContext] = useState('');
  const [asked, setAsked] = useState<string | null>(null);

  const coach = useCoachNext(asked);
  const regenerate = useRegenerateCoach();
  const updateGoal = useUpdateGoal();

  const brief: CoachBrief | null = coach.data?.brief ?? null;
  const busy = coach.isLoading || coach.isFetching || regenerate.isPending;
  const action = brief?.nudge_action ?? coach.data?.nudge_action ?? null;

  const ask = () => {
    const line = context.trim() || null;
    setAsked(line);
    regenerate.mutate(line);
  };

  const tellIt = () => router.push({ pathname: '/log', params: { hint: 'coach_context' } });

  const act = () => {
    if (!action) return;
    if (action.kind === 'mark_reached' && action.goal_id) {
      updateGoal.mutate({ id: action.goal_id, patch: { status: 'reached' } });
      return;
    }
    if (action.kind === 'adjust_goal') router.push({ pathname: '/log', params: { hint: 'goal' } });
    else if (action.kind === 'weigh_in') router.push({ pathname: '/log', params: { hint: 'weight' } });
    else router.push(`/day/${localDateKey()}/log`);
  };

  return (
    <ScrollView
      testID="coach-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}
      keyboardShouldPersistTaps="handled">
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 }}>
        <IconChevronLeft size={18} color={C.mute} />
        <Sub>Today</Sub>
      </Pressable>

      <Eyebrow>The coach</Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        {brief?.headline ?? 'What should I do?'}
      </Disp>
      {brief?.asked_at ? (
        <Sub testID="asked-at" style={[{ marginTop: 6 }, TABULAR]}>
          {`Asked at ${clock(brief.asked_at)}`}
          {brief.cached ? ' · the same answer as your last ask today' : ''}
          {coach.data?.stale ? ' · your log has moved since' : ''}
        </Sub>
      ) : null}

      {busy && !brief ? (
        <View style={{ marginTop: 40, alignItems: 'center' }}>
          <ActivityIndicator color={C.mute} />
        </View>
      ) : null}

      {coach.error && !brief ? (
        <Card style={{ marginTop: 18 }}>
          <Sub style={{ color: C.accent }}>{(coach.error as Error).message}</Sub>
          <View style={{ marginTop: 14, alignSelf: 'flex-start' }}>
            <Chip label="Try again" variant="primary" onPress={() => coach.refetch()} />
          </View>
        </Card>
      ) : null}

      {/* Why — the reasoning, expanded, because the point is that it is grounded. */}
      {brief?.why ? (
        <Card style={{ marginTop: 18 }}>
          <Eyebrow>Why</Eyebrow>
          <Body style={{ marginTop: 8, lineHeight: 15 * 1.55 }}>{brief.why}</Body>
        </Card>
      ) : null}

      {/* Do — each exercise with the load, sets and reps its own history produced. */}
      {brief?.workout ? (
        <Section title="Do" summary={brief.workout.targets?.join(' · ') || null}>
          <Card style={{ paddingVertical: 4 }}>
            <GroupHeading
              label={brief.workout.type ?? 'Session'}
              right={`${(brief.workout.exercises ?? []).length} moves`}
            />
            {(brief.workout.exercises ?? []).map((exercise, index, all) => (
              <Row
                key={`${exercise.name}-${index}`}
                title={exercise.name}
                sub={[
                  exercise.load_lb != null ? `${exercise.load_lb} lb` : null,
                  exercise.sets != null && exercise.reps != null
                    ? `${exercise.sets} × ${exercise.reps}`
                    : exercise.sets != null
                      ? `${exercise.sets} sets`
                      : null,
                  exercise.minutes != null ? `${exercise.minutes} min` : null,
                  exercise.note,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                divider={index < all.length - 1}
              />
            ))}
            {(brief.workout.exercises ?? []).length === 0 ? (
              <View style={{ paddingVertical: 14 }}>
                <Sub>Rest today.</Sub>
              </View>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {/* Eat */}
      {brief?.nutrition ? (
        <Section title="Eat">
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Disp size={38} style={TABULAR}>
                {brief.nutrition.kcal ?? '—'}
              </Disp>
              <Sub style={{ marginLeft: 6, fontFamily: FONT.medium, fontSize: 13 }}>kcal</Sub>
            </View>
            <Sub style={[{ marginTop: 4 }, TABULAR]}>
              {[
                brief.nutrition.protein_g != null ? `${brief.nutrition.protein_g} g protein` : null,
                brief.nutrition.carbs_max_g != null ? `≤ ${brief.nutrition.carbs_max_g} g carbs` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Sub>
            {brief.nutrition.why ? (
              <Body style={{ marginTop: 12, lineHeight: 15 * 1.55 }}>{brief.nutrition.why}</Body>
            ) : null}
            {brief.nutrition.ideas && brief.nutrition.ideas.length > 0 ? (
              <View style={{ marginTop: 12 }}>
                {brief.nutrition.ideas.map((idea) => (
                  <Sub key={idea} style={{ marginTop: 4, lineHeight: 18 }}>
                    · {idea}
                  </Sub>
                ))}
              </View>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {/* One thing */}
      {brief?.nudge ? (
        <Card style={{ marginTop: 22, borderLeftWidth: 3, borderLeftColor: C.accent }}>
          <Eyebrow>One thing</Eyebrow>
          <Body style={{ marginTop: 8, lineHeight: 15 * 1.55 }}>{brief.nudge}</Body>
          {action ? (
            <View style={{ marginTop: 14 }}>
              <Chips>
                <Chip
                  testID="nudge-action"
                  label={action.label ?? 'Do it'}
                  variant="primary"
                  onPress={act}
                  disabled={updateGoal.isPending}
                />
              </Chips>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* Context — the same Photo / Speak / Type panel as everywhere else. */}
      <Section title="Anything I should know?">
        <TextInput
          ref={inputRef}
          testID="coach-context"
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

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
          <Control label="Photo" onPress={tellIt} testID="coach-photo">
            <IconCamera size={26} color={C.ink} />
          </Control>
          {speech.available ? (
            <Control label="Speak" filled onPress={tellIt} testID="coach-speak">
              <IconMic size={26} color={C.bg} />
            </Control>
          ) : null}
          <Control label="Type" onPress={() => inputRef.current?.focus()} testID="coach-type">
            <IconKeyboard size={26} color={C.ink} />
          </Control>
        </View>
        <Sub style={{ marginTop: 12, lineHeight: 18 }}>
          A photo or a spoken line is saved against today and used every time you ask.
          {speech.available ? '' : ' (Speaking needs the dev build.)'}
        </Sub>

        <View style={{ marginTop: 16 }}>
          <Chips>
            <Chip
              testID="coach-regenerate"
              label={busy ? 'Thinking…' : brief ? 'Ask again' : 'Ask'}
              variant="primary"
              disabled={busy}
              onPress={ask}
            />
          </Chips>
        </View>
      </Section>
    </ScrollView>
  );
}
