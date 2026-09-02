import { View } from 'react-native';

import { Sparkline } from '@/components/charts';
import { Chevron, Tile, TileHead } from '@/components/progress/tile';
import { Body, Sub } from '@/components/type';
import type { BodyRowView } from '@/lib/scoreboard';
import { C, TABULAR } from '@/lib/theme';

// BODY — the weight line, drawn ON the row.
//
// The full-height chart and the weigh-in rows (tap to correct, ✕ to take it back) are
// behind this door, on app/progress/body.tsx. What a person wants from the page itself is
// the shape of the line and today's number, and a 34 px sparkline says the shape.

const SPARK_WIDTH = 84;

export function BodyTile({ body, loading, onOpen }: { body: BodyRowView | null; loading: boolean; onOpen: () => void }) {
  if (!body) {
    return (
      <Tile testID="tile-body-empty" accessibilityLabel="Weigh-ins" onPress={loading ? undefined : onOpen}>
        <TileHead eyebrow="Body" right={loading ? null : <Chevron />} />
        <Sub testID="body-empty" style={{ marginTop: 5 }}>
          {loading ? 'Reading your weigh-ins…' : 'No weigh-ins yet.'}
        </Sub>
      </Tile>
    );
  }

  return (
    <Tile testID="tile-body" accessibilityLabel={`Body, ${body.headline}`} onPress={onOpen}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <TileHead eyebrow="Body" />
          <Body testID="body-line" style={[{ marginTop: 4 }, TABULAR]}>
            {body.headline}
            {body.trend ? <Body style={{ color: C.mute }}>{` · ${body.trend}`}</Body> : null}
          </Body>
        </View>
        {body.values.length > 0 ? (
          <View testID="body-spark" style={{ width: SPARK_WIDTH }}>
            <Sparkline points={body.values} height={34} color={C.dim} />
          </View>
        ) : null}
        <Chevron />
      </View>
    </Tile>
  );
}
