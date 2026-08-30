import {
  consistencySection,
  coverageSection,
  goalSections,
} from '@/lib/progress-sections';
import { makeDayRow, makeGoal, makeMetric } from './fixtures';

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

describe('the two sections every Progress screen ends with', () => {
  const days = [
    makeDayRow({ date: '2026-08-24', muscle_groups: ['chest', 'triceps'] }),
    makeDayRow({ date: '2026-08-26', muscle_groups: ['back'] }),
    makeDayRow({ date: '2026-08-28', muscle_groups: [] }),
    makeDayRow({ date: '2026-08-17', muscle_groups: ['quads'] }),
  ];

  it('counts workouts a week', () => {
    const section = consistencySection(days, true)!;
    expect(section.eyebrow).toBe('Workouts a week');
    expect(section.value).toBe('2');
    expect(section.chart?.kind).toBe('columns');
  });

  it('counts the muscle groups covered, and names the ones that are not', () => {
    const section = coverageSection(days, true)!;
    expect(section.value).toBe('4');
    expect(section.unit).toContain('groups');
    expect(section.sub).toContain('Lats');
    if (section.chart?.kind !== 'rows') throw new Error('expected rows');
    expect(section.chart.rows.find((row) => row.label === 'Chest')?.value).toBe('1 day');
    expect(section.chart.rows.find((row) => row.label === 'Lats')?.value).toBe('—');
  });

  it('is muted rather than coloured when there is no goal', () => {
    expect(consistencySection(days, false)!.judge).toBe(false);
    expect(coverageSection(days, false)!.judge).toBe(false);
  });
});
