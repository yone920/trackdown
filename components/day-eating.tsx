import { View } from 'react-native';

import { Bar } from '@/components/charts';
import { EvidenceThumbs } from '@/components/evidence';
import { Card, GroupHeading, Row, Section } from '@/components/kit';
import { Eyebrow, Sub } from '@/components/type';
import { clock, grams, kcal, nothingEatenYet, slotLabel } from '@/lib/format';
import { useDeleteRecord } from '@/lib/queries';
import { C, FONT, TABULAR } from '@/lib/theme';
import type { DayView, MacroLine, MealSlot } from '@/lib/types';

// A day's EATING, wherever it is being read — the whole-day archive behind Progress, and
// the eating-only reading behind the Eat calendar (user decision 2026-09-02: history is
// domain-scoped, the same way the tabs are).
//
// Moved out of `app/day/[date].tsx` with nothing changed: the macro bars with no track
// where there is no target, the one hint line naming what is unset, the eating pattern, and
// the meals grouped by slot with their photographs — each row opening the review-and-tell
// sheet, each with its own ✕.

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export function DayEating({
  view,
  onCorrect,
}: {
  view: DayView;
  onCorrect: (kind: 'meal', id: string) => void;
}) {
  const remove = useDeleteRecord();

  const mealsBySlot = SLOT_ORDER.map((slot) => ({
    slot,
    meals: view.items.meals.filter((meal) => meal.slot === slot),
  })).filter((group) => group.meals.length > 0);

  const macroHintLine = macroHint([
    { label: 'protein', line: view.macros.protein_g },
    { label: 'carbs', line: view.macros.carbs_g },
    { label: 'fat', line: view.macros.fat_g },
  ]);

  return (
    <Section title="Eating" summary={view.items.meals.length > 0 ? `${kcal(view.eaten)} kcal` : null}>
      {view.items.meals.length === 0 ? (
        <Card>
          <Sub testID="eating-empty" style={{ lineHeight: 18 }}>
            {view.is_today ? nothingEatenYet(new Date().getHours()) : 'Nothing eaten was logged.'}
          </Sub>
        </Card>
      ) : (
        <Card testID="day-macros">
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
        <Card style={{ marginTop: 10, paddingVertical: 4 }} testID="day-meals">
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
