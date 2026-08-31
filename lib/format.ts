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

// ---------------------------------------------------------------------------
// Corrections (migration 0015) — the record's own history, in one line.
// ---------------------------------------------------------------------------

/**
 * How a corrected field is named to a reader. The wire names are columns; nobody says
 * "carbs_g". A field with no entry here is printed with its suffix and underscores taken
 * off, which is the same rule the confirm card's sources line uses.
 */
const FIELD_LABEL: Record<string, string> = {
  meal_type: 'meal',
  muscle_groups: 'muscles',
  duration_min: 'minutes',
  distance_mi: 'miles',
  load_lb: 'load',
  weight_lb: 'weight',
};

export function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field.replace(/_lb$|_g$|_min$|_mi$/, '').replace(/_/g, ' ');
}

/** A corrected value as the line prints it. A field that was cleared reads as an em dash. */
export function fieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ');
  if (typeof value === 'number') return String(Math.round(value * 10) / 10);
  return String(value);
}

/** "carbs 398 → 89" — one field that moved. */
export function changeLine(change: { field: string; from: unknown; to: unknown }): string {
  return `${fieldLabel(change.field)} ${fieldValue(change.from)} → ${fieldValue(change.to)}`;
}

/**
 * The correction as the provenance list reads it:
 *
 *   Corrected 1:45p: "the carbs look wrong" · carbs 398 → 89
 *
 * The instruction is quoted because it is the user's own sentence and the whole point is
 * that it is theirs — the changes beside it are what the app did about it.
 */
export function correctionLine(correction: {
  instruction: string;
  changes: { field: string; from: unknown; to: unknown }[];
  created_at: string;
}): string {
  const changes = correction.changes.map(changeLine).join(' · ');
  const said = `Corrected ${clock(correction.created_at)}: “${correction.instruction}”`;
  return changes ? `${said} · ${changes}` : said;
}
