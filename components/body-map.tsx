import BodyFigure from 'react-native-body-highlighter';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Card } from '@/components/kit';
import { Body as BodyText, Sub, Eyebrow } from '@/components/type';
import {
  bodyLegend,
  bodyRegions,
  overdueRegions,
  regionBySlug,
  type BodyRegion,
} from '@/lib/body-map';
import { C, RADIUS, TABULAR } from '@/lib/theme';
import type { CoverageEntry } from '@/lib/types';

// The coverage ledger, on a body (user decision 2026-08-31). It replaces the sets-per-muscle
// bars and the "Overdue a turn" text line that sat under them — one picture instead of two
// lists of the same twelve numbers.
//
// The figure is `react-native-body-highlighter` (MIT): pure JavaScript over
// `react-native-svg`, which this app already ships, so there is no native module and it runs
// in Expo Go and on the new architecture unchanged. Everything visible about it here is
// ours — the package draws paths and reports taps, and the colours, the stroke, the legend
// and the words come from lib/body-map.ts.
//
// Front and back STACKED, full width each (user: side by side was too small to read or tap): the pull half of a
// week is all on the back.

/** Two figures on one row of a phone; the package scales from a ~400 px design. */
const FIGURE_SCALE = 1.9;

export function BodyMap({
  coverage,
  testID = 'body-map',
}: {
  coverage: readonly CoverageEntry[] | undefined;
  testID?: string;
}) {
  const regions = bodyRegions(coverage);
  const [selected, setSelected] = useState<BodyRegion | null>(null);
  const [selectedSide, setSelectedSide] = useState<'front' | 'back'>('front');
  const overdue = overdueRegions(regions);

  // One data array feeds both figures: a slug the back does not draw is simply not drawn,
  // and a muscle on both sides (deltoids, forearms, calves) is coloured on both.
  const data = regions.flatMap((region) =>
    region.slugs.map((slug) => ({
      slug,
      // `intensity` is the package's own index into `colors`; we hand it one colour per
      // part instead, so the ramp lives in one place (lib/body-map.ts §LEVEL_COLOR).
      color: region.color,
      styles: {
        fill: region.color,
        // The rotation's debts, said without a word: a thin accent outline on anything
        // overdue. On a grey region it is the only thing that distinguishes "never trained"
        // from "not trained this week".
        stroke: region.overdue ? C.accent : C.line,
        strokeWidth: region.overdue ? 1.2 : 0.5,
      },
    })),
  );

  const onPart = (side: 'front' | 'back') => (part: { slug?: string }) => {
    const region = part.slug ? regionBySlug(regions, part.slug) : null;
    setSelectedSide(side);
    setSelected((current) => (region && current?.key === region.key ? null : region));
  };

  return (
    <Card testID={testID}>
      {/* What window the colours are about. The map never said, and the question it left
          people asking was whether it resets on a Monday — it does not: every set carries
          its own rolling 7-day clock (field report 2026-09-01). The tap detail says
          days-since and the weekly target; this says what the picture is of. */}
      <Eyebrow testID="body-map-window" style={{ marginBottom: 14 }}>
        Last 7 days
      </Eyebrow>
      <View style={{ flexDirection: 'column', alignItems: 'center', gap: 20 }}>
        {(['front', 'back'] as const).map((side) => (
          <View key={side} testID={`body-map-${side}`} style={{ alignItems: 'center' }}>
            {/* The detail pops up OVER the figure that was tapped — the card used to sit
                below both figures, a full screen away from a tap on the top one. */}
            {selected && selectedSide === side ? (
              <Pressable
                testID="body-map-detail"
                accessibilityLabel={selected.detail}
                onPress={() => setSelected(null)}
                style={{
                  position: 'absolute',
                  top: 16,
                  left: 0,
                  right: 0,
                  zIndex: 10,
                  padding: 12,
                  borderRadius: RADIUS.tile,
                  borderWidth: 1,
                  borderColor: selected.overdue ? C.accent : C.track,
                  backgroundColor: C.bg,
                  shadowColor: '#000',
                  shadowOpacity: 0.5,
                  shadowRadius: 12,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 8,
                }}>
                <BodyText style={[{ lineHeight: 20 }, TABULAR]}>{selected.detail}</BodyText>
              </Pressable>
            ) : null}
            <BodyFigure
              side={side}
              gender="male"
              scale={FIGURE_SCALE}
              data={data}
              onBodyPartPress={onPart(side)}
              defaultFill={C.track}
              defaultStroke={C.line}
              defaultStrokeWidth={0.5}
              border="none"
              hiddenParts={['hair', 'head', 'hands', 'feet']}
            />
            <Sub style={{ marginTop: 4, fontSize: 10 }}>{side === 'front' ? 'Front' : 'Back'}</Sub>
          </View>
        ))}
      </View>

      {selected ? null : (
        <Sub testID="body-map-hint" style={{ marginTop: 14, color: C.dim }}>
          Tap a muscle for its week.
        </Sub>
      )}

      {/* The legend, because a colour ramp nobody explained is decoration. */}
      <View
        testID="body-map-legend"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
        {bodyLegend().map((step) => (
          <View key={step.level} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View
              style={{
                width: 9,
                height: 9,
                borderRadius: 2,
                backgroundColor: step.color,
                borderWidth: step.level === 0 ? 1 : 0,
                borderColor: C.line,
              }}
            />
            <Sub style={{ fontSize: 10 }}>{step.label}</Sub>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              borderWidth: 1.2,
              borderColor: C.accent,
            }}
          />
          <Sub style={{ fontSize: 10 }}>Overdue a turn</Sub>
        </View>
      </View>

      {overdue.length > 0 ? (
        <Sub testID="body-map-overdue" style={{ marginTop: 10, color: C.dim, lineHeight: 17 }}>
          {`Overdue: ${overdue
            .map((region) => `${region.label} · ${region.days_since == null ? 'never' : `${region.days_since} days`}`)
            .join(' · ')}`}
        </Sub>
      ) : null}
    </Card>
  );
}

/** The eyebrow the section draws over the map — sets a week, in one phrase. */
export function coverageSummary(coverage: readonly CoverageEntry[] | undefined): string | null {
  const entries = (coverage ?? []).filter((entry) => entry.unit === 'sets');
  if (entries.length === 0) return null;
  const served = entries.filter((entry) => entry.days_since != null).length;
  return `${served} of ${entries.length} served`;
}
