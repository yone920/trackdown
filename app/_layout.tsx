import {
  Fraunces_300Light,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  useFonts,
} from '@expo-google-fonts/fraunces';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import 'react-native-reanimated';
import '../global.css';

import { useSession } from '@/lib/auth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 30, retry: 1 },
  },
});

const TrackdownTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#FAF7F2',
    card: '#FAF7F2',
    text: '#1A1714',
    border: '#E8E1D6',
    primary: '#B8623E',
  },
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Fraunces_300Light,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
  });
  const { session, loading } = useSession();

  if (!fontsLoaded || loading) {
    return <View style={{ flex: 1, backgroundColor: '#FAF7F2' }} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={TrackdownTheme}>
        <Stack>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="detail"
            options={{
              headerShown: false,
              contentStyle: { backgroundColor: '#FAF7F2' },
            }}
          />
          <Stack.Screen
            name="day"
            options={{
              headerShown: false,
              contentStyle: { backgroundColor: '#FAF7F2' },
            }}
          />
          <Stack.Screen
            name="weight"
            options={{
              headerShown: false,
              contentStyle: { backgroundColor: '#FAF7F2' },
            }}
          />
          <Stack.Screen
            name="eating"
            options={{
              headerShown: false,
              contentStyle: { backgroundColor: '#FAF7F2' },
            }}
          />
          <Stack.Screen
            name="movement"
            options={{
              headerShown: false,
              contentStyle: { backgroundColor: '#FAF7F2' },
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
        </Stack>
        <StatusBar style="dark" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
