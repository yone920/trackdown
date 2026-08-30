import { Pressable, View } from 'react-native';

import { Ring } from '@/components/charts';
import { IconChevronRight, IconGoals } from '@/components/icons';
import { Card } from '@/components/kit';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { C, RADIUS } from '@/lib/theme';

// The goal, one card, on every screen that has one (docs/design-system.md §Shared
// components). The no-goal state is not an error and is not styled like one: a flag
// instead of a ring, `mute` instead of `accent`, and an invitation instead of a number —
// concept-v2 §Goals, "with none, the app shows no judgement".

export function GoalBanner({
  title,
  sub,
  percent,
  onPress,
  testID,
}: {
  /** null renders the "no goal set" state. */
  title: string | null;
  sub?: string | null;
  /** 0–1 through the goal; null when nothing can be measured yet. */
  percent?: number | null;
  onPress?: () => void;
  testID?: string;
}) {
  const hasGoal = title !== null;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
      <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
        {hasGoal ? (
          <Ring size={56} stroke={5} fraction={percent ?? 0}>
            <Disp size={15} style={{ color: percent == null ? C.mute : C.ink }}>
              {percent == null ? '—' : `${Math.round(percent * 100)}%`}
            </Disp>
          </Ring>
        ) : (
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              borderWidth: 1,
              borderColor: C.track,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <IconGoals size={24} color={C.mute} />
          </View>
        )}

        <View style={{ flex: 1, marginLeft: 14 }}>
          <Eyebrow style={{ color: hasGoal ? C.accent : C.mute }}>
            {hasGoal ? 'Goal · active' : 'No goal set'}
          </Eyebrow>
          <Disp size={22} style={{ marginTop: 4 }}>
            {hasGoal ? title : 'Training for consistency'}
          </Disp>
          {sub ? <Sub style={{ marginTop: 3 }}>{sub}</Sub> : null}
        </View>
        {onPress ? <IconChevronRight size={20} color={C.dim} /> : null}
      </Card>
    </Pressable>
  );
}
