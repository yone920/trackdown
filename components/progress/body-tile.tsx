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
// the shape of the line and today's number.
//
// The line used to be 84 px wide, `dim`, wedged between the number and the chevron, and at
// that size it read as a scratch on the glass rather than as a chart (field report
// 2026-09-03 — "too cramped, too dense"). It is the most interesting thing on the tile, so
// it now gets the full width under the number, in accent, with a fade beneath it.

const SPARK_HEIGHT = 62;

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
        <Chevron />
      </View>
      {/* One reading is a dot, not a line: nothing to draw until there are two. */}
      {body.values.length > 1 ? (
        <View testID="body-spark" style={{ marginTop: 10 }}>
          <Sparkline points={body.values} height={SPARK_HEIGHT} color={C.accent} area />
        </View>
      ) : null}
    </Tile>
  );
}
