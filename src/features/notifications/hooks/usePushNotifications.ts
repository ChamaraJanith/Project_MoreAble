import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';
import { useAuthStore } from '../../../shared/store/authStore';
import { API_BASE_URL } from '../../../shared/api/config';
import { useNotificationPreferencesStore } from '../store/notificationPreferencesStore';
import { usePreferencesStore } from '../../../shared/store/preferencesStore';

// Safe check for Expo Go store client on Android
const isExpoGoOnAndroid =
    Platform.OS === 'android' &&
    (Constants?.appOwnership === 'expo' ||
        Constants?.executionEnvironment === (ExecutionEnvironment?.StoreClient || 'storeClient'));

// Ensure global notification presentation handler is set safely with preferences awareness
try {
    Notifications.setNotificationHandler({
        handleNotification: async (notification) => {
            try {
                const prefs = useNotificationPreferencesStore.getState().preferences;
                const data = (notification?.request?.content?.data || {}) as Record<string, any>;
                const notifType = String(data.type || '');
                const isEmergency =
                    notifType === 'EMERGENCY_SOS' ||
                    notifType === 'SOS_EMERGENCY' ||
                    Boolean(data.isEmergency);

                // Emergency SOS alerts must ALWAYS bypass filters and present full alert with sound
                if (isEmergency) {
                    return {
                        shouldShowBanner: true,
                        shouldShowList: true,
                        shouldPlaySound: true,
                        shouldSetBadge: true,
                    };
                }

                // Master push notifications toggle
                if (prefs?.pushEnabled === false) {
                    return {
                        shouldShowBanner: false,
                        shouldShowList: false,
                        shouldPlaySound: false,
                        shouldSetBadge: false,
                    };
                }

                // Granular category preference filters
                if (prefs?.bookingAlerts === false && (notifType === 'BOOKING_CONFIRMATION' || notifType === 'BOOKING')) {
                    return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
                }
                if (prefs?.boardingReminders === false && (notifType === 'BOARDING_REMINDER' || notifType === 'BOARDING_CONFIRMED' || notifType === 'PASSENGER_BOARDED')) {
                    return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
                }
                if (prefs?.arrivalAlerts === false && notifType === 'VEHICLE_ARRIVAL') {
                    return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
                }
                if (prefs?.destinationReminders === false && notifType === 'DESTINATION_REMINDER') {
                    return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
                }
                if (prefs?.caregiverUpdates === false && (notifType === 'CAREGIVER_JOURNEY_UPDATE' || notifType === 'CARE_PASSENGER_BOARDED' || notifType.startsWith('CAREGIVER'))) {
                    return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
                }

                const appPrefs = usePreferencesStore.getState().preferences;
                const soundOption = appPrefs?.notificationSound !== false;

                return {
                    shouldShowBanner: true,
                    shouldShowList: true,
                    shouldPlaySound: soundOption,
                    shouldSetBadge: true,
                };
            } catch {
                return {
                    shouldShowBanner: true,
                    shouldShowList: true,
                    shouldPlaySound: true,
                    shouldSetBadge: true,
                };
            }
        },
    });
} catch (handlerErr) {
    // Graceful fallback in Expo Go
}

/**
 * Configure high-priority notification channels on Android (Android 8.0+)
 */
export async function setupAndroidNotificationChannels(): Promise<void> {
    if (Platform.OS !== 'android') return;

    try {
        await Notifications.setNotificationChannelAsync('sos-emergency', {
            name: 'Emergency SOS Alerts',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 500, 200, 500, 200, 500],
            lightColor: '#EF4444',
            sound: 'default',
            bypassDnd: true,
            showBadge: true,
        });

        await Notifications.setNotificationChannelAsync('vehicle-arrival', {
            name: 'Vehicle Arrival Alerts',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#0066CC',
            sound: 'default',
            showBadge: true,
        });

        await Notifications.setNotificationChannelAsync('boarding-alerts', {
            name: 'Boarding & Ticket Alerts',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#059669',
            sound: 'default',
            showBadge: true,
        });

        await Notifications.setNotificationChannelAsync('caregiver-alerts', {
            name: 'Caregiver Journey Updates',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#8B5CF6',
            sound: 'default',
            showBadge: true,
        });

        await Notifications.setNotificationChannelAsync('general-alerts', {
            name: 'General Transit Updates',
            importance: Notifications.AndroidImportance.DEFAULT,
            showBadge: true,
        });
    } catch (err) {
        // Non-blocking in Expo Go
    }
}

/**
 * Hook to manage device push token registration, notification listeners, and deep-link routing.
 */
export function usePushNotifications() {
    const { user, isAuthenticated } = useAuthStore();
    const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
    const [permissionGranted, setPermissionGranted] = useState<boolean>(false);
    const [isRegistering, setIsRegistering] = useState<boolean>(false);

    const notificationListener = useRef<Notifications.EventSubscription | null>(null);
    const responseListener = useRef<Notifications.EventSubscription | null>(null);

    /**
     * Request notification permission from the OS
     */
    const requestPermissions = useCallback(async (): Promise<boolean> => {
        if (Platform.OS === 'web' || isExpoGoOnAndroid) return false;

        try {
            const { status: existingStatus } = await Notifications.getPermissionsAsync();
            let finalStatus = existingStatus;

            if (existingStatus !== 'granted') {
                const { status } = await Notifications.requestPermissionsAsync();
                finalStatus = status;
            }

            const granted = finalStatus === 'granted';
            setPermissionGranted(granted);
            return granted;
        } catch (error) {
            return false;
        }
    }, []);

    /**
     * Fetch Expo Push Token and send to backend
     */
    const registerDeviceToken = useCallback(
        async (targetUserId: string) => {
            if (Platform.OS === 'web' || !targetUserId || isExpoGoOnAndroid) return;

            try {
                setIsRegistering(true);
                await setupAndroidNotificationChannels();

                const hasPermission = await requestPermissions();
                if (!hasPermission) {
                    setIsRegistering(false);
                    return;
                }

                // Get Expo Push Token gracefully
                let tokenData: Notifications.ExpoPushToken | null = null;
                try {
                    tokenData = await Notifications.getExpoPushTokenAsync();
                } catch (tErr) {
                    // In development without EAS project ID or in Expo Go simulator, fallback quietly
                }

                if (!tokenData || !tokenData.data) {
                    setIsRegistering(false);
                    return;
                }

                const token = tokenData.data;
                setExpoPushToken(token);

                // Register with backend
                await fetch(`${API_BASE_URL}/api/notifications/register-token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: targetUserId,
                        pushToken: token,
                        devicePlatform: Platform.OS,
                        appVersion: '1.0.0',
                        notificationsEnabled: true,
                    }),
                }).catch(() => {});
            } catch (error) {
                // Non-blocking
            } finally {
                setIsRegistering(false);
            }
        },
        [requestPermissions]
    );

    // Initial setup on mount or auth change
    useEffect(() => {
        if (Platform.OS === 'web') return;

        setupAndroidNotificationChannels();

        if (isAuthenticated && user) {
            const effectiveUserId = user.uid || user.passengerId || (user as any).id;
            if (effectiveUserId) {
                registerDeviceToken(effectiveUserId);
            }
        }

        // Listener for foreground notifications
        notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
            // Optional: trigger state updates or badge changes
            console.log('[usePushNotifications] Foreground notification received:', notification.request.content.title);
        });

        // Listener for user tapping/clicking notification banner (Deep Linking)
        responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
            const data = response.notification.request.content.data;
            if (data && data.route && typeof data.route === 'string') {
                try {
                    router.push(data.route as any);
                } catch (navErr) {
                    console.warn('[usePushNotifications] Deep link navigation failed:', navErr);
                }
            } else if (data && data.type === 'BOARDING_CONFIRMED') {
                router.push('/(tabs)/ticket' as any);
            } else if (data && data.type === 'VEHICLE_ARRIVAL') {
                router.push('/(tabs)/schedule' as any);
            } else if (data && data.type === 'EMERGENCY_SOS') {
                router.push('/(admin)' as any);
            }
        });

        return () => {
            if (notificationListener.current) {
                notificationListener.current.remove();
            }
            if (responseListener.current) {
                responseListener.current.remove();
            }
        };
    }, [isAuthenticated, user, registerDeviceToken]);

    return {
        expoPushToken,
        permissionGranted,
        requestPermissions,
        registerDeviceToken,
        isRegistering,
    };
}
