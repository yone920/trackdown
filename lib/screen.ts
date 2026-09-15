import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { EdgeInsets } from 'react-native-safe-area-context';

// The top of a screen.
//
// Nothing in this app draws a navigation header: `app/_layout.tsx` and
// `app/(tabs)/_layout.tsx` both set `headerShown: false`, and the tab bar is at the
// bottom. So every screen is full-bleed from the very top of the display, and every
// screen is responsible for keeping its own eyebrow out from under the clock. The whole
// convention is `paddingTop: insets.top + <a little>` on the scroller the screen is
// built in.
//
// `useSafeAreaInsets` is the answer wherever the platform has one to give. This hook
// exists for the case where it does not:
//
//   * before the provider has measured, `insets.top` is 0 for a frame or two;
//   * a host that reports nothing (a web build with no `viewport-fit=cover`, a preview
//     surface) reports 0 for good.
//
// A zero there means the first line of the screen is drawn *at* y=0, under the status
// bar — the field report was "1 ACTIVE" sitting beside the clock on Goals. There is no
// iOS device whose full-screen top inset is genuinely below the classic 20 pt status
// bar, so a floor costs nothing on a real phone and makes that collision impossible.
//
// Only `top` is floored. A device with no home indicator really does have a zero bottom
// inset, and the tab bar (components/tab-bar.tsx) needs that zero to sit flush.

/** The pre-notch iOS status bar. Nothing may be drawn above this line. */
export const STATUS_BAR_MIN = 20;

/**
 * The safe-area insets a screen should lay itself out against: the real ones, with the
 * top floored so a header can never land under the status bar.
 */
export function useScreenInsets(): EdgeInsets {
  const insets = useSafeAreaInsets();
  return insets.top >= STATUS_BAR_MIN ? insets : { ...insets, top: STATUS_BAR_MIN };
}
