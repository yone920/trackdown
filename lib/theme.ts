// The same tokens as tailwind.config.js, as values. NativeWind classes cover layout and
// colour in JSX; svg fills, navigation themes and the odd computed style need the numbers,
// and two lists of hexes that can disagree is how a design system starts drifting.

export const C = {
  bg: '#121418',
  card: '#1C1F25',
  track: '#2A2E36',
  line: '#23262D',
  ink: '#F3F1EC',
  mute: '#8B8F98',
  dim: '#5C6069',
  accent: '#FF7A1A',
  good: '#3DD68C',
} as const;

export const FONT = {
  regular: 'Barlow_400Regular',
  medium: 'Barlow_500Medium',
  semi: 'Barlow_600SemiBold',
  disp: 'BarlowCondensed_700Bold',
  dispSemi: 'BarlowCondensed_600SemiBold',
} as const;

/** Numerals are always tabular, so a changing figure does not shuffle the line. */
export const TABULAR = { fontVariant: ['tabular-nums' as const] };

export const RADIUS = { card: 20, tile: 14, thumb: 10, pill: 26 } as const;
// `pill` is 26, not 999: on iOS (new architecture) a borderRadius larger than half the element's
// size stops the background from painting — the Read-it chip and the + button vanished. Circles
// use exactly half their size; pill buttons are ≥ 52 tall.

/** Screen padding 24, card padding 18, tab bar 84 (docs/design-system.md §Tokens). */
export const SPACE = { screen: 24, card: 18, tabBar: 84 } as const;
