import { clock } from '@/lib/format';
import type { CompletionRecord, ExerciseCompletion } from '@/lib/types';

// The line under a prescription that says what actually happened (user decision
// 2026-09-01: "if it's done, it's checked, you can click it, you can see the log,
// everything I logged about it").
//
// The plan and the log were two sections showing the same facts twice — the Do list said
// "Chest Press Machine · 85 lb · 4 × 10" and the Done list said "Chest Press Machine ·
// 2 × 10 · 85 lb" and "2 × 10 · 70 lb", and the reader had to hold both in their head to
// see that the load had dropped. One row now carries both: what was asked for, and this.
//
// Pure, and tested without a renderer, because it is a formatting rule and formatting rules
// rot quietly inside components. The MATCHING is not done here and is never done in the
// app: the server computed it to make the tick, and two matchers would eventually disagree
// about the same row (backend services/coach/completion.ts).

/** The numbers of one logged record, compactly: "2 × 10 @ 85", "17 min", "3 sets". */
export function recordFacts(record: CompletionRecord): string {
  const parts: string[] = [];
  if (record.sets != null && record.reps != null) parts.push(`${record.sets} × ${record.reps}`);
  else if (record.sets != null) parts.push(`${record.sets} ${record.sets === 1 ? 'set' : 'sets'}`);
  else if (record.reps != null) parts.push(`${record.reps} reps`);
  if (record.load_lb != null) parts.push(`@ ${round(record.load_lb)}`);
  if (record.duration_min != null) parts.push(`${Math.round(record.duration_min)} min`);
  return parts.join(' ');
}

/**
 * "Done 8:02a · 2 × 10 @ 85 + 2 × 10 @ 70" — what was logged against this prescription.
 *
 * Several records joined with "+" is the case this exists for: a drop set corrected into
 * two rows is two records against one prescribed line, and printing only the first would
 * be the double-counting bug wearing a new hat.
 *
 * Null when nothing has been logged against it — an untouched line says nothing, because
 * a plan is not a list of things you are behind on (concept-v2 §Principles 8).
 */
export function truthLine(completion: ExerciseCompletion | undefined): string | null {
  const records = completion?.records ?? [];
  if (!completion || records.length === 0) return null;
  const when = records.find((record) => record.logged_at)?.logged_at ?? null;
  const facts = records.map(recordFacts).filter(Boolean).join(' + ');
  const head = completion.done
    ? 'Done'
    : completion.sets_prescribed != null
      ? `${completion.sets_done} of ${completion.sets_prescribed} sets`
      : 'Logged';
  return [when ? `${head} ${clock(when)}` : head, facts].filter(Boolean).join(' · ');
}

/** Every record id that ticked any line of the plan off. */
export function matchedRecordIds(
  exercises: readonly { completion?: ExerciseCompletion }[],
): Set<string> {
  const ids = new Set<string>();
  for (const exercise of exercises) {
    for (const record of exercise.completion?.records ?? []) ids.add(record.id);
  }
  return ids;
}

/** 85, not 85.0; 82.5 stays 82.5. */
function round(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
