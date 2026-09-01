import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';

import { ActivityRow } from '@/components/activity-row';
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
import { Card, Chip, dismissDeletes, GroupHeading, Row, Section, Skeleton, SkeletonLines } from '@/components/kit';
import { ReadingCard } from '@/components/reading-card';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { addDays } from '@/lib/days-weeks';
import { clock, dateLabel, grams, kcal, slotLabel } from '@/lib/format';
import { groupTraining, splitBySource } from '@/lib/training-groups';
import { localDateKey, useDay, useDeleteRecord } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, SPACE, TABULAR } from '@/lib/theme';
import type { DayView, MacroLine, MealSlot, Verdict } from '@/lib/types';

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

  const isToday = date >= today;

  // The open day has exactly ONE page and it is the Today tab (user decision 2026-09-01).
  // A link can still land here on today's date — an old deep link, the Days list before it
  // was taught otherwise, a typed URL — so it goes home rather than drawing a second,
  // quieter copy of today that groups the same rows a different way.
  useEffect(() => {
    if (isToday) router.replace('/');
  }, [isToday, router]);

  const day = useDay(date, { enabled: !isToday });
  const view = day.data ?? null;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/days'));

  if (isToday) return <View testID="day-redirect" style={{ flex: 1, backgroundColor: C.bg }} />;

  return (
    <ScrollView
      testID="day-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      onScrollBeginDrag={dismissDeletes}
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
  // Training draws every activity exactly once, and it is filed the same way here and on
  // Today — one rule, in lib/training-groups.ts, because the same workout read two ways
  // depending on which door you came through (user decision 2026-09-01).
  const { logged, health } = splitBySource(view.items.activities);
  const { cardio, cardioMinutes, byMuscle, unfiled } = groupTraining(logged, view.muscle_summary);
  // Lifts print no calories, so their block's figure is a MET estimate (concept-v2
  // §Calories). Said once on the Earned tile and once on the Training line.
  const earnedEstimated = view.blocks.some((block) => block.kcal_estimated);

  const mealsBySlot = SLOT_ORDER.map((slot) => ({
    slot,
    meals: view.items.meals.filter((meal) => meal.slot === slot),
  })).filter((group) => group.meals.length > 0);

  const macroHintLine = macroHint([
    { label: 'protein', line: view.macros.protein_g },
    { label: 'carbs', line: view.macros.carbs_g },
    { label: 'fat', line: view.macros.fat_g },
  ]);

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
                      activity.id
                        ? () => remove.mutate({ kind: 'activity', id: activity.id as string })
                        : undefined
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
                      activity.id
                        ? () => remove.mutate({ kind: 'activity', id: activity.id as string })
                        : undefined
                    }
                  />
                ))}
              </View>
            ))}
            {/* Anything left over — no muscle group of its own, or one the summary
                does not know: a class, a hike, an unrecognised movement. */}
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

      {/* Eating: macros against the targets, then the meals. A day with nothing eaten
          prints one line instead — three zero rows carry no information, and the live
          day's line can afford a wink (field report 2026-09-01). The macros, the hints
          and the pattern all come back with the first logged bite. */}
      <Section
        title="Eating"
        summary={view.items.meals.length > 0 ? `${kcal(view.eaten)} kcal` : null}>
        {view.items.meals.length === 0 ? (
          <Card>
            <Sub testID="eating-empty" style={{ lineHeight: 18 }}>
              {view.is_today ? nothingEatenYet(new Date().getHours()) : 'Nothing eaten was logged.'}
            </Sub>
          </Card>
        ) : (
        <Card>
          <MacroBar label="Protein" line={view.macros.protein_g} color={C.good} />
          <MacroBar label="Carbs" line={view.macros.carbs_g} color={C.accent} />
          <MacroBar label="Fat" line={view.macros.fat_g} color={C.mute} />
          {macroHintLine ? (
            <Sub testID="macro-hint" style={{ marginTop: 12, color: C.dim, lineHeight: 18 }}>
              {macroHintLine}
            </Sub>
          ) : null}
          {view.eating_pattern ? (
            <Sub style={{ marginTop: 14, lineHeight: 18 }}>{view.eating_pattern}</Sub>
          ) : null}
        </Card>
        )}

        {view.items.meals.length > 0 && mealsBySlot.length > 0 ? (
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
        ) : null}
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

/**
 * One macro against its target, with the note the server already worked out — and **no
 * track at all** when there is no target (field report 2026-08-31: after the profile was
 * wiped, protein, carbs and fat each drew a full-width empty groove, because grams ÷ null
 * is a zero-width fill. An empty bar is a bar reporting nothing eaten; what was true is
 * that nobody had said what to aim for). The grams are still shown: they are measured.
 */
function MacroBar({ label, line, color }: { label: string; line: MacroLine; color: string }) {
  const eaten = line.eaten ?? 0;
  const target = line.target != null && line.target > 0 ? line.target : null;
  return (
    <View testID={`macro-${label}`} style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <Eyebrow>{label}</Eyebrow>
        <Sub style={[{ fontFamily: FONT.medium }, TABULAR]}>
          {target == null
            ? `${Math.round(eaten)} g`
            : `${Math.round(eaten)} of ${Math.round(target)} g${line.note ? ` · ${line.note}` : ''}`}
        </Sub>
      </View>
      {target == null ? null : (
        <View testID={`macro-track-${label}`} style={{ marginTop: 6 }}>
          <Bar fraction={eaten / target} color={color} />
        </View>
      )}
    </View>
  );
}

/**
 * One quiet line for the whole group, naming what is unset and what to do about it. Once,
 * not once per macro: three copies of the same sentence is the empty-bar problem again in
 * words. Null when every macro has a target, which is the normal case.
 */
/**
 * The empty plate, said once with a wink instead of three zero rows ("PROTEIN 0 g" before
 * breakfast helps nobody — field report 2026-09-01). Picked by the clock so the line
 * matches the meal it is waiting for; the macros and hints return with the first bite.
 */
export function nothingEatenYet(hour: number): string {
  if (hour < 5) return 'Nothing eaten yet — even the fridge is still asleep.';
  if (hour < 11)
    return 'Nothing eaten yet. Breakfast is still a rumor — log the first bite and the breakdown wakes up.';
  if (hour < 15)
    return 'Still an empty plate. Say it or snap it whenever you eat, and the numbers start here.';
  if (hour < 20)
    return 'A whole day and zero bites logged. Iron discipline or a forgotten lunch — tell me which.';
  return 'Nothing logged all day. If you ate, say so before the day closes — I only count what I hear about.';
}

export function macroHint(macros: { label: string; line: MacroLine }[]): string | null {
  const missing = macros
    .filter(({ line }) => line.target == null || line.target <= 0)
    .map(({ label }) => label);
  if (missing.length === 0) return null;
  if (missing.length === macros.length) {
    return 'No targets set — tell me your protein and carb aims and these become bars.';
  }
  return `No target for ${listOf(missing)} — tell me what you are aiming for and these become bars.`;
}

/** "carbs and fat", "protein, carbs and fat". */
function listOf(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
