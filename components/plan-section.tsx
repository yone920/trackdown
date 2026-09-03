import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ActivityRow } from '@/components/activity-row';
import { BigButton, Card, Chip, Chips, GroupHeading, Row, Section, SkeletonLines } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { openExercise } from '@/lib/exercise';
import { clock, kcal } from '@/lib/format';
import { perSideNote } from '@/lib/plates';
import { matchedRecordIds, truthLine } from '@/lib/plan-truth';
import {
  localDateKey,
  useAskCoach,
  useCoachNext,
  useStartWorkout,
  useDay,
  useDeleteRecord,
  usePrefetchExercises,
  useUpdateGoal,
} from '@/lib/queries';
import { sessionSpan, splitBySource } from '@/lib/training-groups';
import { C, TABULAR } from '@/lib/theme';
import type { BriefExercise, CoachBrief, ExerciseCompletion } from '@/lib/types';
import { readerLine } from '@/lib/errors';

// The day's plan, where the day is (user decision 2026-09-01). It used to be a page of its
// own behind an accent button at the bottom of Today, which meant the answer to "what
// should I do?" was three scrolls and a tap away from the question — and it put the plan
// and the record of what you actually did on two different screens, when they are two
// halves of one day.
//
// So this is a SECTION now, and Today is the page. Nothing about how it behaves changed:
//
//   * **Opening it generates nothing** (user decision 2026-08-31 §2). The read is
//     `GET /api/coach/next?generate=false`, which answers with the day's standing brief or
//     with nothing at all; with nothing, it draws the question as a button and waits to be
//     pressed. That mattered when this was a page you chose to open. It matters more now
//     that it is on the tab the app lands on.
//   * **"Generate today's workout" is the only generator in the app.** One verb, one place.
//     Named for what it does: somebody who has already logged their own session has very
//     much started, and telling them to start is the app not reading its own screen (user
//     decision 2026-09-03).
//   * Adding keeps everything above it; replacing costs a second tap and says what it will
//     do. Adjusting is told in words, like every other change (concept-v2 §Principles 7).
//
// On a rest day nobody presses the button, and this section stays one quiet card while the
// rest of Today goes on recording meals, weight and anything else that happened.

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

export function PlanSection() {
  const router = useRouter();

  /**
   * *Replace today's plan* is the one control on this screen that can take work away, so it
   * asks first: the first tap arms it and says what it will do, the second does it. Armed
   * state is dropped whenever anything else happens, so it can never be pressed by accident
   * two screens later.
   */
  const [replaceArmed, setReplaceArmed] = useState(false);
  /**
   * The Why card, expanded again by hand after it folded. Off by default and never
   * remembered: it folds because the session started, and it should fold again tomorrow.
   */
  const [whyOpen, setWhyOpen] = useState(false);


  const coach = useCoachNext();
  // The day, for the log that hangs off the plan. The same query Today runs, so this costs
  // no extra request.
  const date = localDateKey();
  const day = useDay(date);
  const remove = useDeleteRecord();
  const askCoach = useAskCoach();
  // The first ask of the day goes through here rather than through `askCoach` directly: a
  // generation is the one call that routinely outlives a phone's patience, and a dropped
  // answer is recovered rather than reported (lib/queries.ts §useStartWorkout).
  const startWorkout = useStartWorkout();
  const updateGoal = useUpdateGoal();

  const brief: CoachBrief | null = coach.data?.brief ?? null;
  const asking = askCoach.isPending || startWorkout.asking;
  // ONE spinner and one disabled button, whichever of the two paths is in flight — and the
  // recovery poll counts as busy, because from the user's side it is still the same wait.
  const busy = coach.isLoading || coach.isFetching || asking || startWorkout.recovering;
  const action = brief?.nudge_action ?? coach.data?.nudge_action ?? null;
  /**
   * The server answered, and the answer was that there is no plan for today. Distinct from
   * "still loading" and from "the request failed": only this one gets the ask button, and
   * nothing on this screen turns it into a brief except a tap on that button.
   */
  const noPlan = !brief && !busy && coach.isSuccess;

  // The sheets for everything on the plan, warmed while the user is reading it — the row
  // AND its first photograph, so a tap on a movement's name in a gym is a screen that was
  // already there rather than a round trip (lib/queries.ts §usePrefetchExercises). The
  // finisher goes on the list too: most of its items resolve to nothing and warm nothing,
  // and the ones that do resolve are the ones a person is most likely to be unsure about.
  // What the plan and the log come to, together. The MATCHING is the server's — it is the
  // same computation the ticks are made from (backend services/coach/completion.ts), and a
  // second matcher in the app would eventually disagree with the tick beside it.
  // Optional all the way down on purpose: this section is drawn while the day is still in
  // flight, and a half-arrived payload is not a reason to take the plan off the screen.
  const { logged } = splitBySource(day.data?.items?.activities ?? []);
  const span = sessionSpan(logged);
  /**
   * The session is under way once ANY prescribed item has been done. That is the moment the
   * plan stops being a proposal and becomes a thing in progress — and the moment its
   * rationale stops being the headline (user report 2026-09-02).
   *
   * Read from the plan's own completions, not from the log: work that was never on the plan
   * is not the plan starting.
   */
  const sessionStarted = (brief?.workout?.exercises ?? []).some(
    (exercise) => exercise.completion?.done || exercise.completion?.partial,
  );
  const offPlan = useMemo(() => {
    const matched = matchedRecordIds(brief?.workout?.exercises ?? []);
    return logged.filter((activity) => !activity.id || !matched.has(activity.id));
  }, [logged, brief]);

  /** The record a done line opens — the first one logged against it. */
  const firstRecordOf = (exercise: { completion?: ExerciseCompletion }): string | null =>
    exercise.completion?.records?.[0]?.id ?? null;

  /** A logged row opens for a correction, the same door the full log uses. */
  const correct = (id: string) =>
    router.push({ pathname: '/log', params: { editDate: date, editId: id, editKind: 'activity' } });

  usePrefetchExercises([
    ...(brief?.workout?.exercises ?? []).map((exercise) => ({
      id: exercise.exercise_id,
      mediaCount: exercise.media_count,
    })),
    ...(brief?.workout?.finisher ?? []).map((item) => ({
      id: item.exercise_id,
      mediaCount: item.media_count,
    })),
  ]);

  // Three ways this screen can have something to say above the brief, in the order they
  // matter: the server kept the old answer and said why; the request never landed; the
  // brief is simply older than the log. None of them replaces the brief.
  const note =
    (busy ? null : (coach.data?.note ?? null)) ??
    // By code, never by the throw's own message: an ask that failed on the provider used to
    // print whatever the SDK said into the note card (lib/errors.ts).
    (askCoach.isError && !asking ? readerLine(askCoach.error, 'The coach could not answer just now.') : null) ??
    // The one the old flow never had: the generate call that came back as nothing. It used
    // to leave the page on "Nothing planned yet" with no word of what happened, while the
    // plan sat finished on the server (field report 2026-09-02).
    (busy ? null : startWorkout.note);

  /**
   * The first ask of the day. It is the only thing in the app that writes a plan, and it
   * is a tap — never a page load (user decision 2026-08-31 §2).
   *
   * Since 2026-09-03 the tap opens the ONE logger sheet in `plan-new` framing rather than
   * generating on the spot. Asking for a whole session is the moment somebody is most
   * likely to have something to say about it — "only half an hour", "my knee", "something
   * different" — and there was nowhere to say it without knowing to make a separate trip
   * through the + first. **Saying nothing still generates**: the sheet's Generate button
   * with an empty box is exactly the call this used to make (app/log.tsx §runGeneratePlan).
   */
  const askForPlan = () => {
    setReplaceArmed(false);
    router.push({ pathname: '/log', params: { framing: 'plan-new' } });
  };

  /**
   * "Adjust the plan" — a door into the ONE input surface in the app, in plan-adjust mode
   * (app/log.tsx §adjustingPlan). Same say / type / snap affordances as logging a meal;
   * the sheet says plainly that it is changing the plan rather than recording anything,
   * and the words go to the coach's adjust endpoint with append semantics.
   */
  const adjustPlan = () => {
    setReplaceArmed(false);
    router.push({ pathname: '/log', params: { framing: 'plan' } });
  };

  /** "Replace today's plan": arm, say what it does, and only act on the second tap. */
  const replacePlan = () => {
    if (!replaceArmed) {
      setReplaceArmed(true);
      return;
    }
    setReplaceArmed(false);
    askCoach.mutate({ mode: 'rewrite' });
  };

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

  // Why — the reasoning behind the plan.
  //
  // Before the session starts it is the point: a plan you have not begun is a claim, and
  // the claim's grounds are what you read it against. Once ANY item is done the session is
  // under way, the reasoning has been acted on, and a paragraph about what the morning was
  // thinking reads as stale next to work already logged (user report 2026-09-02: "it looks
  // stale after the workout"). So it folds to one line and the training moves up past it.
  //
  // It never REWRITES — the sticky law holds and the words are identical either way. This
  // is position, not generation.
  const whyCard = brief?.why ? (
      sessionStarted && !whyOpen ? (
        <Row
          testID="coach-why-collapsed"
          title={brief.asked_at ? `Why this plan · as of ${clock(brief.asked_at)}` : 'Why this plan'}
          onPress={() => setWhyOpen(true)}
          divider={false}
        />
      ) : (
        <Card style={{ marginTop: 18 }}>
          {/* The rationale is a fact about the ANSWER, not about now: it was written when
              the plan was asked for, which on a plan asked at 7 am is a reading of
              yesterday. It said so nowhere, and the user asked why it was "talking about
              yesterday" (field report 2026-09-01). So it admits its age. */}
          <Eyebrow testID="coach-why-eyebrow">
            {brief.asked_at ? `Why · as of ${clock(brief.asked_at)}` : 'Why'}
          </Eyebrow>
          <Body style={{ marginTop: 8, lineHeight: 15 * 1.55 }}>{brief.why}</Body>
        </Card>
    )
  ) : null;

  // Do — the day's plan, ticked off as it happens. Every line stays on screen all day: a
  // done item is dimmed with a ✓, a half-done one says how far in it is, and a finished
  // plan says so above a list that is still all there.
  const trainingCard = brief?.workout ? (
      <Section
        title="Training"
        summary={
          logged.length === 0
            ? brief.workout.targets?.join(' · ') || null
            : `${kcal(day.data?.earned ?? 0)} kcal earned`
        }
        note={span}>
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
                  // Once a line has been done, the ROW — name included — opens what was
                  // actually logged, and the how-to sheet moves to the glyph beside the
                  // name (user decision 2026-09-01). Before it is done there is no record
                  // to open, so the name is the sheet's door exactly as it always was.
                  onPress={firstRecordOf(exercise) ? () => correct(firstRecordOf(exercise)!) : undefined}
                  onTitlePress={
                    firstRecordOf(exercise)
                      ? undefined
                      : () =>
                          openExercise(router, {
                            id: exercise.exercise_id,
                            name: exercise.name,
                            mediaCount: exercise.media_count,
                          })
                  }
                  onMediaPress={
                    firstRecordOf(exercise)
                      ? () =>
                          openExercise(router, {
                            id: exercise.exercise_id,
                            name: exercise.name,
                            mediaCount: exercise.media_count,
                          })
                      : undefined
                  }
                  titleMedia={exercise.media_count}
                  // The prescription — and it is GONE once the line is done. What was
                  // asked for stops being the point the moment it has been answered; the
                  // truth line below is the row's subject then (user decision 2026-09-01).
                  // A partial row keeps it, because the target is still live.
                  sub={
                    exercise.completion?.done
                      ? null
                      : [
                          // The total leads — it is what the plan, the history and the
                          // progression are keyed on — and the plates follow, because
                          // that is the number the hands do (field report 2026-09-02).
                          exercise.load_lb != null
                            ? [
                                `${exercise.load_lb} lb`,
                                perSideNote(exercise.load_lb, exercise.barbell ? ['barbell'] : null),
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            : null,
                          exercise.sets != null && exercise.reps != null
                            ? `${exercise.sets} × ${exercise.reps}`
                            : exercise.sets != null
                              ? `${exercise.sets} sets`
                              : null,
                          exercise.minutes != null ? `${exercise.minutes} min` : null,
                          exercise.note,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                  }
                  right={tick(exercise.completion)}
                  rightColor={exercise.completion?.done ? C.good : C.mute}
                  divider={index < all.length - 1}>
                  {/* What was actually logged against this prescription. It is the whole
                      point of the merge: the ask and the answer on one row, so a load
                      that dropped partway through reads without holding two lists in
                      your head. */}
                  {truthLine(exercise.completion, exercise.barbell) ? (
                    <Sub
                      testID={`coach-truth-${index}`}
                      style={[
                        { marginTop: 2, color: exercise.completion?.done ? C.ink : C.good },
                        TABULAR,
                      ]}>
                      {truthLine(exercise.completion, exercise.barbell)}
                    </Sub>
                  ) : null}
                  {exercise.is_new ? (
                    <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                      <Chip
                        testID={`coach-new-${index}`}
                        label="New to you"
                        onPress={() =>
                          openExercise(router, {
                            id: exercise.exercise_id,
                            name: exercise.name,
                            mediaCount: exercise.media_count,
                          })
                        }
                      />
                    </View>
                  ) : null}
                </Row>
              </View>
            </View>
          ))}
          {/* Everything logged that no line of the plan asked for — the extra set, the
              walk home, the whole session on a day the plan said rest. It joins the SAME
              card, because nothing the user actually did should render in a second
              section (user decision 2026-09-01). */}
          {offPlan.length > 0 ? (
            <View testID="coach-also">
              <GroupHeading label="Also" right={`${offPlan.length} logged`} />
              {offPlan.map((activity, position, all) => (
                <ActivityRow
                  key={activity.id ?? position}
                  activity={activity}
                  last={position === all.length - 1}
                  showDelta={false}
                  // Off-plan work is DONE by definition — it is a logged fact. Beside
                  // plan lines nobody has started yet it was reading as pending (field
                  // report 2026-09-02: "the way it is listing under also don't show that
                  // it is done"). It stays its own group: freelanced work is not the
                  // plan, and it is still not in the N-of-M count.
                  done
                  onPress={activity.id ? () => correct(activity.id as string) : undefined}
                  onDelete={
                    activity.id ? () => remove.mutate({ kind: 'activity', id: activity.id as string }) : undefined
                  }
                />
              ))}
            </View>
          ) : null}

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
            {/* Every one of these opens (field report 2026-09-01: they did not). A
                stretch is rarely in the catalogue, so most of them open the sheet in
                name-only mode — a title and a form video, which is a search and knows
                what a couch stretch looks like even when we do not. */}
            {brief.workout.finisher.map((item, index, all) => (
              <Row
                key={`${item.name}-${index}`}
                testID={`coach-finisher-${index}`}
                title={item.name}
                onTitlePress={() =>
                  openExercise(router, {
                    id: item.exercise_id,
                    name: item.name,
                    mediaCount: item.media_count,
                  })
                }
                titleMedia={item.media_count}
                sub={[item.minutes != null ? `${item.minutes} min` : null, item.note]
                  .filter(Boolean)
                  .join(' · ')}
                divider={index < all.length - 1}
              />
            ))}
          </Card>
        ) : null}

        {/* Adjusting the plan is TOLD, in the one place anything is told: the logger
            (user decision 2026-09-01 — "there is only one way to update anything in the
            app and that is the logger"). This section used to carry its own text box,
            its own Photo/Type tiles and its own submit button, which is a second input
            surface and the one thing concept-v2 §Principles 7 forbids.

            Adding is what a told adjustment does, and it keeps everything above it.
            Replacing does not, so it stays here as its own deliberate act: two taps, no
            words needed, and it says what it is about to do. */}
        <View style={{ marginTop: 14 }}>
          <Chips>
            <Chip
              testID="coach-adjust"
              label="Adjust the plan"
              variant="primary"
              disabled={busy}
              onPress={adjustPlan}
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
              : 'Adjusting opens the logger — say what to add and it is added to the plan. Replacing starts the session over.'}
          </Sub>
        </View>
      </Section>
  ) : null;

  return (
    <>
      {/* The plan's own headline. It is a Section heading rather than a page title now:
          Today already says what day it is, and this says what the day is FOR. */}
      <View style={{ paddingTop: 26 }}>
        <Eyebrow>Today&apos;s plan</Eyebrow>
        <Disp size={24} weight="semi" style={{ marginTop: 6 }}>
          {brief?.headline ?? (noPlan ? 'Nothing planned yet' : 'What should I do?')}
        </Disp>
      </View>
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
      {(asking || startWorkout.recovering) && brief ? (
        <View
          testID="coach-working"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <ActivityIndicator color={C.mute} size="small" />
          <Sub>{startWorkout.recovering ? 'Still writing it…' : 'Rewriting your brief…'}</Sub>
        </View>
      ) : null}

      {/* What went wrong. It is drawn WITH OR WITHOUT a brief: conditioning it on there
          being one is exactly how a failed first generation ended in silence — the note
          existed and had nowhere to go (field report 2026-09-02). */}
      {note ? (
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
        </Card>
      ) : null}

      {/* The answer is late and the app has gone looking for it. Said out loud, because a
          spinner that has been going for a minute reads as a hang. */}
      {startWorkout.recovering && !brief ? (
        <View
          testID="coach-recovering"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <ActivityIndicator color={C.mute} size="small" />
          <Sub>Still writing it — this can take a minute on a phone connection.</Sub>
        </View>
      ) : null}

      {coach.error && !brief ? (
        <Card style={{ marginTop: 18 }}>
          <Sub style={{ color: C.accent }}>
            {readerLine(coach.error, 'The coach could not answer just now.')}
          </Sub>
          <View style={{ marginTop: 14, alignSelf: 'flex-start' }}>
            <Chip label="Try again" variant="primary" onPress={() => coach.refetch()} />
          </View>
        </Card>
      ) : null}

      {/* ORDER, not content. Before the session starts the reasoning leads: a plan you have
          not begun is a claim, and its grounds are what you read it against. Once any item
          is done the work leads and the reasoning folds behind one line — a paragraph about
          what the morning was thinking reads as stale next to work already logged (user
          report 2026-09-02: "it looks stale after the workout").

          The Why never rewrites. Same words, different place. */}
      {sessionStarted ? (
        <>
          {trainingCard}
          {whyCard}
        </>
      ) : (
        <>
          {whyCard}
          {trainingCard}
        </>
      )}

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

      {/* With no plan there is one thing to press, and it is the only generator in the
          app. It takes no words: context is TOLD through the logger like everything else,
          and a plan asked for with nothing said is still a plan built from the whole log.
          (user decision 2026-09-01 — the box that used to sit here was a second form.) */}
      {!brief ? (
        <View style={{ marginTop: 16 }}>
          <BigButton
            testID="coach-regenerate"
            label={busy ? 'Thinking…' : "Generate today's workout"}
            disabled={busy}
            pending={busy}
            onPress={askForPlan}
          />
          <Sub style={{ marginTop: 12, lineHeight: 18 }}>
            Anything I should know first — only 30 minutes, knee is sore — goes in through
            the + like everything else.
          </Sub>
        </View>
      ) : null}

    </>
  );
}
