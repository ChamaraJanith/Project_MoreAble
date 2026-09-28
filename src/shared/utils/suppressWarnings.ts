import { LogBox, Platform } from 'react-native';

// Intercept and silence expo-notifications warning on Android Expo Go to prevent both RedBox and Terminal console pollution
if (Platform.OS === 'android') {
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    try {
      const msg = args[0] != null ? String(args[0]?.message || args[0]) : '';
      if (
        msg.includes('expo-notifications: Android Push notifications') ||
        msg.includes('Android Push notifications (remote notifications)') ||
        msg.includes('functionality provided by expo-notifications was removed')
      ) {
        return;
      }
    } catch {}
    originalWarn(...args);
  };

  const originalError = console.error;
  console.error = (...args: any[]) => {
    try {
      const msg = args[0] != null ? String(args[0]?.message || args[0]) : '';
      if (
        msg.includes('expo-notifications: Android Push notifications') ||
        msg.includes('Android Push notifications (remote notifications)') ||
        msg.includes('functionality provided by expo-notifications was removed')
      ) {
        return;
      }
    } catch {}
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
