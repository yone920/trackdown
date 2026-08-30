import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconDays, IconGoals, IconPlus, IconProgress, IconToday, type IconProps } from '@/components/icons';
import { Eyebrow } from '@/components/type';
import { C, RADIUS, SPACE } from '@/lib/theme';

// Today · Days · Progress · Goals, 84 high, stroke icons at 1.8, inactive `dim`
// (docs/design-system.md §Tokens). Written by hand rather than configured, because the
// floating `+` sits above it and the two have to agree about where the bar ends.

const ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  index: IconToday,
  days: IconDays,
  progress: IconProgress,
  goals: IconGoals,
};

const LABELS: Record<string, string> = {
  index: 'Today',
  days: 'Days',
  progress: 'Progress',
  goals: 'Goals',
};

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
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
    </View>
  );
}

/** The 64px `+`: `ink` on `bg`, bottom-right above the tab bar, opens the Log sheet. */
export function LogFab({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      testID="log-fab"
      accessibilityRole="button"
      accessibilityLabel="Log something"
      onPress={onPress}
      style={({ pressed }) => ({
        position: 'absolute',
        right: SPACE.screen,
        bottom: SPACE.tabBar + insets.bottom + 18,
        width: 64,
        height: 64,
        borderRadius: RADIUS.pill,
        backgroundColor: C.ink,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.85 : 1,
      })}>
      <IconPlus size={28} color={C.bg} strokeWidth={2.2} />
    </Pressable>
  );
}
