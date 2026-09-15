import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

// The keyboard, and the one bug it caused: on the Log sheet the input hid behind it and
// nothing would scroll far enough to bring it back (field report, 2026-08-31).
//
// Two mechanisms exist and using both at once is the bug, not the fix — they each add the
// keyboard's height to the layout, so together they push the content up twice as far as
// the keyboard is tall:
//
//   * iOS: `automaticallyAdjustKeyboardInsets` on the ScrollView. UIKit measures the
//     keyboard against the WINDOW and adds it to the scroll view's own content inset, so
//     the content can always be scrolled clear of it and the first responder is scrolled
//     into view. It is the only one of the two that is right inside a modal presentation,
//     where the JS side cannot know the sheet's offset from the window and
//     `KeyboardAvoidingView`'s `keyboardVerticalOffset` is therefore a guess.
//   * Android: no such inset exists, so `KeyboardAvoidingView` (behavior "height") does
//     the work, and this hook's height is the extra bottom padding that guarantees the
//     content below the input can still be reached.
//
// So: `keyboardPadding` is what a screen adds to its scroll content, and it is zero on
// iOS *because the inset already did it*. Extracted here so the rule is one testable
// function rather than a platform check buried in a style object.

/** The keyboard's height while it is up, 0 while it is down. */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    // The "will" events fire with the animation rather than after it, so the padding
    // lands at the same time as the keyboard instead of a frame behind it. Android only
    // has the "did" pair.
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => setHeight(event.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

/**
 * How much bottom padding a scrolling screen needs so its content clears the keyboard.
 * Zero on iOS, where `automaticallyAdjustKeyboardInsets` has already inset the scroll
 * view by exactly this much: adding it again would scroll the content twice as far up as
 * the keyboard is tall, which is the same bug in the other direction.
 */
export function keyboardPadding(keyboardHeight: number, platform: string = Platform.OS): number {
  if (keyboardHeight <= 0) return 0;
  return platform === 'ios' ? 0 : keyboardHeight;
}

/**
 * The tallest a compose box may grow before it scrolls inside itself.
 *
 * A multiline `TextInput` with no cap grows with its text until the caret is under the
 * keyboard and nothing can bring it back — reported 2026-08-31 by a user who pasted a long
 * paragraph into the Log sheet. Capped, iOS scrolls the caret into view inside the input
 * itself, which is what every other compose box on the phone does.
 *
 * 42 % of the window, less the top inset: enough for a long log, never so much that the
 * box and the keyboard together are the whole screen.
 */
export function composeMaxHeight(windowHeight: number, topInset = 0): number {
  return Math.max(120, Math.round(windowHeight * 0.42) - topInset);
}

/**
 * How far the pinned action bar has to rise to sit on top of the keyboard.
 *
 * On iOS the scroll view's own inset moves the *content*, not a sibling below it, so the
 * footer is lifted explicitly. On Android the `KeyboardAvoidingView` has already shrunk the
 * whole container by the keyboard's height and lifting again would double it.
 */
export function footerLift(keyboardHeight: number, platform: string = Platform.OS): number {
  if (keyboardHeight <= 0) return 0;
  return platform === 'ios' ? keyboardHeight : 0;
}
