import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  IconAvatar,
  IconEat,
  IconHome,
  IconPlus,
  IconProgress,
  IconToday,
  type IconProps,
} from '@/components/icons';
import { Eyebrow } from '@/components/type';
import { C, SPACE } from '@/lib/theme';

// Home · Today · Eat · Progress · You, 84 high, stroke icons at 1.8, inactive `dim`
// (docs/design-system.md §Tokens). Written by hand rather than configured, because the
// floating `+` sits above it and the two have to agree about where the bar ends.

const ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  index: IconHome,
  today: IconToday,
  eat: IconEat,
  progress: IconProgress,
};

const LABELS: Record<string, string> = {
  index: 'Home',
  today: 'Today',
  eat: 'Eat',
  progress: 'Progress',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ overflow: 'visible' }}>
      {/* The `+` lives inside the tab bar's tree: the tab scenes are native views that can
          cover siblings rendered after the navigator, which made a screen-level FAB
          invisible on iOS. The navigator always draws the tab bar above the scenes. */}
      <LogFab onPress={() => router.push('/log')} />
    <View
      style={{
        flexDirection: 'row',
        height: SPACE.tabBar + insets.bottom,
        paddingBottom: insets.bottom,
        paddingTop: 14,
        backgroundColor: C.bg,
        borderTopWidth: 1,
        borderTopColor: C.line,
      }}>
      {state.routes.map((route, index) => {
        const Icon = ICONS[route.name];
        if (!Icon) return null;
        const focused = state.index === index;
        const color = focused ? C.ink : C.dim;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            testID={`tab-${route.name}`}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={{ flex: 1, alignItems: 'center', gap: 5 }}>
            <Icon size={22} color={color} />
            <Eyebrow style={{ color, fontSize: 10, letterSpacing: 1.2 }}>{LABELS[route.name]}</Eyebrow>
          </Pressable>
        );
      })}
      {/* You is a stack screen rather than a tab (app/you.tsx): it is one screen deep from
          two places — this button and the avatar on Today — and nothing about it wants a
          tab's own navigation stack. The bar still reads Today · Days · Progress · You. */}
      <Pressable
        accessibilityRole="button"
        testID="tab-you"
        onPress={() => router.push('/you')}
        style={{ flex: 1, alignItems: 'center', gap: 5 }}>
        <IconAvatar size={22} color={C.dim} />
        <Eyebrow style={{ color: C.dim, fontSize: 10, letterSpacing: 1.2 }}>You</Eyebrow>
      </Pressable>
    </View>
    </View>
  );
}

/** The 64px `+`: `ink` on `bg`, bottom-right above the tab bar, opens the Log sheet. */
export function LogFab({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      testID="log-fab"
      accessibilityRole="button"
      accessibilityLabel="Log something"
      onPress={onPress}
      style={({
        position: 'absolute',
        right: SPACE.screen,
        top: -(64 + 18),
        zIndex: 10,
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: C.ink,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 1,
      })}>
      <IconPlus size={28} color={C.bg} strokeWidth={2.2} />
    </Pressable>
  );
}
