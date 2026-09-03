import { bodyRegions } from '@/lib/body-map';
import {
  bodyRow,
  cardioRow,
  coverageRow,
  daysHeadline,
  daysRow,
  goalRow,
  movers,
  muscleFacts,
  strengthRow,
} from '@/lib/scoreboard';
import type { BoardLift } from '@/lib/types';
import { BENCH, CHIN, COVERAGE, EMPTY_BOARD, makeBoard, makeDayRow, makeGoal, makeMetric, makeWeek } from './fixtures';

// The scoreboard's arithmetic (user decision 2026-09-02). Every fact the Progress page
// prints is computed here, so this is where the facts are checked — the screen test asks
// whether they were drawn, and this one asks whether they are true.

const TODAY = '2026-08-31';

describe('the goal row', () => {
  const weightGoal = () => ({
    ...makeGoal('lose_fat', [
      makeMetric({
        measure: 'body_weight',
        unit: 'lb',
        target: 200,
        current: 210.4,
        baseline: 212,
        percent: 0.13,
        series: [
          { date: '2026-08-24', value: 212 },
          { date: '2026-08-31', value: 210.4 },
        ],
      }),
    ]),
    title: 'Get to 200 lb',
  });

  it('carries the percent, the measure and the last move, dated', () => {
    const row = goalRow(weightGoal(), {
      today: TODAY,
      weighIns: [
        { date: '2026-08-29', value: 212.4 },
        { date: '2026-08-31', value: 210.4 },
      ],
    });
    expect(row.percent).toBe(0.13);
    expect(row.value).toBe('210.4');
    expect(row.unit).toBe('lb');
    // The WEIGH-INS, not the smoothed series: "since Aug 31" is a claim about a reading.
    expect(row.delta).toEqual({ text: '−2.0 lb since Sat, Aug 29', tone: 'good' });
  });

  it('calls a move away from the target accent, and never colours an unjudged goal', () => {
    const away = goalRow(weightGoal(), {
      today: TODAY,
      weighIns: [
        { date: '2026-08-29', value: 209 },
        { date: '2026-08-31', value: 210.4 },
      ],
    });
    expect(away.delta).toEqual({ text: '+1.4 lb since Sat, Aug 29', tone: 'accent' });

    const maintain = goalRow({ ...weightGoal(), kind: 'maintain' }, {
      today: TODAY,
      weighIns: [
        { date: '2026-08-29', value: 209 },
        { date: '2026-08-31', value: 210.4 },
      ],
    });
    expect(maintain.judge).toBe(false);
    expect(maintain.delta?.tone).toBe('mute');
  });

  it('says nothing about a move nobody can measure yet', () => {
    const row = goalRow(weightGoal(), { today: TODAY, weighIns: [{ date: '2026-08-31', value: 210.4 }] });
    expect(row.delta).toBeNull();
  });
});

describe('the body row', () => {
  it('reads the latest weigh-in, when it was taken, and the trend', () => {
    const row = bodyRow(makeBoard().body, TODAY);
    expect(row).toEqual({
      values: [212, 210.4],
      headline: '210.4 lb today',
      trend: 'trend −0.8 lb / wk',
    });
  });

  it('is nothing at all on an account with no weigh-ins', () => {
    expect(bodyRow(EMPTY_BOARD.body, TODAY)).toBeNull();
  });
});

describe('the strength row', () => {
  const lift = (overrides: Partial<BoardLift>): BoardLift => ({ ...BENCH, ...overrides });

  it('counts what is ready and names what is new, in one line', () => {
    const row = strengthRow([
      BENCH,
      CHIN,
      lift({ exercise: 'Squat', exercise_id: 'ex-squat', days_since: 2, next: { ...BENCH.next, rule: 'step_up', load_lb: 140 } }),
      lift({ exercise: 'Deadlift', exercise_id: 'ex-dead', days_since: 0, next: { ...BENCH.next, rule: 'new' } }),
    ]);
    expect(row.count).toBe(4);
    expect(row.news).toBe('2 ready to step up · Deadlift baseline set');
  });

  it('picks its movers deterministically — kind, then most recent, then the name', () => {
    const board = [
      lift({ exercise: 'Row', exercise_id: 'ex-row', days_since: 5, next: { ...BENCH.next, rule: 'step_up', load_lb: 140 } }),
      lift({ exercise: 'Deadlift', exercise_id: 'ex-dead', days_since: 0, next: { ...BENCH.next, rule: 'new' } }),
      lift({ exercise: 'Squat', exercise_id: 'ex-squat', days_since: 2, next: { ...BENCH.next, rule: 'step_up', load_lb: 140 } }),
      BENCH,
    ];
    expect(movers(board).map((mover) => mover.exercise)).toEqual(['Squat', 'Row']);
    // The same board in any order picks the same two, in the same order.
    expect(movers([...board].reverse()).map((mover) => mover.exercise)).toEqual(['Squat', 'Row']);
    // A hold is not news: BENCH is on the board and never on the row.
    expect(movers(board, 4).map((mover) => mover.exercise)).not.toContain('Bench Press');
  });

  it('draws the step as an arrow, and leaves an assisted machine its own words', () => {
    const [step] = movers([
      lift({ exercise: 'Squat', days_since: 2, load_lb: 135, next: { ...BENCH.next, rule: 'step_up', load_lb: 140 } }),
    ]);
    expect(step?.text).toBe('135 → 140 lb next');

    // On an assisted machine the load is the help: "55 → 50" reads like a step down unless
    // the prescription's own sentence comes with it.
    const [assisted] = movers([CHIN]);
    expect(assisted?.text).toBe('50 lb of assistance next — one step less help');
  });

  it('says the quiet true thing when nothing is news', () => {
    expect(strengthRow([BENCH]).news).toBe('1 trained this week · all holding');
    expect(strengthRow([]).news).toBe('Nothing lifted in four weeks');
    expect(strengthRow([{ ...BENCH, days_since: 20 }]).news).toBe('All holding — nothing lifted this week');
  });
});

describe('the coverage row', () => {
  it('counts what has been served and names what the rotation owes', () => {
    const row = coverageRow(COVERAGE);
    expect(row.total).toBe(12);
    expect(row.served).toBe(3);
    expect(row.line).toBe('3 of 12 served · quiet: calves, core');
    expect(row.chips).toHaveLength(12);
  });

  it('colours a chip the way the figure colours a region', () => {
    const by = new Map(coverageRow(COVERAGE).chips.map((chip) => [chip.key, chip.tone]));
    // Chest: twelve sets, inside the band.
    expect(by.get('chest')).toBe('good');
    // Biceps: three sets, served but under it.
    expect(by.get('biceps')).toBe('accent');
    // Core: overdue. Calves: never seen. Both dim — the rotation owes them a turn.
    expect(by.get('core')).toBe('dim');
    expect(by.get('calves')).toBe('dim');
    // A muscle the ledger did not mention at all is still a chip, and still honest.
    expect(by.get('hamstrings')).toBe('dim');
  });
});

describe('the muscle popup', () => {
  it('says the week, the band, when it was last trained and what fed it', () => {
    const chest = bodyRegions(COVERAGE).find((region) => region.key === 'chest')!;
    const facts = muscleFacts(chest, [BENCH, CHIN]);

    expect(facts.headline).toBe('12 sets this week');
    expect(facts.band).toBe('in the band');
    expect(facts.facts[0]).toEqual({ label: 'Target', value: '10–20 sets/wk' });
    expect(facts.facts[1]?.value).toContain('trained yesterday');
    expect(facts.facts[1]?.value).toContain('Bench Press');
    expect(facts.facts[2]).toEqual({ label: 'Fed by', value: 'Bench Press · 3 sets' });
  });

  it('is honest about a muscle nothing on the board feeds', () => {
    const calves = bodyRegions(COVERAGE).find((region) => region.key === 'calves')!;
    const facts = muscleFacts(calves, [BENCH, CHIN]);
    expect(facts.headline).toBe('Nothing in four weeks');
    expect(facts.band).toBe('not trained in four weeks');
    expect(facts.facts[2]?.value).toBe('nothing on the board');
  });

  // A treadmill walk serves the glutes and the calves and records no sets at all, so the
  // colour and the number must tell one story (lib/body-map.ts §levelOf).
  it('says where the credit came from when a muscle was served with no sets', () => {
    const walked = bodyRegions([
      { key: 'glutes', label: 'glutes', days_since: 0, last_date: '2026-08-31', sets_7d: 0, sets_14d: 0, sets_28d: 0, unit: 'sets', overdue: false },
    ]).find((region) => region.key === 'glutes')!;
    expect(muscleFacts(walked, []).headline).toBe('Credited from cardio');
  });
});

describe('the cardio row', () => {
  it('is equivalent minutes against the target, with the next prescription', () => {
    expect(cardioRow(makeBoard().cardio)).toEqual({
      line: '50 of 150 min',
      next: '22 min next',
      fraction: 50 / 150,
    });
  });

  it('says nothing at all to somebody who lifts and does not run', () => {
    expect(cardioRow(EMPTY_BOARD.cardio)).toBeNull();
  });

  it('answers the question once a goal has asked it', () => {
    const asked = cardioRow({ ...EMPTY_BOARD.cardio, weekly_target_min: 120, target_stated: true });
    expect(asked?.line).toBe('0 of 120 min');
    expect(asked?.next).toBe('150 min to go');
  });
});

describe('the days row', () => {
  // A fortnight since 2026-09-03: the tile draws one bar per day, and three bars are not a
  // rhythm. The window is DAYS_ON_ROW and the sort is still newest first.
  it('takes a fortnight, newest first, with what each one earned', () => {
    const rows = daysRow([
      makeDayRow({ date: '2026-08-28', earned: 0, verdict: 'missed' }),
      makeDayRow({ date: '2026-08-31', is_today: true, earned: 175, summary: 'Pull day + walk' }),
      makeDayRow({ date: '2026-08-30', earned: 300 }),
      makeDayRow({ date: '2026-08-29' }),
    ]);
    expect(rows.map((row) => row.date)).toEqual(['2026-08-31', '2026-08-30', '2026-08-29', '2026-08-28']);
    expect(rows[0]).toMatchObject({ line: 'Today · Pull day + walk', right: '175 earned', open: true });
    expect(rows[1]?.right).toBe('300 earned');
    expect(rows[1]?.line).toBe('Served your goal · Chest and triceps · 1,450 kcal');
    // The bar heights read the number, not the sentence.
    expect(rows[0]?.earned).toBe(175);
    expect(rows[3]?.earned).toBe(0);
  });

  it('still takes only what it is asked for', () => {
    const rows = daysRow(
      [
        makeDayRow({ date: '2026-08-31' }),
        makeDayRow({ date: '2026-08-30' }),
        makeDayRow({ date: '2026-08-29' }),
      ],
      2,
    );
    expect(rows.map((row) => row.date)).toEqual(['2026-08-31', '2026-08-30']);
  });

  it('falls back to the verdict when a day earned nothing', () => {
    expect(daysRow([makeDayRow({ earned: 0, verdict: 'missed' })])[0]?.right).toBe('missed');
  });

  it('reports the week only once something has been judged', () => {
    expect(daysHeadline(makeWeek())).toBe('4 of 7 served');
    expect(daysHeadline(makeWeek({ judged: 0, served: 0 }))).toBeNull();
    expect(daysHeadline(null)).toBeNull();
  });
});
