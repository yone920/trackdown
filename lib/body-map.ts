import { C } from '@/lib/theme';
import type { CoverageEntry } from '@/lib/types';

// The body map — the coverage ledger drawn on a figure instead of listed as bars.
//
// The old Progress tab drew "sets per muscle group" as eleven horizontal bars and, under
// them, a text line reading "Overdue a turn · Calves · never · Core · 21 days". Both are
// the same fact — how the rotation is spread across the body — said in a vocabulary that
// only makes sense to somebody already holding the answer. A figure says it in the shape
// the answer is actually about (user decision 2026-08-31).
//
// Everything here is pure: the ledger in, a list of regions out. The component
// (components/body-map.tsx) draws them and nothing else; this file is where the colour
// rule lives so it can be tested without a renderer, like every other calculation in this
// app (lib/progress-sections.ts).
//
// **The ledger is the only input.** Not `frequency.muscles`, which is the catalogue's own
// vocabulary and a different set of buckets: the ledger is what the coach's rotation is
// held to, and a map that disagreed with the brief about what is overdue would be two
// answers to one question.

/**
 * The slugs `react-native-body-highlighter` draws. Repeated here rather than imported so
 * that a region list can be written and tested without pulling an SVG package into a unit
 * test; `components/body-map.tsx` is where the two meet and TypeScript checks the join.
 */
export type BodySlug =
  | 'abs'
  | 'biceps'
  | 'calves'
  | 'chest'
  | 'deltoids'
  | 'forearm'
  | 'gluteal'
  | 'hamstring'
  | 'obliques'
  | 'quadriceps'
  | 'trapezius'
  | 'triceps'
  | 'upper-back';

/**
 * The twelve ledger muscles, and where each one is on the figure.
 *
 * Two of these are a judgement rather than a lookup, and they are worth the note. The
 * package has no `lats` slug at all — its back is `trapezius`, `upper-back` and
 * `lower-back`. So **`lats` takes `upper-back`** (the wing under the shoulder blades, which
 * is what that path covers) and **the ledger's `upper_back` takes `trapezius`** (the traps
 * are the part of an upper back anybody can point at). The ledger's own tokens already say
 * these are two different things — `lats` is `lats`, `upper_back` is `back` + `traps` — and
 * this is the closest the drawing gets to saying it too.
 *
 * `stretching` is on the ledger and deliberately not here: it is a category, not a place on
 * a body, and the coach reads it. Nothing is lost by leaving it off a map of muscles.
 */
export const BODY_REGIONS: readonly { key: string; label: string; slugs: readonly BodySlug[] }[] = [
  { key: 'chest', label: 'Chest', slugs: ['chest'] },
  { key: 'shoulders', label: 'Shoulders', slugs: ['deltoids'] },
  { key: 'biceps', label: 'Biceps', slugs: ['biceps'] },
  { key: 'triceps', label: 'Triceps', slugs: ['triceps'] },
  { key: 'forearms', label: 'Forearms', slugs: ['forearm'] },
  { key: 'core', label: 'Core', slugs: ['abs', 'obliques'] },
  { key: 'lats', label: 'Lats', slugs: ['upper-back'] },
  { key: 'upper_back', label: 'Upper back', slugs: ['trapezius'] },
  { key: 'glutes', label: 'Glutes', slugs: ['gluteal'] },
  { key: 'quads', label: 'Quads', slugs: ['quadriceps'] },
  { key: 'hamstrings', label: 'Hamstrings', slugs: ['hamstring'] },
  { key: 'calves', label: 'Calves', slugs: ['calves'] },
];

/**
 * The weekly band a working muscle is aimed at — the number the ramp is measured against.
 * Ten to twenty hard sets a week is the range every serious programme lands in, and it is
 * a *band* rather than a target because the top of it is not better than the middle.
 */
export const SET_BAND_LOW = 10;
export const SET_BAND_HIGH = 20;

/**
 * Four states, and the first one is not a judgement: `0` is "nothing in four weeks", which
 * is what an untouched region looks like on the ledger. The three above it are volume this
 * week against the band — under it, in it, past it.
 */
export type CoverageLevel = 0 | 1 | 2 | 3;

/**
 * The ramp: the card's own background mixed toward the accent, 28 % and 60 % and all the
 * way. Written as values rather than computed so the three steps are legible side by side
 * and a designer can move one without reading a colour-mixing function.
 */
export const LEVEL_COLOR: Record<CoverageLevel, string> = {
  0: C.track,
  1: '#5C3822',
  2: '#A4561E',
  3: C.accent,
};

export const LEVEL_LABEL: Record<CoverageLevel, string> = {
  0: 'Not in four weeks',
  1: `Under ${SET_BAND_LOW}`,
  2: `${SET_BAND_LOW}–${SET_BAND_HIGH}`,
  3: `Over ${SET_BAND_HIGH}`,
};

export type BodyRegion = {
  key: string;
  label: string;
  slugs: readonly BodySlug[];
  level: CoverageLevel;
  color: string;
  /** The rotation owes this one: never served, or unserved a fortnight. Drawn as a stroke. */
  overdue: boolean;
  sets_7d: number;
  sets_28d: number;
  days_since: number | null;
  last_date: string | null;
  unit: 'sets' | 'sessions';
  /** "Biceps — 3 sets this week · last trained Tue · target 10+/wk". */
  detail: string;
};

/**
 * Which level a ledger entry's week lands on.
 *
 * Level 0 is `days_since == null` and **nothing else** — the ledger has not seen this muscle
 * in four weeks. Deliberately not "and no sets either": a treadmill walk serves the calves
 * and the glutes and records no sets at all, so a muscle can be `days_since: 0` with
 * `sets_28d: 0`, and grey there would say "not in four weeks" about something trained this
 * morning. Checked against the live account, which is exactly that shape.
 */
export function levelOf(entry: {
  sets_7d?: number;
  sets_28d: number;
  days_since: number | null;
}): CoverageLevel {
  if (entry.days_since == null) return 0;
  const week = entry.sets_7d ?? 0;
  if (week >= SET_BAND_LOW && week <= SET_BAND_HIGH) return 2;
  if (week > SET_BAND_HIGH) return 3;
  // Served inside the window but not this week — or served lightly. Either way it is the
  // faintest step and not the grey, because grey means "I have never seen this".
  return 1;
}

/** "today", "Tue", "never" — how long ago, in the fewest words that are still true. */
export function lastTrainedWords(daysSince: number | null, lastDate: string | null | undefined): string {
  if (daysSince == null) return 'not trained in four weeks';
  if (daysSince === 0) return 'trained today';
  if (daysSince === 1) return 'trained yesterday';
  if (lastDate && daysSince <= 6) {
    const [y, m, d] = lastDate.split('-').map(Number);
    if (y && m && d) {
      return `last trained ${new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' })}`;
    }
  }
  return `last trained ${daysSince} days ago`;
}

/** The sheet's one line. The band is quoted as a floor, because the top of it is not a wall. */
export function regionDetail(region: Omit<BodyRegion, 'detail'>): string {
  const noun = region.unit === 'sessions' ? 'session' : 'set';
  // A muscle can be served with zero sets — a walk works the glutes and calves but records
  // no strength volume. Colour and numbers must tell one story, so that case says where the
  // credit came from instead of the contradictory "0 sets this week" beside an orange region.
  const cardioCredit = region.days_since != null && region.sets_28d === 0;
  const volume =
    region.days_since == null
      ? 'nothing in four weeks'
      : cardioCredit
        ? 'no strength sets — credited from cardio'
        : `${region.sets_7d} ${noun}${region.sets_7d === 1 ? '' : 's'} this week`;
  return [
    `${region.label} — ${volume}`,
    lastTrainedWords(region.days_since, region.last_date),
    `target ${SET_BAND_LOW}+ sets/wk`,
  ].join(' · ');
}

/**
 * The ledger as twelve regions, in the order they are defined (the map is a picture, so a
 * stable order beats the ledger's debt-first sort — the *list* under it is what is sorted).
 *
 * A ledger entry the server did not send is still drawn, grey and with nothing to say: a
 * missing muscle on a body map is a hole, and "I have no reading for this" is a state.
 */
export function bodyRegions(coverage: readonly CoverageEntry[] | undefined): BodyRegion[] {
  const byKey = new Map((coverage ?? []).map((entry) => [entry.key, entry]));
  return BODY_REGIONS.map((region) => {
    const entry = byKey.get(region.key) ?? null;
    const level = entry ? levelOf(entry) : 0;
    const base = {
      key: region.key,
      label: region.label,
      slugs: region.slugs,
      level,
      color: LEVEL_COLOR[level],
      overdue: entry?.overdue ?? false,
      sets_7d: entry?.sets_7d ?? 0,
      sets_28d: entry?.sets_28d ?? 0,
      days_since: entry?.days_since ?? null,
      last_date: entry?.last_date ?? null,
      unit: entry?.unit ?? ('sets' as const),
    };
    return { ...base, detail: regionDetail(base) };
  });
}

/** Slug → region, so a tap on the drawing knows which ledger entry it landed on. */
export function regionBySlug(regions: readonly BodyRegion[], slug: string): BodyRegion | null {
  return regions.find((region) => region.slugs.some((each) => each === slug)) ?? null;
}

/** The legend, left to right, in the order the ramp climbs. */
export function bodyLegend(): { level: CoverageLevel; color: string; label: string }[] {
  return ([0, 1, 2, 3] as CoverageLevel[]).map((level) => ({
    level,
    color: LEVEL_COLOR[level],
    label: LEVEL_LABEL[level],
  }));
}

/**
 * The regions the rotation owes a turn, largest debt first — the outlined ones. "Never in
 * four weeks" scores one day past the window, the same way the ledger scores it, so it is
 * always the largest debt there can be (backend features.ts §coverageLedger).
 */
const NEVER_DEBT_DAYS = 29;

export function overdueRegions(regions: readonly BodyRegion[]): BodyRegion[] {
  const debt = (region: BodyRegion): number => region.days_since ?? NEVER_DEBT_DAYS;
  return regions
    .filter((region) => region.overdue)
    .sort((a, b) => debt(b) - debt(a) || a.label.localeCompare(b.label));
}
