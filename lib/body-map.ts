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
  | 'lower-back'
  | 'neck'
  | 'obliques'
  | 'quadriceps'
  | 'trapezius'
  | 'triceps'
  | 'upper-back';

/**
 * The fourteen registry muscles (`backend/src/services/recommendation/registry.ts`), and
 * where each one is on the figure.
 *
 * Two of these are a judgement rather than a lookup, and they are worth the note. The
 * package has no `lats` slug at all — its back is `trapezius`, `upper-back` and
 * `lower-back`. So **`lats` takes `upper-back`** (the wing under the shoulder blades, which
 * is what that path covers) and **the registry's `upper_back` takes `trapezius`** (the traps
 * are the part of an upper back anybody can point at). The registry's own tokens already say
 * these are two different things — `lats` is `lats`, `upper_back` is `back` + `traps` — and
 * this is the closest the drawing gets to saying it too.
 *
 * `lower_back` and `neck` are new here (ENGINE.md §4b): the package draws both
 * (`lower-back` on the back figure, `neck` on both), so nothing about the drawing itself
 * blocked adding them the way the old twelve-muscle ledger never had a place for them.
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
  { key: 'abs', label: 'Abs', slugs: ['abs', 'obliques'] },
  { key: 'lats', label: 'Lats', slugs: ['upper-back'] },
  { key: 'upper_back', label: 'Upper back', slugs: ['trapezius'] },
  { key: 'glutes', label: 'Glutes', slugs: ['gluteal'] },
  { key: 'quads', label: 'Quads', slugs: ['quadriceps'] },
  { key: 'hamstrings', label: 'Hamstrings', slugs: ['hamstring'] },
  { key: 'calves', label: 'Calves', slugs: ['calves'] },
  { key: 'lower_back', label: 'Lower back', slugs: ['lower-back'] },
  { key: 'neck', label: 'Neck', slugs: ['neck'] },
];

/**
 * Four states, and the first one is not a judgement: `0` is "nothing in four weeks", which
 * is what an untouched region looks like on the ledger. The three above it are volume this
 * week against the muscle's OWN band — under it, in it, past it
 * (`backend/src/services/recommendation/coverage.ts`'s `coverageLevel`, computed
 * server-side and sent as `CoverageEntry.level`; there is no flat band left to compute here).
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

/**
 * No numbers here on purpose: each muscle judges its week against its own band now
 * (forearms' floor is not chest's), so a legend that quoted one range would be right about
 * at most one of fourteen regions. The per-region number, when there is one, is in its own
 * detail line (`regionDetail`) instead.
 */
export const LEVEL_LABEL: Record<CoverageLevel, string> = {
  0: 'Not in four weeks',
  1: 'Under this week',
  2: 'In range',
  3: 'Over this week',
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
  /** This muscle's own weekly floor and ceiling (sets/wk); null when the server sent none. */
  band_low: number | null;
  band_high: number | null;
  /** "Biceps — 3 sets this week · last trained Tue · target 8+ sets/wk". */
  detail: string;
};

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
    // This muscle's own floor, not a flat one — a server that sent no band (an old release,
    // or a region it has no reading for at all) simply leaves the line without one.
    region.band_low != null ? `target ${region.band_low}+ sets/wk` : null,
  ]
    .filter((line): line is string => line != null)
    .join(' · ');
}

/**
 * The ledger as fourteen regions, in the order they are defined (the map is a picture, so a
 * stable order beats the ledger's debt-first sort — the *list* under it is what is sorted).
 *
 * A ledger entry the server did not send is still drawn, grey and with nothing to say: a
 * missing muscle on a body map is a hole, and "I have no reading for this" is a state.
 *
 * `level` is read straight off the entry (`backend/src/services/recommendation/coverage.ts`'s
 * `coverageLevel`, computed server-side against this muscle's own band) rather than
 * recomputed here — the flat 10–20 band this file used to hold every muscle to is gone.
 * Served-but-unlabelled (an entry with no `level`, from a server before this shipped) reads
 * as the faintest step rather than grey, matching the same "not zero, just unknown" instinct
 * the old flat-band fallback already had.
 */
export function bodyRegions(coverage: readonly CoverageEntry[] | undefined): BodyRegion[] {
  const byKey = new Map((coverage ?? []).map((entry) => [entry.key, entry]));
  return BODY_REGIONS.map((region) => {
    const entry = byKey.get(region.key) ?? null;
    const level: CoverageLevel = entry?.level ?? (entry?.days_since == null ? 0 : 1);
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
      band_low: entry?.band_low ?? null,
      band_high: entry?.band_high ?? null,
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
