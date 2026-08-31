import type { LoadDirection } from '@/lib/types';

// The sub-line under a logged exercise, and the one rule it exists to enforce: **it never
// repeats what the row already shows** (user decision 2026-08-31).
//
// Today used to print the raw description under the title, so a row read
//
//     Lat Pulldown
//     4 × 15 lat pulldown at 60 lb
//
// — the name twice, and the numbers about to be shown again on the right. What a reader
// wants there is the facts, spelled once: "4 × 15 · 60 lb". The raw sentence is still the
// fallback, but only for what the structured fields could not carry — a machine nobody has
// a column for, a note about how it felt.
//
// Pure, and tested without a renderer: this is a formatting rule, and formatting rules are
// exactly the thing that rots quietly inside a component.

export type RowFactsInput = {
  description?: string | null;
  exercise?: string | null;
  /** The machine, when the fusion named one — a fact the title does not carry. */
  equipment?: string | null;
  sets?: number | null;
  reps?: number | null;
  load_lb?: number | null;
  /** On "assistance" the load is the help the machine gives; the row has to say so. */
  load_direction?: LoadDirection | null;
  duration_min?: number | null;
  distance_mi?: number | null;
};

/** Words that carry no information of their own — the scaffolding around a number. */
const FILLER = new Set([
  'a', 'an', 'and', 'at', 'by', 'did', 'do', 'doing', 'each', 'for', 'from', 'i', 'in', 'into',
  'is', 'it', 'of', 'on', 'or', 'per', 'plus', 'set', 'sets', 'rep', 'reps', 'the', 'then',
  'this', 'time', 'times', 'to', 'today', 'total', 'was', 'were', 'with', 'x',
  'lb', 'lbs', 'pound', 'pounds', 'kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms',
  'min', 'mins', 'minute', 'minutes', 'hr', 'hrs', 'hour', 'hours', 'sec', 'secs', 'second',
  'seconds', 'mi', 'mile', 'miles', 'km', 'kms', 'kilometre', 'kilometres', 'kilometer',
  'kilometers', 'k', 'assisted', 'assistance', 'help',
]);

const WORDS = /[a-z0-9.]+/g;

function tokens(text: string): string[] {
  return (text.toLowerCase().replace(/[×✕]/g, ' x ').match(WORDS) ?? []).filter(Boolean);
}

function number(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** "60 lb", or "60 lb assistance" where the number is the help rather than the resistance. */
export function loadWords(load: number, direction?: LoadDirection | null): string {
  return direction === 'assistance' ? `${number(load)} lb assistance` : `${number(load)} lb`;
}

/**
 * The structured facts, in the order a lifter reads them: what it was done on, the shape
 * of the work, the load, then how long and how far.
 */
export function structuredFacts(input: RowFactsInput): string[] {
  const parts: string[] = [];
  if (input.equipment?.trim()) parts.push(input.equipment.trim());
  if (input.sets != null && input.reps != null) parts.push(`${input.sets} × ${input.reps}`);
  else if (input.reps != null) parts.push(`${input.reps} reps`);
  else if (input.sets != null) parts.push(`${input.sets} sets`);
  if (input.load_lb != null) parts.push(loadWords(input.load_lb, input.load_direction));
  if (input.duration_min != null) parts.push(`${Math.round(input.duration_min)} min`);
  if (input.distance_mi != null) parts.push(`${number(input.distance_mi)} mi`);
  return parts;
}

/**
 * True when the raw description still holds something the structured facts do not: a word
 * that is not part of the exercise's name, not one of the numbers already drawn, and not
 * grammar. "4 × 15 lat pulldown at 60 lb" under "Lat Pulldown" adds nothing; "on the blue
 * machine, right shoulder twinged" adds two things.
 */
export function descriptionAdds(input: RowFactsInput): boolean {
  const description = input.description?.trim();
  if (!description) return false;

  const covered = new Set<string>([
    ...tokens(input.exercise ?? ''),
    ...tokens(input.equipment ?? ''),
    ...[input.sets, input.reps, input.load_lb, input.duration_min, input.distance_mi]
      .filter((value): value is number => value != null)
      .flatMap((value) => [number(value), String(Math.round(value))]),
  ]);

  return tokens(description).some((word) => !FILLER.has(word) && !covered.has(word));
}

/**
 * The sub-line for one logged exercise. Structured facts, joined with " · ", and the raw
 * description appended only when it says something they do not. Null when there is nothing
 * to add under the title at all.
 */
export function activitySubLine(input: RowFactsInput): string | null {
  const parts = structuredFacts(input);
  if (descriptionAdds(input)) parts.push(input.description!.trim());
  return parts.length === 0 ? null : parts.join(' · ');
}
