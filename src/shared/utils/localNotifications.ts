import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Set notification handler so pop-down banner appears even when app is in foreground
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
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
        const routeName = booking.journey?.routeName;
        const routeDisplay = routeName && routeName !== '—' ? `${routeNo} (${routeName})` : routeNo;

        const title = `Booking Confirmed • Route ${routeNo} 🎟️`;
        const body = `Your reservation ${booking.bookingId} for Route ${routeDisplay} (Seat ${booking.seatNumber}) has been confirmed successfully.`;

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

export async function sendLocalBoardingReminderNotification(reminder: {
    bookingId: string;
    vehicleNumber: string;
    startLocation: string;
    departureTime: string;
    seatNumber: string;
    routeNumber?: string;
    routeName?: string;
    minutesRemaining?: number;
}) {
    if (Platform.OS === 'web') return;
    try {
        const hasPermission = await requestNotificationPermissions();
        if (!hasPermission) return;

        const mins = reminder.minutesRemaining || 15;
        const vehicle = reminder.vehicleNumber || 'Bus';
        const routeNo = reminder.routeNumber || '—';
        const routeName = reminder.routeName;
        const routeDisplay = routeName && routeName !== '—' ? `${routeNo} (${routeName})` : routeNo;

        const title = `Boarding Reminder • Route ${routeNo} 🚌`;
        const body = `Bus ${vehicle} for Route ${routeDisplay} will depart in ${mins} minute${mins === 1 ? '' : 's'}. Please proceed to ${reminder.startLocation} to board your bus (Seat ${reminder.seatNumber}).`;

        await Notifications.scheduleNotificationAsync({
            content: {
                title,
                body,
                sound: 'default',
                data: { bookingId: reminder.bookingId, type: 'BOARDING_REMINDER' },
            },
            trigger: null,
        });
    } catch (error) {
        console.error('Failed to trigger local boarding reminder notification:', error);
    }
}

function parseTimeHelper(journeyDate?: string, timeStr?: string): Date | null {
    if (!timeStr) return null;
    if (timeStr.includes('T') && !isNaN(Date.parse(timeStr))) return new Date(timeStr);

    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!timeMatch) return null;

    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const period = timeMatch[3] ? timeMatch[3].toUpperCase() : null;

    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    let year: number, month: number, day: number;
    if (journeyDate && /^\d{4}-\d{2}-\d{2}$/.test(journeyDate)) {
        const parts = journeyDate.split('-').map(Number);
        year = parts[0];
        month = parts[1] - 1;
        day = parts[2];
    } else {
        const today = new Date();
        year = today.getFullYear();
        month = today.getMonth();
        day = today.getDate();
    }
    return new Date(year, month, day, hours, minutes, 0, 0);
}

export async function scheduleLocalBoardingReminder(booking: {
    bookingId: string;
    seatNumber: string;
    journey?: {
        routeNumber?: string;
        routeName?: string;
        startLocation?: string;
        journeyDate?: string;
        departureTime?: string;
    };
    vehicle?: {
        numberPlate?: string;
    };
}) {
    if (Platform.OS === 'web') return;
    try {
        const hasPermission = await requestNotificationPermissions();
        if (!hasPermission) return;

        const departureStr = booking.journey?.departureTime;
        const journeyDateStr = booking.journey?.journeyDate;
        const depDate = parseTimeHelper(journeyDateStr, departureStr);

        if (!depDate) return;

        const now = new Date();
        const reminderTime = new Date(depDate.getTime() - 15 * 60 * 1000);
        const diffMsFromNow = reminderTime.getTime() - now.getTime();

        const routeNo = booking.journey?.routeNumber || '—';
        const routeName = booking.journey?.routeName;
        const routeDisplay = routeName && routeName !== '—' ? `${routeNo} (${routeName})` : routeNo;
        const vehicle = booking.vehicle?.numberPlate || 'Bus';
        const startLoc = booking.journey?.startLocation || 'Boarding Point';
        const seatNo = booking.seatNumber || '—';

        const title = `Boarding Reminder • Route ${routeNo} 🚌`;

        if (diffMsFromNow > 0) {
            const secondsFromNow = Math.max(1, Math.floor(diffMsFromNow / 1000));
            const body = `Bus ${vehicle} for Route ${routeDisplay} will depart in 15 minutes. Please proceed to ${startLoc} to board your bus (Seat ${seatNo}).`;

            await Notifications.scheduleNotificationAsync({
                content: {
                    title,
                    body,
                    sound: 'default',
                    data: { bookingId: booking.bookingId, type: 'BOARDING_REMINDER' },
                },
                trigger: {
                    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
                    seconds: secondsFromNow,
                },
            });
        } else {
            const minutesRemaining = Math.max(1, Math.round((depDate.getTime() - now.getTime()) / (1000 * 60)));
            if (minutesRemaining > 0 && minutesRemaining <= 15) {
                const body = `Bus ${vehicle} for Route ${routeDisplay} will depart in ${minutesRemaining} minute${minutesRemaining === 1 ? '' : 's'}. Please proceed to ${startLoc} to board your bus (Seat ${seatNo}).`;
                await Notifications.scheduleNotificationAsync({
                    content: {
                        title,
                        body,
                        sound: 'default',
                        data: { bookingId: booking.bookingId, type: 'BOARDING_REMINDER' },
                    },
                    trigger: null,
                });
            }
        }
    } catch (error) {
        console.error('Failed to schedule local boarding reminder:', error);
    }
}


