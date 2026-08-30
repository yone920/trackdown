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
        <Tabs.Screen name="days" options={{ title: 'Days' }} />
        <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
        <Tabs.Screen name="goals" options={{ title: 'Goals' }} />
      </Tabs>
    </View>
  );
}
