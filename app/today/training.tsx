import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { ActivityRow } from '@/components/activity-row';
import { IconChevronLeft, IconHeart } from '@/components/icons';
import { Card, dismissDeletes, GroupHeading, Section } from '@/components/kit';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { kcal } from '@/lib/format';
import { localDateKey, useDay, useDeleteRecord } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, SPACE } from '@/lib/theme';
import { groupTraining, sessionSpan, splitBySource } from '@/lib/training-groups';

// The day's training in full, behind a door (user decision 2026-09-01). It used to be the
// whole middle of Today, which pushed everything under it off the screen: on a real gym
// day the plan, the meals and the weigh-in were all below eight rows of what had just been
// logged. Today keeps a one-line summary; this is what the line opens.
//
// The grouping is the same rule the closed day uses (lib/training-groups.ts): Cardio with
// its minutes first, then muscle headings with set counts, then "Also", every activity
// drawn exactly once. Every row is still three targets — the name opens the sheet, the ✕
// deletes it, the rest of the row opens it for a correction.

export default function TrainingLog() {
  const router = useRouter();
  const insets = useScreenInsets();
  const date = localDateKey();
  const day = useDay(date);
  const remove = useDeleteRecord();

  const view = day.data ?? null;
  const { logged, health } = splitBySource(view?.items.activities ?? []);
  const { cardio, cardioMinutes, byMuscle, unfiled } = groupTraining(logged, view?.muscle_summary ?? []);
  const span = sessionSpan(logged);
  const earnedEstimated = (view?.blocks ?? []).some((block) => block.kcal_estimated);

  const correct = (id: string) =>
    router.push({ pathname: '/log', params: { editDate: date, editId: id, editKind: 'activity' } });

  const rowsOf = (activities: typeof logged, prefix: string) =>
    activities.map((activity, index, all) => (
      <ActivityRow
        key={activity.id ?? `${prefix}-${index}`}
        activity={activity}
        last={index === all.length - 1}
        onPress={activity.id ? () => correct(activity.id as string) : undefined}
        onDelete={activity.id ? () => remove.mutate({ kind: 'activity', id: activity.id as string }) : undefined}
      />
    ));

  return (
    <ScrollView
      testID="training-log-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      onScrollBeginDrag={dismissDeletes}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/today'))}
        accessibilityLabel="Back to Today"
        testID="training-log-back"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, alignSelf: 'flex-start' }}>
        <IconChevronLeft size={18} color={C.mute} />
        <Sub>Today</Sub>
      </Pressable>

      <Eyebrow style={{ marginTop: 6 }}>What you did</Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        Done
      </Disp>

      <Section
        title="Training"
        summary={
          logged.length === 0 && health.length === 0 ? 'Nothing yet' : `${kcal(view?.earned ?? 0)} kcal earned`
        }
        note={[span, earnedEstimated ? 'est.' : null].filter(Boolean).join(' · ') || null}>
        {logged.length === 0 && health.length === 0 ? (
          <Card>
            <Sub testID="training-log-empty">No exercise logged today.</Sub>
          </Card>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {cardio.length > 0 ? (
              <View>
                <GroupHeading label="Cardio" right={cardioMinutes > 0 ? `${cardioMinutes} min` : null} />
                {rowsOf(cardio, 'cardio')}
              </View>
            ) : null}
            {byMuscle.map((group) => (
              <View key={group.muscle}>
                <GroupHeading label={group.muscle} right={`${group.sets} sets`} />
                {rowsOf(group.members, group.muscle)}
              </View>
            ))}
            {/* Anything left over — no muscle group of its own, or one the summary does
                not know: a class, a hike, an unrecognised movement. */}
            {unfiled.length > 0 ? (
              <View>
                <GroupHeading label="Also" />
                {rowsOf(unfiled, 'other')}
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
    </ScrollView>
  );
}
