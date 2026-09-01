import {
  BODY_REGIONS,
  bodyLegend,
  bodyRegions,
  LEVEL_COLOR,
  lastTrainedWords,
  levelOf,
  overdueRegions,
  regionBySlug,
  SET_BAND_HIGH,
  SET_BAND_LOW,
} from '@/lib/body-map';
import { C } from '@/lib/theme';
import type { CoverageEntry } from '@/lib/types';

// The body map's colour rule, without a renderer (lib/body-map.ts) — the same convention
// every other calculation in this app is tested under.

const entry = (over: Partial<CoverageEntry> & { key: string }): CoverageEntry => ({
  label: over.key,
  days_since: 1,
  last_date: '2026-08-30',
  sets_7d: 12,
  sets_14d: 20,
  sets_28d: 40,
  unit: 'sets',
  overdue: false,
  ...over,
});

describe('the ramp', () => {
  it('greys anything four weeks has never touched, and never confuses it with a quiet week', () => {
    expect(levelOf({ days_since: null, sets_28d: 0, sets_7d: 0 })).toBe(0);
    // Trained ten days ago: nothing this week, but it is not a muscle we have never seen.
    expect(levelOf({ days_since: 10, sets_28d: 12, sets_7d: 0 })).toBe(1);
    // The live account's own shape: a treadmill walk serves the calves and records no sets,
    // so this is `days_since: 0` with nothing counted. Grey here would say "not in four
    // weeks" about something done this morning.
    expect(levelOf({ days_since: 0, sets_28d: 0, sets_7d: 0 })).toBe(1);
    expect(LEVEL_COLOR[0]).toBe(C.track);
    expect(LEVEL_COLOR[3]).toBe(C.accent);
  });

  it('climbs three steps against the 10–20 band', () => {
    expect(levelOf({ days_since: 1, sets_28d: 30, sets_7d: SET_BAND_LOW - 1 })).toBe(1);
    expect(levelOf({ days_since: 1, sets_28d: 30, sets_7d: SET_BAND_LOW })).toBe(2);
    expect(levelOf({ days_since: 1, sets_28d: 30, sets_7d: SET_BAND_HIGH })).toBe(2);
    expect(levelOf({ days_since: 1, sets_28d: 30, sets_7d: SET_BAND_HIGH + 1 })).toBe(3);
  });

  // An older server sends no weekly count at all. That is "I do not know", which reads as
  // the faintest step and never as zero sets.
  it('holds at the first step when the server sent no weekly count', () => {
    expect(levelOf({ days_since: 3, sets_28d: 18 })).toBe(1);
  });

  it('draws a legend for every step plus the outline, so no colour is unexplained', () => {
    expect(bodyLegend().map((step) => step.level)).toEqual([0, 1, 2, 3]);
    expect(bodyLegend()[2]!.label).toBe('10–20');
  });
});

describe('the twelve regions', () => {
  it('covers every muscle the ledger keeps and puts each one somewhere on the figure', () => {
    expect(BODY_REGIONS.map((region) => region.key)).toEqual([
      'chest',
      'shoulders',
      'biceps',
      'triceps',
      'forearms',
      'core',
      'lats',
      'upper_back',
      'glutes',
      'quads',
      'hamstrings',
      'calves',
    ]);
    // Core is two slugs on one ledger entry, which is the ledger's own definition of it
    // (abs + obliques). Nothing else on the figure may claim those two.
    expect(BODY_REGIONS.find((region) => region.key === 'core')!.slugs).toEqual(['abs', 'obliques']);
    // Every slug belongs to exactly one region: two regions colouring one path would be
    // two answers about the same pixels.
    const slugs = BODY_REGIONS.flatMap((region) => region.slugs);
    expect(new Set(slugs).size).toBe(slugs.length);
    // The package has no `lats`; the two back regions take the two paths it does have.
    expect(BODY_REGIONS.find((region) => region.key === 'lats')!.slugs).toEqual(['upper-back']);
    expect(BODY_REGIONS.find((region) => region.key === 'upper_back')!.slugs).toEqual(['trapezius']);
  });

  it('draws a region the server said nothing about as grey with nothing to claim', () => {
    const regions = bodyRegions([entry({ key: 'chest' })]);
    const calves = regions.find((region) => region.key === 'calves')!;
    expect(calves).toMatchObject({ level: 0, color: C.track, sets_7d: 0, days_since: null });
    expect(calves.overdue).toBe(false);
    expect(calves.detail).toContain('nothing in four weeks');
  });

  it('finds the region a tap landed on, by any of its slugs', () => {
    const regions = bodyRegions([]);
    expect(regionBySlug(regions, 'obliques')?.key).toBe('core');
    expect(regionBySlug(regions, 'trapezius')?.label).toBe('Upper back');
    expect(regionBySlug(regions, 'hair')).toBeNull();
  });
});

describe('the detail line', () => {
  it('reads the way the sheet reads it', () => {
    const [region] = bodyRegions([
      entry({ key: 'biceps', label: 'biceps', sets_7d: 3, days_since: 5, last_date: '2026-08-25' }),
    ]).filter((each) => each.key === 'biceps');
    expect(region!.detail).toBe('Biceps — 3 sets this week · last trained Tue · target 10+/wk');
  });

  it('counts one set as a set and a stretch in sessions', () => {
    const regions = bodyRegions([entry({ key: 'core', label: 'core', sets_7d: 1, days_since: 0 })]);
    expect(regions.find((region) => region.key === 'core')!.detail).toContain('1 set this week');
    expect(regions.find((region) => region.key === 'core')!.detail).toContain('trained today');
  });

  it('says how long ago in the fewest words that are still true', () => {
    expect(lastTrainedWords(0, '2026-08-31')).toBe('trained today');
    expect(lastTrainedWords(1, '2026-08-30')).toBe('trained yesterday');
    expect(lastTrainedWords(4, '2026-08-27')).toBe('last trained Thu');
    // Past a week a weekday is ambiguous, so it counts instead.
    expect(lastTrainedWords(9, '2026-08-22')).toBe('last trained 9 days ago');
    expect(lastTrainedWords(null, null)).toBe('not trained in four weeks');
  });
});

describe('what the rotation owes', () => {
  it('outlines the overdue ones, largest debt first, with never always at the front', () => {
    const regions = bodyRegions([
      entry({ key: 'core', label: 'core', days_since: 21, overdue: true }),
      entry({ key: 'calves', label: 'calves', days_since: null, sets_28d: 0, sets_7d: 0, overdue: true }),
      entry({ key: 'chest', label: 'chest', days_since: 1 }),
    ]);
    expect(overdueRegions(regions).map((region) => region.label)).toEqual(['Calves', 'Core']);
    expect(regions.find((region) => region.key === 'chest')!.overdue).toBe(false);
  });
});
