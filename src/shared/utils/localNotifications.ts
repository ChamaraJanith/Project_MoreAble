import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Set notification handler so pop-down banner appears even when app is in foreground
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
    }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
    if (Platform.OS === 'web') return false;
    try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }
        return finalStatus === 'granted';
    } catch (error) {
        console.error('Error requesting notification permission:', error);
        return false;
    }
}

export async function sendLocalBookingNotification(booking: {
    bookingId: string;
    seatNumber: string;
    journey?: {
        routeNumber?: string;
        routeName?: string;
    };
}) {
    if (Platform.OS === 'web') return;
    try {
        const hasPermission = await requestNotificationPermissions();
        if (!hasPermission) return;

        const routeNo = booking.journey?.routeNumber || '—';
        const title = 'Booking Confirmed! 🎟️';
        const body = `Your reservation ${booking.bookingId} for Route ${routeNo} (Seat ${booking.seatNumber}) has been confirmed successfully.`;

        await Notifications.scheduleNotificationAsync({
            content: {
                title,
                body,
                sound: 'default',
                data: { bookingId: booking.bookingId },
            },
            trigger: null, // Immediately trigger device notification banner
        });
    } catch (error) {
        console.error('Failed to trigger local device notification:', error);
    }
}
