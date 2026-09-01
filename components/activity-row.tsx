import { useRouter } from 'expo-router';

import { EvidenceThumbs } from '@/components/evidence';
import { Row } from '@/components/kit';
import { Sub } from '@/components/type';
import { openExercise } from '@/lib/exercise';
import { clock, kcal } from '@/lib/format';
import { activitySubLine } from '@/lib/row-facts';
import { C } from '@/lib/theme';
import type { DayActivity, DeltaVsLast } from '@/lib/types';

// One logged exercise, drawn the same way wherever it appears. It was written twice — once
// on Today and once on Day — and the two had already drifted apart by the time Today became
// the only page for the open day (user decision 2026-09-01).
//
// Every row is three targets (concept-v2 §The two day views): the exercise NAME opens its
// sheet, the ✕ deletes it in two taps, and the rest of the row opens it for a correction.

export function ActivityRow({
  activity,
  last,
  onPress,
  onDelete,
}: {
  activity: DayActivity;
  /** The last row under a heading draws no divider. */
  last: boolean;
  onPress?: () => void;
  onDelete?: () => void;
}) {
  const router = useRouter();
  return (
    <Row
      testID={activity.id ? `row-activity-${activity.id}` : undefined}
      time={clock(activity.logged_at)}
      title={activity.exercise ?? activity.description}
      onTitlePress={() =>
        openExercise(router, {
          // The description when there is no resolved movement: a name-only sheet with a
          // form video is a better answer than a title that does nothing.
          id: activity.exercise_id,
          name: activity.exercise ?? activity.description,
          mediaCount: activity.media_count,
        })
      }
      titleMedia={activity.media_count}
      // The machine belongs on this line and not in the title: the movement is what the
      // week is compared on, and the kit is what the row is recognised by. Structured
      // facts only — never the raw sentence the title already says (lib/row-facts.ts).
      sub={activitySubLine(activity)}
      right={activity.kcal > 0 ? kcal(activity.kcal) : null}
      onPress={onPress}
      onDelete={onDelete}
      deleteLabel={activity.exercise ?? activity.description}
      divider={!last}>
      {activity.delta_vs_last ? (
        <Sub style={{ marginTop: 3, color: deltaColor(activity.delta_vs_last) }}>
          {activity.delta_vs_last.text}
        </Sub>
      ) : null}
      <EvidenceThumbs photos={activity.evidence} />
    </Row>
  );
}

/**
 * Green for progress, amber for a step back, quiet for neither. Read from `sentiment`, not
 * from which way the number went: on an assisted machine the load is the help the machine
 * gives, so "-5 lb" is less help and is the good news. `direction` is the fallback for a
 * response from a build before the field existed.
 */
export function deltaColor(delta: DeltaVsLast): string {
  const sentiment =
    delta.sentiment ?? (delta.direction === 'up' ? 'good' : delta.direction === 'down' ? 'watch' : 'neutral');
  if (sentiment === 'good') return C.good;
  if (sentiment === 'watch') return C.accent;
  return C.mute;
}
