// What the user actually puts on the bar.
//
// A barbell load is STORED and PRESCRIBED as a total, and that is right: progression math
// works on totals, and a history that said "35" for a 115 lb lift would be a history that
// lies. But nobody loads a total. They load plates, per side, and the arithmetic in between
// was being left to the user in a gym (field report 2026-09-02: "coach says 115… minus the
// 45 bar… 70… 35 a side").
//
// So the app says both. The total leads, because it is the number the plan, the history and
// the progression are all keyed on; the per-side breakdown follows, because it is the number
// the hands do.
//
// **Only for a barbell.** A dumbbell load is already per hand (services/fusion/prompt.ts
// §load rules), a machine's number is the stack, and a bodyweight movement has no plates at
// all. Printing "/side" on any of those would be a different lie from the one this fixes.

/** The bar itself, in pounds. The standard Olympic bar, which is what the fusion rules assume. */
export const BAR_LB = 45;

/** Is this a movement loaded with plates on a bar? Read from the catalogue, never the name. */
export function isBarbell(equipment: readonly string[] | null | undefined): boolean {
  return (equipment ?? []).some((item) => item.trim().toLowerCase() === 'barbell');
}

/**
 * The plates on one side of the bar, or null when there is nothing useful to say.
 *
 * Null — not zero — for a total at or below the bar: an empty bar is "just the bar", and
 * "0/side" is arithmetic nobody asked for. Null too for a total that does not divide into a
 * pair of matching sides, which cannot be loaded as stated and is better left unannotated
 * than rounded into something the user would have to un-round.
 */
export function perSideLb(totalLb: number | null | undefined): number | null {
  if (totalLb == null || !Number.isFinite(totalLb)) return null;
  if (totalLb <= BAR_LB) return null;
  const perSide = (totalLb - BAR_LB) / 2;
  return perSide > 0 ? perSide : null;
}

/** "35", "37.5" — a plate count reads naturally, and never as "37.50". */
export function plateText(perSide: number): string {
  const rounded = Math.round(perSide * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * The per-side half of a load, as it is drawn beside the total: "35/side + bar".
 *
 * Null whenever there is nothing to add — not a barbell, no load, or a load the bar alone
 * accounts for. A caller appends it; it never replaces the total, which is the number
 * everything else in the app is keyed on.
 */
export function perSideNote(
  totalLb: number | null | undefined,
  equipment: readonly string[] | null | undefined,
): string | null {
  if (!isBarbell(equipment)) return null;
  const perSide = perSideLb(totalLb);
  return perSide === null ? null : `${plateText(perSide)}/side + bar`;
}
