import { useRouter } from 'expo-router';
import { View } from 'react-native';

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
  showDelta = true,
  done = false,
}: {
  activity: DayActivity;
  /** The last row under a heading draws no divider. */
  last: boolean;
  onPress?: () => void;
  onDelete?: () => void;
  /**
   * The "+5 lb" / "−2 sets" line against last time. **Off inside the merged training
   * card** (user decision 2026-09-01): there the prescription sits directly above the
   * truth line, so the gap between what was asked for and what was done reads off the row
   * itself, and a third comparison against a different baseline is noise on top of it.
   * On the full log screen and on a closed Day there is no prescription to read it
   * against, so it stays.
   */
  showDelta?: boolean;
  /**
   * Draw it as accomplished — dimmed, with the green ✓ a finished plan line carries.
   *
   * Used where a logged row sits BESIDE unfinished ones (the "Also" group inside the
   * training card): off-plan work is done by definition, and rendering it in the same
   * upright ink as a plan line nobody has started made finished work look pending (field
   * report 2026-09-02). It is deliberately NOT used on the full training log, where every
   * row is done and a column of identical ticks would say nothing at all.
   */
  done?: boolean;
}) {
  const router = useRouter();
  return (
    <View style={{ opacity: done ? 0.45 : 1 }}>
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
      // The calories move into the line when the ✓ takes the right-hand slot, so nothing
      // is lost to the done treatment.
      sub={[activitySubLine(activity), done && activity.kcal > 0 ? `${kcal(activity.kcal)} kcal` : null]
        .filter(Boolean)
        .join(' · ')}
      right={done ? '✓' : activity.kcal > 0 ? kcal(activity.kcal) : null}
      rightColor={done ? C.good : undefined}
      onPress={onPress}
      onDelete={onDelete}
      deleteLabel={activity.exercise ?? activity.description}
      divider={!last}>
      {showDelta && activity.delta_vs_last ? (
        <Sub style={{ marginTop: 3, color: deltaColor(activity.delta_vs_last) }}>
          {activity.delta_vs_last.text}
        </Sub>
      ) : null}
      <EvidenceThumbs photos={activity.evidence} />
    </Row>
    </View>
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
