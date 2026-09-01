import { View } from 'react-native';

import { Card } from '@/components/kit';
import { Body, Disp, Sub } from '@/components/type';
import { useCoachNext } from '@/lib/queries';
import { C, FONT, TABULAR } from '@/lib/theme';
import type { CoachBrief } from '@/lib/types';

// The coach's eating guidance, drawn beside the meals rather than on a page of its own
// (user decision 2026-09-01). What is LEFT of the day, not what the day was for: the big
// number is the server's live arithmetic against everything logged so far, and past the
// allowance it is one flat line and no advice.
//
// It reads the same standing brief the plan does — one query, one fetch — and draws
// nothing at all when nobody has asked for a plan today. Nothing here generates one.

/** The big number: what is left, or how far over. Never a signed minus. */
export function eatFigure(brief: CoachBrief): string {
  const now = brief.nutrition_now;
  if (!now || now.remaining_kcal == null) return String(brief.nutrition?.kcal ?? '—');
  return String(Math.abs(now.remaining_kcal));
}

export function EatGuidance() {
  const coach = useCoachNext();
  const brief: CoachBrief | null = coach.data?.brief ?? null;
  if (!brief?.nutrition) return null;
  // What is LEFT of the day, not what the day was for. The big number is the server's
  // live arithmetic against everything logged so far; the model's meal ideas sit under it.
  // Past the allowance it is one flat line and no advice.
  return (
    <Card testID="eat-guidance">
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <Disp size={38} testID="eat-remaining" style={TABULAR}>
            {eatFigure(brief)}
          </Disp>
          <Sub style={{ marginLeft: 6, fontFamily: FONT.medium, fontSize: 13 }}>
            {brief.nutrition_now ? (brief.nutrition_now.past_target ? 'kcal over' : 'kcal left') : 'kcal'}
          </Sub>
        </View>
        <Sub testID="eat-line" style={[{ marginTop: 4 }, TABULAR]}>
          {brief.nutrition_now
            ? brief.nutrition_now.line
            : [
                brief.nutrition.protein_g != null ? `${brief.nutrition.protein_g} g protein` : null,
                brief.nutrition.carbs_max_g != null
                  ? `≤ ${brief.nutrition.carbs_max_g} g carbs`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
        </Sub>
        {brief.nutrition_now ? (
          <Sub style={[{ marginTop: 2, color: C.dim }, TABULAR]}>
            {[
              `${brief.nutrition_now.eaten_kcal} eaten`,
              brief.nutrition_now.allowance_kcal != null
                ? `of ${brief.nutrition_now.allowance_kcal}`
                : null,
              brief.nutrition.carbs_max_g != null
                ? `· ≤ ${brief.nutrition.carbs_max_g} g carbs`
                : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </Sub>
        ) : null}
        {brief.nutrition.why ? (
          <Body style={{ marginTop: 12, lineHeight: 15 * 1.55 }}>{brief.nutrition.why}</Body>
        ) : null}
        {brief.nutrition.ideas && brief.nutrition.ideas.length > 0 ? (
          <View style={{ marginTop: 12 }}>
            {brief.nutrition.ideas.map((idea) => (
              <Sub key={idea} style={{ marginTop: 4, lineHeight: 18 }}>
                · {idea}
              </Sub>
            ))}
          </View>
        ) : null}
      </Card>
  );
}
