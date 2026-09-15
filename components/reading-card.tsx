import { View } from 'react-native';

import { Body, Eyebrow } from '@/components/type';
import { C, RADIUS, SPACE } from '@/lib/theme';

// "In short" / "Right now" — the one place in the app where a model writes the words
// (docs/concept-v2.md §Principles 4). The 3px left border says which day it is about:
// `good` while the day is live, `accent` once it is closed.

export function ReadingCard({
  eyebrow,
  text,
  live = true,
  children,
}: {
  eyebrow: string;
  text: string;
  live?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View
      style={{
        backgroundColor: C.card,
        borderRadius: RADIUS.card,
        padding: SPACE.card,
        borderLeftWidth: 3,
        borderLeftColor: live ? C.good : C.accent,
      }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <Body style={{ marginTop: 8, lineHeight: 15 * 1.55 }}>{text}</Body>
      {children ? <View style={{ marginTop: 14 }}>{children}</View> : null}
    </View>
  );
}
