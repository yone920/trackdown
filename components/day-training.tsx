import { View } from 'react-native';

import { ActivityRow } from '@/components/activity-row';
import { IconHeart } from '@/components/icons';
import { Card, GroupHeading, Section } from '@/components/kit';
import { Body, Eyebrow, Sub } from '@/components/type';
import { kcal } from '@/lib/format';
import { useDeleteRecord } from '@/lib/queries';
import { groupTraining, splitBySource } from '@/lib/training-groups';
import { C } from '@/lib/theme';
import type { DayView } from '@/lib/types';

// A day's TRAINING, wherever it is being read.
//
// Lifted out of `app/day/[date].tsx` unchanged when history became domain-scoped (user
// decision 2026-09-02: "in train it should show me only the train … they have their own
// page — the historic data should also have their own page"). Two screens draw it now — the
// whole-day archive behind Progress, and the training-only reading behind the Train
// calendar — and they must not be able to disagree about what a session looked like, which
// is exactly what two copies of this JSX would eventually do.
//
// Every rule here is the one it always had: activities are filed by `lib/training-groups.ts`
// so a workout reads the same through every door, a row opens the review-and-tell sheet, ✕
// takes it back, and Health is a source rather than a section (concept-v2 §Health).

export function DayTraining({
  view,
  onCorrect,
  summary,
}: {
  view: DayView;
  onCorrect: (kind: 'activity', id: string) => void;
  /**
   * Overrides the section's right-hand line. The Train tab passes its own — which carries
   * the session's time span as well as the calories — because on the live day "when" is
   * half the answer (user decision 2026-09-03).
   */
  summary?: string | null;
}) {
  const remove = useDeleteRecord();
  const { logged, health } = splitBySource(view.items.activities);
  const { cardio, cardioMinutes, byMuscle, unfiled } = groupTraining(logged, view.muscle_summary);
  // Lifts print no calories, so their block's figure is a MET estimate (concept-v2 §Calories).
  const earnedEstimated = view.blocks.some((block) => block.kcal_estimated);

  return (
    <Section
      title="Training"
      summary={
        summary ?? (logged.length === 0 && health.length === 0 ? 'Nothing logged' : `${kcal(view.earned)} kcal earned`)
      }
      note={earnedEstimated ? 'est.' : null}>
      {logged.length === 0 && health.length === 0 ? (
        <Card>
          <Sub testID="training-empty">No exercise on this day.</Sub>
        </Card>
      ) : (
        <Card style={{ paddingVertical: 4 }} testID="day-training">
          {cardio.length > 0 ? (
            <View>
              <GroupHeading label="Cardio" right={cardioMinutes > 0 ? `${cardioMinutes} min` : null} />
              {cardio.map((activity, index) => (
                <ActivityRow
                  key={activity.id ?? `cardio-${index}`}
                  activity={activity}
                  last={index === cardio.length - 1}
                  onPress={activity.id ? () => onCorrect('activity', activity.id as string) : undefined}
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
                  onPress={activity.id ? () => onCorrect('activity', activity.id as string) : undefined}
                  onDelete={
                    activity.id ? () => remove.mutate({ kind: 'activity', id: activity.id as string }) : undefined
                  }
                />
              ))}
            </View>
          ))}
          {/* Anything left over — no muscle group of its own, or one the summary does not
              know: a class, a hike, an unrecognised movement. */}
          {unfiled.length > 0 ? (
            <View>
              <GroupHeading label="Also" />
              {unfiled.map((activity, index, all) => (
                <ActivityRow
                  key={activity.id ?? `other-${index}`}
                  activity={activity}
                  last={index === all.length - 1}
                  onPress={activity.id ? () => onCorrect('activity', activity.id as string) : undefined}
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
  );
}
