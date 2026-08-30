import { Tabs, useRouter } from 'expo-router';
import { View } from 'react-native';

import { LogFab, TabBar } from '@/components/tab-bar';
import { C } from '@/lib/theme';

export default function TabLayout() {
  const router = useRouter();
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
      {/* One `+` for the whole app: the log is the same sheet whatever you are logging. */}
      <LogFab onPress={() => router.push('/log')} />
    </View>
  );
}
