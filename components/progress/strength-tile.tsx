import { View } from 'react-native';

import { ExerciseName } from '@/components/exercise-name';
import { Chevron, Tile, TileHead } from '@/components/progress/tile';
import { Body, Sub } from '@/components/type';
import type { StrengthRowView } from '@/lib/scoreboard';
import { C, TABULAR } from '@/lib/theme';

// STRENGTH — what is new on the board, and the two lifts it is new about.
//
// The six live lift cards, their sparklines and the sessions-a-week bars are all behind
// this door (app/progress/strength.tsx), which also carries "All lifts". On the page a
// person gets the news line — computed from the same `prescribeLoads` states the coach
// reads — and the movers it names, with the prescription right-aligned in green because a
// next step is the one genuinely forward-looking thing on this screen.

export function StrengthTile({
  strength,
  loading,
  onOpen,
}: {
  strength: StrengthRowView;
  loading: boolean;
  onOpen: () => void;
}) {
  const empty = strength.count === 0;

  return (
    <Tile
      testID="tile-strength"
      accessibilityLabel={`Strength, ${strength.count} lifts`}
      onPress={empty && loading ? undefined : onOpen}>
      <TileHead
        eyebrow={empty ? 'Strength' : `Strength · ${strength.count} lift${strength.count === 1 ? '' : 's'}`}
        right={empty && loading ? null : <Chevron />}
      />
      <Body testID="strength-news" style={{ marginTop: 4 }}>
        {loading && empty ? 'Reading your log…' : strength.news}
      </Body>

      {strength.movers.length > 0 ? (
        <View
          testID="strength-movers"
          style={{ marginTop: 11, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 }}>
          {strength.movers.map((mover) => (
            <View
              key={mover.exercise}
              testID={`mover-${mover.exercise}`}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <ExerciseName
                  testID={`mover-name-${mover.exercise}`}
                  name={mover.exercise}
                  id={mover.exercise_id}
                  mediaCount={mover.media_count}
                />
              </View>
              <Sub
                testID={`mover-next-${mover.exercise}`}
                style={[{ color: C.good, textAlign: 'right' }, TABULAR]}
                numberOfLines={1}>
                {mover.text}
              </Sub>
            </View>
          ))}
        </View>
      ) : null}
    </Tile>
  );
}
