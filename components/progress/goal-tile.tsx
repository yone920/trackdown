import { View } from 'react-native';

import { Ring } from '@/components/charts';
import { Chevron, Tile, TileHead } from '@/components/progress/tile';
import { Body, Disp, Sub } from '@/components/type';
import type { GoalRowView, Tone } from '@/lib/scoreboard';
import { C, FONT, TABULAR } from '@/lib/theme';

// GOAL — the ring, the number, and what it did last (mockup, user-approved 2026-09-02).
//
// The whole goal card used to live on this page: the chart, the labelled weigh-in trio,
// "Mark reached", "Drop", the reorder arrows and the history under it. All of that is
// behind this row now (app/progress/goal.tsx). What survives on the page is the answer:
// how far along, what the measure reads, and which way it moved.

const RING = 46;

export const TONE_COLOR: Record<Tone, string> = {
  ink: C.ink,
  mute: C.mute,
  good: C.good,
  accent: C.accent,
  dim: C.dim,
};

export function GoalTile({
  goal,
  loading,
  onOpen,
  onTell,
}: {
  goal: GoalRowView | null;
  loading: boolean;
  onOpen: () => void;
  /** No goal is a legitimate state, not an error (concept-v2 §Goals). */
  onTell: () => void;
}) {
  if (!goal) {
    return (
      <Tile
        testID="tile-goal-empty"
        accessibilityLabel="Tell me what you're after"
        onPress={loading ? undefined : onTell}>
        <TileHead eyebrow="Goal" right={loading ? null : <Chevron />} />
        <Disp size={24} style={{ marginTop: 6 }}>
          {loading ? 'Reading your goals…' : 'No goal yet'}
        </Disp>
        {loading ? null : (
          <Sub style={{ marginTop: 4, lineHeight: 17 }}>
            Tell me what you’re after and this row starts keeping score.
          </Sub>
        )}
      </Tile>
    );
  }

  return (
    <Tile testID="tile-goal" accessibilityLabel={`Goal, ${goal.title}`} onPress={onOpen}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {goal.percent == null ? null : (
          <View style={{ marginRight: 13 }}>
            <Ring size={RING} stroke={5} fraction={goal.percent} color={goal.judge ? C.accent : C.mute}>
              <Body testID="goal-percent" style={{ fontFamily: FONT.semi, fontSize: 11, color: C.mute }}>
                {`${Math.round(goal.percent * 100)}%`}
              </Body>
            </Ring>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <TileHead
            testID="goal-eyebrow"
            eyebrow={`Goal · ${goal.title}`}
            tone={goal.judge ? C.accent : C.mute}
          />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 3 }}>
            <Disp size={30} testID="goal-value">
              {goal.value}
            </Disp>
            {goal.unit ? (
              <Sub style={{ marginLeft: 5, fontFamily: FONT.medium, fontSize: 12 }}>{goal.unit}</Sub>
            ) : null}
          </View>
          {goal.delta ? (
            <Sub testID="goal-delta" style={[{ marginTop: 2, color: TONE_COLOR[goal.delta.tone] }, TABULAR]}>
              {goal.delta.text}
            </Sub>
          ) : null}
        </View>
        <Chevron />
      </View>
    </Tile>
  );
}
