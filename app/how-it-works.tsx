import { useRouter } from 'expo-router';
import { ScrollView, Pressable, View } from 'react-native';

import { IconChevronLeft } from '@/components/icons';
import { Body, Disp, Eyebrow, Sub } from '@/components/type';
import { HOW_IT_WORKS } from '@/lib/how-it-works';
import { useScreenInsets } from '@/lib/screen';
import { C, SPACE } from '@/lib/theme';

// What the app is doing, plainly (user request 2026-09-01). Static: a page to read, with
// nothing on it to press but the way back. The words live in lib/how-it-works.ts so that
// adding a rule is adding an entry.

export default function HowItWorks() {
  const router = useRouter();
  const insets = useScreenInsets();

  return (
    <ScrollView
      testID="how-it-works-scroll"
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{
        paddingHorizontal: SPACE.screen,
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 60,
      }}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/you'))}
        accessibilityLabel="Back"
        testID="how-it-works-back"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, alignSelf: 'flex-start' }}>
        <IconChevronLeft size={18} color={C.mute} />
        <Sub>Back</Sub>
      </Pressable>

      <Eyebrow style={{ marginTop: 6 }}>The workings</Eyebrow>
      <Disp size={30} style={{ marginTop: 6 }}>
        How it works
      </Disp>
      <Sub style={{ marginTop: 10, lineHeight: 20 }}>
        Every number here is one the app actually uses.
      </Sub>

      {HOW_IT_WORKS.map((section) => (
        <View key={section.title} style={{ marginTop: 28 }}>
          <Disp size={19} weight="semi">
            {section.title}
          </Disp>
          <Body style={{ marginTop: 8, lineHeight: 15 * 1.6, color: C.mute }}>{section.body}</Body>
        </View>
      ))}
    </ScrollView>
  );
}
