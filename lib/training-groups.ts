import { clock } from '@/lib/format';
import type { DayActivity, MuscleSummary } from '@/lib/types';

// How a day's training is filed, for the ONE page that shows an open day and the one that
// reads a closed one. It used to be two answers: the Day page grouped by muscle, Today
// grouped by auto-block, and the same workout therefore looked like two different workouts
// depending on which door you came through (user decision 2026-09-01 — Today is now the
// only page for the open day, and it groups the way Day does).
//
// The contract, in one paragraph. **Every activity is drawn exactly once.** Cardio gets its
// own heading first, with the day's cardio minutes on the right — its muscle tags exist to
// credit the body map, not to file a walk under "glutes" (field report 2026-09-01: one
// treadmill walk was drawn under two headings). Then the muscle summary's groups in the
// order the server sent them, each with its set count; a lift that touches two muscles
// belongs to the FIRST heading that claims it. Whatever is left — a class, a hike, a
// movement the catalogue never resolved — falls under "Also".
//
// Pure, and tested without a renderer: which heading a row appears under is a rule, and
// rules are exactly the thing that rots quietly inside a component.

export interface TrainingGroup {
  muscle: string;
  sets: number;
  members: DayActivity[];
}

export interface TrainingGroups {
  /** Cardio, first and on its own. Never repeated under a muscle heading. */
  cardio: DayActivity[];
  /** The day's cardio minutes, for the Cardio heading's right-hand side. */
  cardioMinutes: number;
  /** The muscle summary's groups that actually claimed a row, in the server's order. */
  byMuscle: TrainingGroup[];
  /** Everything no heading claimed. Drawn under "Also". */
  unfiled: DayActivity[];
}

/**
 * Health is a source, not a section: it is badged in its own slim card rather than filed
 * among the lifts (concept-v2 §Health). Both pages split the day the same way first.
 */
export function splitBySource(activities: readonly DayActivity[]): {
  logged: DayActivity[];
  health: DayActivity[];
} {
  return {
    logged: activities.filter((activity) => activity.source !== 'health'),
    health: activities.filter((activity) => activity.source === 'health'),
  };
}

/** The day's training, grouped. `logged` is what {@link splitBySource} kept. */
export function groupTraining(
  logged: readonly DayActivity[],
  muscleSummary: readonly MuscleSummary[],
): TrainingGroups {
  const cardio = logged.filter((activity) => activity.category === 'cardio');
  const cardioMinutes = cardio.reduce((sum, activity) => sum + (activity.duration_min ?? 0), 0);

  const claimed = new Set<DayActivity>(cardio);
  const byMuscle: TrainingGroup[] = [];
  for (const group of muscleSummary) {
    const members = logged.filter(
      (activity) =>
        !claimed.has(activity) &&
        activity.muscle_groups.some((muscle) => muscle.toLowerCase() === group.muscle.toLowerCase()),
    );
    if (members.length === 0) continue;
    members.forEach((member) => claimed.add(member));
    byMuscle.push({ muscle: group.muscle, sets: group.sets, members });
  }

  return { cardio, cardioMinutes, byMuscle, unfiled: logged.filter((activity) => !claimed.has(activity)) };
}

/**
 * When the training happened, as one small note — "7:36a–8:35a". The auto-blocks used to be
 * the grouping principle on Today, which meant the *time* decided what a workout was; it is
 * a fact about the session, not a way to file it, so it is a note on the section header and
 * nothing else (user decision 2026-09-01).
 *
 * Null when there is nothing to span: no training, or a single row, whose own time is
 * already printed beside it.
 */
export function sessionSpan(logged: readonly DayActivity[]): string | null {
  const times = logged
    .map((activity) => activity.logged_at)
    .filter((at): at is string => Boolean(at))
    .sort();
  const first = times[0];
  const last = times[times.length - 1];
  if (!first || !last) return null;
  const from = clock(first);
  const to = clock(last);
  return from === to ? null : `${from}–${to}`;
}
