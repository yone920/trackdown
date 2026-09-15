import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View, type ViewProps } from 'react-native';

import { IconChevronLeft } from '@/components/icons';
import { dismissDeletes } from '@/components/kit';
import { Disp, Eyebrow, Sub } from '@/components/type';
import { useScreenInsets } from '@/lib/screen';
import { C, SPACE } from '@/lib/theme';

// The shell every room behind the scoreboard is built in.
//
// Six of them arrived at once when the Progress page became a page of doors, and they are
// all the same screen: a Back link, an eyebrow, a title, and whatever the section actually
// holds. Written once so a change to the way back is a change in one file — app/lifts.tsx
// had its own copy of this and the two were already drifting.

export function DetailScreen({
  eyebrow,
  title,
  testID,
  children,
  ...rest
}: {
  eyebrow?: string | null;
  title: string;
  testID?: string;
} & ViewProps) {
  const router = useRouter();
  const insets = useScreenInsets();

  return (
    <ScrollView
      testID={testID}
      style={{ flex: 1, backgroundColor: C.bg }}
      // A scroll is an answer of "no" to an armed Delete? (components/kit.tsx).
      onScrollBeginDrag={dismissDeletes}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}
      {...rest}>
      <Pressable
        testID={testID ? `${testID}-back` : 'detail-back'}
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/progress'))}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingVertical: 8,
          alignSelf: 'flex-start',
        }}>
        <IconChevronLeft size={18} color={C.mute} />
        <Sub>Back</Sub>
      </Pressable>

      {eyebrow ? <Eyebrow style={{ marginTop: 6 }}>{eyebrow}</Eyebrow> : null}
      <Disp size={30} style={{ marginTop: 6 }}>
        {title}
      </Disp>
      <View style={{ marginTop: 4 }}>{children}</View>
    </ScrollView>
  );
}
