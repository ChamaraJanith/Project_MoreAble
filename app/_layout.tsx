import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, LogBox, StyleSheet, View, Platform } from 'react-native';
import { useAuthStore } from '../src/shared/store/authStore';

// Intercept and silence expo-notifications warning on Android Expo Go to prevent both RedBox and Terminal console pollution
if (Platform.OS === 'android') {
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    if (args[0] && typeof args[0] === 'string' && (
      args[0].includes('expo-notifications: Android Push notifications') ||
      args[0].includes('Android Push notifications (remote notifications)')
    )) {
      return;
    }
    originalWarn(...args);
  };

  const originalError = console.error;
  console.error = (...args: any[]) => {
    if (args[0] && typeof args[0] === 'string' && (
      args[0].includes('expo-notifications: Android Push notifications') ||
      args[0].includes('Android Push notifications (remote notifications)')
    )) {
      return;
    }
    originalError(...args);
  };
}

// Ignore warnings matching the same signature in LogBox
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  'Android Push notifications (remote notifications) functionality',
]);

// Keep native splash screen visible while loading JS
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const { isAuthenticated, isHydrated, user, hydrate } = useAuthStore();

  useEffect(() => {
    // Hide native splash screen as soon as JS loads so custom splash screen displays spinner
    SplashScreen.hideAsync();

    // Hydrate auth state from secure storage
    hydrate();

    // 3 seconds timer for splash screen
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  // Auto-redirect based on auth state once both splash timer and hydration are complete
  useEffect(() => {
    if (!isReady || !isHydrated) return;

    if (isAuthenticated && user) {
      const targetRoute = user.role === 'ADMIN' ? '/(admin)' : '/(tabs)';
      router.replace(targetRoute);
    }
    // If not authenticated, the default initialRouteName "(auth)" will be shown
  }, [isReady, isHydrated, isAuthenticated, user]);

  if (!isReady) {
    return (
      <View style={styles.splashContainer}>
        <Image
          source={require('../assets/images/moreable-logo.jpg')}
          style={styles.logo}
          resizeMode="contain"
        />
        <ActivityIndicator size="large" color="#0a7ea4" style={styles.spinner} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }} initialRouteName="(auth)">
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(admin)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="vehicle-dashboard" />
      <Stack.Screen name="accessibility-profile" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 220,
    height: 220,
    marginBottom: 20,
  },
  spinner: {
    marginTop: 10,
  },
});