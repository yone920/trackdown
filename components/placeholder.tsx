import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Card } from '@/components/kit';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { C, SPACE } from '@/lib/theme';

// The screens WP6b builds. They are named, routed and reachable now so the navigation is
// real in the morning test; what they will contain is in docs/design-system.md.

export function Placeholder({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 12,
        paddingBottom: 140,
      }}>
      <Eyebrow>Coming in WP6b</Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        {title}
      </Disp>
      <Card style={{ marginTop: 18 }}>
        <Sub style={{ lineHeight: 19 }}>{note}</Sub>
      </Card>
      {children ? <View style={{ marginTop: 16 }}>{children}</View> : null}
    </ScrollView>
  );
}
