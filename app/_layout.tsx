import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { MD3LightTheme as DefaultTheme, PaperProvider } from 'react-native-paper';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // Load custom fonts here if needed
  const [loaded] = useFonts({
    // 'CustomFont': require('../assets/fonts/CustomFont.ttf'),
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  // You can dynamically change the theme here based on user accessibility preferences 
  // fetched from the Zustand store (e.g., High Contrast Mode).
  const theme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: '#0052cc', // Define your app's main primary color here
      secondary: '#00c4b4',
    },
  };

  return (
    <PaperProvider theme={theme}>
      <Stack screenOptions={{ headerShown: false }}>
        {/* Authentication Flow (Login, Register) */}
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        
        {/* Main App Flow (Bottom Tabs) */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        
        {/* Fallback Screen (404) */}
        <Stack.Screen name="+not-found" options={{ title: 'Oops!' }} />
      </Stack>
    </PaperProvider>
  );
}