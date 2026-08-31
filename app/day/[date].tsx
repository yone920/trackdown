import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, Share, View } from 'react-native';

import { Bar } from '@/components/charts';
import { EvidenceThumbs } from '@/components/evidence';
import {
  IconAlertCircle,
  IconCheckCircle,
  IconChevronLeft,
  IconChevronRight,
  IconHeart,
  IconShare,
} from '@/components/icons';
import { Card, Chip, GroupHeading, Row, Section, Skeleton, SkeletonLines } from '@/components/kit';
import { ReadingCard } from '@/components/reading-card';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { addDays } from '@/lib/days-weeks';
import { openExercise } from '@/lib/exercise';
import { clock, dateLabel, grams, kcal, slotLabel } from '@/lib/format';
import { localDateKey, useDay, useDeleteRecord } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, SPACE, TABULAR } from '@/lib/theme';
import type { DayActivity, DayView, DeltaVsLast, MacroLine, MealSlot, Verdict } from '@/lib/types';

// A closed day (docs/design-system.md §Day; concept-v2 §The two day views: "Day is a
// reading, not a replay"). The verdict against the goal that was active *that* day, the
// paragraph written when the day closed, training by muscle group with each lift's delta,
// eating as macros and meals, the body, and the coach ask if there was one.
//
// Nothing here is computed: `GET /api/day/:date` returns the verdict, the reading, the
// muscle summary, the macros, the pattern line and the brief. The raw rows live one tap
// further in, behind "See the log as recorded".

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const VERDICT_COLOR: Record<Verdict, string> = {
  served: C.good,
  missed: C.accent,
  unlogged: C.mute,
  none: C.mute,
};

export default function Day() {
  const router = useRouter();
  const insets = useScreenInsets();
  const params = useLocalSearchParams<{ date?: string }>();
  const today = localDateKey();
  const date = typeof params.date === 'string' && params.date ? params.date : today;

  const day = useDay(date);
  const view = day.data ?? null;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/days'));

  return (
    <ScrollView
      testID="day-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}>
      {/* Nav: back to Days, then the date with a day either side of it. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          onPress={goBack}
          accessibilityLabel="Back to Days"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 }}>
          <IconChevronLeft size={18} color={C.mute} />
          <Sub>Days</Sub>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable
            testID="day-prev"
            accessibilityLabel="The day before"
            onPress={() => router.replace(`/day/${addDays(date, -1)}`)}
            style={{ padding: 6 }}>
            <IconChevronLeft size={20} color={C.mute} />
          </Pressable>
          <Sub style={[{ minWidth: 92, textAlign: 'center' }, TABULAR]}>{dateLabel(date)}</Sub>
          <Pressable
            testID="day-next"
            accessibilityLabel="The day after"
            disabled={date >= today}
            onPress={() => router.replace(`/day/${addDays(date, 1)}`)}
            style={{ padding: 6, opacity: date >= today ? 0.3 : 1 }}>
            <IconChevronRight size={20} color={C.mute} />
          </Pressable>
        </View>
      </View>

      {/* The day, in outline, while it is fetched: the verdict line, the paragraph, and
          the three stats — in the places they are about to appear, so nothing jumps. */}
      {day.isLoading && !view ? (
        <View testID="day-skeleton" style={{ paddingTop: 22 }}>
          <Skeleton width="45%" height={26} />
          <Card style={{ marginTop: 18 }}>
            <SkeletonLines lines={3} />
          </Card>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            {[0, 1, 2].map((index) => (
              <Card key={index} style={{ flex: 1 }}>
                <Skeleton width="70%" height={22} />
                <Skeleton width="50%" height={10} style={{ marginTop: 10 }} />
              </Card>
            ))}
          </View>
        </View>
      ) : null}

      {day.error && !view ? (
        <Card style={{ marginTop: 20 }}>
          <Sub style={{ color: C.accent }}>{(day.error as Error).message}</Sub>
        </Card>
      ) : null}

      {view ? (
        <DayBody
          view={view}
          onOpenLog={() => router.push(`/day/${date}/log`)}
          // A row on the reading opens the same review-and-tell screen the record view
          // routes to, for the day being read rather than for today.
          onCorrect={(kind, id) =>
            router.push({ pathname: '/log', params: { editDate: date, editId: id, editKind: kind } })
          }
        />
      ) : null}
    </ScrollView>
  );
}

function DayBody({
  view,
  onOpenLog,
  onCorrect,
}: {
  view: DayView;
  onOpenLog: () => void;
  onCorrect: (kind: 'activity' | 'meal', id: string) => void;
}) {
  const remove = useDeleteRecord();
  const color = VERDICT_COLOR[view.verdict] ?? C.mute;
  const Mark = view.verdict === 'served' ? IconCheckCircle : IconAlertCircle;
  const health = view.items.activities.filter((activity) => activity.source === 'health');
  const logged = view.items.activities.filter((activity) => activity.source !== 'health');
  // Lifts print no calories, so their block's figure is a MET estimate (concept-v2
  // §Calories). Said once on the Earned tile and once on the Training line.
  const earnedEstimated = view.blocks.some((block) => block.kcal_estimated);

  const mealsBySlot = SLOT_ORDER.map((slot) => ({
    slot,
    meals: view.items.meals.filter((meal) => meal.slot === slot),
  })).filter((group) => group.meals.length > 0);

  const exportDay = () =>
    Share.share({
      title: `TrackDown · ${dateLabel(view.date)}`,
      message: JSON.stringify(view, null, 2),
    }).catch(() => undefined);

  return (
    <View>
      {/* The verdict */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 14 }}>
        {view.verdict === 'unlogged' || view.verdict === 'none' ? null : (
          <View style={{ paddingTop: 2, marginRight: 12 }}>
            <Mark size={36} color={color} strokeWidth={1.6} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Disp size={32} style={{ color }}>
            {view.verdict_words}
          </Disp>
          <Sub style={[{ marginTop: 6, lineHeight: 18 }, TABULAR]}>
            {[
              view.verdict_why,
              view.goal ? `Goal · ${view.goal.title}` : 'No goal that day',
              `Day ${view.day_number}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Sub>
        </View>
      </View>

      {/* In short */}
      {view.reading ? (
        <View style={{ marginTop: 18 }}>
          <ReadingCard eyebrow="In short" text={view.reading.text} live={view.is_today} />
        </View>
      ) : null}

      {/* Eaten · Earned · Allowance */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Stat label="Eaten" value={kcal(view.eaten)} />
        <Stat
          label="Earned"
          value={kcal(view.earned)}
          unit={earnedEstimated ? 'estimated' : undefined}
          color={view.earned > 0 ? C.good : C.ink}
        />
        <Stat label="Allowance" value={view.allowance == null ? '—' : kcal(view.allowance)} />
      </View>

      {/* Training, by muscle group */}
      <Section
        title="Training"
        summary={logged.length === 0 && health.length === 0 ? 'Nothing logged' : `${kcal(view.earned)} kcal earned`}
        note={earnedEstimated ? 'est.' : null}>
        {logged.length === 0 && health.length === 0 ? (
          <Card>
            <Sub>No exercise on this day.</Sub>
          </Card>
        ) : (
          <Card style={{ paddingVertical: 4 }}>
            {view.muscle_summary.map((group) => {
              const members = logged.filter((activity) =>
                activity.muscle_groups.some((muscle) => muscle.toLowerCase() === group.muscle.toLowerCase()),
              );
              if (members.length === 0) return null;
              return (
                <View key={group.muscle}>
                  <GroupHeading label={group.muscle} right={`${group.sets} sets`} />
                  {members.map((activity, index) => (
                    <ActivityRow
                      key={activity.id ?? `${group.muscle}-${index}`}
                      activity={activity}
                      last={index === members.length - 1}
                      onPress={activity.id ? () => onCorrect('activity', activity.id as string) : undefined}
                      onDelete={
                        activity.id
                          ? () => remove.mutate({ kind: 'activity', id: activity.id as string })
                          : undefined
                      }
                    />
                  ))}
                </View>
              );
            })}
            {/* Anything with no muscle group of its own — a run, a walk, a class. */}
            {logged.filter((activity) => activity.muscle_groups.length === 0).length > 0 ? (
              <View>
                <GroupHeading label="Also" />
                {logged
                  .filter((activity) => activity.muscle_groups.length === 0)
                  .map((activity, index, all) => (
                    <ActivityRow
                      key={activity.id ?? `other-${index}`}
                      activity={activity}
                      last={index === all.length - 1}
                      onPress={activity.id ? () => onCorrect('activity', activity.id as string) : undefined}
                      onDelete={
                        activity.id
                          ? () => remove.mutate({ kind: 'activity', id: activity.id as string })
                          : undefined
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

      {/* Eating: macros against the targets, then the meals */}
      <Section title="Eating" summary={`${kcal(view.eaten)} kcal`}>
        <Card>
          <MacroBar label="Protein" line={view.macros.protein_g} color={C.good} />
          <MacroBar label="Carbs" line={view.macros.carbs_g} color={C.accent} />
          <MacroBar label="Fat" line={view.macros.fat_g} color={C.mute} />
          {view.eating_pattern ? (
            <Sub style={{ marginTop: 14, lineHeight: 18 }}>{view.eating_pattern}</Sub>
          ) : null}
        </Card>

        {mealsBySlot.length > 0 ? (
          <Card style={{ marginTop: 10, paddingVertical: 4 }}>
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
                    onPress={() => onCorrect('meal', meal.id)}
                    onDelete={() => remove.mutate({ kind: 'meal', id: meal.id })}
                    divider={index < group.meals.length - 1}>
                    <EvidenceThumbs photos={meal.evidence} />
                  </Row>
                ))}
              </View>
            ))}
          </Card>
        ) : (
          <Card style={{ marginTop: 10 }}>
            <Sub>Nothing eaten was logged.</Sub>
          </Card>
        )}
      </Section>

      {/* Body */}
      <Section title="Body">
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat label="Weight" value={view.weight.day == null ? '—' : view.weight.day.toFixed(1)} unit="lb" />
          <Stat label="7-day avg" value={view.weight.avg_7d == null ? '—' : view.weight.avg_7d.toFixed(1)} unit="lb" />
          <Stat
            label="Trend"
            value={
              view.weight.trend_per_week == null
                ? '—'
                : `${view.weight.trend_per_week > 0 ? '+' : '−'}${Math.abs(view.weight.trend_per_week).toFixed(1)}`
            }
            unit="lb / wk"
          />
        </View>
      </Section>

      {/* The ask made that day, if there was one */}
      {view.coach ? (
        <Card style={{ marginTop: 22, borderLeftWidth: 3, borderLeftColor: C.accent }}>
          <Eyebrow>You asked the coach</Eyebrow>
          <Disp size={20} weight="semi" style={{ marginTop: 6 }}>
            {view.coach.headline ?? 'The brief'}
          </Disp>
          {view.coach.nudge ? <Sub style={{ marginTop: 6, lineHeight: 18 }}>{view.coach.nudge}</Sub> : null}
        </Card>
      ) : null}

      {/* Footer */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 26 }}>
        <Chip label="See the log as recorded" onPress={onOpenLog} testID="open-day-log" />
        <Pressable
          testID="export-day"
          accessibilityLabel="Export this day"
          onPress={exportDay}
          style={({
            width: 40,
            height: 40,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: C.track,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 1,
          })}>
          <IconShare size={18} color={C.ink} />
        </Pressable>
      </View>
    </View>
  );
}

function ActivityRow({
  activity,
  last,
  onPress,
  onDelete,
}: {
  activity: DayActivity;
  last: boolean;
  onPress?: () => void;
  onDelete?: () => void;
}) {
  const router = useRouter();
  const load = activity.load_lb == null ? null : `${activity.load_lb} lb`;
  const shape =
    activity.sets != null && activity.reps != null ? `${activity.sets} × ${activity.reps}` : null;
  return (
    <Row
      testID={activity.id ? `row-activity-${activity.id}` : undefined}
      time={clock(activity.logged_at)}
      title={activity.exercise ?? activity.description}
      onTitlePress={
        activity.exercise
          ? () => openExercise(router, { id: activity.exercise_id, name: activity.exercise })
          : undefined
      }
      // The machine belongs on this line and not in the title: the movement is what the
      // week is compared on, and the kit is what the row is recognised by.
      sub={[
        activity.equipment,
        shape,
        load,
        activity.duration_min == null ? null : `${activity.duration_min} min`,
      ]
        .filter(Boolean)
        .join(' · ')}
      right={activity.kcal > 0 ? kcal(activity.kcal) : null}
      onPress={onPress}
      onDelete={onDelete}
      deleteLabel={activity.exercise ?? activity.description}
      divider={!last}>
      {activity.delta_vs_last ? (
        <Sub style={{ marginTop: 3, color: deltaColor(activity.delta_vs_last) }}>
          {activity.delta_vs_last.text}
        </Sub>
      ) : null}
      <EvidenceThumbs photos={activity.evidence} />
    </Row>
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

function Stat({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <Card style={{ flex: 1, padding: 14 }}>
      <Eyebrow>{label}</Eyebrow>
      <Disp size={26} style={[{ marginTop: 6, color: color ?? C.ink }, TABULAR]}>
        {value}
      </Disp>
      {unit ? <Sub style={{ marginTop: 2 }}>{unit}</Sub> : null}
    </Card>
  );
}

/** One macro against its target, with the note the server already worked out. */
function MacroBar({ label, line, color }: { label: string; line: MacroLine; color: string }) {
  const eaten = line.eaten ?? 0;
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <Eyebrow>{label}</Eyebrow>
        <Sub style={[{ fontFamily: FONT.medium }, TABULAR]}>
          {line.target == null
            ? `${Math.round(eaten)} g`
            : `${Math.round(eaten)} of ${Math.round(line.target)} g${line.note ? ` · ${line.note}` : ''}`}
        </Sub>
      </View>
      <View style={{ marginTop: 6 }}>
        <Bar fraction={line.target ? eaten / line.target : 0} color={color} />
      </View>
    </View>
  );
}
