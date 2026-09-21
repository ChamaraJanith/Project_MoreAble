import { LogBox, Platform } from 'react-native';

// Intercept and silence expo-notifications warning on Android Expo Go to prevent both RedBox and Terminal console pollution
if (Platform.OS === 'android') {
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    if (
      args[0] &&
      typeof args[0] === 'string' &&
      (args[0].includes('expo-notifications: Android Push notifications') ||
        args[0].includes('Android Push notifications (remote notifications)') ||
        args[0].includes('functionality provided by expo-notifications was removed'))
    ) {
      return;
    }
    originalWarn(...args);
  };

  const originalError = console.error;
  console.error = (...args: any[]) => {
    if (
      args[0] &&
      (typeof args[0] === 'string' || (args[0] instanceof Error && args[0].message)) &&
      (String(args[0]).includes('expo-notifications: Android Push notifications') ||
        String(args[0]).includes('Android Push notifications (remote notifications)') ||
        String(args[0]).includes('functionality provided by expo-notifications was removed'))
    ) {
      return;
    }
    originalError(...args);
  };
}

// Ignore warnings matching the same signature in LogBox
LogBox.ignoreLogs([
  'expo-notifications: Android Push notifications',
  'Android Push notifications (remote notifications) functionality',
  'functionality provided by expo-notifications was removed from Expo Go',
  'Route "./_layout.tsx" is missing the required default export',
  'Route "./vehicle-dashboard.tsx" is missing the required default export',
]);
