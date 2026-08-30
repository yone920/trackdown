import { View } from 'react-native';

import { Bar, Ring, Segments, Sparkline, type Segment } from '@/components/charts';
import { Card } from '@/components/kit';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { C, FONT, TABULAR } from '@/lib/theme';

// docs/design-system.md §Shared components: "eyebrow + big numeral + small unit + one of:
// bar, segment row, sparkline, ring". Which card appears is Today's decision (goal kind);
// this only draws one.

export type MetricChart =
  | { kind: 'bar'; fraction: number; color?: string }
  | { kind: 'segments'; segments: Segment[] }
  | { kind: 'sparkline'; points: number[]; target?: number | null; color?: string }
  | { kind: 'ring'; fraction: number; color?: string; caption?: string };

export function MetricCard({
  eyebrow,
  value,
  unit,
  sub,
  chart,
  valueColor,
  testID,
}: {
  eyebrow: string;
  value: string;
  unit?: string | null;
  sub?: string | null;
  chart?: MetricChart;
  valueColor?: string;
  testID?: string;
}) {
  const ring = chart?.kind === 'ring' ? chart : null;
  return (
    <Card testID={testID} style={{ flex: 1 }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Disp size={42} style={{ color: valueColor ?? C.ink }}>
              {value}
            </Disp>
            {unit ? (
              <Sub style={{ marginLeft: 6, fontFamily: FONT.medium, fontSize: 13 }}>{unit}</Sub>
            ) : null}
          </View>
          {sub ? <Sub style={[{ marginTop: 4 }, TABULAR]}>{sub}</Sub> : null}
        </View>
        {ring ? (
          <Ring size={76} stroke={7} fraction={ring.fraction} color={ring.color ?? C.accent}>
            {ring.caption ? (
              <Disp size={15} style={{ color: C.mute }}>
                {ring.caption}
              </Disp>
            ) : null}
          </Ring>
        ) : null}
      </View>

      {chart?.kind === 'bar' ? (
        <View style={{ marginTop: 14 }}>
          <Bar fraction={chart.fraction} color={chart.color} />
        </View>
      ) : null}
      {chart?.kind === 'segments' ? (
        <View style={{ marginTop: 14 }}>
          <Segments segments={chart.segments} />
        </View>
      ) : null}
      {chart?.kind === 'sparkline' ? (
        <View style={{ marginTop: 14 }}>
          <Sparkline points={chart.points} target={chart.target ?? null} color={chart.color} />
        </View>
      ) : null}
    </Card>
  );
}
