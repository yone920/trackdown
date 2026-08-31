import {
  cardioColumns,
  frequencyColumns,
  goalCard,
  goalSections,
  muscleBars,
  ratePerWeek,
  untrainedGroups,
} from '@/lib/progress-sections';
import { makeGoal, makeMetric, makeWeek } from './fixtures';

// Which chart a measure gets (lib/progress-sections.ts). The rule: a measure whose number
// means something on a single day is a line; one that only means something over a week is
// columns. Everything else on the Progress screen follows from that.

const series = (values: number[]) =>
  values.map((value, index) => ({ date: `2026-08-${String(index + 1).padStart(2, '0')}`, value }));

describe('goalSections — the chart per measure', () => {
  it('draws body weight as a line, with the target and the raw weigh-ins under it', () => {
    const goal = makeGoal('lose_fat', [
      makeMetric({ measure: 'body_weight', target: 170, series: series([190, 185, 181]) }),
    ]);
    const [section] = goalSections(goal, [
      { date: '2026-08-01', value: 191.2 },
      { date: '2026-08-03', value: 180.4 },
    ]);
    expect(section.chart?.kind).toBe('line');
    if (section.chart?.kind !== 'line') throw new Error('expected a line');
    expect(section.chart.target).toBe(170);
    expect(section.chart.values).toEqual([190, 185, 181]);
    // Aligned to the average's dates: a gap where nothing was weighed.
    expect(section.chart.raw).toEqual([191.2, null, 180.4]);
  });

  it('draws a lift as a line and cardio minutes as weekly columns', () => {
    const strength = makeGoal('build_strength', [
      makeMetric({ measure: 'exercise_load', label: 'Best load', scope: 'Bench Press', unit: 'lb', current: 135, series: series([120, 130, 135]) }),
    ]);
    expect(goalSections(strength)[0].chart?.kind).toBe('line');
    expect(goalSections(strength)[0].eyebrow).toBe('Best load · Bench Press');

    const endurance = makeGoal('improve_endurance', [
      makeMetric({ measure: 'weekly_cardio_min', label: 'Cardio this week', unit: 'min', current: 90, target: 150, series: series([20, 30, 40]) }),
    ]);
    expect(goalSections(endurance)[0].chart?.kind).toBe('columns');
  });

  it('draws weekly sets as columns', () => {
    const muscle = makeGoal('gain_muscle', [
      makeMetric({ measure: 'weekly_sets', label: 'Weekly sets', scope: 'chest', unit: 'sets', current: 9, target: 12, series: series([6, 8, 9]) }),
    ]);
    expect(goalSections(muscle)[0].chart?.kind).toBe('columns');
  });

  it('leaves out a metric with no reading and no series at all', () => {
    const goal = makeGoal('improve_endurance', [
      makeMetric({ measure: 'resting_hr', label: 'Resting heart rate', current: null, target: null, percent: null, series: [] }),
    ]);
    expect(goalSections(goal)).toEqual([]);
  });

  it('does not judge a maintain goal', () => {
    const goal = makeGoal('maintain', [
      makeMetric({ measure: 'weekly_cardio_min', current: 90, series: series([20, 30]) }),
    ]);
    expect(goalSections(goal)[0].judge).toBe(false);
  });
});

describe('the goal card — where I stand, and whether the rate gets me there', () => {
  const TODAY = '2026-08-31';

  /** A clean loss: 212 on 1 Aug down to 210.4 on 31 Aug, one point a week. */
  const losing = (target: number | null, by: string | null) => {
    const goal = makeGoal('lose_fat', [
      makeMetric({
        measure: 'body_weight',
        unit: 'lb',
        direction: 'decrease',
        target,
        current: 210.4,
        baseline: 212,
        percent: 0.1,
        series: [
          { date: '2026-08-03', value: 212 },
          { date: '2026-08-10', value: 211.6 },
          { date: '2026-08-17', value: 211.2 },
          { date: '2026-08-24', value: 210.8 },
          { date: '2026-08-31', value: 210.4 },
        ],
      }),
    ]);
    return {
      ...goal,
      metrics: [{ measure: 'body_weight', target, unit: 'lb', by }],
    };
  };

  it('says where it started, where it is, how far is left and how fast', () => {
    const card = goalCard(losing(200, '2027-01-01'), { today: TODAY });
    expect(card.standing).toBe('212.0 → 210.4 lb now (7-day avg)');
    expect(card.to_go).toBe('10.4 lb to go');
    // −0.4 lb over each of four weeks.
    expect(card.rate).toBe('−0.4 lb/wk');
  });

  it('calls it on pace, ahead or behind against the date the user named', () => {
    // 10.4 lb at 0.4 a week is ~26 weeks — the first of March.
    expect(goalCard(losing(200, '2027-03-01'), { today: TODAY }).pace).toEqual({
      text: 'On pace for Mon, Mar 1',
      tone: 'good',
    });
    expect(goalCard(losing(200, '2027-06-01'), { today: TODAY }).pace?.tone).toBe('good');
    expect(goalCard(losing(200, '2027-06-01'), { today: TODAY }).pace?.text).toContain('Ahead of');
    const behind = goalCard(losing(200, '2026-10-01'), { today: TODAY }).pace;
    expect(behind?.tone).toBe('accent');
    expect(behind?.text).toContain('Behind');
  });

  it('projects a date rather than judging one when no date was named', () => {
    const card = goalCard(losing(200, null), { today: TODAY });
    expect(card.pace?.tone).toBe('mute');
    expect(card.pace?.text).toContain('At this rate');
  });

  it('draws the line, and a dotted continuation to where the rate lands', () => {
    const card = goalCard(losing(200, '2027-03-01'), { today: TODAY });
    if (!card.chart) throw new Error('expected a chart');
    expect(card.chart.target).toBe(200);
    // The measured points first, then room for the projection.
    expect(card.chart.values.slice(0, 5)).toEqual([212, 211.6, 211.2, 210.8, 210.4]);
    expect(card.chart.values.length).toBeGreaterThan(5);
    // Two points on the dotted line and nothing in between: today, and the projection.
    const drawn = card.chart.projection.filter((value) => value != null);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).toBe(210.4);
    expect(drawn[1]).toBeLessThan(202);
    expect(card.chart.projection).toHaveLength(card.chart.values.length);
  });

  it('adds the week: the days served and what the measure did', () => {
    const card = goalCard(losing(200, '2027-03-01'), { today: TODAY, week: makeWeek() });
    expect(card.week).toBe('This week: 4 of 7 served · −0.4 lb');
  });

  it('has no verdict and no dotted line without a finish line at all', () => {
    const card = goalCard(losing(null, null), { today: TODAY });
    expect(card.to_go).toBeNull();
    expect(card.pace).toBeNull();
    expect(card.chart?.projection.every((value) => value == null)).toBe(true);
  });

  it('says so plainly when the measure says it is there', () => {
    const goal = makeGoal('lose_fat', [makeMetric({ percent: 1, current: 170, target: 170 })]);
    const card = goalCard(goal, { today: TODAY });
    expect(card.to_go).toBe('Reached');
    expect(card.pace?.tone).toBe('good');
  });

  it('never colours a maintain goal', () => {
    const goal = { ...losing(200, '2026-10-01'), kind: 'maintain' as const };
    expect(goalCard(goal, { today: TODAY }).judge).toBe(false);
    expect(goalCard(goal, { today: TODAY }).pace?.tone).toBe('mute');
  });

  it('is quiet rather than wrong with nothing measured', () => {
    const goal = makeGoal('lose_fat', [
      makeMetric({ current: null, baseline: null, target: null, percent: null, series: [] }),
    ]);
    const card = goalCard(goal, { today: TODAY });
    expect(card.standing).toBe('Nothing measured yet');
    expect(card.chart).toBeNull();
    expect(card.rate).toBeNull();
  });

  it('refuses to call two days a trend', () => {
    expect(ratePerWeek([{ date: '2026-08-30', value: 212 }, { date: '2026-08-31', value: 210 }])).toBeNull();
  });
});

describe('the board sections', () => {
  const weeks = [
    { start: '2026-08-10', sessions: 1 },
    { start: '2026-08-17', sessions: 4 },
    { start: '2026-08-24', sessions: 2 },
  ];

  it('scales the frequency bars to the busiest week', () => {
    const columns = frequencyColumns(weeks)!.columns;
    expect(columns.map((column) => column.label)).toEqual(['10', '17', '24']);
    expect(columns[1]!.fraction).toBe(1);
    expect(columns[0]!.fraction).toBe(0.25);
  });

  // The cardio bars are about the plan, not about the user's own best week: a full bar
  // means the week's target was met and nothing else.
  it('scales the cardio bars against the weekly target', () => {
    const columns = cardioColumns([{ start: '2026-08-24', minutes: 75 }], 150)!.columns;
    expect(columns[0]!.fraction).toBe(0.5);
  });

  it('sorts the muscle bars and says what has not been trained at all', () => {
    const bars = muscleBars([
      { muscle: 'chest', sets_7d: 6, sets_28d: 18 },
      { muscle: 'back', sets_7d: 0, sets_28d: 9 },
    ]);
    expect(bars[0]).toEqual({ label: 'Chest', fraction: 1, value: '6 this week · 18 in 4' });
    expect(bars[1]!.fraction).toBe(0.5);
    expect(untrainedGroups([{ muscle: 'chest' }, { muscle: 'back' }])).toContain('Lats');
    expect(untrainedGroups([{ muscle: 'chest' }])).not.toContain('Chest');
  });

  it('is muted rather than coloured when there is no goal', () => {
    expect(frequencyColumns(weeks, false)!.columns[0]!.muted).toBe(true);
    expect(cardioColumns(weeks.map((w) => ({ start: w.start, minutes: 30 })), 150, false)!.columns[0]!.muted).toBe(true);
  });
});
