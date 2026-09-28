let didWarn = false;

export const warnOfExpoGoPushUsage = () => {
  if (!didWarn && typeof __DEV__ !== 'undefined' && __DEV__) {
    didWarn = true;
    console.warn(
      '[expo-notifications] Remote push notifications are disabled in Expo Go on Android. Use a development build for remote push functionality.'
    );
  }
};

export default { warnOfExpoGoPushUsage };
