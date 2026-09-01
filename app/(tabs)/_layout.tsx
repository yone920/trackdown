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
        <Tabs.Screen name="index" options={{ title: 'Today' }} />
        {/* Plan sits second: it is the question the app is opened to answer, and it used
            to be a button at the bottom of Today (user decision 2026-09-01). */}
        <Tabs.Screen name="plan" options={{ title: 'Plan' }} />
        <Tabs.Screen name="days" options={{ title: 'Days' }} />
        <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
      </Tabs>
    </View>
  );
}
