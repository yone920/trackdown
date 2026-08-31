import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';

import { Control } from '@/components/control';
import { IconCamera, IconChevronLeft, IconKeyboard, IconMic } from '@/components/icons';
import { Card, Chip, Chips, GroupHeading, Row, Section, SkeletonLines } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { openExercise } from '@/lib/exercise';
import { clock } from '@/lib/format';
import { composeMaxHeight, keyboardPadding, useKeyboardHeight } from '@/lib/keyboard';
import { getSpeech } from '@/lib/ports/speech';
import { localDateKey, useAskCoach, useCoachNext, useUpdateGoal } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, RADIUS, SPACE, TABULAR } from '@/lib/theme';
import type { CoachBrief } from '@/lib/types';

// The coach (docs/concept-v2.md §Coach; docs/design-system.md §Today — the accent pill
// that leads here). A button, and nothing else: no schedule, no notification, no second
// place that generates advice. The brief is cached for the day on the server, so asking
// twice is consistent and free, and *Regenerate* is explicit.
//
// Context comes the usual way (concept-v2 §Principles 7): the same Photo / Speak / Type
// panel. A photo or a spoken line goes through the Log sheet in `coach_context` mode,
// which saves it against today and every later ask reads it back.
//
// The typed box does two different jobs and says which one it is doing. Before there is a
// brief it is context for the first ask. Once there is one, the user is looking at an
// answer and what they type is a change to *it* — "make it 8 exercises", "switch to legs"
// — so it is sent as a `revision` and the server hands the model this brief to rewrite.
// The brief on screen never goes away while that runs, and it never goes away when it
// fails either: a note appears above it saying what happened.
//
// The nudge's button is not generated. `nudge_action` is chosen by
// backend/src/services/coach/rules.ts and only ever routes — the coach proposes, the
// user's tap is what changes anything.

export default function Coach() {
  const router = useRouter();
  const insets = useScreenInsets();
  const inputRef = useRef<TextInput>(null);
  const speech = useMemo(() => getSpeech(), []);

  const [context, setContext] = useState('');

  const keyboard = useKeyboardHeight();
  const window = useWindowDimensions();

  const coach = useCoachNext();
  const askCoach = useAskCoach();
  const updateGoal = useUpdateGoal();

  const brief: CoachBrief | null = coach.data?.brief ?? null;
  const asking = askCoach.isPending;
  const busy = coach.isLoading || coach.isFetching || asking;
  const action = brief?.nudge_action ?? coach.data?.nudge_action ?? null;

  // Three ways this screen can have something to say above the brief, in the order they
  // matter: the server kept the old answer and said why; the request never landed; the
  // brief is simply older than the log. None of them replaces the brief.
  const note =
    (asking ? null : (coach.data?.note ?? null)) ??
    (askCoach.isError && !asking ? (askCoach.error as Error).message : null);

  /**
   * With a brief on screen the input is an *adjustment* to it — that is what the user
   * means by typing into a page that already answered them. With no brief yet it is
   * context for the first ask. An empty box is a plain regenerate either way.
   */
  const ask = () => {
    const line = context.trim();
    if (!line) {
      askCoach.mutate({});
      return;
    }
    askCoach.mutate(brief ? { revision: line } : { context: line });
    setContext('');
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
    // The cold-start nudge: nothing logged and nothing said, so the one useful thing is
    // for the user to say where they are starting from — which is a statement, and goes
    // in through the same Log sheet as every other one.
    else if (action.kind === 'tell_background')
      router.push({ pathname: '/log', params: { hint: 'statement' } });
    else router.push(`/day/${localDateKey()}/log`);
  };

  return (
    <ScrollView
      testID="coach-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      // The context box is the last thing on this screen, so the keyboard covers it and
      // whatever is under it. UIKit's own inset is what lets it scroll clear; on Android
      // the padding does it (lib/keyboard.ts explains why never both).
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60 + keyboardPadding(keyboard),
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
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

      {/* Nothing to keep yet: the shape of a brief while the first one is written. */}
      {busy && !brief ? (
        <Card testID="coach-skeleton" style={{ marginTop: 18 }}>
          <Eyebrow>Thinking</Eyebrow>
          <View style={{ marginTop: 10 }}>
            <SkeletonLines lines={3} />
          </View>
        </Card>
      ) : null}

      {/* A brief IS on screen and a new one is being written: the old one stays exactly
          where it is and the work says so on one line. Losing the answer you are reading
          in order to ask for a better one is the thing this screen must never do. */}
      {asking && brief ? (
        <View
          testID="coach-working"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <ActivityIndicator color={C.mute} size="small" />
          <Sub>Rewriting your brief…</Sub>
        </View>
      ) : null}

      {/* What went wrong, above the brief that was kept. */}
      {note && brief ? (
        <Card testID="coach-note" style={{ marginTop: 14, borderLeftWidth: 3, borderLeftColor: C.accent }}>
          <Sub style={{ lineHeight: 18 }}>{note}</Sub>
        </Card>
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
                onTitlePress={() =>
                  openExercise(router, { id: exercise.exercise_id, name: exercise.name })
                }
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
            {/* An empty Do list is either a rest day or a brief that failed to fill
                itself in. The second one is never drawn as blank space: the server
                refuses to store it, and if one ever reaches here it says so. */}
            {(brief.workout.exercises ?? []).length === 0 ? (
              <View style={{ paddingVertical: 14 }}>
                <Sub testID="coach-do-empty" style={{ lineHeight: 18 }}>
                  {brief.workout.type === 'rest'
                    ? 'Rest today.'
                    : 'No exercises came back for this one. Ask again, or say what you want the session to be.'}
                </Sub>
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

      {/* Context — the same Photo / Speak / Type panel as everywhere else. Once there is
          a brief the box changes what it is for: you are no longer telling the coach about
          your day, you are telling it what to change about the answer in front of you. */}
      <Section title={brief ? 'Not quite right?' : 'Anything I should know?'}>
        <TextInput
          ref={inputRef}
          testID="coach-context"
          value={context}
          onChangeText={setContext}
          placeholder={
            brief
              ? "Adjust it — 'make it 8 exercises', 'switch to legs'…"
              : 'Only 30 minutes · knee hurts today'
          }
          placeholderTextColor={C.dim}
          multiline
          style={{
            minHeight: 70,
            // Capped for the same reason as the Log sheet's box: a compose box that grows
            // for ever ends with its caret under the keyboard (lib/keyboard.ts).
            maxHeight: composeMaxHeight(window.height, insets.top),
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
              label={
                busy
                  ? 'Thinking…'
                  : brief
                    ? context.trim()
                      ? 'Adjust it'
                      : 'Ask again'
                    : 'Ask'
              }
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
