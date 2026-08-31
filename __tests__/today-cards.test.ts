import { todayCards } from '@/lib/today-cards';
import { C } from '@/lib/theme';

import { makeDay, makeGoal, makeMetric, makeWeek } from './fixtures';

// Which cards Today shows is the one judgement the app makes for itself
// (docs/design-system.md §Today). These are the rules, per goal kind — and the rule that
// a card whose number is missing does not appear at all.

const keys = (cards: { key: string }[]) => cards.map((card) => card.key);

describe('todayCards', () => {
  it('fat loss gets the calories ring, the week and the weight trend', () => {
    const cards = todayCards({
      day: makeDay(),
      week: makeWeek(),
      goal: makeGoal('lose_fat'),
    });
    expect(keys(cards)).toEqual(['calories-left', 'weekly-deficit', 'weight-trend']);
    expect(cards[0].full).toBe(true);
    expect(cards[0].chart?.kind).toBe('ring');
  });

  it('muscle gets protein, weekly sets and the coverage strip', () => {
    const cards = todayCards({
      day: makeDay(),
      week: makeWeek(),
      goal: makeGoal('gain_muscle', [
        makeMetric({ measure: 'weekly_sets', label: 'Weekly sets', unit: 'sets', target: 12, current: 6, scope: 'chest' }),
      ]),
    });
    expect(keys(cards)).toEqual(['protein', 'weekly_sets', 'coverage']);
  });

  it('endurance hides the cards it has no number for', () => {
    const cards = todayCards({
      day: makeDay(),
      week: makeWeek(),
      goal: makeGoal('improve_endurance', [
        makeMetric({ measure: 'weekly_cardio_min', label: 'Cardio', unit: 'min', target: 150, current: 90 }),
      ]),
    });
    // No run today and no resting HR: only the weekly cardio card can be drawn.
    expect(keys(cards)).toEqual(['weekly_cardio_min']);
  });

  it('endurance shows a pace card once the day has a run', () => {
    const day = makeDay({
      items: {
        meals: [],
        weights: [],
        activities: [
          {
            id: 'a1',
            logged_at: '2026-08-30T12:00:00.000Z',
            description: '3 miles',
            exercise: 'Run',
            exercise_id: null,
            equipment: null,
            category: 'cardio',
            muscle_groups: [],
            sets: null,
            reps: null,
            load_lb: null,
            duration_min: 27,
            distance_mi: 3,
            kcal: 320,
            source: 'manual',
            confidence: 'high',
            block_id: null,
            delta_vs_last: null,
            evidence: [],
          },
        ],
      },
    });
    const cards = todayCards({
      day,
      week: makeWeek(),
      goal: makeGoal('improve_endurance', [
        makeMetric({ measure: 'weekly_cardio_min', label: 'Cardio', unit: 'min', target: 150, current: 90 }),
      ]),
    });
    expect(keys(cards)).toEqual(['weekly_cardio_min', 'pace']);
    expect(cards[1].value).toBe('9:00');
  });

  it('strength gets the target lift and push/pull/legs', () => {
    const cards = todayCards({
      day: makeDay(),
      week: makeWeek(),
      goal: makeGoal('build_strength', [
        makeMetric({ measure: 'exercise_load', label: 'Load', unit: 'lb', scope: 'Bench Press', target: 185, current: 150 }),
      ]),
    });
    expect(keys(cards)).toEqual(['exercise_load', 'push-pull-legs']);
    expect(cards[0].eyebrow).toContain('Bench Press');
  });

  it('no goal gets consistency and coverage, and no judgement colours', () => {
    const cards = todayCards({ day: makeDay(), week: makeWeek(), goal: null });
    expect(keys(cards)).toEqual(['workouts-week', 'cardio-today', 'coverage']);
    for (const card of cards) {
      const chart = card.chart;
      if (chart?.kind === 'segments') {
        for (const segment of chart.segments) {
          expect(segment.color).not.toBe(C.good);
          expect(segment.color).not.toBe(C.accent);
        }
      }
      expect(card.valueColor ?? C.ink).toBe(C.ink);
    }
  });

  it('maintain is judged as gently as no goal at all', () => {
    const cards = todayCards({ day: makeDay(), week: makeWeek(), goal: makeGoal('maintain') });
    expect(keys(cards)).toEqual(['workouts-week', 'cardio-today', 'coverage']);
  });

  it('drops the calories card when the profile cannot produce an allowance', () => {
    const day = makeDay({ allowance: null, remaining: null, target: null });
    const cards = todayCards({ day, week: makeWeek(), goal: makeGoal('lose_fat') });
    expect(keys(cards)).not.toContain('calories-left');
  });

  it('drops the week card when the week has not loaded', () => {
    const cards = todayCards({ day: makeDay(), week: null, goal: makeGoal('lose_fat') });
    expect(keys(cards)).toEqual(['calories-left', 'weight-trend']);
  });
});
