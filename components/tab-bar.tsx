import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { router } from 'expo-router';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  IconAvatar,
  IconEat,
  IconHome,
  IconPlus,
  IconProgress,
  IconTrain,
  type IconProps,
} from '@/components/icons';
import { Eyebrow } from '@/components/type';
import type { Framing } from '@/lib/log-framing';
import { C, SPACE } from '@/lib/theme';

// Home · Train · Eat · Progress · You, 84 high, stroke icons at 1.8, inactive `dim`
// (docs/design-system.md §Tokens). Written by hand rather than configured, because the
// floating `+` sits above it and the two have to agree about where the bar ends.

const ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  index: IconHome,
  train: IconTrain,
  eat: IconEat,
  progress: IconProgress,
};

const LABELS: Record<string, string> = {
  index: 'Home',
  train: 'Train',
  eat: 'Eat',
  progress: 'Progress',
};

/**
 * What the `+` opens on, per tab (lib/log-framing.ts). A tab about one thing is a door that
 * knows something, and the sheet should say it: pressing + while looking at what you ate
 * should not suggest a shoulder press (field report 2026-09-03).
 *
 * Home and Progress are deliberately absent. Home thinks in whole days and Progress in the
 * long view, so neither implies a register and both get the default — which is now three
 * examples wide rather than a workout.
 */
const TAB_FRAMING: Record<string, Framing> = {
  train: 'workout',
  eat: 'food',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const framing = TAB_FRAMING[state.routes[state.index]?.name ?? ''];
  return (
    <View style={{ overflow: 'visible' }}>
      {/* The `+` lives inside the tab bar's tree: the tab scenes are native views that can
          cover siblings rendered after the navigator, which made a screen-level FAB
          invisible on iOS. The navigator always draws the tab bar above the scenes. */}
      <LogFab
        onPress={() =>
          router.push(framing ? { pathname: '/log', params: { framing } } : { pathname: '/log' })
        }
      />
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

/**
 * The 64px `+`: `ink` on `bg`, bottom-right, opens the Log sheet.
 *
 * `style` places it. Left out, it sits above the tab bar it is rendered inside — which is
 * where it is on the four tabs. A screen with no tab bar (the You page) renders its own and
 * says where: there is nothing above it to hang from.
 */
export function LogFab({ onPress, style }: { onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      testID="log-fab"
      accessibilityRole="button"
      accessibilityLabel="Log something"
      onPress={onPress}
      style={[
        {
          position: 'absolute',
          right: SPACE.screen,
          zIndex: 10,
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: C.ink,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 1,
        },
        style ?? { top: -(64 + 18) },
      ]}>
      <IconPlus size={28} color={C.bg} strokeWidth={2.2} />
    </Pressable>
  );
}
