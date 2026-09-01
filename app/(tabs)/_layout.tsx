import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { TabBar } from '@/components/tab-bar';
import { C } from '@/lib/theme';

export default function TabLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg } }}
        tabBar={(props) => <TabBar {...props} />}>
        {/* Home lands and is the only page that thinks in whole days; the rest each own
            one verb — Train the session, Eat the food, Progress the long view (user
            decision 2026-09-01). */}
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="train" options={{ title: 'Train' }} />
        {/* Eat is a tab and Days is not (user decision 2026-09-01): eating is the half of
            the day that had no page of its own, and the list of closed days is a section of
            Progress rather than a destination. Five tabs, not six. */}
        <Tabs.Screen name="eat" options={{ title: 'Eat' }} />
        <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
      </Tabs>
    </View>
  );
}
