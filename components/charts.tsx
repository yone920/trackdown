import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { C } from '@/lib/theme';

// The four shapes a MetricCard can carry (docs/design-system.md §Shared components):
// bar, segment row, ring, sparkline. All svg, all pure — they take numbers and draw them,
// and none of them knows what a goal is.

/** Widths come from layout, not from a guess: a card's inner width is padding-dependent. */
function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)];
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export function Bar({
  fraction,
  color = C.accent,
  height = 8,
}: {
  fraction: number;
  color?: string;
  height?: number;
}) {
  const [width, onLayout] = useWidth();
  const filled = clamp01(fraction) * width;
  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Rect x={0} y={0} width={width} height={height} rx={height / 2} fill={C.track} />
          {filled > 0 && (
            <Rect
              x={0}
              y={0}
              width={Math.max(filled, height)}
              height={height}
              rx={height / 2}
              fill={color}
            />
          )}
        </Svg>
      )}
    </View>
  );
}

export type Segment = { filled: boolean; color?: string };

/** The weekly-deficit dots and the per-muscle coverage strip are both this. */
export function Segments({
  segments,
  height = 8,
  gap = 5,
}: {
  segments: Segment[];
  height?: number;
  gap?: number;
}) {
  const [width, onLayout] = useWidth();
  const count = Math.max(segments.length, 1);
  const each = (width - gap * (count - 1)) / count;
  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && each > 0 && (
        <Svg width={width} height={height}>
          {segments.map((segment, i) => (
            <Rect
              key={i}
              x={i * (each + gap)}
              y={0}
              width={each}
              height={height}
              rx={height / 2}
              fill={segment.filled ? (segment.color ?? C.accent) : C.track}
            />
          ))}
        </Svg>
      )}
    </View>
  );
}

/** The goal ring and the calories-left ring. `fraction` over 1 is clipped, never wrapped. */
export function Ring({
  size,
  fraction,
  color = C.accent,
  stroke = 6,
  children,
}: {
  size: number;
  fraction: number;
  color?: string;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const drawn = clamp01(fraction) * circumference;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.track} strokeWidth={stroke} fill="none" />
        {drawn > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${drawn} ${circumference}`}
            // Start at 12 o'clock rather than 3.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            fill="none"
          />
        )}
      </Svg>
      {children}
    </View>
  );
}

/**
 * A trend line. `points` are y-values in their own units, oldest first; the sparkline
 * scales to whatever range it is given, so weights and loads both look like themselves.
 */
export function Sparkline({
  points,
  height = 40,
  color = C.ink,
  target,
}: {
  points: number[];
  height?: number;
  color?: string;
  /** A dashed line to draw across the chart — the goal weight, usually. */
  target?: number | null;
}) {
  const [width, onLayout] = useWidth();
  const values = points.filter((n) => Number.isFinite(n));
  const withTarget = target != null ? [...values, target] : values;
  const min = Math.min(...withTarget);
  const max = Math.max(...withTarget);
  const span = max - min || 1;
  const pad = 3;
  const y = (value: number) => pad + (1 - (value - min) / span) * (height - pad * 2);
  const x = (i: number) => (values.length <= 1 ? width / 2 : (i / (values.length - 1)) * width);

  const d = values.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(value)}`).join(' ');

  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && values.length > 0 && (
        <Svg width={width} height={height}>
          {target != null && (
            <Line
              x1={0}
              y1={y(target)}
              x2={width}
              y2={y(target)}
              stroke={C.track}
              strokeWidth={1}
              strokeDasharray="3 4"
            />
          )}
          {values.length > 1 && <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
          <Circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r={3} fill={color} />
        </Svg>
      )}
    </View>
  );
}
