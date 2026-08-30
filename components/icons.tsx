import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

import { C } from '@/lib/theme';

// Stroke icons, drawn with react-native-svg. docs/design-system.md: "No emoji anywhere;
// icons are stroke SVGs" — and no glyph font either, because a font ties every icon's
// weight to whatever the vendor shipped and these are all 1.8 on a 24 grid.

export type IconProps = { size?: number; color?: string; strokeWidth?: number };

function Frame({
  size = 24,
  children,
}: {
  size?: number;
  children: React.ReactNode;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {children}
    </Svg>
  );
}

const base = (p: IconProps) => ({
  stroke: p.color ?? C.ink,
  strokeWidth: p.strokeWidth ?? 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

/** Today — a sun over the horizon: the live day. */
export function IconToday(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Circle cx={12} cy={11} r={4} {...base(p)} />
      <Line x1={12} y1={2} x2={12} y2={4} {...base(p)} />
      <Line x1={5} y1={5} x2={6.5} y2={6.5} {...base(p)} />
      <Line x1={19} y1={5} x2={17.5} y2={6.5} {...base(p)} />
      <Line x1={3} y1={18} x2={21} y2={18} {...base(p)} />
      <Line x1={7} y1={21.5} x2={17} y2={21.5} {...base(p)} />
    </Frame>
  );
}

/** Days — a calendar. */
export function IconDays(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Rect x={3} y={5} width={18} height={16} rx={3} {...base(p)} />
      <Line x1={3} y1={10} x2={21} y2={10} {...base(p)} />
      <Line x1={8} y1={3} x2={8} y2={6} {...base(p)} />
      <Line x1={16} y1={3} x2={16} y2={6} {...base(p)} />
    </Frame>
  );
}

/** Progress — a rising line. */
export function IconProgress(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Polyline points="3,17 9,11 13,15 21,6" {...base(p)} />
      <Polyline points="16,6 21,6 21,11" {...base(p)} />
    </Frame>
  );
}

/** Goals — a flag on a pole. */
export function IconGoals(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Line x1={5} y1={3} x2={5} y2={21} {...base(p)} />
      <Path d="M5 4h11l-2.5 4L16 12H5z" {...base(p)} />
    </Frame>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Line x1={12} y1={5} x2={12} y2={19} {...base(p)} />
      <Line x1={5} y1={12} x2={19} y2={12} {...base(p)} />
    </Frame>
  );
}

export function IconChevronRight(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Polyline points="9,5 16,12 9,19" {...base(p)} />
    </Frame>
  );
}

export function IconChevronLeft(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Polyline points="15,5 8,12 15,19" {...base(p)} />
    </Frame>
  );
}

export function IconCamera(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H8l1.5-2h5L16 6h2.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" {...base(p)} />
      <Circle cx={12} cy={13} r={3.5} {...base(p)} />
    </Frame>
  );
}

export function IconMic(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Rect x={9} y={2.5} width={6} height={11} rx={3} {...base(p)} />
      <Path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" {...base(p)} />
      <Line x1={12} y1={18} x2={12} y2={21.5} {...base(p)} />
    </Frame>
  );
}

export function IconKeyboard(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Rect x={2.5} y={6} width={19} height={12} rx={2.5} {...base(p)} />
      <Line x1={6} y1={10} x2={6} y2={10} {...base(p)} />
      <Line x1={10} y1={10} x2={10} y2={10} {...base(p)} />
      <Line x1={14} y1={10} x2={14} y2={10} {...base(p)} />
      <Line x1={18} y1={10} x2={18} y2={10} {...base(p)} />
      <Line x1={8} y1={14.5} x2={16} y2={14.5} {...base(p)} />
    </Frame>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Polyline points="4,12.5 9.5,18 20,6.5" {...base(p)} />
    </Frame>
  );
}

export function IconClose(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Line x1={6} y1={6} x2={18} y2={18} {...base(p)} />
      <Line x1={18} y1={6} x2={6} y2={18} {...base(p)} />
    </Frame>
  );
}

export function IconHeart(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Path d="M12 20s-7.5-4.6-7.5-9.5A4 4 0 0 1 12 7.6 4 4 0 0 1 19.5 10.5C19.5 15.4 12 20 12 20z" {...base(p)} />
    </Frame>
  );
}

/** The Today header's stand-in for a face — the account, not a person. */
export function IconAvatar(p: IconProps) {
  return (
    <Frame size={p.size}>
      <Circle cx={12} cy={9} r={3.6} {...base(p)} />
      <Path d="M4.5 20a7.5 7.5 0 0 1 15 0" {...base(p)} />
    </Frame>
  );
}
