import { useState } from 'react';
import { Pressable, View } from 'react-native';
import BodyFigure from 'react-native-body-highlighter';

import { MuscleSheet } from '@/components/progress/muscle-sheet';
import { Chevron, Tile, TileHead } from '@/components/progress/tile';
import { Body, Sub } from '@/components/type';
import { bodyRegions, regionBySlug, type BodyRegion } from '@/lib/body-map';
import { coverageRow } from '@/lib/scoreboard';
import { C, TABULAR } from '@/lib/theme';
import type { BoardLift, CoverageEntry } from '@/lib/types';

// COVERAGE — the week on a body (user decision 2026-09-03, from a reviewed mockup).
//
// It was twelve chips in a four-column grid. Twelve names do not fit four to a row on a
// phone, so half of them arrived cut: "Upper ba…", "Hamstrin…". The grid was chosen to save
// the height two full-width figures cost, and it bought that height with the one thing a
// coverage read cannot spare, which is knowing which muscle you are looking at.
//
// Colour on a shape needs no label at all. So the figure comes back — small, side by side,
// front and back — and the twelve names, their set counts and their debts stay one tap away
// on the muscle sheet, exactly as they were behind the chips.
//
// The side-by-side pair was tried once before at full scale and rejected as too small to
// read or tap (components/body-map.tsx). This is the summary, not the map: it answers "is
// anything being missed" at a glance, the chevron opens the full-width figures on
// app/progress/coverage.tsx, and a tap on any muscle opens its sheet over the page. A miss
// costs a second tap rather than a wrong answer.

/**
 * Two figures across a tile. `body-map.tsx` draws one full-width at 1.9, so the package's
 * own design is about 172 px across: 0.8 puts a pair inside the tile's ~315 px with room
 * between them, and keeps each muscle a real target rather than a hairline.
 */
const FIGURE_SCALE = 0.8;

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

  // One data array feeds both figures: a slug the back does not draw is simply not drawn,
  // and a muscle on both sides (deltoids, forearms, calves) is coloured on both.
  const data = regions.flatMap((region) =>
    region.slugs.map((slug) => ({
      slug,
      color: region.color,
      styles: {
        fill: region.color,
        // The rotation's debts, said without a word: a thin accent outline on anything
        // overdue. On a grey region it is the only thing that tells "never trained" from
        // "not trained this week".
        stroke: region.overdue ? C.accent : C.line,
        strokeWidth: region.overdue ? 1.2 : 0.5,
      },
    })),
  );

  const onPart = (part: { slug?: string }) => {
    const region = part.slug ? regionBySlug(regions, part.slug) : null;
    if (region) setChosen((current) => (current?.key === region.key ? null : region));
  };

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

      <View
        testID="coverage-figures"
        style={{ flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 10 }}>
        {(['front', 'back'] as const).map((side) => (
          // The wrapper carries the id, not the figure: the package takes no testID, and
          // the muscle sheet's own figure is mounted at the same time as this one.
          <View key={side} testID={`coverage-${side}`} style={{ alignItems: 'center' }}>
            <BodyFigure
              side={side}
              gender="male"
              scale={FIGURE_SCALE}
              data={data}
              onBodyPartPress={onPart}
              defaultFill={C.track}
              defaultStroke={C.line}
              defaultStrokeWidth={0.5}
              border="none"
              hiddenParts={['hair', 'head', 'hands', 'feet']}
            />
            <Sub style={{ marginTop: 2, fontSize: 10, color: C.dim }}>
              {side === 'front' ? 'Front' : 'Back'}
            </Sub>
          </View>
        ))}
      </View>

      <MuscleSheet region={chosen} lifts={lifts} onClose={() => setChosen(null)} />
    </Tile>
  );
}
