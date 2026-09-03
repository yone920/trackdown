import { bodyRegions, lastTrainedWords, overdueRegions, SET_BAND_HIGH, SET_BAND_LOW, type BodyRegion } from '@/lib/body-map';
import { dateLabel } from '@/lib/format';
import { whenLabel } from '@/lib/progress-sections';
import type {
  BoardLift,
  CoverageEntry,
  DayRow,
  GoalWithProgress,
  IsoDate,
  TrainingBoard,
  WeekView,
} from '@/lib/types';

// The scoreboard — what each row of the Progress page SAYS (user decision 2026-09-02, from
// a reviewed mockup).
//
// The page is one screenful of live facts and nothing else: seven summary rows, each
// carrying the most important computed thing about its section, each a door to the screen
// that holds the detail. If the user never taps anything, the page alone has told them how
// they are doing.
//
// Everything on those rows is arithmetic, so it lives here rather than in the screen —
// the same rule lib/progress-sections.ts and lib/body-map.ts already follow. The renderers
// under components/progress/ take these views and draw them; nothing in them decides what
// a number means.
//
// Nothing computed here invents a verdict. A row with no data says the shortest true thing
// (concept-v2 §Principles 8), and green appears only where a goal has asked to be judged.

/** Where a fact sits on the palette. The screens map these onto `C`. */
export type Tone = 'ink' | 'mute' | 'good' | 'accent' | 'dim';

const round1 = (value: number) => (Math.round(value * 10) / 10).toFixed(1);

/** "−2.0 lb", "+5 lb" — a change, with the sign a person reads rather than a hyphen. */
function signed(value: number, unit: string | null): string {
  const magnitude = unit === 'lb' || unit === 'mi' ? round1(Math.abs(value)) : String(Math.round(Math.abs(value)));
  return `${value > 0 ? '+' : '−'}${magnitude}${unit ? ` ${unit}` : ''}`;
}

// ---------------------------------------------------------------------------
// 2 · Goal
// ---------------------------------------------------------------------------

export type GoalRowView = {
  id: string;
  title: string;
  /** 0–1, for the ring. Null when the goal has no finish line to be a fraction of. */
  percent: number | null;
  /** The measure as it stands, big and condensed: "210.4". */
  value: string;
  unit: string | null;
  /** "−2.0 lb since Aug 31" — the last move, dated, so the number can be checked. */
  delta: { text: string; tone: Tone } | null;
  /** False for maintain/custom goals: no green, no orange (concept-v2 §Goals). */
  judge: boolean;
};

/**
 * The goal, in a row. `weighIns` is the evidence behind a smoothed measure — the goal's own
 * series is a 7-day average, so it cannot say what the scale read and when, and "since Aug
 * 31" is a claim about a reading rather than about a statistic.
 */
export function goalRow(
  goal: GoalWithProgress,
  { today, weighIns = [] }: { today: IsoDate; weighIns?: readonly { date: IsoDate; value: number }[] },
): GoalRowView {
  const judge = goal.kind !== 'maintain' && goal.kind !== 'custom';
  const metric = goal.progress.metrics[0] ?? null;
  const spec = goal.metrics[0];
  const unit = metric?.unit ?? spec?.unit ?? null;
  const current = metric?.current ?? null;
  const target = metric?.target ?? spec?.target ?? null;

  // The dated readings this measure is made of. For body weight that is the weigh-ins;
  // for anything else the metric's own series is already the readings.
  const readings =
    metric?.measure === 'body_weight' && weighIns.length > 0
      ? [...weighIns].sort((a, b) => a.date.localeCompare(b.date))
      : (metric?.series ?? []);

  return {
    id: goal.id,
    title: goal.title,
    percent: metric?.percent ?? goal.progress.percent ?? null,
    value: current == null ? '—' : unit === 'lb' || unit === 'mi' ? round1(current) : String(Math.round(current)),
    unit,
    delta: goalDelta(readings, { current, target, judge, unit, today }),
    judge,
  };
}

/**
 * "−2.0 lb since Aug 31": the move between the last two readings, and the day the earlier
 * one was taken. Green only when it is movement TOWARD a stated target — a goal with no
 * finish line has no direction to be pleased about.
 */
export function goalDelta(
  readings: readonly { date: IsoDate; value: number }[],
  {
    current,
    target,
    judge,
    unit,
    today,
  }: { current: number | null; target: number | null; judge: boolean; unit: string | null; today: IsoDate },
): { text: string; tone: Tone } | null {
  const last = readings[readings.length - 1];
  const previous = readings[readings.length - 2];
  if (!last || !previous) return null;
  const moved = last.value - previous.value;
  if (Math.abs(moved) < 0.05) return null;

  const needed = target == null || current == null ? null : target - current;
  const tone: Tone =
    !judge || needed == null || needed === 0
      ? 'mute'
      : Math.sign(moved) === Math.sign(needed)
        ? 'good'
        : 'accent';

  const when = previous.date === today ? 'today' : dateLabel(previous.date);
  return { text: `${signed(moved, unit)} since ${when}`, tone };
}

// ---------------------------------------------------------------------------
// 3 · Body
// ---------------------------------------------------------------------------

export type BodyRowView = {
  /** The weigh-ins, oldest first, for the sparkline drawn on the row itself. */
  values: number[];
  /** "210.0 today" — the reading and when it was taken. */
  headline: string;
  /** "trend −1.0 lb / wk", or null when there is no trend to state. */
  trend: string | null;
};

export function bodyRow(body: TrainingBoard['body'] | null | undefined, today: IsoDate): BodyRowView | null {
  if (!body) return null;
  const values = body.series.map((point) => point.value);
  if (body.latest == null && values.length === 0) return null;
  const latest = body.latest ?? values[values.length - 1] ?? null;
  if (latest == null) return null;

  const when = body.latest_date ? whenLabel(body.latest_date, today) : null;
  return {
    values,
    headline: `${round1(latest)} lb${when ? ` ${when}` : ''}`,
    trend: body.trend_per_week == null ? null : `trend ${signed(body.trend_per_week, 'lb')} / wk`,
  };
}

// ---------------------------------------------------------------------------
// 4 · Strength
// ---------------------------------------------------------------------------

/**
 * Why a lift is news. The three states the progression engine can put a movement in that a
 * person would want to hear about, and nothing else: a hold is the absence of news, which
 * is why the row is two movers rather than six rows of "holding".
 */
export type MoverKind = 'step' | 'baseline' | 'back';

export type Mover = {
  exercise: string;
  exercise_id: string | null;
  media_count?: number;
  kind: MoverKind;
  /** "60 → 65 lb next" — the coach's own prescription, in the fewest words that are true. */
  text: string;
  days_since: number;
};

export type StrengthRowView = {
  count: number;
  /** "2 ready to step up · Deadlift baseline set" */
  news: string;
  movers: Mover[];
};

const MOVER_KIND: Record<string, MoverKind | undefined> = {
  step_up: 'step',
  new: 'baseline',
  reference: 'baseline',
  step_down: 'back',
  ease_back: 'back',
  restart: 'back',
};

const KIND_ORDER: MoverKind[] = ['step', 'baseline', 'back'];

/** The next step in a row's worth of words. An arrow when there are two loads to put on it. */
function moverText(lift: BoardLift, kind: MoverKind): string {
  if (
    kind === 'step' &&
    lift.load_direction === 'resistance' &&
    lift.load_lb != null &&
    lift.next.load_lb != null &&
    lift.next.load_lb !== lift.load_lb
  ) {
    return `${round0(lift.load_lb)} → ${round0(lift.next.load_lb)} lb next`;
  }
  // Assistance loads and everything else keep the prescription's own sentence: on an
  // assisted machine "55 → 50 lb" reads like a step down unless the words come with it.
  return lift.next.text;
}

const round0 = (value: number) => String(Math.round(value * 10) / 10);

/**
 * The lifts with news on them, most recent first — the two the row draws and the line above
 * them. Deterministic: kind, then how recently it was trained, then the name, so the same
 * board always picks the same two.
 */
export function movers(lifts: readonly BoardLift[], limit = 2): Mover[] {
  return lifts
    .flatMap((lift) => {
      const kind = MOVER_KIND[lift.next.rule];
      return kind
        ? [
            {
              exercise: lift.exercise,
              exercise_id: lift.exercise_id,
              media_count: lift.media_count,
              kind,
              text: moverText(lift, kind),
              days_since: lift.days_since,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.days_since - b.days_since ||
        a.exercise.localeCompare(b.exercise),
    )
    .slice(0, limit);
}

/**
 * What is new on the board, in one line. Counts where a count is the news ("2 ready to step
 * up") and names where the name is ("Deadlift baseline set"); at most two clauses, because a
 * third is a paragraph and this is a row.
 */
export function strengthRow(lifts: readonly BoardLift[], limit = 2): StrengthRowView {
  const all = movers(lifts, lifts.length);
  const ready = all.filter((mover) => mover.kind === 'step');
  const baselines = all.filter((mover) => mover.kind === 'baseline');
  const back = all.filter((mover) => mover.kind === 'back');

  const clauses: string[] = [];
  if (ready.length > 0) clauses.push(`${ready.length} ready to step up`);
  if (baselines[0]) clauses.push(`${baselines[0].exercise} baseline set`);
  if (back[0]) clauses.push(`${back[0].exercise} eased back`);

  const trainedThisWeek = lifts.filter((lift) => lift.days_since <= 6).length;
  const news =
    clauses.length > 0
      ? clauses.slice(0, 2).join(' · ')
      : lifts.length === 0
        ? 'Nothing lifted in four weeks'
        : trainedThisWeek > 0
          ? `${trainedThisWeek} trained this week · all holding`
          : 'All holding — nothing lifted this week';

  return { count: lifts.length, news, movers: all.slice(0, limit) };
}

// ---------------------------------------------------------------------------
// 5 · Coverage
// ---------------------------------------------------------------------------

export type CoverageChip = { key: string; label: string; tone: Tone; sets_7d: number };

export type CoverageRowView = {
  served: number;
  total: number;
  /** The muscles the rotation owes a turn, longest debt first, in a person's words. */
  quiet: string[];
  /** "11 of 12 served · quiet: calves" */
  line: string;
  chips: CoverageChip[];
};

/** How many quiet muscles get named before the line stops being a line. */
const QUIET_NAMED = 2;

/**
 * The twelve, as chips. Colour is the same three-way question the figure asks — is this
 * muscle in the band, under it, or has the rotation forgotten it — said in a dot small
 * enough to fit twelve of on one row of a phone.
 */
export function coverageRow(coverage: readonly CoverageEntry[] | undefined): CoverageRowView {
  const regions = bodyRegions(coverage);
  const chips = regions.map((region) => ({
    key: region.key,
    label: region.label,
    tone: chipTone(region),
    sets_7d: region.sets_7d,
  }));

  const served = regions.filter((region) => region.days_since != null).length;
  const quiet = overdueRegions(regions).map((region) => region.label.toLowerCase());
  const named = quiet.slice(0, QUIET_NAMED);
  const line = [
    `${served} of ${regions.length} served`,
    named.length > 0
      ? `quiet: ${named.join(', ')}${quiet.length > named.length ? ` +${quiet.length - named.length}` : ''}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return { served, total: regions.length, quiet, line, chips };
}

/** Dim is "never, or owed a turn"; accent is "served but under the band"; good is in it. */
function chipTone(region: BodyRegion): Tone {
  if (region.days_since == null || region.overdue) return 'dim';
  if (region.level >= 2) return 'good';
  return 'accent';
}

// ---------------------------------------------------------------------------
// The muscle popup — one region, everything the ledger knows about it
// ---------------------------------------------------------------------------

export type MuscleFacts = {
  key: string;
  label: string;
  /** "9 sets this week", or what stands in for it when the credit came from cardio. */
  headline: string;
  /** "in the band", "under", "not trained in four weeks". */
  band: string;
  facts: { label: string; value: string }[];
};

/**
 * What the sheet says about one muscle. The band and the last-trained words are the ledger's
 * own (lib/body-map.ts, so the sheet and the figure cannot disagree); "Fed by" is the board's
 * lifts filtered to the ones that name this muscle, which is the question the picture always
 * raised and never answered — *what* is feeding it.
 */
export function muscleFacts(region: BodyRegion, lifts: readonly BoardLift[] = []): MuscleFacts {
  const cardioCredit = region.days_since != null && region.sets_28d === 0;
  const headline =
    region.days_since == null
      ? 'Nothing in four weeks'
      : cardioCredit
        ? 'Credited from cardio'
        : `${region.sets_7d} set${region.sets_7d === 1 ? '' : 's'} this week`;

  const band =
    region.days_since == null
      ? 'not trained in four weeks'
      : region.level >= 3
        ? 'over the band'
        : region.level === 2
          ? 'in the band'
          : 'under the band';

  const fed = fedBy(region, lifts);
  const lastExercises = fed
    .filter((lift) => lift.last_date === region.last_date)
    .map((lift) => lift.exercise);

  return {
    key: region.key,
    label: region.label,
    headline,
    band,
    facts: [
      { label: 'Target', value: `${SET_BAND_LOW}–${SET_BAND_HIGH} sets/wk` },
      {
        label: 'Last trained',
        value: [
          lastTrainedWords(region.days_since, region.last_date),
          lastExercises.length > 0 ? lastExercises.join(', ') : null,
        ]
          .filter(Boolean)
          .join(' · '),
      },
      {
        label: 'Fed by',
        value:
          fed.length === 0
            ? 'nothing on the board'
            : fed
                .map((lift) => `${lift.exercise}${lift.sets == null ? '' : ` · ${lift.sets} sets`}`)
                .join(' · '),
      },
    ],
  };
}

/** How many exercises the "Fed by" line names before it becomes a list. */
const FED_BY_LIMIT = 4;

/**
 * The lifts on the board that name this muscle. The catalogue's own vocabulary is close to
 * the ledger's but not identical — `upper_back` against "upper back" — so both are matched
 * on the same normalised form, and a lift the catalogue could not label feeds nothing.
 */
export function fedBy(region: { key: string; label: string }, lifts: readonly BoardLift[]): BoardLift[] {
  const wanted = new Set([normalise(region.key), normalise(region.label)]);
  return [...lifts]
    .filter((lift) => (lift.muscle_groups ?? []).some((muscle) => wanted.has(normalise(muscle))))
    .sort((a, b) => a.days_since - b.days_since || a.exercise.localeCompare(b.exercise))
    .slice(0, FED_BY_LIMIT);
}

const normalise = (text: string) => text.trim().toLowerCase().replace(/[\s-]+/g, '_');

// ---------------------------------------------------------------------------
// 6 · Cardio
// ---------------------------------------------------------------------------

export type CardioRowView = {
  /** "58 of 150 min" */
  line: string;
  /** "22 min next" — the prescription, which is the only green thing on the row. */
  next: string | null;
  /** 0–1, for the 5 px bar. */
  fraction: number;
};

export function cardioRow(cardio: TrainingBoard['cardio'] | null | undefined): CardioRowView | null {
  if (!cardio) return null;
  const equivalent = cardio.equiv_minutes_this_week ?? cardio.minutes_this_week;
  const nothing = equivalent === 0 && (cardio.activities ?? []).length === 0;
  // A section of zeroes on the screen of somebody who lifts and does not run is the app
  // inventing a shortfall; a user whose goal named the minutes has asked the question.
  if (nothing && !cardio.target_stated) return null;

  // The next prescription: the activity trained most recently, which is the one the user is
  // about to do again. Ties go to the name, so the row never shuffles between renders.
  const next = [...(cardio.activities ?? [])]
    .sort((a, b) => a.days_since - b.days_since || a.exercise.localeCompare(b.exercise))[0]
    ?.next.text;

  return {
    line: `${equivalent} of ${cardio.weekly_target_min} min`,
    next: next ?? (cardio.short_by_min > 0 ? `${cardio.short_by_min} min to go` : null),
    fraction: cardio.weekly_target_min > 0 ? equivalent / cardio.weekly_target_min : 0,
  };
}

// ---------------------------------------------------------------------------
// 7 · Days
// ---------------------------------------------------------------------------

/** How many days the row keeps. Three is what fits under everything above it. */
/**
 * How many days the strip on the Progress tile draws. Three was the count when the tile was
 * three sentences; a fortnight is the shortest window in which a rhythm — and a gap in one —
 * is visible as a shape (user decision 2026-09-03).
 */
export const DAYS_ON_ROW = 14;

export type DayLineView = {
  date: IsoDate;
  /** "Today · Pull day + walk" */
  line: string;
  /** "175 earned", or the verdict when the day earned nothing. */
  right: string;
  /** The calories earned, as a number, for the strip's bar heights. Null when none were. */
  earned: number | null;
  verdict: DayRow['verdict'];
  /** An open day is a ring rather than a filled dot: the day is not over. */
  open: boolean;
};

export function daysRow(rows: readonly DayRow[], limit = DAYS_ON_ROW): DayLineView[] {
  return [...rows]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .map((row) => ({
      date: row.date,
      line: [row.is_today ? 'Today' : row.verdict_words, row.summary].filter(Boolean).join(' · '),
      right: row.earned != null && row.earned > 0 ? `${Math.round(row.earned)} earned` : verdictWord(row),
      earned: row.earned ?? null,
      verdict: row.verdict,
      open: row.is_today,
    }));
}

function verdictWord(row: DayRow): string {
  if (row.verdict === 'served') return 'served';
  if (row.verdict === 'missed') return 'missed';
  return row.closed ? 'closed' : 'open';
}

/** "3 of 3 served" — the week, for the eyebrow. Null when nothing has been judged. */
export function daysHeadline(week: WeekView | null | undefined): string | null {
  if (!week || week.judged === 0) return null;
  return `${week.served} of ${week.judged} served`;
}
