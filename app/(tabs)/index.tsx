import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { DayArc } from '@/components/day-arc';
import { EvidenceThumbs } from '@/components/evidence';
import { GoalBanner } from '@/components/goal-banner';
import { IconAvatar } from '@/components/icons';
import { Card, Chip, Chips, GroupHeading, Row, Section } from '@/components/kit';
import { MetricCard } from '@/components/metric-card';
import { ReadingCard } from '@/components/reading-card';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { openExercise } from '@/lib/exercise';
import { clock, dateEyebrow, dateLabel, grams, kcal, slotLabel } from '@/lib/format';
import { localDateKey, useDay, useDeleteRecord, useGoals, useProfile, useWeek } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, RADIUS, SPACE } from '@/lib/theme';
import { todayCards } from '@/lib/today-cards';
import type { ActionKind, DayView, DeltaVsLast, MealSlot } from '@/lib/types';

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

  const refreshing = day.isRefetching || week.isRefetching || goals.isRefetching;
  const onRefresh = useCallback(() => {
    day.refetch();
    week.refetch();
    goals.refetch();
    profile.refetch();
  }, [day, week, goals, profile]);

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

  const onAction = (kind: ActionKind) => {
    if (kind === 'coach') router.push('/coach');
    else if (kind === 'weigh_in') openLog('weight');
    else if (kind === 'workout') openLog('activities');
    else openLog('meal');
  };

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
  const reading = view.reading;
  const workoutDone = view.workout_done ?? view.blocks.length > 0;
  const mealsBySlot = SLOT_ORDER.map((slot) => ({
    slot,
    meals: view.items.meals.filter((meal) => meal.slot === slot),
  })).filter((group) => group.meals.length > 0);
  const standalone = view.items.activities.filter((activity) => activity.block_id === null);
  // Lifts print no calories, so their block's figure is a MET estimate (concept-v2
  // §Calories). Say so, quietly, wherever that number is shown.
  const earnedEstimated = view.blocks.some((block) => block.kcal_estimated);

  return (
    <ScrollView
      testID="today-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
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
            Day {view.day_number} ·{' '}
            <Text style={{ color: status.color, fontFamily: FONT.disp }}>{status.text}</Text>
          </Disp>
        </View>
        <Pressable
          accessibilityLabel="Account"
          onPress={() => router.push('/goals')}
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
          onPress={() => router.push('/goals')}
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
          <ReadingCard eyebrow="Right now" text={reading.text} live={view.is_today}>
            <Chips>
              {reading.next_action ? (
                <Chip
                  label={reading.next_action.label}
                  variant="primary"
                  onPress={() => onAction(reading.next_action!.kind)}
                />
              ) : null}
              {reading.actions.map((action) => (
                <Chip key={action.label} label={action.label} onPress={() => onAction(action.kind)} />
              ))}
            </Chips>
          </ReadingCard>
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

      {/* Training */}
      <Section
        title="Training"
        summary={
          view.blocks.length === 0 && standalone.length === 0
            ? 'Nothing yet'
            : `${kcal(view.earned)} kcal earned`
        }
        note={earnedEstimated ? 'est.' : null}>
        {view.blocks.length === 0 && standalone.length === 0 ? (
          <Card>
            <Sub>No exercise logged today.</Sub>
          </Card>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {view.blocks.map((block) => {
              const members = view.items.activities.filter((a) => a.block_id === block.id);
              return (
                <View key={block.id}>
                  <GroupHeading
                    label={block.title}
                    right={`${clock(block.start)}–${clock(block.end)} · ${kcal(block.kcal)} kcal`}
                    note={block.kcal_estimated ? 'est.' : null}
                  />
                  {members.map((activity, index) => (
                    <Row
                      key={activity.id ?? `${block.id}-${index}`}
                      testID={activity.id ? `row-activity-${activity.id}` : undefined}
                      time={clock(activity.logged_at)}
                      title={activity.exercise ?? activity.description}
                      onTitlePress={
                        activity.exercise
                          ? () =>
                              openExercise(router, {
                                id: activity.exercise_id,
                                name: activity.exercise,
                              })
                          : undefined
                      }
                      sub={activity.exercise ? activity.description : null}
                      right={activity.kcal > 0 ? kcal(activity.kcal) : null}
                      onPress={activity.id ? () => correct('activity', activity.id as string) : undefined}
                      onDelete={
                        activity.id
                          ? () => remove.mutate({ kind: 'activity', id: activity.id as string })
                          : undefined
                      }
                      deleteLabel={activity.exercise ?? activity.description}
                      divider={index < members.length - 1}>
                      {activity.delta_vs_last ? (
                        <Sub style={{ marginTop: 3, color: deltaColor(activity.delta_vs_last) }}>
                          {activity.delta_vs_last.text}
                        </Sub>
                      ) : null}
                      <EvidenceThumbs photos={activity.evidence} />
                    </Row>
                  ))}
                </View>
              );
            })}
            {standalone.length > 0 ? (
              <View>
                <GroupHeading label="Also today" />
                {standalone.map((activity, index) => (
                  <Row
                    key={activity.id ?? `standalone-${index}`}
                    testID={activity.id ? `row-activity-${activity.id}` : undefined}
                    time={clock(activity.logged_at)}
                    title={activity.exercise ?? activity.description}
                    onTitlePress={
                      activity.exercise
                        ? () =>
                            openExercise(router, { id: activity.exercise_id, name: activity.exercise })
                        : undefined
                    }
                    sub={activity.source === 'health' ? 'From Health' : null}
                    right={activity.kcal > 0 ? kcal(activity.kcal) : null}
                    onPress={activity.id ? () => correct('activity', activity.id as string) : undefined}
                    onDelete={
                      activity.id
                        ? () => remove.mutate({ kind: 'activity', id: activity.id as string })
                        : undefined
                    }
                    deleteLabel={activity.exercise ?? activity.description}
                    divider={index < standalone.length - 1}
                  />
                ))}
              </View>
            ) : null}
          </Card>
        )}
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

      {/* The coach is a button (concept-v2 §Principles 5) */}
      <Pressable
        testID="coach-button"
        onPress={() => router.push('/coach')}
        style={({
          marginTop: 26,
          borderRadius: RADIUS.pill,
          backgroundColor: C.accent,
          paddingVertical: 16,
          alignItems: 'center',
          opacity: 1,
        })}>
        <Body style={{ fontFamily: FONT.semi, color: C.bg }}>
          {workoutDone ? 'What should I do tomorrow?' : 'What should I do today?'}
        </Body>
      </Pressable>
    </ScrollView>
  );
}

/**
 * Green for progress, amber for a step back, quiet for neither. Read from `sentiment`, not
 * from which way the number went: on an assisted machine the load is the help the machine
 * gives, so "-5 lb" is less help and is the good news. `direction` is the fallback for a
 * response from a build before the field existed.
 */
function deltaColor(delta: DeltaVsLast): string {
  const sentiment = delta.sentiment ?? (delta.direction === 'up' ? 'good' : delta.direction === 'down' ? 'watch' : 'neutral');
  if (sentiment === 'good') return C.good;
  if (sentiment === 'watch') return C.accent;
  return C.mute;
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
