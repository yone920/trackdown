import type { DayLogRecord, FusionResult, PartCorrection } from '@/lib/types';

// The DayLog's "tap → correct" (docs/design-system.md §DayLog). A saved row is turned back
// into the shape the confirm card already knows how to draw and edit, and the edited shape
// is turned back into the patch its endpoint takes. Pure both ways, so the round trip is
// testable and the Log sheet stays one screen rather than growing a second editor.
//
// Confidence comes back as "high" because the user is the one saying it now: a correction
// is the most confident fact in the system (concept-v2 §Principles 3).

export type EditKind = 'activity' | 'meal' | 'weight' | 'goal';

/** A saved row as a confirm-card result. Null for a statement, which nothing can PATCH. */
export function recordToResult(record: DayLogRecord): FusionResult | null {
  switch (record.kind) {
    case 'activity':
      return {
        kind: 'activities',
        items: [
          {
            exercise: record.exercise,
            equipment: record.equipment,
            description: record.description,
            category: record.category,
            muscle_groups: record.muscle_groups,
            sets: record.sets,
            reps: record.reps,
            load_lb: record.load_lb,
            duration_min: record.duration_min,
            distance_mi: record.distance_mi,
            kcal: record.kcal,
            confidence: 'high',
            sources: null,
          },
        ],
      };
    case 'meal':
      return {
        kind: 'meal',
        description: record.description,
        meal_type: record.meal_type,
        kcal: record.kcal,
        protein_g: record.protein_g,
        carbs_g: record.carbs_g,
        fat_g: record.fat_g,
        fiber_g: record.fiber_g,
        items: [],
        confidence: 'high',
        sources: null,
      };
    case 'weight':
      return { kind: 'weight', weight_lb: record.weight_lb, confidence: 'high', sources: null };
    case 'goal':
      return {
        kind: 'goal',
        spec: {
          kind: record.goal_kind,
          title: record.title,
          metrics: record.metrics,
          active_from: null,
          active_to: null,
        },
        proposed_timeline: null,
      };
    case 'statement':
      return null;
  }
}

/**
 * The edited result as the patch its endpoint takes. Only the fields that endpoint owns:
 * a PATCH that carries the whole row would overwrite the columns the user did not touch.
 */
export function resultToPatch(kind: EditKind, result: FusionResult): Record<string, unknown> | null {
  if (kind === 'activity' && result.kind === 'activities') {
    const item = result.items[0];
    if (!item) return null;
    return {
      description: item.description || item.exercise || 'Exercise',
      kcal: Math.max(0, Math.round(item.kcal ?? 0)),
      exercise: item.exercise,
      equipment: item.equipment,
      category: item.category,
      muscle_groups: item.muscle_groups,
      sets: item.sets,
      reps: item.reps,
      load_lb: item.load_lb,
      duration_min: item.duration_min,
      distance_mi: item.distance_mi,
    };
  }
  if (kind === 'meal' && result.kind === 'meal') {
    return {
      description: result.description,
      kcal: Math.max(0, Math.round(result.kcal ?? 0)),
      protein_g: result.protein_g,
      carbs_g: result.carbs_g,
      fat_g: result.fat_g,
      fiber_g: result.fiber_g,
    };
  }
  if (kind === 'weight' && result.kind === 'weight') return { weight_lb: result.weight_lb };
  if (kind === 'goal' && result.kind === 'goal') {
    return { title: result.spec.title, metrics: result.spec.metrics };
  }
  return null;
}

/**
 * A told change that could not fit in the record it was about, as the parts to replace it
 * with — or null, which is the ordinary answer.
 *
 * A record carries ONE load, so "the last two sets I dropped to 70" on a 4-set record is
 * two records or it is nothing (field report 2026-09-01). The correction path can now
 * answer with several items where one went in; this is that answer on its way to
 * `POST /api/entries/movement/:id/split`, which replaces the row in one transaction.
 *
 * Null for one item, because replacing one record with one record is a PATCH, and for any
 * kind but an activity: a plate read wrong is one plate read wrong.
 */
export function resultToSplit(kind: EditKind, result: FusionResult): Record<string, unknown>[] | null {
  if (kind !== 'activity' || result.kind !== 'activities') return null;
  if (result.items.length < 2) return null;
  return result.items.map((item) => ({
    description: item.description || item.exercise || 'Exercise',
    kcal: Math.max(0, Math.round(item.kcal ?? 0)),
    exercise: item.exercise,
    equipment: item.equipment,
    category: item.category,
    muscle_groups: item.muscle_groups,
    sets: item.sets,
    reps: item.reps,
    load_lb: item.load_lb,
    duration_min: item.duration_min,
    distance_mi: item.distance_mi,
  }));
}

/**
 * The corrections that belong to the parts actually being saved, renumbered onto the list
 * the confirm sends.
 *
 * `results` is what is on screen and `POST /api/log/confirm` is sent only the parts that
 * are records — an `unclear` is a question and goes no further than the card — so the part
 * indexes the corrections were measured against are not the indexes the server will file
 * them under. A correction pointing at the wrong record is worse history than no history,
 * so one whose part is not being saved is dropped rather than moved somewhere plausible.
 */
export function savableCorrections(
  corrections: readonly PartCorrection[],
  results: readonly FusionResult[],
): PartCorrection[] {
  const renumbered = new Map<number, number>();
  let next = 0;
  results.forEach((result, index) => {
    if (result.kind === 'unclear') return;
    renumbered.set(index, next);
    next += 1;
  });
  return corrections.flatMap((correction) => {
    const part = renumbered.get(correction.part);
    return part === undefined ? [] : [{ ...correction, part }];
  });
}
