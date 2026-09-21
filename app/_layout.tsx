import '../src/shared/utils/suppressWarnings';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { useAuthStore } from '../src/shared/store/authStore';
import { usePreferencesStore } from '../src/shared/store/preferencesStore';
import { usePushNotifications } from '../src/features/notifications/hooks/usePushNotifications';
import { journeySharing } from '../src/features/driver/services/journeySharing';
import '../src/shared/i18n'; // Import i18n config

// Keep native splash screen visible while loading JS
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
  const { isAuthenticated, isHydrated, user, hydrate } = useAuthStore();
  const { hydrate: hydratePreferences } = usePreferencesStore();
  usePushNotifications();

  useEffect(() => {
    // Hide native splash screen as soon as JS loads so custom splash screen displays spinner
    SplashScreen.hideAsync();

    // Hydrate auth state and preferences from secure storage
    hydrate();
    hydratePreferences();

    // A bus journey started before the app was closed keeps sharing its
    // location, whoever is signed in (MOV-294). No-op on any other phone.
    journeySharing.restore().catch(() => {});

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
          source={require('../assets/images/moreable-logo.png')}
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