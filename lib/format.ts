// Small formatters shared by the screens. Nothing here decides anything — the server
// already did (docs/concept-v2.md §Principles 4); this only spells numbers the way the
// design spells them.

export function kcal(value: number | null | undefined): string {
  if (value == null) return '—';
  return Math.round(value).toLocaleString('en-US');
}

export function grams(value: number | null | undefined): string | null {
  if (value == null) return null;
  return `${Math.round(value)} g`;
}

/** "7:04a" — the Row's 50px time column. */
export function clock(instant: string): string {
  const at = new Date(instant);
  const hours = at.getHours();
  const minutes = String(at.getMinutes()).padStart(2, '0');
  const suffix = hours >= 12 ? 'p' : 'a';
  return `${hours % 12 || 12}:${minutes}${suffix}`;
}

/** The Today header's eyebrow: "SAT 30 AUG · 7:04 AM". */
export function dateEyebrow(now: Date = new Date()): string {
  const day = now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${time}`;
}

/** "Fri 29 Aug" for a stored `YYYY-MM-DD`, read as a local calendar date. */
export function dateLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

const SLOT_LABEL: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snacks',
};

export function slotLabel(slot: string): string {
  return SLOT_LABEL[slot] ?? 'Snacks';
}
