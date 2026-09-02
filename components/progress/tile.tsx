import { Pressable, View, type ViewStyle } from 'react-native';

import { IconChevronRight } from '@/components/icons';
import { Eyebrow } from '@/components/type';
import { C, RADIUS } from '@/lib/theme';

// The shape every row of the scoreboard is made of (user decision 2026-09-02).
//
// A tile is a summary and a DOOR: it carries its section's most important computed fact and
// a chevron, and pressing it opens the screen that holds the rest. Deliberately not an
// accordion — a page that expands in place answers "what else is there" by pushing
// everything below it off the screen, which is the problem this page was rebuilt to fix.
//
// `RADIUS.tile` and 15 px of padding rather than the `Card`'s 20 and 18: seven of these
// stack on one phone screen, and the card built for a full-width section is too loose to do
// that. Ten pixels between them (`TILE_GAP`), 24 down each side (`SPACE.screen`).

/** The gap between two tiles. One number, so the rhythm can be changed in one place. */
export const TILE_GAP = 10;

export function Tile({
  onPress,
  accessibilityLabel,
  testID,
  style,
  children,
}: {
  /** Omitted for a tile with nowhere to go — an empty section is not a door. */
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  const body = (
    <View
      style={[
        {
          backgroundColor: C.card,
          borderRadius: RADIUS.tile,
          paddingVertical: 14,
          paddingHorizontal: 15,
        },
        style,
      ]}>
      {children}
    </View>
  );

  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ opacity: 1 })}>
      {body}
    </Pressable>
  );
}

/** The door mark at the right of a tile. Never the only affordance — the whole tile taps. */
export function Chevron({ color = C.dim }: { color?: string }) {
  return (
    <View style={{ paddingLeft: 10, alignSelf: 'center' }}>
      <IconChevronRight size={16} color={color} />
    </View>
  );
}

/**
 * The tile's first line: what this is, and — when there is one — a small thing on the right
 * that is not the chevron ("All days", a count).
 */
export function TileHead({
  eyebrow,
  tone = C.mute,
  right,
  testID,
}: {
  eyebrow: string;
  tone?: string;
  right?: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Eyebrow testID={testID} style={{ color: tone, flex: 1 }} numberOfLines={1}>
        {eyebrow}
      </Eyebrow>
      {right}
    </View>
  );
}
