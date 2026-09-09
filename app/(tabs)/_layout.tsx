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
            one verb — Train the session, Progress the long view (user decision 2026-09-01).
            Days is not a tab: the list of closed days is a section of Progress rather than
            a destination. */}
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="train" options={{ title: 'Train' }} />
        <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
      </Tabs>
    </View>
  );
}
