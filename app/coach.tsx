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
import { localDateKey, useAskCoach, useCoachNext, usePrefetchExercises, useUpdateGoal } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, RADIUS, SPACE, TABULAR } from '@/lib/theme';
import type { BriefExercise, CoachBrief, ExerciseCompletion } from '@/lib/types';

// The coach (docs/concept-v2.md §Coach; docs/design-system.md §Today — the accent pill
// that leads here). A button, and nothing else: no schedule, no notification, no second
// place that generates advice. The brief is cached for the day on the server, so asking
// twice is consistent and free, and *Regenerate* is explicit.
//
// **Opening this screen does not generate anything** (user decision 2026-08-31 §2). The
// page load is `GET /api/coach/next?generate=false`, which answers with the day's standing
// brief or with nothing at all; with nothing, the screen draws the question as a button and
// waits to be pressed. It used to generate on that first GET, which made merely looking the
// act that wrote the day's advice — and left Today's button no way to ask whether there was
// a plan without creating one.
//
// Three explicit ways to change the plan, and the two that are buttons say which they are:
// **Add to today's plan** appends under it, **Replace today's plan** rebuilds it behind a
// confirming second tap, and the box below leaves the choice to the model, which defaults
// to adding.
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

/**
 * The mark at the end of a Do row. A tick when it is done, "2/3" while it is half in, and
 * nothing at all before it is started — an untouched plan should read as a plan, not as a
 * column of zeroes (concept-v2 §Principles 8: nothing is owed).
 */
function tick(completion: ExerciseCompletion | undefined): string | null {
  if (!completion) return null;
  if (completion.done) return '✓';
  if (completion.partial && completion.sets_prescribed != null) {
    return `${completion.sets_done}/${completion.sets_prescribed}`;
  }
  return null;
}

/** "2 of 5 done" while the plan is being worked through; the count on its own before that. */
function doneSummary(exercises: BriefExercise[]): string {
  const done = exercises.filter((exercise) => exercise.completion?.done).length;
  if (exercises.length === 0) return '0 moves';
  return done === 0 ? `${exercises.length} moves` : `${done} of ${exercises.length} done`;
}

/** The big number on the Eat card: what is left, or how far over. Never a signed minus. */
function eatFigure(brief: CoachBrief): string {
  const now = brief.nutrition_now;
  if (!now || now.remaining_kcal == null) return String(brief.nutrition?.kcal ?? '—');
  return String(Math.abs(now.remaining_kcal));
}

export default function Coach() {
  const router = useRouter();
  const insets = useScreenInsets();
  const inputRef = useRef<TextInput>(null);
  const speech = useMemo(() => getSpeech(), []);

  const [context, setContext] = useState('');
  /**
   * *Replace today's plan* is the one control on this screen that can take work away, so it
   * asks first: the first tap arms it and says what it will do, the second does it. Armed
   * state is dropped whenever anything else happens, so it can never be pressed by accident
   * two screens later.
   */
  const [replaceArmed, setReplaceArmed] = useState(false);

  const keyboard = useKeyboardHeight();
  const window = useWindowDimensions();

  const coach = useCoachNext();
  const askCoach = useAskCoach();
  const updateGoal = useUpdateGoal();

  const brief: CoachBrief | null = coach.data?.brief ?? null;
  const asking = askCoach.isPending;
  const busy = coach.isLoading || coach.isFetching || asking;
  const action = brief?.nudge_action ?? coach.data?.nudge_action ?? null;
  /**
   * The server answered, and the answer was that there is no plan for today. Distinct from
   * "still loading" and from "the request failed": only this one gets the ask button, and
   * nothing on this screen turns it into a brief except a tap on that button.
   */
  const noPlan = !brief && !busy && coach.isSuccess;

  // The sheets for everything on the plan, warmed while the user is reading it. Tapping a
  // movement's name in a gym should not be a round trip (lib/queries.ts §usePrefetchExercises).
  // The finisher's items carry no catalogue id, so there is nothing to warm for them.
  usePrefetchExercises((brief?.workout?.exercises ?? []).map((exercise) => exercise.exercise_id));

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
   *
   * No `mode`: the box does not claim to know which kind of change this is, so the server
   * lets the model read the sentence — and tells it that an addition is the default,
   * because the two buttons above are where a replacement is asked for out loud.
   */
  const ask = () => {
    setReplaceArmed(false);
    const line = context.trim();
    if (!line) {
      askCoach.mutate({});
      return;
    }
    askCoach.mutate(brief ? { revision: line } : { context: line });
    setContext('');
  };

  /**
   * The first ask of the day, from the button that replaces the plan when there is none.
   * This is the only thing on the screen that a page load could have done for the user, and
   * the whole point of the fix is that it does not.
   */
  const askFirst = () => {
    setReplaceArmed(false);
    const line = context.trim();
    askCoach.mutate(line ? { context: line } : {});
    setContext('');
  };

  /** "Add to today's plan" — an append, decided here rather than inferred from a sentence. */
  const addToPlan = () => {
    setReplaceArmed(false);
    const line = context.trim();
    askCoach.mutate({ revision: line || 'add to the plan — a little more of what today needs', mode: 'append' });
    setContext('');
  };

  /** "Replace today's plan": arm, say what it does, and only act on the second tap. */
  const replacePlan = () => {
    if (!replaceArmed) {
      setReplaceArmed(true);
      return;
    }
    setReplaceArmed(false);
    const line = context.trim();
    askCoach.mutate(line ? { revision: line, mode: 'rewrite' } : {});
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
        {brief?.headline ?? (noPlan ? 'No plan yet today' : 'What should I do?')}
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

      {/* Nobody has asked today, and the page load did not ask on their behalf. This is
          the ONLY thing that makes the first brief of the day, and it is a tap (user
          decision 2026-08-31 §2). */}
      {noPlan ? (
        <Card testID="coach-no-plan" style={{ marginTop: 18 }}>
          <Body style={{ lineHeight: 15 * 1.55 }}>
            Nothing planned for today yet. I will read what you have logged, your goals and
            where you are in the week, and write one.
          </Body>
          <View style={{ marginTop: 14 }}>
            <Chips>
              <Chip
                testID="coach-ask-today"
                label="What should I do today?"
                variant="primary"
                onPress={askFirst}
              />
            </Chips>
          </View>
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

      {/* Do — the day's plan, ticked off as it happens. Every line stays on screen all
          day: a done item is dimmed with a ✓, a half-done one says how far in it is, and
          a finished plan says so above a list that is still all there. */}
      {brief?.workout ? (
        <Section title="Do" summary={brief.workout.targets?.join(' · ') || null}>
          <Card style={{ paddingVertical: 4 }}>
            <GroupHeading
              label={brief.workout.type ?? 'Session'}
              right={doneSummary(brief.workout.exercises ?? [])}
            />
            {(brief.workout.exercises ?? []).map((exercise, index, all) => (
              <View key={`${exercise.name}-${index}`}>
                {/* An add-on the user asked for later in the day sits under its own
                    divider, so the plan reads as the plan plus what was added to it. */}
                {exercise.added_at && exercise.added_at !== all[index - 1]?.added_at ? (
                  <View testID={`coach-added-${exercise.added_at}`} style={{ marginTop: 6 }}>
                    <GroupHeading label={`Added ${exercise.added_at}`} />
                  </View>
                ) : null}
                <View style={{ opacity: exercise.completion?.done ? 0.45 : 1 }}>
                  <Row
                    testID={`coach-do-${index}`}
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
                    right={tick(exercise.completion)}
                    rightColor={exercise.completion?.done ? C.good : C.mute}
                    divider={index < all.length - 1}>
                    {exercise.is_new ? (
                      <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                        <Chip
                          testID={`coach-new-${index}`}
                          label="New to you"
                          onPress={() =>
                            openExercise(router, { id: exercise.exercise_id, name: exercise.name })
                          }
                        />
                      </View>
                    ) : null}
                  </Row>
                </View>
              </View>
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

          {/* The plan is done. It says so, and it does not take the plan away. */}
          {brief.workout.complete ? (
            <Card
              testID="coach-plan-complete"
              style={{ marginTop: 10, borderLeftWidth: 3, borderLeftColor: C.good }}>
              <Body style={{ lineHeight: 15 * 1.55 }}>
                Plan complete — every item logged. Anything else today is extra.
              </Body>
            </Card>
          ) : null}

          {/* How the session ends. Short, scaled to its length, and never a rest day's. */}
          {brief.workout.finisher && brief.workout.finisher.length > 0 ? (
            <Card testID="coach-finisher" style={{ marginTop: 10, paddingVertical: 4 }}>
              <GroupHeading label="To finish" right={`${brief.workout.finisher.length} items`} />
              {brief.workout.finisher.map((item, index, all) => (
                <Row
                  key={`${item.name}-${index}`}
                  title={item.name}
                  sub={[item.minutes != null ? `${item.minutes} min` : null, item.note]
                    .filter(Boolean)
                    .join(' · ')}
                  divider={index < all.length - 1}
                />
              ))}
            </Card>
          ) : null}

          {/* The two things you can do to a plan, said out loud (user decision
              2026-08-31 §3). Adding keeps everything above; replacing does not, so it
              costs a second tap and says what it is about to do. Both take whatever is in
              the box below as the instruction, and both work with it empty. */}
          <View style={{ marginTop: 14 }}>
            <Chips>
              <Chip
                testID="coach-add"
                label="Add to today's plan"
                variant="primary"
                disabled={busy}
                onPress={addToPlan}
              />
              <Chip
                testID="coach-replace"
                label={replaceArmed ? "Replace? This clears today's plan" : "Replace today's plan"}
                variant="danger"
                disabled={busy}
                onPress={replacePlan}
              />
            </Chips>
            <Sub testID="coach-plan-actions-hint" style={{ marginTop: 10, lineHeight: 18 }}>
              {replaceArmed
                ? 'Tap Replace again to rebuild the session. Everything above goes, ticks included.'
                : 'Adding keeps everything above it. Type below first to say what to add, or what the new session should be.'}
            </Sub>
          </View>
        </Section>
      ) : null}

      {/* Eat — what is LEFT of the day, not what the day was for. The big number is the
          server's live arithmetic against everything logged so far; the model's meal
          ideas sit under it. Past the allowance it is one flat line and no advice. */}
      {brief?.nutrition ? (
        <Section title="Eat">
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Disp size={38} testID="eat-remaining" style={TABULAR}>
                {eatFigure(brief)}
              </Disp>
              <Sub style={{ marginLeft: 6, fontFamily: FONT.medium, fontSize: 13 }}>
                {brief.nutrition_now ? (brief.nutrition_now.past_target ? 'kcal over' : 'kcal left') : 'kcal'}
              </Sub>
            </View>
            <Sub testID="eat-line" style={[{ marginTop: 4 }, TABULAR]}>
              {brief.nutrition_now
                ? brief.nutrition_now.line
                : [
                    brief.nutrition.protein_g != null ? `${brief.nutrition.protein_g} g protein` : null,
                    brief.nutrition.carbs_max_g != null
                      ? `≤ ${brief.nutrition.carbs_max_g} g carbs`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
            </Sub>
            {brief.nutrition_now ? (
              <Sub style={[{ marginTop: 2, color: C.dim }, TABULAR]}>
                {[
                  `${brief.nutrition_now.eaten_kcal} eaten`,
                  brief.nutrition_now.allowance_kcal != null
                    ? `of ${brief.nutrition_now.allowance_kcal}`
                    : null,
                  brief.nutrition.carbs_max_g != null
                    ? `· ≤ ${brief.nutrition.carbs_max_g} g carbs`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </Sub>
            ) : null}
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

        {/* With a brief on screen this box is an adjustment to it, and it needs words to
            be one: an empty box used to send a plain regenerate, which silently replaced
            the plan from the least explicit control on the page. Replacing has its own
            button now, and its own confirmation. */}
        <View style={{ marginTop: 16 }}>
          <Chips>
            <Chip
              testID="coach-regenerate"
              label={busy ? 'Thinking…' : brief ? 'Adjust it' : 'Ask'}
              variant="primary"
              disabled={busy || (!!brief && context.trim() === '')}
              onPress={ask}
            />
          </Chips>
        </View>
      </Section>
    </ScrollView>
  );
}
