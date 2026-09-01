import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { Bar } from '@/components/charts';
import { EvidenceThumbs } from '@/components/evidence';
import { IconAvatar } from '@/components/icons';
import { Card, dismissDeletes, GroupHeading, Row, Section } from '@/components/kit';
import { ReadingCard } from '@/components/reading-card';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { clock, dateEyebrow, grams, kcal, nothingEatenYet, slotLabel } from '@/lib/format';
import { localDateKey, useDeleteRecord, useEating } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, SPACE, TABULAR } from '@/lib/theme';
import type { EatingWeek, MacroAverage, MacroLine, MealSlot } from '@/lib/types';

// The Eat tab (user decision 2026-09-01). Four layers, and the order is the argument:
//
//   1. TODAY      what is left of the day. The same arithmetic Today's compact row shows,
//                 because two screens must never disagree about one day's calories.
//   2. THE WEEK   rolling seven days of logged meals, COMPUTED — averages against targets,
//                 with each target saying whether it was stated, derived or a guideline.
//   3. THE DIRECTION  the one written layer: which way to steer the nutrients. It is a
//                 READING — cached against the week's inputs hash, so opening this page
//                 costs nothing when nothing has moved, and it never nags.
//   4. THE FOOD LOG   what was actually eaten, by sitting.
//
// Facts are computed, advice is generated (concept-v2 §Principles 4). Layer 2 is arithmetic
// on the server and nothing on it came out of a model; layer 3 is handed those numbers and
// is forbidden from naming a dish — the user was plain that a meal plan is not what they
// want ("it doesn't have to be a dish… general direction of nutrients").
//
// The + remains the only way anything gets in here.

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export default function Eat() {
  const router = useRouter();
  const insets = useScreenInsets();
  const eating = useEating();
  const remove = useDeleteRecord();

  const onRefresh = useCallback(() => eating.refetch(), [eating]);

  const view = eating.data ?? null;
  const meals = view?.today.meals ?? [];
  const mealsBySlot = SLOT_ORDER.map((slot) => ({
    slot,
    meals: meals.filter((meal) => meal.slot === slot),
  })).filter((group) => group.meals.length > 0);

  const correct = (id: string) =>
    router.push({ pathname: '/log', params: { editDate: localDateKey(), editId: id, editKind: 'meal' } });

  return (
    <ScrollView
      testID="eat-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      onScrollBeginDrag={dismissDeletes}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 12,
        paddingBottom: 140,
      }}
      refreshControl={
        <RefreshControl refreshing={eating.isRefetching} onRefresh={onRefresh} tintColor={C.mute} />
      }>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Eyebrow>{dateEyebrow()}</Eyebrow>
          <Disp size={30} style={{ marginTop: 6 }}>
            Eat
          </Disp>
        </View>
        <Pressable
          testID="eat-you"
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

      {/* 1 — Today. One authoritative figure, the day's own. */}
      <Section title="Today" summary={view ? `${kcal(view.today.eaten)} kcal eaten` : null}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Disp size={38} testID="eat-remaining" style={TABULAR}>
              {view?.today.remaining == null ? '—' : kcal(Math.abs(view.today.remaining))}
            </Disp>
            <Sub style={{ marginLeft: 6, fontFamily: FONT.medium, fontSize: 13 }}>
              {view?.today.remaining == null
                ? 'no target set'
                : view.today.remaining < 0
                  ? 'kcal over'
                  : 'kcal left'}
            </Sub>
          </View>
          {view && meals.length > 0 ? (
            <View style={{ marginTop: 6 }}>
              <MacroBar label="Protein" line={view.today.macros.protein_g} color={C.good} />
              <MacroBar label="Carbs" line={view.today.macros.carbs_g} color={C.accent} />
              <MacroBar label="Fat" line={view.today.macros.fat_g} color={C.mute} />
              {view.today.eating_pattern ? (
                <Sub style={{ marginTop: 14, lineHeight: 18 }}>{view.today.eating_pattern}</Sub>
              ) : null}
            </View>
          ) : (
            <Sub testID="eat-empty-today" style={{ marginTop: 10, lineHeight: 18 }}>
              {nothingEatenYet(new Date().getHours())}
            </Sub>
          )}
        </Card>
      </Section>

      {/* 2 — The week, computed. Nothing on this section came out of a model. */}
      <Section title="The week" summary={view?.week.avg_kcal != null ? `${kcal(view.week.avg_kcal)} kcal / day` : null}>
        {!view || view.week.days_logged === 0 ? (
          <Card>
            <Sub testID="eat-empty-week" style={{ lineHeight: 18 }}>
              Nothing logged in the last seven days. The averages start with the first meal —
              and a day you did not log is left out of them rather than counted as a zero.
            </Sub>
          </Card>
        ) : (
          <Card>
            {/* The divisor, said out loud. An average over two days is a thin week and the
                page says so rather than letting it read as a trend. */}
            <Sub testID="eat-week-days" style={[{ marginBottom: 4 }, TABULAR]}>
              {`${view.week.days_logged} of 7 days logged${view.week.days_logged < 4 ? ' · a thin week' : ''}`}
            </Sub>
            <WeekLine label="Calories" value={view.week.avg_kcal} unit="kcal / day" />
            <MacroAverageRow label="Protein" macro={view.week.protein} />
            <MacroAverageRow label="Carbs" macro={view.week.carbs} />
            <MacroAverageRow label="Fat" macro={view.week.fat} />
            <MacroAverageRow label="Fibre" macro={view.week.fiber} />
            {view.week.outliers.length > 0 ? (
              <View testID="eat-outliers" style={{ marginTop: 14 }}>
                {view.week.outliers.map((note) => (
                  <Sub key={note} style={{ marginTop: 4, lineHeight: 18 }}>
                    · {note}
                  </Sub>
                ))}
              </View>
            ) : null}
          </Card>
        )}
      </Section>

      {/* 3 — The direction. The one written layer, and it is a reading: cached, never
              scheduled, and silent when there is nothing to steer. */}
      {view?.direction ? (
        <View style={{ marginTop: 20 }}>
          <ReadingCard eyebrow="The direction" text={view.direction.text} live />
        </View>
      ) : null}

      {/* 4 — The food log. */}
      <Section title="Logged" summary={meals.length > 0 ? `${meals.length} today` : null}>
        {mealsBySlot.length === 0 ? (
          <Card>
            <Sub testID="eat-empty-log">Nothing logged today.</Sub>
          </Card>
        ) : (
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
                    onPress={() => correct(meal.id)}
                    onDelete={() => remove.mutate({ kind: 'meal', id: meal.id })}
                    divider={index < group.meals.length - 1}>
                    <EvidenceThumbs photos={meal.evidence} />
                  </Row>
                ))}
              </View>
            ))}
          </Card>
        )}
      </Section>
    </ScrollView>
  );
}

/** One computed average against what it is measured by, and where that came from. */
function MacroAverageRow({ label, macro }: { label: string; macro: MacroAverage }) {
  const aim =
    macro.target == null
      ? 'no target set'
      : `${macro.direction === 'at_most' ? '≤' : '≥'} ${macro.target} g${
          macro.source === 'stated' ? '' : macro.source === 'derived' ? ' · from your weight' : ' · guideline'
        }`;
  const met =
    macro.avg_per_day == null || macro.target == null
      ? null
      : macro.direction === 'at_most'
        ? macro.avg_per_day <= macro.target
        : macro.avg_per_day >= macro.target;
  return (
    <View testID={`eat-week-${label}`} style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <Eyebrow>{label}</Eyebrow>
        <Sub style={[{ fontFamily: FONT.medium, color: met === false ? C.accent : C.ink }, TABULAR]}>
          {macro.avg_per_day == null ? '—' : `${macro.avg_per_day} g`}
        </Sub>
      </View>
      <Sub style={[{ marginTop: 2, color: C.dim }, TABULAR]}>{aim}</Sub>
    </View>
  );
}

/** A computed figure with no target to read it against — the week's calories. */
function WeekLine({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
      <Eyebrow>{label}</Eyebrow>
      <Sub style={[{ fontFamily: FONT.medium }, TABULAR]}>
        {value == null ? '—' : `${kcal(value)} ${unit}`}
      </Sub>
    </View>
  );
}

/**
 * One macro against today's target, and **no track at all** when there is no target: grams
 * ÷ null is a zero-width fill, and an empty bar reads as nothing eaten when what was true
 * is that nobody had said what to aim for.
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
