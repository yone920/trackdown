import { Text, type TextProps, type TextStyle } from 'react-native';

import { C, FONT, TABULAR } from '@/lib/theme';

// The type scale of docs/design-system.md §Tokens, as components. Font family and
// tabular numerals are style props, not class names — NativeWind can set a family, but
// `fontVariant` has no utility and every numeral in this design needs it.

type Props = TextProps & { style?: TextStyle | TextStyle[] };

/** 11px / 600, letterSpacing 1.6, uppercase, `mute` unless told otherwise. */
export function Eyebrow({ style, children, ...rest }: Props) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: FONT.semi,
          fontSize: 11,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: C.mute,
        },
        style as TextStyle,
      ]}>
      {children}
    </Text>
  );
}

/** Body copy: 15 / 500. */
export function Body({ style, children, ...rest }: Props) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: FONT.medium, fontSize: 15, color: C.ink }, style as TextStyle]}>
      {children}
    </Text>
  );
}

/** Secondary line: 12–13, `mute`. */
export function Sub({ style, children, ...rest }: Props) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: FONT.regular, fontSize: 12, color: C.mute }, style as TextStyle]}>
      {children}
    </Text>
  );
}

/**
 * Barlow Condensed — screen titles, section titles, card numerals. `size` is the whole
 * scale in one prop because these differ by nothing else.
 */
export function Disp({
  size = 22,
  weight = 'bold',
  style,
  children,
  ...rest
}: Props & { size?: number; weight?: 'bold' | 'semi' }) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: weight === 'bold' ? FONT.disp : FONT.dispSemi,
          fontSize: size,
          lineHeight: Math.round(size * 1.05),
          color: C.ink,
        },
        TABULAR,
        style as TextStyle,
      ]}>
      {children}
    </Text>
  );
}

/** A number in running text, so it lines up with the one above it. */
export function Num({ style, children, ...rest }: Props) {
  return (
    <Text
      {...rest}
      style={[{ fontFamily: FONT.medium, fontSize: 15, color: C.ink }, TABULAR, style as TextStyle]}>
      {children}
    </Text>
  );
}
