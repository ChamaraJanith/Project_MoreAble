import { useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useAuthStore } from '../../../shared/store/authStore';
import { API_BASE_URL } from '../../../shared/api/config';

// Ensure global notification presentation handler is set
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
    }),
});

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
        console.warn('[usePushNotifications] Failed setting up Android channels:', err);
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
        if (Platform.OS === 'web') return false;

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
            console.warn('[usePushNotifications] Error requesting permissions:', error);
            return false;
        }
    }, []);

    /**
     * Fetch Expo Push Token and send to backend
     */
    const registerDeviceToken = useCallback(
        async (targetUserId: string) => {
            if (Platform.OS === 'web' || !targetUserId) return;

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
                    // Real device with EAS build will supply projectId automatically
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
                }).catch((syncErr) => {
                    console.warn('[usePushNotifications] Token backend sync warning:', syncErr);
                });
            } catch (error) {
                console.warn('[usePushNotifications] Registration error:', error);
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
