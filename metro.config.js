const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Custom resolver to redirect packages using ESM `import.meta` (such as zustand) to their CommonJS versions
const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'zustand' || moduleName.startsWith('zustand/')) {
    return {
      filePath: require.resolve(moduleName),
      type: 'sourceFile',
    };
  }

  // Intercept expo-notifications warnOfExpoGoPushUsage to prevent fatal module-level crash on Android Expo Go
  if (
    moduleName === './warnOfExpoGoPushUsage' ||
    moduleName.endsWith('/warnOfExpoGoPushUsage') ||
    moduleName === 'expo-notifications/build/warnOfExpoGoPushUsage'
  ) {
    return {
      filePath: path.resolve(__dirname, 'src/shared/shims/warnOfExpoGoPushUsage.js'),
      type: 'sourceFile',
    };
  }

  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
