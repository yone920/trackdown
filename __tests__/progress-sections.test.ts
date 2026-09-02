import {
  cardioColumns,
  cardioProvenance,
  frequencyColumns,
  goalCard,
  goalSections,
  liftGroups,
  liftRank,
  ratePerWeek,
  snapshotStrip,
  topLifts,
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

  // Field report 2026-09-02: a 110 lb slip from somebody who weighs 212 made the card say
  // "Reached · The measure says you are there" the same day. A verdict that FLATTERS is
  // worse than one that scolds, because nothing about it invites a second look.
  it('does not call a goal reached off one reading at target', () => {
    const goal = makeGoal('lose_fat', [makeMetric({ percent: 1, current: 170, target: 170 })]);
    const card = goalCard(goal, { today: TODAY });
    expect(card.to_go).toBe('At target today');
    expect(card.to_go).not.toBe('Reached');
    // And it says what would make it count, rather than celebrating.
    expect(card.pace?.text).toMatch(/once it holds/);
    expect(card.pace?.tone).toBe('mute');
  });

  it('says Reached once the server says the average HELD', () => {
    // `reached_candidate_at` is set only after a week at target on several weigh-ins across
    // several days (backend services/goals/detect.ts). That is the signal the word waits for.
    const goal = {
      ...makeGoal('lose_fat', [makeMetric({ percent: 1, current: 170, target: 170 })]),
      reached_candidate_at: '2026-09-01T00:00:00.000Z',
    };
    const card = goalCard(goal, { today: TODAY });
    expect(card.to_go).toBe('Reached');
    expect(card.pace?.text).toBe('The measure says you are there');
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

  // The field report (2026-08-31): one weigh-in drew a tall empty box and "No movement yet".
  describe('fewer than two readings', () => {
    const withSeries = (points: { date: string; value: number }[]) => {
      const goal = makeGoal('lose_fat', [
        makeMetric({
          measure: 'body_weight',
          unit: 'lb',
          target: 200,
          current: points[points.length - 1]?.value ?? null,
          baseline: points[0]?.value ?? null,
          percent: points.length > 0 ? 0.1 : null,
          series: points,
        }),
      ]);
      return { ...goal, metrics: [{ measure: 'body_weight', target: 200, unit: 'lb', by: '2027-03-01' }] };
    };

    it('names the one reading and what would make it a line', () => {
      const card = goalCard(withSeries([{ date: '2026-08-31', value: 212 }]), { today: TODAY });
      expect(card.pace).toEqual({
        text: 'One weigh-in so far (212.0 lb · Mon, Aug 31). Weigh in a few mornings and your trend appears.',
        tone: 'mute',
      });
      // A strip: the dot against its target, with no room reserved for a projection.
      expect(card.chart?.sparse).toBe(true);
      expect(card.chart?.values).toEqual([212]);
      expect(card.chart?.projection).toEqual([null]);
      expect(card.rate).toBeNull();
    });

    it('asks for the first reading when there is none', () => {
      const card = goalCard(withSeries([]), { today: TODAY });
      expect(card.standing).toBe('Nothing measured yet');
      expect(card.pace?.text).toBe('Log a weigh-in to start the line.');
      expect(card.chart).toBeNull();
    });

    it('speaks each measure’s own language', () => {
      const strength = makeGoal('build_strength', [
        makeMetric({
          measure: 'exercise_load',
          label: 'Best load',
          scope: 'Bench Press',
          unit: 'lb',
          target: 185,
          current: 135,
          baseline: 135,
          series: [{ date: '2026-08-31', value: 135 }],
        }),
      ]);
      const said = goalCard(strength, { today: TODAY }).pace?.text ?? '';
      expect(said).toContain('One session so far (135.0 lb');
      expect(said).toContain('Log a few more sessions');
    });

    it('leaves two readings and up exactly as they were', () => {
      const card = goalCard(losing(200, '2027-03-01'), { today: TODAY });
      expect(card.chart?.sparse).toBe(false);
      expect(card.pace?.text).toBe('On pace for Mon, Mar 1');
    });
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

  it('is muted rather than coloured when there is no goal', () => {
    expect(frequencyColumns(weeks, false)!.columns[0]!.muted).toBe(true);
    expect(cardioColumns(weeks.map((w) => ({ start: w.start, minutes: 30 })), 150, false)!.columns[0]!.muted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lifts, at two scales (user decision 2026-08-31)
// ---------------------------------------------------------------------------

type TestLift = {
  exercise: string;
  days_since: number;
  muscle_groups: string[];
  next: { rule: string; eta: string | null };
};

const lift = (over: Partial<TestLift> & { exercise: string }): TestLift => ({
  days_since: 2,
  muscle_groups: ['chest'],
  next: { rule: 'step_up', eta: null },
  ...over,
});

describe('the lifts board, ranked', () => {
  it('ranks a lift by what makes it interesting, in the order the question is asked', () => {
    expect(liftRank(lift({ exercise: 'a', days_since: 6 }))).toBe('this_week');
    // A hold with an eta is a specific thing being waited for; one without is not.
    expect(liftRank(lift({ exercise: 'a', days_since: 9, next: { rule: 'hold', eta: '~2 wks' } }))).toBe(
      'mid_progression',
    );
    expect(liftRank(lift({ exercise: 'a', days_since: 9, next: { rule: 'hold', eta: null } }))).toBe('other');
    expect(liftRank(lift({ exercise: 'a', days_since: 9, next: { rule: 'new', eta: null } }))).toBe('baseline');
    expect(liftRank(lift({ exercise: 'a', days_since: 9, next: { rule: 'reference', eta: null } }))).toBe('baseline');
  });

  it('keeps six, newest first inside each rank, and never reorders a tie by accident', () => {
    const all = [
      lift({ exercise: 'Restart Row', days_since: 20, next: { rule: 'restart', eta: null } }),
      lift({ exercise: 'Baseline Curl', days_since: 12, next: { rule: 'new', eta: null } }),
      lift({ exercise: 'Held Press', days_since: 10, next: { rule: 'hold', eta: '~1 wk' } }),
      lift({ exercise: 'Bench Press', days_since: 1 }),
      lift({ exercise: 'Zercher Squat', days_since: 1 }),
      lift({ exercise: 'Alpha Row', days_since: 1 }),
      lift({ exercise: 'Deadlift', days_since: 4 }),
      lift({ exercise: 'Pull-Up', days_since: 6 }),
    ];
    expect(topLifts(all).map((row) => row.exercise)).toEqual([
      // This week, most recent first; the three one-day-old rows break their tie by name.
      'Alpha Row',
      'Bench Press',
      'Zercher Squat',
      'Deadlift',
      'Pull-Up',
      // Then the one held mid-progression, before the baseline and the restart.
      'Held Press',
    ]);
    expect(topLifts(all, 2).map((row) => row.exercise)).toEqual(['Alpha Row', 'Bench Press']);
  });

  it('groups everything by its primary muscle and folds a fortnight-old lift to the end', () => {
    const groups = liftGroups([
      lift({ exercise: 'Bench Press', days_since: 1, muscle_groups: ['chest', 'triceps'] }),
      lift({ exercise: 'Lat Pulldown', days_since: 3, muscle_groups: ['lats'] }),
      lift({ exercise: 'Incline Press', days_since: 5, muscle_groups: ['chest'] }),
      lift({ exercise: 'Calf Raise', days_since: 14, muscle_groups: ['calves'] }),
      lift({ exercise: 'Nameless Machine', days_since: 2, muscle_groups: [] }),
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      // Freshest group first: chest was trained yesterday.
      'Chest',
      'Other',
      'Lats',
      'Not trained lately',
    ]);
    expect(groups[0]!.lifts.map((row) => row.exercise)).toEqual(['Bench Press', 'Incline Press']);
    expect(groups.at(-1)).toMatchObject({ key: 'stale', stale: true });
    expect(groups.at(-1)!.lifts.map((row) => row.exercise)).toEqual(['Calf Raise']);
  });
});

describe('the snapshot strip', () => {
  it('says how often, how much cardio and which way the weight is going', () => {
    expect(
      snapshotStrip({
        frequency: { sessions_this_week: 3, training_days_target: 4 },
        cardio: { equiv_minutes_this_week: 50, minutes_this_week: 35, weekly_target_min: 150 },
        body: { trend_per_week: -0.4 },
      }),
    ).toBe('3 of 4 sessions this week · 50 of 150 cardio min · −0.4 lb/wk');
  });

  it('drops every part nobody measured rather than printing a zero', () => {
    expect(
      snapshotStrip({
        frequency: { sessions_this_week: 1, training_days_target: null },
        cardio: { minutes_this_week: 0, weekly_target_min: 150 },
        body: { trend_per_week: null },
      }),
    ).toBe('1 session this week');
    expect(snapshotStrip(null)).toBeNull();
    expect(snapshotStrip({})).toBeNull();
  });

  // An older server does not send the equivalent figure; the raw minutes are what it has.
  it('falls back to raw minutes when the server has never heard of equivalent ones', () => {
    expect(snapshotStrip({ cardio: { minutes_this_week: 35, weekly_target_min: 150 } })).toBe(
      '35 of 150 cardio min',
    );
  });
});

describe('the cardio target, and where it came from', () => {
  it('never reports a guideline nobody chose as something the user said', () => {
    expect(cardioProvenance('default')).toBe('Standard guideline — tell me yours');
    expect(cardioProvenance('stated')).toBe('From stated');
    expect(cardioProvenance('goal')).toBe('From your goal');
    expect(cardioProvenance(undefined)).toBeNull();
  });
});

describe('the goal card shows the weigh-ins, labelled and dated', () => {
  // `TODAY` above is scoped to its own describe; this block names its own.
  const TODAY = '2026-09-02';
  // User request 2026-09-02: "show where I was at the previous weight vs the new one with
  // dates". The card printed "212.0 → 161.0 lb now (7-day avg)" — an arrow between two
  // numbers, one of them an average, neither of them dated, so a reader had no way to judge
  // whether 161 was believable.

  const goal = () => makeGoal('lose_fat', [makeMetric({ measure: 'body_weight', unit: 'lb', current: 161, target: 170, baseline: 212 })]);

  it('names the latest reading and when it was taken', () => {
    const card = goalCard(goal(), {
      today: TODAY,
      weighIns: [
        { date: '2026-09-01', value: 212 },
        { date: TODAY, value: 110 },
      ],
    });
    expect(card.readings?.latest).toEqual({ value: '110.0 lb', when: 'today' });
  });

  it('names the one before it, with its own date', () => {
    const card = goalCard(goal(), {
      today: TODAY,
      weighIns: [
        { date: '2026-08-25', value: 213 },
        { date: '2026-09-01', value: 212 },
        { date: TODAY, value: 110 },
      ],
    });
    // A day a person would say, not an ISO string and not an arrow.
    expect(card.readings?.previous?.value).toBe('212.0 lb');
    expect(card.readings?.previous?.when).toBe('yesterday');
  });

  it('falls back to a weekday and a date for anything older', () => {
    const card = goalCard(goal(), {
      today: TODAY,
      weighIns: [
        { date: '2026-08-25', value: 213 },
        { date: '2026-08-27', value: 212 },
        { date: TODAY, value: 110 },
      ],
    });
    expect(card.readings?.previous?.when).toMatch(/Aug 27/);
  });

  it('labels the average as an average, because it is one and it is not a weigh-in', () => {
    const card = goalCard(goal(), { today: TODAY, weighIns: [{ date: TODAY, value: 110 }] });
    expect(card.readings?.average).toBe('161.0 lb');
  });

  it('says nothing at all when there are no weigh-ins behind the number', () => {
    const card = goalCard(makeGoal('build_strength', [makeMetric({ measure: 'exercise_load' })]), {
      today: TODAY,
      weighIns: [],
    });
    expect(card.readings).toBeNull();
  });
});
