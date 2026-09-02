import React, { useState } from 'react';
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

export type TrendSeries = {
  /** One value per x step; null leaves a gap rather than inventing a point. */
  values: (number | null)[];
  color?: string;
  width?: number;
  dashed?: boolean;
};

/**
 * The Progress screen's chart: several lines over one shared x domain — the daily
 * weigh-ins and the 7-day average that smooths them, say — with an optional dashed
 * target across the whole width. The y range covers every finite value and the target,
 * so a line and its goal are always both on screen (docs/design-system.md §Progress).
 */
export function TrendLine({
  series,
  height = 120,
  target,
  targetColor = C.track,
}: {
  series: TrendSeries[];
  height?: number;
  target?: number | null;
  targetColor?: string;
}) {
  const [width, onLayout] = useWidth();
  const finite = series.flatMap((line) => line.values.filter((v): v is number => v != null && Number.isFinite(v)));
  const withTarget = target != null ? [...finite, target] : finite;
  const min = withTarget.length > 0 ? Math.min(...withTarget) : 0;
  const max = withTarget.length > 0 ? Math.max(...withTarget) : 1;
  const span = max - min || 1;
  const pad = 6;
  const steps = Math.max(...series.map((line) => line.values.length), 1);
  const y = (value: number) => pad + (1 - (value - min) / span) * (height - pad * 2);
  const x = (i: number) => (steps <= 1 ? width / 2 : (i / (steps - 1)) * width);

  const path = (values: (number | null)[]) => {
    let started = false;
    let d = '';
    values.forEach((value, i) => {
      if (value == null || !Number.isFinite(value)) {
        started = false;
        return;
      }
      d += `${started ? 'L' : 'M'}${x(i)},${y(value)}`;
      started = true;
    });
    return d;
  };

  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && finite.length > 0 && (
        <Svg width={width} height={height}>
          {target != null && (
            <Line
              x1={0}
              y1={y(target)}
              x2={width}
              y2={y(target)}
              stroke={targetColor}
              strokeWidth={1}
              strokeDasharray="4 5"
            />
          )}
          {series.map((line, index) => (
            <Path
              key={index}
              d={path(line.values)}
              stroke={line.color ?? C.ink}
              strokeWidth={line.width ?? 2}
              strokeDasharray={line.dashed ? '3 4' : undefined}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {/* A line of one point is a path that draws nothing. One reading is still a fact,
              so it gets a dot — the same mark the sparkline puts on its latest value. */}
          {series.map((line, index) => {
            const at = line.values.findIndex((v) => v != null && Number.isFinite(v));
            const only = line.values.filter((v) => v != null && Number.isFinite(v)).length === 1;
            return only ? (
              <Circle
                key={`dot-${index}`}
                cx={x(at)}
                cy={y(line.values[at] as number)}
                r={3}
                fill={line.color ?? C.ink}
              />
            ) : null;
          })}
        </Svg>
      )}
    </View>
  );
}

/**
 * Vertical bars with a label under each — cardio minutes by week, workouts per week.
 * `fraction` is already scaled by the caller: a chart that rescales itself is a chart
 * that lies about the week it left out.
 */
export function Columns({
  columns,
  height = 90,
  color = C.accent,
}: {
  columns: { label: string; fraction: number; muted?: boolean }[];
  height?: number;
  color?: string;
}) {
  const [width, onLayout] = useWidth();
  const count = Math.max(columns.length, 1);
  const gap = 6;
  const each = (width - gap * (count - 1)) / count;
  const radius = Math.min(each / 2, 4);
  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && each > 0 && (
        <Svg width={width} height={height}>
          {columns.map((column, i) => {
            const filled = Math.max(clamp01(column.fraction) * height, column.fraction > 0 ? 3 : 0);
            return (
              <React.Fragment key={i}>
                <Rect x={i * (each + gap)} y={0} width={each} height={height} rx={radius} fill={C.track} />
                {filled > 0 && (
                  <Rect
                    x={i * (each + gap)}
                    y={height - filled}
                    width={each}
                    height={filled}
                    rx={radius}
                    fill={column.muted ? C.dim : color}
                  />
                )}
              </React.Fragment>
            );
          })}
        </Svg>
      )}
    </View>
  );
}

/**
 * A measure over its own sessions: one dot per session, and a line through them once there
 * are enough to mean something (field report 2026-09-02: "the historic loads, the progress
 * of the load … which direction I'm going").
 *
 * **The line is the claim and the dots are the evidence**, which is why the dots are always
 * drawn and the line is conditional. Two points joined up look exactly like a trend and are
 * not one — the goal card learnt that when a single weigh-in drew a chart with a projection
 * across it (lib/exercise-history.ts §sparseNote decides; this only draws).
 *
 * `values` are oldest first, in whatever unit the caller is plotting. A flat series still
 * gets a line down the middle rather than at the bottom: nothing changing is a fact about
 * the load, not a zero.
 */
export function SessionTrend({
  values,
  height = 120,
  color = C.accent,
  line = true,
}: {
  values: number[];
  height?: number;
  color?: string;
  /** False under three sessions: dots only, and the screen says why. */
  line?: boolean;
}) {
  const [width, onLayout] = useWidth();
  const finite = values.filter((value) => Number.isFinite(value));
  const min = finite.length > 0 ? Math.min(...finite) : 0;
  const max = finite.length > 0 ? Math.max(...finite) : 1;
  const span = max - min;
  const pad = 10;
  const y = (value: number) =>
    // A flat series has no span to scale against; drawn down the middle rather than at the
    // floor, where it would read as "nothing".
    span === 0 ? height / 2 : pad + (1 - (value - min) / span) * (height - pad * 2);
  const x = (index: number) =>
    finite.length <= 1 ? width / 2 : pad + (index / (finite.length - 1)) * (width - pad * 2);

  const d = finite.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(value)}`).join(' ');

  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && finite.length > 0 && (
        <Svg width={width} height={height}>
          {line && finite.length > 1 && (
            <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {finite.map((value, index) => (
            <Circle
              key={index}
              cx={x(index)}
              cy={y(value)}
              r={index === finite.length - 1 ? 4.5 : 3}
              fill={index === finite.length - 1 ? color : C.dim}
            />
          ))}
        </Svg>
      )}
    </View>
  );
}
