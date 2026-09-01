import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { ActivityRow } from '@/components/activity-row';
import { DayArc } from '@/components/day-arc';
import { EvidenceThumbs } from '@/components/evidence';
import { GoalBanner } from '@/components/goal-banner';
import { IconAvatar, IconChevronRight, IconHeart, IconPlan } from '@/components/icons';
import { Card, Chip, Chips, dismissDeletes, GroupHeading, Row, Section } from '@/components/kit';
import { MetricCard } from '@/components/metric-card';
import { ReadingCard } from '@/components/reading-card';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { clock, dateEyebrow, dateLabel, grams, kcal, slotLabel } from '@/lib/format';
import {
  localDateKey,
  useCoachStatus,
  useDay,
  useDeleteRecord,
  useGoals,
  useProfile,
  useWeek,
} from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, RADIUS, SPACE, TABULAR } from '@/lib/theme';
import { todayCards } from '@/lib/today-cards';
import { groupTraining, sessionSpan, splitBySource } from '@/lib/training-groups';
import type { CoachStatus, DayView, MealSlot } from '@/lib/types';

// Today (docs/design-system.md §Today). The live day: where you are, what the goal is,
// the cards that goal decides, the model's two sentences about right now, the arc, and
// what you have actually done — training and eating, organised the way the closed Day is.
//
// Nothing on this screen is computed here. `/api/day/:date` answers with the totals, the
// verdict, the blocks and the deltas; `/api/goals` with the goal and its progress. The one
// judgement the app makes is *which cards to show*, and that is lib/today-cards.ts.

const STATUS_WORDS: Record<DayView['status'], { text: string; color: string }> = {
  on_track: { text: 'on track', color: C.good },
  over: { text: 'over', color: C.accent },
  under: { text: 'under', color: C.accent },
  none: { text: '—', color: C.mute },
};

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export default function Today() {
  const router = useRouter();
  const insets = useScreenInsets();
  // Recomputed on every render, so an app left open overnight asks for the new day.
  const date = localDateKey();

  const day = useDay(date);
  const week = useWeek();
  const goals = useGoals();
  const profile = useProfile();
  const remove = useDeleteRecord();
  const coachStatus = useCoachStatus();

  const refreshing = day.isRefetching || week.isRefetching || goals.isRefetching;
  const onRefresh = useCallback(() => {
    day.refetch();
    week.refetch();
    goals.refetch();
    profile.refetch();
    coachStatus.refetch();
  }, [day, week, goals, profile, coachStatus]);

  const goal = goals.data?.active?.[0] ?? null;
  const cards = useMemo(
    () => (day.data ? todayCards({ day: day.data, week: week.data ?? null, goal }) : []),
    [day.data, week.data, goal],
  );

  const openLog = (hint?: string) =>
    router.push(hint ? { pathname: '/log', params: { hint } } : '/log');

  /**
   * Tapping a logged row opens it for a correction — the same review-and-tell screen the
   * record view routes to (app/day/[date]/log.tsx). Editing used to be two screens deep,
   * behind Day → "See the log as recorded"; the row you are looking at is where you notice
   * it is wrong, so it is where the correction starts.
   */
  const correct = (kind: 'activity' | 'meal' | 'weight', id: string) =>
    router.push({ pathname: '/log', params: { editDate: date, editId: id, editKind: kind } });


  if (day.isLoading && !day.data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.mute} />
      </View>
    );
  }

  if (day.error || !day.data) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: SPACE.screen, justifyContent: 'center' }}>
        <Disp size={26}>Could not reach the server</Disp>
        <Sub style={{ marginTop: 8 }}>{(day.error as Error | null)?.message ?? 'No day to show.'}</Sub>
        <View style={{ marginTop: 18, alignSelf: 'flex-start' }}>
          <Chip label="Try again" variant="primary" onPress={onRefresh} />
        </View>
      </View>
    );
  }

  const view = day.data;
  const status = STATUS_WORDS[view.status];
  const coachLabel = coachButtonLabel(coachStatus.data ?? null);
  const coachProgress = coachButtonProgress(coachStatus.data ?? null);
  const reading = view.reading;
  const mealsBySlot = SLOT_ORDER.map((slot) => ({
    slot,
    meals: view.items.meals.filter((meal) => meal.slot === slot),
  })).filter((group) => group.meals.length > 0);
  // Training is filed the way the closed Day files it — one rule, lib/training-groups.ts.
  // Today used to group by auto-block, so the same workout looked like two different
  // workouts depending on which page you opened it from (user decision 2026-09-01).
  const { logged, health } = splitBySource(view.items.activities);
  const { cardio, cardioMinutes, byMuscle, unfiled } = groupTraining(logged, view.muscle_summary);
  const span = sessionSpan(logged);
  // Lifts print no calories, so their block's figure is a MET estimate (concept-v2
  // §Calories). Say so, quietly, wherever that number is shown.
  const earnedEstimated = view.blocks.some((block) => block.kcal_estimated);

  return (
    <ScrollView
      testID="today-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      onScrollBeginDrag={dismissDeletes}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 12,
        paddingBottom: 140,
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.mute} />}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Eyebrow>{dateEyebrow()}</Eyebrow>
          <Disp size={30} style={{ marginTop: 6 }}>
            {/* An empty day carries no verdict: 0 eaten is trivially "under allowance", and a
                green "on track" at 6 am judges a day that has not happened (user report). */}
            {view.items.meals.length + view.items.activities.length + view.items.weights.length === 0 ? (
              <>Day {view.day_number}</>
            ) : (
              <>
                Day {view.day_number} ·{' '}
                <Text style={{ color: status.color, fontFamily: FONT.disp }}>{status.text}</Text>
              </>
            )}
          </Disp>
        </View>
        <Pressable
          testID="today-you"
          accessibilityLabel="You"
          onPress={() => router.push('/you')}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: C.track,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <IconAvatar size={20} color={C.mute} />
        </Pressable>
      </View>

      {/* The goal, or the absence of one */}
      <View style={{ marginTop: 18 }}>
        <GoalBanner
          testID="goal-banner"
          title={goal?.title ?? null}
          sub={goalSubtitle(goal?.metrics ?? [], goal?.progress?.percent ?? null)}
          percent={goal?.progress?.percent ?? null}
          onPress={() => router.push('/progress')}
        />
      </View>

      {/* The cards the goal decides */}
      <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {cards.map((card) => (
          <View key={card.key} style={card.full ? { width: '100%' } : { flexGrow: 1, flexBasis: '46%' }}>
            <MetricCard
              testID={`metric-${card.key}`}
              eyebrow={card.eyebrow}
              value={card.value}
              unit={card.unit}
              sub={card.sub}
              chart={card.chart}
              valueColor={card.valueColor}
            />
          </View>
        ))}
      </View>

      {/* No target yet: the profile cannot produce one, so say what is missing. */}
      {view.allowance == null && profile.data?.targets?.source === 'none' ? (
        <Card style={{ marginTop: 12 }}>
          <Eyebrow>No calorie target yet</Eyebrow>
          <Body style={{ marginTop: 8, lineHeight: 15 * 1.55 }}>
            Tell me your height, your age and what you weigh and I can work out what to eat.
          </Body>
          <View style={{ marginTop: 14 }}>
            <Chips>
              <Chip label="Tell me" variant="primary" onPress={() => openLog()} />
            </Chips>
          </View>
        </Card>
      ) : null}

      {/* Right now */}
      {reading ? (
        <View style={{ marginTop: 12 }}>
          {/* A pure reading, refreshed after every log. No action chips: the + is the one
              door for logging (user decision 2026-09-01) — extra buttons implied there were
              different kinds of logging. */}
          <ReadingCard eyebrow="Right now" text={reading.text} live={view.is_today} />
        </View>
      ) : null}

      {/* The day arc */}
      {view.arc.length > 0 ? (
        <Card style={{ marginTop: 12 }}>
          <Eyebrow>The day so far</Eyebrow>
          <View style={{ marginTop: 10 }}>
            <DayArc events={view.arc} />
          </View>
        </Card>
      ) : null}

      {/* Training, by muscle group — the same grouping the closed Day uses, because this
          is now the only page for the open day (user decision 2026-09-01). The session's
          time span is a NOTE on the header, not the grouping principle: when a workout
          happened is a fact about it, not a way to file it. */}
      <Section
        title="Training"
        summary={logged.length === 0 && health.length === 0 ? 'Nothing yet' : `${kcal(view.earned)} kcal earned`}
        note={[span, earnedEstimated ? 'est.' : null].filter(Boolean).join(' · ') || null}>
        {logged.length === 0 && health.length === 0 ? (
          <Card>
            <Sub>No exercise logged today.</Sub>
          </Card>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {cardio.length > 0 ? (
              <View>
                <GroupHeading label="Cardio" right={cardioMinutes > 0 ? `${cardioMinutes} min` : null} />
                {cardio.map((activity, index) => (
                  <ActivityRow
                    key={activity.id ?? `cardio-${index}`}
                    activity={activity}
                    last={index === cardio.length - 1}
                    onPress={activity.id ? () => correct('activity', activity.id as string) : undefined}
                    onDelete={
                      activity.id ? () => remove.mutate({ kind: 'activity', id: activity.id as string }) : undefined
                    }
                  />
                ))}
              </View>
            ) : null}
            {byMuscle.map((group) => (
              <View key={group.muscle}>
                <GroupHeading label={group.muscle} right={`${group.sets} sets`} />
                {group.members.map((activity, index) => (
                  <ActivityRow
                    key={activity.id ?? `${group.muscle}-${index}`}
                    activity={activity}
                    last={index === group.members.length - 1}
                    onPress={activity.id ? () => correct('activity', activity.id as string) : undefined}
                    onDelete={
                      activity.id ? () => remove.mutate({ kind: 'activity', id: activity.id as string }) : undefined
                    }
                  />
                ))}
              </View>
            ))}
            {/* Anything left over — no muscle group of its own, or one the summary does
                not know: a class, a hike, an unrecognised movement. */}
            {unfiled.length > 0 ? (
              <View>
                <GroupHeading label="Also" />
                {unfiled.map((activity, index, all) => (
                  <ActivityRow
                    key={activity.id ?? `other-${index}`}
                    activity={activity}
                    last={index === all.length - 1}
                    onPress={activity.id ? () => correct('activity', activity.id as string) : undefined}
                    onDelete={
                      activity.id ? () => remove.mutate({ kind: 'activity', id: activity.id as string }) : undefined
                    }
                  />
                ))}
              </View>
            ) : null}
          </Card>
        )}

        {/* Health is a source, not a section: one slim card, badged (concept-v2 §Health). */}
        {health.length > 0 ? (
          <Card style={{ marginTop: 10, paddingVertical: 12, flexDirection: 'row', alignItems: 'center' }}>
            <IconHeart size={20} color={C.good} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Body>{health.map((activity) => activity.exercise ?? activity.description).join(' · ')}</Body>
              <Sub style={{ marginTop: 2 }}>
                {kcal(health.reduce((sum, activity) => sum + activity.kcal, 0))} kcal from Health
              </Sub>
            </View>
            <Eyebrow style={{ color: C.good }}>Health</Eyebrow>
          </Card>
        ) : null}
      </Section>

      {/* Eating */}
      <Section
        title="Eating"
        summary={`${kcal(view.eaten)} kcal${view.macros.protein_g.eaten != null ? ` · ${grams(view.macros.protein_g.eaten)} protein` : ''}`}>
        <Card style={{ paddingVertical: 4 }}>
          {mealsBySlot.map((group) => (
            <View key={group.slot}>
              <GroupHeading
                label={slotLabel(group.slot)}
                right={`${kcal(group.meals.reduce((sum, meal) => sum + meal.kcal, 0))} kcal`}
              />
              {group.meals.map((meal, index) => (
                <Row
                  key={meal.id}
                  testID={`row-meal-${meal.id}`}
                  time={clock(meal.logged_at)}
                  title={meal.description}
                  sub={grams(meal.protein_g) ? `${grams(meal.protein_g)} protein` : null}
                  right={kcal(meal.kcal)}
                  onPress={() => correct('meal', meal.id)}
                  onDelete={() => remove.mutate({ kind: 'meal', id: meal.id })}
                  divider={index < group.meals.length - 1}>
                  <EvidenceThumbs photos={meal.evidence} />
                </Row>
              ))}
            </View>
          ))}

          {/* One meal logged is one meal shown. There is no row for a dinner nobody has
              eaten: the day is a record of what happened, not a list of what is owed
              (concept-v2 §Principles 6, user decision 2026-08-31). */}
          {mealsBySlot.length === 0 ? (
            <View style={{ paddingVertical: 14 }}>
              <Sub>Nothing eaten yet today.</Sub>
            </View>
          ) : null}
        </Card>
        {view.eating_pattern ? <Sub style={{ marginTop: 10 }}>{view.eating_pattern}</Sub> : null}
      </Section>

      {/* The plan has its own tab now (user decision 2026-09-01: "if I want to quickly see
          what should I do, I have to go to the home page, scroll down, find that orange
          button"). What is left here is a STATUS row, not a second door to the answer: it
          says whether there is a plan and how far through it you are, and the tap switches
          to the tab. Nothing here generates anything — `useCoachStatus` is an exists-check
          on the server (user decision 2026-08-31 §1). */}
      <Pressable
        testID="coach-button"
        accessibilityLabel={coachLabel}
        onPress={() => router.push('/plan')}
        style={({
          marginTop: 26,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderRadius: RADIUS.card,
          borderWidth: 1,
          borderColor: C.track,
          paddingVertical: 14,
          paddingHorizontal: 16,
          opacity: 1,
        })}>
        <IconPlan size={18} color={C.accent} />
        <Body style={{ flex: 1, fontFamily: FONT.medium }}>{coachLabel}</Body>
        {coachProgress ? (
          <Sub testID="coach-button-sub" style={TABULAR}>
            {coachProgress}
          </Sub>
        ) : null}
        <IconChevronRight size={18} color={C.mute} />
      </Pressable>
    </ScrollView>
  );
}

/**
 * What the button says. Two states, and the difference between them is whether the coach
 * has been asked today (user decision 2026-08-31 §1).
 *
 *   * **No plan** — the question, exactly as before. Tapping opens the Coach screen, which
 *     asks on demand; nothing is generated by the button, or by drawing it.
 *   * **A plan** — it says so. Telling somebody who has a plan on the next screen to ask
 *     what they should do today is the app forgetting its own answer.
 *
 * A status that has not arrived yet reads as the question: it is the safe half of the pair
 * — it promises nothing that is not there, and the tap does the same thing either way.
 */
function coachButtonLabel(status: CoachStatus | null): string {
  return status?.has_plan ? "Today's plan" : "Get today's plan";
}

/**
 * The line under it. Same words as the Coach screen's own group heading, because the two
 * are counting the same list with the same matcher and should not sound like two answers:
 * the count on its own before anything is done, "2 of 4 done" partway, and a plain
 * statement at the end. A plan with nothing in it (a rest day) says nothing here.
 */
function coachButtonProgress(status: CoachStatus | null): string | null {
  if (!status?.has_plan || status.total_count === 0) return null;
  if (status.complete) return 'Plan complete ✓';
  return status.done_count === 0
    ? `${status.total_count} moves`
    : `${status.done_count} of ${status.total_count} done`;
}

/** The line under the goal's title: what it is measured on, and where it finishes. */
function goalSubtitle(
  metrics: { measure: string; target?: number | null; unit?: string | null; by?: string | null }[],
  percent: number | null,
): string | null {
  const first = metrics[0];
  if (!first) return percent == null ? null : `${Math.round(percent * 100)}% of the way`;
  const target = first.target == null ? null : `${first.target}${first.unit ? ` ${first.unit}` : ''}`;
  const by = first.by ? ` by ${dateLabel(first.by)}` : '';
  return target ? `${target}${by}` : by.trim() || null;
}
