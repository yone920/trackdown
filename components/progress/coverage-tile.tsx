import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { MuscleSheet } from '@/components/progress/muscle-sheet';
import { Chevron, Tile, TileHead } from '@/components/progress/tile';
import { Body, Sub } from '@/components/type';
import { bodyRegions, type BodyRegion } from '@/lib/body-map';
import { coverageRow, type Tone } from '@/lib/scoreboard';
import { C, TABULAR } from '@/lib/theme';
import type { BoardLift, CoverageEntry } from '@/lib/types';

// COVERAGE — twelve muscles as twelve chips, and a popup behind each one.
//
// The stacked figures left the page (they cost most of a screen to say one thing); the grid
// says the same thing in four lines, and a tap on a chip opens the drawing over the page
// with everything the ledger knows about that muscle (components/progress/muscle-sheet.tsx).
//
// The colours are the ledger's three answers and no more: in the band, served but under it,
// or the rotation owes it a turn. The chevron on the head opens the full map and the
// sessions-a-week bars (app/progress/coverage.tsx).

const DOT: Record<Tone, string> = {
  good: C.good,
  accent: C.accent,
  dim: C.dim,
  mute: C.mute,
  ink: C.ink,
};

export function CoverageTile({
  coverage,
  lifts,
  onOpen,
}: {
  coverage: readonly CoverageEntry[] | undefined;
  /** For the popup's "Fed by": the board's lifts that name the muscle. */
  lifts: readonly BoardLift[];
  onOpen: () => void;
}) {
  const view = coverageRow(coverage);
  const regions = bodyRegions(coverage);
  const [chosen, setChosen] = useState<BodyRegion | null>(null);

  return (
    <Tile testID="tile-coverage">
      <Pressable
        testID="coverage-head"
        accessibilityRole="button"
        accessibilityLabel={`Coverage, ${view.line}`}
        onPress={onOpen}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <TileHead eyebrow="Coverage · last 7 days" />
            <Body testID="coverage-line" style={[{ marginTop: 4 }, TABULAR]}>
              {view.line}
            </Body>
          </View>
          <Chevron />
        </View>
      </Pressable>

      <View testID="coverage-chips" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 11 }}>
        {view.chips.map((chip) => (
          <Pressable
            key={chip.key}
            testID={`chip-${chip.key}`}
            accessibilityRole="button"
            accessibilityLabel={`${chip.label}, ${chip.sets_7d} sets this week`}
            onPress={() => setChosen(regions.find((region) => region.key === chip.key) ?? null)}
            style={{
              // Four to a row, with the gaps taken out of the share.
              width: '23.2%',
              backgroundColor: C.track,
              borderRadius: 8,
              paddingVertical: 7,
              paddingHorizontal: 7,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
            }}>
            <View
              testID={`chip-dot-${chip.key}`}
              accessibilityLabel={chip.tone}
              style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: DOT[chip.tone] }}
            />
            <Sub style={{ fontSize: 11, color: C.ink, flex: 1 }} numberOfLines={1}>
              {chip.label}
            </Sub>
          </Pressable>
        ))}
      </View>

      <MuscleSheet region={chosen} lifts={lifts} onClose={() => setChosen(null)} />
    </Tile>
  );
}
