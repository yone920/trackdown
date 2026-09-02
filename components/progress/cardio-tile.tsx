import { View } from 'react-native';

import { Bar } from '@/components/charts';
import { Chevron, Tile, TileHead } from '@/components/progress/tile';
import { Body } from '@/components/type';
import type { CardioRowView } from '@/lib/scoreboard';
import { C, TABULAR } from '@/lib/theme';

// CARDIO — the week against its target, and what is prescribed next.
//
// Equivalent minutes, not minutes: a hard twenty is worth more than an easy forty
// (backend services/coach/cardioIntensity.ts). The breakdown behind that number, the
// weekly bars and the pace history are behind the door (app/progress/cardio.tsx).

/** Thin on purpose: it is a reading, not a control. */
const BAR_HEIGHT = 5;

export function CardioTile({ cardio, onOpen }: { cardio: CardioRowView; onOpen: () => void }) {
  return (
    <Tile testID="tile-cardio" accessibilityLabel={`Cardio, ${cardio.line}`} onPress={onOpen}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <TileHead eyebrow="Cardio · this week" />
          <Body testID="cardio-line" style={[{ marginTop: 4 }, TABULAR]}>
            {cardio.line}
            {cardio.next ? <Body style={{ color: C.good }}>{` · ${cardio.next}`}</Body> : null}
          </Body>
          <View testID="cardio-bar" style={{ marginTop: 9 }}>
            <Bar fraction={cardio.fraction} height={BAR_HEIGHT} color={C.accent} />
          </View>
        </View>
        <Chevron />
      </View>
    </Tile>
  );
}
