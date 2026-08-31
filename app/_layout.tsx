// Imported one weight at a time rather than from the package root: the root re-exports
// every weight, and Metro then bundles about 2 MB of italics nothing renders.
import { Barlow_400Regular } from '@expo-google-fonts/barlow/400Regular';
import { Barlow_500Medium } from '@expo-google-fonts/barlow/500Medium';
import { Barlow_600SemiBold } from '@expo-google-fonts/barlow/600SemiBold';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import 'react-native-reanimated';
import '../global.css';

import { useSession } from '@/lib/auth';
import { C } from '@/lib/theme';

// Direction A (docs/design-system.md): dark everywhere, Barlow for text and Barlow
// Condensed for display. The cream/Fraunces theme of v1 is gone.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 30, retry: 1 },
  },
});

const TrackdownTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: C.bg,
    card: C.card,
    text: C.ink,
    border: C.line,
    primary: C.accent,
  },
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
  });
  const { session, loading } = useSession();

  if (!fontsLoaded || loading) {
    return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={TrackdownTheme}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }}>
          <Stack.Protected guard={!!session}>
            <Stack.Screen name="(tabs)" />
            {/* The Log sheet is a modal from the `+` and from the Right now chips. */}
            <Stack.Screen name="log" options={{ presentation: 'modal' }} />
            <Stack.Screen name="coach" />
            {/* A day and, one tap further in, the rows it was built from. */}
            <Stack.Screen name="day/[date]" />
            <Stack.Screen name="day/[date]/log" />
            {/* Any exercise name, anywhere, opens this. */}
            <Stack.Screen name="exercise/[id]" />
          </Stack.Protected>
          <Stack.Protected guard={!session}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
        <StatusBar style="light" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
