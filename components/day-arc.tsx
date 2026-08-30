import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';

import { C, FONT } from '@/lib/theme';
import type { ArcEvent } from '@/lib/types';

// The day arc (docs/design-system.md §Shared components): 6a→11p, `ink` dots for logs,
// an `accent` bar for the workout span, the `good` NOW marker, and a dashed dot for
// something the day expected and has not had. Every event on it is computed by the server
// (backend/src/services/day/narrative.ts) — this draws the list it is given.

const START = 6 * 60;
const END = 23 * 60;
const HEIGHT = 62;
const BASELINE = 34;

const LABELS = [
  { at: 6 * 60, text: '6a' },
  { at: 12 * 60, text: '12p' },
  { at: 18 * 60, text: '6p' },
  { at: 23 * 60, text: '11p' },
];

export function DayArc({ events }: { events: ArcEvent[] }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // 8px of margin each side so a dot at 6 am is not half off the card.
  const pad = 8;
  const x = (minutes: number) => {
    const clamped = Math.max(START, Math.min(END, minutes));
    return pad + ((clamped - START) / (END - START)) * Math.max(width - pad * 2, 1);
  };

  const blocks = events.filter((e) => e.kind === 'block');
  const now = events.find((e) => e.kind === 'now');
  const expected = events.filter((e) => e.kind === 'expected');
  const dots = events.filter((e) => e.kind === 'meal' || e.kind === 'activity' || e.kind === 'weight');

  return (
    <View onLayout={onLayout} style={{ height: HEIGHT }}>
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          <Line
            x1={pad}
            y1={BASELINE}
            x2={width - pad}
            y2={BASELINE}
            stroke={C.track}
            strokeWidth={2}
            strokeLinecap="round"
          />

          {blocks.map((block, i) => {
            const from = x(block.at);
            const to = x(block.until ?? block.at + 30);
            return (
              <Rect
                key={`block-${i}`}
                x={from}
                y={BASELINE - 4}
                width={Math.max(to - from, 6)}
                height={8}
                rx={4}
                fill={C.accent}
              />
            );
          })}

          {dots.map((event, i) => (
            <Circle key={`dot-${i}`} cx={x(event.at)} cy={BASELINE} r={3.5} fill={C.ink} />
          ))}

          {expected.map((event, i) => (
            <Circle
              key={`exp-${i}`}
              cx={x(event.at)}
              cy={BASELINE}
              r={4}
              fill={C.bg}
              stroke={C.dim}
              strokeWidth={1.5}
              strokeDasharray="2 2"
            />
          ))}

          {now ? (
            <>
              <Line
                x1={x(now.at)}
                y1={BASELINE - 12}
                x2={x(now.at)}
                y2={BASELINE + 12}
                stroke={C.good}
                strokeWidth={2}
                strokeLinecap="round"
              />
              <SvgText
                x={x(now.at)}
                y={BASELINE - 17}
                fill={C.good}
                fontSize={9}
                fontFamily={FONT.semi}
                textAnchor="middle">
                NOW
              </SvgText>
            </>
          ) : null}

          {LABELS.map((label) => (
            <SvgText
              key={label.text}
              x={x(label.at)}
              y={BASELINE + 20}
              fill={C.dim}
              fontSize={9}
              fontFamily={FONT.regular}
              textAnchor="middle">
              {label.text}
            </SvgText>
          ))}
        </Svg>
      )}
    </View>
  );
}
