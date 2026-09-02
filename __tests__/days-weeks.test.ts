import { addDays, groupByWeek, tallyFor, weekStart, weekdayLabel } from '@/lib/days-weeks';
import { makeDayRow, makeWeek } from './fixtures';

// The Days tab's arithmetic (lib/days-weeks.ts): which week a day belongs to, and what
// the line under the week heading says.

describe('calendar', () => {
  it('starts weeks on Monday and names the weekday', () => {
    // 2026-08-30 is a Sunday, so its week began on the 24th.
    expect(weekStart('2026-08-30')).toBe('2026-08-24');
    expect(weekStart('2026-08-24')).toBe('2026-08-24');
    expect(weekdayLabel('2026-08-30')).toBe('Sun');
    expect(weekdayLabel('2026-08-24')).toBe('Mon');
  });

  it('steps by whole calendar days across a month boundary', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });
});

describe('groupByWeek', () => {
  it('splits the rows into weeks, newest first, keeping their order inside one', () => {
    const rows = [
      makeDayRow({ date: '2026-08-25' }),
      makeDayRow({ date: '2026-08-24' }),
      makeDayRow({ date: '2026-08-23' }),
      makeDayRow({ date: '2026-08-22' }),
    ];
    const groups = groupByWeek(rows);
    expect(groups.map((group) => group.key)).toEqual(['2026-08-24', '2026-08-17']);
    expect(groups[0].days.map((day) => day.date)).toEqual(['2026-08-25', '2026-08-24']);
    expect(groups[1].days.map((day) => day.date)).toEqual(['2026-08-23', '2026-08-22']);
    expect(groups[1].label).toBe('Week of 17 Aug');
  });

  it('calls the week the user is living "This week"', () => {
    const groups = groupByWeek([makeDayRow({ date: '2026-08-30', is_today: true })]);
    expect(groups[0].label).toBe('This week');
  });

  it('lets GET /api/week win for the week it is about, and computes the rest itself', () => {
    const week = makeWeek({ end: '2026-08-30', served: 4, judged: 7, weekly_deficit: 1400 });
    const groups = groupByWeek(
      [
        makeDayRow({ date: '2026-08-30', is_today: true, balance: 100 }),
        makeDayRow({ date: '2026-08-20', verdict: 'served', balance: 300 }),
        makeDayRow({ date: '2026-08-19', verdict: 'missed', balance: -100 }),
      ],
      week,
    );
    // The current week takes the server's tally, not the one page it happens to hold.
    expect(groups[0].tally).toContain('4 of 7 served');
    expect(groups[0].tally).toContain('−1,400');
    // The older week is counted from its own rows.
    expect(groups[1].tally).toContain('1 of 2 served');
    expect(groups[1].tally).toContain('−200');
  });
});

describe('tallyFor', () => {
  it('reports the weight change across the week', () => {
    const tally = tallyFor([
      makeDayRow({ date: '2026-08-24', weight_lb: 182.3 }),
      makeDayRow({ date: '2026-08-30', weight_lb: 181.4 }),
    ]);
    expect(tally).toContain('−0.9 lb');
  });

  it('drops a part rather than showing a zero for a fact it does not have', () => {
    const tally = tallyFor([
      makeDayRow({ date: '2026-08-24', verdict: 'unlogged', balance: null, weight_lb: null }),
    ]);
    // Nothing judged, no balance and one weigh-in short of a change: nothing to say.
    expect(tally).toBeNull();
  });
});

describe("the week's weight delta refuses the implausible", () => {
  // Field report 2026-09-02: a 110 lb slip made the week header read "−102.0 lb". A real
  // week does not move that much, so printing the figure states something the app has no
  // business being confident about.

  const day = (date: string, weight_lb: number | null) =>
    makeDayRow({ date, weight_lb, verdict: 'served' as const });

  it('prints an ordinary week', () => {
    const [group] = groupByWeek([day('2026-08-31', 212.4), day('2026-09-02', 211.2)], null);
    expect(group!.tally).toMatch(/−1\.2 lb/);
  });

  it('says NOTHING rather than "−102.0 lb"', () => {
    const [group] = groupByWeek([day('2026-08-31', 212), day('2026-09-02', 110)], null);
    // The clause is simply absent, which is a shape the reader has already seen — the
    // tally omits it whenever there are too few readings to make one.
    expect(group!.tally).not.toMatch(/lb/);
    expect(group!.tally).not.toMatch(/102/);
  });

  it('refuses an implausible GAIN the same way', () => {
    const [group] = groupByWeek([day('2026-08-31', 212), day('2026-09-02', 260)], null);
    expect(group!.tally).not.toMatch(/lb/);
  });

  it('still prints a hard but believable week', () => {
    const [group] = groupByWeek([day('2026-08-31', 212), day('2026-09-02', 204)], null);
    expect(group!.tally).toMatch(/−8\.0 lb/);
  });
});
