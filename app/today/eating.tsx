import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { Bar } from '@/components/charts';
import { EatGuidance } from '@/components/eat-guidance';
import { EvidenceThumbs } from '@/components/evidence';
import { IconChevronLeft } from '@/components/icons';
import { Card, dismissDeletes, GroupHeading, Row, Section } from '@/components/kit';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { clock, grams, kcal, nothingEatenYet, slotLabel } from '@/lib/format';
import { localDateKey, useDay, useDeleteRecord } from '@/lib/queries';
import { useScreenInsets } from '@/lib/screen';
import { C, FONT, SPACE, TABULAR } from '@/lib/theme';
import type { MacroLine, MealSlot } from '@/lib/types';

// The day's eating in full, behind a door (user decision 2026-09-01). Today keeps ONE
// authoritative number — what is left of the allowance — and everything that elaborates on
// it lives here: the coach's guidance, the macros against their targets, and the meals.
//
// The rule that put it here: the old Eat card printed the same figure three times in three
// type sizes and then quoted a DIFFERENT one underneath, from an earlier generation of the
// brief. Two disagreeing calorie numbers on one card is worse than no number at all, so the
// summary line and the guidance are now on different screens and only one of them counts.

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export default function EatingLog() {
  const router = useRouter();
  const insets = useScreenInsets();
  const date = localDateKey();
  const day = useDay(date);
  const remove = useDeleteRecord();

  const view = day.data ?? null;
  const meals = view?.items.meals ?? [];
  const mealsBySlot = SLOT_ORDER.map((slot) => ({
    slot,
    meals: meals.filter((meal) => meal.slot === slot),
  })).filter((group) => group.meals.length > 0);

  const correct = (id: string) =>
    router.push({ pathname: '/log', params: { editDate: date, editId: id, editKind: 'meal' } });

  return (
    <ScrollView
      testID="eating-log-scroll"
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
        testID="eating-log-back"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, alignSelf: 'flex-start' }}>
        <IconChevronLeft size={18} color={C.mute} />
        <Sub>Today</Sub>
      </Pressable>

      <Eyebrow style={{ marginTop: 6 }}>What you ate</Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        Eat
      </Disp>

      {/* The coach's eating guidance, where it cannot contradict the number on Today: it
          is the only calorie figure on this screen that is not the day's own arithmetic,
          and it is a screen away from the one that is. */}
      <View style={{ marginTop: 18 }}>
        <EatGuidance />
      </View>

      <Section title="Macros" summary={meals.length > 0 ? `${kcal(view?.eaten ?? 0)} kcal` : null}>
        {meals.length === 0 ? (
          <Card>
            <Sub testID="eating-empty" style={{ lineHeight: 18 }}>
              {nothingEatenYet(new Date().getHours())}
            </Sub>
          </Card>
        ) : (
          <Card>
            <MacroBar label="Protein" line={view!.macros.protein_g} color={C.good} />
            <MacroBar label="Carbs" line={view!.macros.carbs_g} color={C.accent} />
            <MacroBar label="Fat" line={view!.macros.fat_g} color={C.mute} />
            {view?.eating_pattern ? (
              <Sub style={{ marginTop: 14, lineHeight: 18 }}>{view.eating_pattern}</Sub>
            ) : null}
          </Card>
        )}
      </Section>

      {mealsBySlot.length > 0 ? (
        <Section title="Meals">
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
        </Section>
      ) : null}
    </ScrollView>
  );
}

/**
 * One macro against its target, and **no track at all** when there is no target: grams ÷
 * null is a zero-width fill, and an empty bar reads as nothing eaten when what was true is
 * that nobody had said what to aim for. The grams are still shown — they are measured.
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
