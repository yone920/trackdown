import { BODY_REGIONS, bodyLegend, bodyRegions, LEVEL_COLOR, lastTrainedWords, overdueRegions, regionBySlug } from '@/lib/body-map';
import { C } from '@/lib/theme';
import type { CoverageEntry } from '@/lib/types';

// The body map's colour rule, without a renderer (lib/body-map.ts) — the same convention
// every other calculation in this app is tested under.
//
// The level ITSELF is no longer computed here — that arithmetic moved to the server
// (backend/src/services/recommendation/coverage.ts §coverageLevel, ENGINE.md §4b), judged
// against each muscle's own band rather than one flat 10–20 sets/week range. What this file
// still owns is what happens to the level the server sent: which colour it draws, which
// region it lands on, and the words the detail line and legend put around it.

const entry = (over: Partial<CoverageEntry> & { key: string }): CoverageEntry => ({
  label: over.key,
  days_since: 1,
  last_date: '2026-08-30',
  sets_7d: 12,
  sets_14d: 20,
  sets_28d: 40,
  unit: 'sets',
  overdue: false,
  level: 2,
  band_low: 10,
  band_high: 20,
  ...over,
});

describe('the ramp', () => {
  it('draws the level the server sent, not a locally recomputed one', () => {
    expect(bodyRegions([entry({ key: 'chest', level: 0 })])[0]!.color).toBe(C.track);
    expect(bodyRegions([entry({ key: 'chest', level: 3 })])[0]!.color).toBe(C.accent);
    expect(LEVEL_COLOR[0]).toBe(C.track);
    expect(LEVEL_COLOR[3]).toBe(C.accent);
  });

  // An older server sends no level at all. That reads as the faintest served step and never
  // as grey, unless nothing has touched the muscle in four weeks either — the same "I do not
  // know, but it is not zero" instinct the flat-band fallback used to carry.
  it('holds at the first step when the server sent no level but the muscle was served', () => {
    const region = bodyRegions([{ key: 'chest', label: 'Chest', days_since: 3, last_date: '2026-08-28', sets_14d: 4, sets_28d: 4, unit: 'sets', overdue: false }])[0]!;
    expect(region.level).toBe(1);
  });

  it('greys a region the server never mentioned at all', () => {
    const region = bodyRegions([])[0]!;
    expect(region.level).toBe(0);
    expect(region.color).toBe(C.track);
  });

  it('draws a legend for every step plus the outline, without quoting one range for every muscle', () => {
    expect(bodyLegend().map((step) => step.level)).toEqual([0, 1, 2, 3]);
    // No numbers here on purpose — a forearm and a chest do not share a band.
    expect(bodyLegend()[2]!.label).toBe('In range');
  });
});

describe('the fourteen regions', () => {
  it('covers every muscle the registry keeps and puts each one somewhere on the figure', () => {
    expect(BODY_REGIONS.map((region) => region.key)).toEqual([
      'chest',
      'shoulders',
      'biceps',
      'triceps',
      'forearms',
      'abs',
      'lats',
      'upper_back',
      'glutes',
      'quads',
      'hamstrings',
      'calves',
      'lower_back',
      'neck',
    ]);
    // Abs is two slugs on one entry, which is the registry's own definition of it
    // (abs + obliques). Nothing else on the figure may claim those two.
    expect(BODY_REGIONS.find((region) => region.key === 'abs')!.slugs).toEqual(['abs', 'obliques']);
    // Every slug belongs to exactly one region: two regions colouring one path would be
    // two answers about the same pixels.
    const slugs = BODY_REGIONS.flatMap((region) => region.slugs);
    expect(new Set(slugs).size).toBe(slugs.length);
    // The package has no `lats`; the two back regions take the two paths it does have.
    expect(BODY_REGIONS.find((region) => region.key === 'lats')!.slugs).toEqual(['upper-back']);
    expect(BODY_REGIONS.find((region) => region.key === 'upper_back')!.slugs).toEqual(['trapezius']);
    // lower_back and neck are new (ENGINE.md §4b) — both slugs exist in the package.
    expect(BODY_REGIONS.find((region) => region.key === 'lower_back')!.slugs).toEqual(['lower-back']);
    expect(BODY_REGIONS.find((region) => region.key === 'neck')!.slugs).toEqual(['neck']);
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
    expect(regionBySlug(regions, 'obliques')?.key).toBe('abs');
    expect(regionBySlug(regions, 'trapezius')?.label).toBe('Upper back');
    expect(regionBySlug(regions, 'lower-back')?.key).toBe('lower_back');
    expect(regionBySlug(regions, 'neck')?.key).toBe('neck');
    expect(regionBySlug(regions, 'hair')).toBeNull();
  });
});

describe('the detail line', () => {
  it('reads the way the sheet reads it, quoting this muscle\'s own floor', () => {
    const [region] = bodyRegions([
      entry({ key: 'biceps', label: 'Biceps', sets_7d: 3, days_since: 5, last_date: '2026-08-25', band_low: 8, band_high: 14 }),
    ]).filter((each) => each.key === 'biceps');
    expect(region!.detail).toBe('Biceps — 3 sets this week · last trained Tue · target 8+ sets/wk');
  });

  it('omits the target clause when the server sent no band for it', () => {
    const biceps = bodyRegions([
      { key: 'biceps', label: 'Biceps', sets_7d: 3, days_since: 5, last_date: '2026-08-25', sets_14d: 3, sets_28d: 3, unit: 'sets', overdue: false },
    ]).find((each) => each.key === 'biceps')!;
    expect(biceps.detail).not.toContain('target');
  });

  it('counts one set as a set and a stretch in sessions', () => {
    const regions = bodyRegions([entry({ key: 'abs', label: 'Abs', sets_7d: 1, days_since: 0 })]);
    expect(regions.find((region) => region.key === 'abs')!.detail).toContain('1 set this week');
    expect(regions.find((region) => region.key === 'abs')!.detail).toContain('trained today');
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
      entry({ key: 'abs', label: 'Abs', days_since: 21, overdue: true }),
      entry({ key: 'calves', label: 'Calves', days_since: null, sets_28d: 0, sets_7d: 0, overdue: true }),
      entry({ key: 'chest', label: 'Chest', days_since: 1 }),
    ]);
    expect(overdueRegions(regions).map((region) => region.label)).toEqual(['Calves', 'Abs']);
    expect(regions.find((region) => region.key === 'chest')!.overdue).toBe(false);
  });
});
