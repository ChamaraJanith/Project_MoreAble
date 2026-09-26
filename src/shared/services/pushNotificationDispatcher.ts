import { getAdminDb } from '../config/firebaseAdmin';
import {
    PushNotificationPayload,
    PushDeliveryResult,
    NotificationPriority,
    NotificationPreferences,
    DEFAULT_NOTIFICATION_PREFERENCES,
    normalizeNotificationPreferences,
} from '../../entities/notification/model/types';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/**
 * Retrieves the user's notification preferences from Firestore.
 * Always returns normalized preferences with emergencyAlerts: true.
 */
export async function getUserNotificationPreferences(userId: string): Promise<NotificationPreferences> {
    if (!userId || userId === 'GUEST') return DEFAULT_NOTIFICATION_PREFERENCES;
    try {
        const adminDb = getAdminDb();
        const trimmed = userId.trim();

        // 1. Try dedicated notification_preferences collection
        const prefDoc = await adminDb.collection('notification_preferences').doc(trimmed).get();
        if (prefDoc.exists) {
            return normalizeNotificationPreferences(prefDoc.data());
        }

        // 2. Try users collection doc
        const userDoc = await adminDb.collection('users').doc(trimmed).get();
        if (userDoc.exists && userDoc.data()?.notificationPreferences) {
            return normalizeNotificationPreferences(userDoc.data()?.notificationPreferences);
        }

        // 3. Try users collection by passengerId
        const pQuery = await adminDb.collection('users').where('passengerId', '==', trimmed).limit(1).get();
        if (!pQuery.empty && pQuery.docs[0].data()?.notificationPreferences) {
            return normalizeNotificationPreferences(pQuery.docs[0].data()?.notificationPreferences);
        }
    } catch (err) {
        console.warn(`[PushDispatcher] Error fetching preferences for ${userId}:`, err);
    }
    return DEFAULT_NOTIFICATION_PREFERENCES;
}

/**
 * Validates whether a token string is a valid Expo Push Token format.
 */
export function isExpoPushToken(token: string | null | undefined): boolean {
    if (!token || typeof token !== 'string') return false;
    const trimmed = token.trim();
    return (
        (trimmed.startsWith('ExponentPushToken[') || trimmed.startsWith('ExpoPushToken[')) &&
        trimmed.endsWith(']')
    );
}

/**
 * Dispatches an array of push messages to the Expo Push Gateway.
 */
export async function sendExpoPushBatch(
    messages: PushNotificationPayload[]
): Promise<PushDeliveryResult> {
    if (!messages || messages.length === 0) {
        return {
            success: true,
            status: 'skipped',
            recipientCount: 0,
            errorMessage: 'No messages to dispatch.',
        };
    }

    // Filter valid tokens
    const validMessages: PushNotificationPayload[] = [];
    messages.forEach((msg) => {
        const recipients = Array.isArray(msg.to) ? msg.to : [msg.to];
        const validRecipients = recipients.filter(isExpoPushToken);
        if (validRecipients.length > 0) {
            validMessages.push({
                ...msg,
                to: validRecipients.length === 1 ? validRecipients[0] : validRecipients,
            });
        }
    });

    if (validMessages.length === 0) {
        return {
            success: false,
            status: 'skipped',
            recipientCount: 0,
            errorMessage: 'No valid Expo Push Tokens found in recipient list.',
        };
    }

    try {
        const response = await fetch(EXPO_PUSH_ENDPOINT, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Accept-Encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(validMessages),
        });

        const data = await response.json();
        const ticketIds: string[] = [];

        if (data && Array.isArray(data.data)) {
            data.data.forEach((ticket: any) => {
                if (ticket.status === 'ok' && ticket.id) {
                    ticketIds.push(ticket.id);
                } else if (ticket.status === 'error') {
                    console.warn(`[PushDispatcher] Ticket error: ${ticket.message} (${ticket.details?.error})`);
                }
            });
        }

        return {
            success: true,
            status: 'ok',
            recipientCount: validMessages.length,
            ticketIds,
        };
    } catch (error: any) {
        console.error('[PushDispatcher] Network error sending push notifications:', error);
        return {
            success: false,
            status: 'error',
            recipientCount: 0,
            errorMessage: error?.message || 'Unknown network error',
        };
    }
}

/**
 * Retrieves all valid push tokens associated with a given userId from Firestore.
 */
export async function getUserPushTokens(userId: string): Promise<string[]> {
    if (!userId || userId === 'GUEST') return [];

    const tokens = new Set<string>();
    try {
        const adminDb = getAdminDb();

        // 1. Direct query on users collection
        const userDoc = await adminDb.collection('users').doc(userId.trim()).get();
        if (userDoc.exists) {
            const uData = userDoc.data();
            if (uData?.pushToken && isExpoPushToken(uData.pushToken) && uData.pushNotificationsEnabled !== false) {
                tokens.add(uData.pushToken.trim());
            }
        } else {
            const pQuery = await adminDb.collection('users').where('passengerId', '==', userId.trim()).limit(1).get();
            if (!pQuery.empty) {
                const uData = pQuery.docs[0].data();
                if (uData?.pushToken && isExpoPushToken(uData.pushToken) && uData.pushNotificationsEnabled !== false) {
                    tokens.add(uData.pushToken.trim());
                }
            }
        }

        // 2. Query dedicated device_tokens collection
        const dSnap = await adminDb.collection('device_tokens').where('userId', '==', userId.trim()).get();
        dSnap.forEach((doc: any) => {
            const data = doc.data();
            if (data?.pushToken && isExpoPushToken(data.pushToken) && data.notificationsEnabled !== false) {
                tokens.add(data.pushToken.trim());
            }
        });
    } catch (err) {
        console.warn(`[PushDispatcher] Error fetching tokens for user ${userId}:`, err);
    }

    return Array.from(tokens);
}

/**
 * Sends a push notification to a specific user by querying their registered device tokens.
 */
export async function sendPushNotificationToUser(
    userId: string,
    payload: {
        title: string;
        body: string;
        data?: Record<string, any>;
        priority?: NotificationPriority;
        channelId?: 'vehicle-arrival' | 'boarding-alerts' | 'caregiver-alerts' | 'sos-emergency' | 'general-alerts';
        sound?: 'default' | string | null;
        badge?: number;
    }
): Promise<PushDeliveryResult> {
    const tokens = await getUserPushTokens(userId);
    if (tokens.length === 0) {
        return {
            success: false,
            status: 'skipped',
            recipientCount: 0,
            errorMessage: `No active push token registered for user: ${userId}`,
        };
    }

    const messages: PushNotificationPayload[] = tokens.map((token) => ({
        to: token,
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        priority: payload.priority || 'high',
        channelId: payload.channelId || 'general-alerts',
        sound: payload.sound || 'default',
        badge: payload.badge,
    }));

    return sendExpoPushBatch(messages);
}

/**
 * Sends a push notification to multiple users simultaneously.
 */
export async function sendPushNotificationToMultipleUsers(
    userIds: string[],
    payload: {
        title: string;
        body: string;
        data?: Record<string, any>;
        priority?: NotificationPriority;
        channelId?: 'vehicle-arrival' | 'boarding-alerts' | 'caregiver-alerts' | 'sos-emergency' | 'general-alerts';
        sound?: 'default' | string | null;
        badge?: number;
    }
): Promise<PushDeliveryResult> {
    if (!userIds || userIds.length === 0) {
        return { success: true, status: 'skipped', recipientCount: 0 };
    }

    const tokenPromises = userIds.map((uid) => getUserPushTokens(uid));
    const tokenArrays = await Promise.all(tokenPromises);
    const uniqueTokens = Array.from(new Set(tokenArrays.flat()));

    if (uniqueTokens.length === 0) {
        return {
            success: false,
            status: 'skipped',
            recipientCount: 0,
            errorMessage: 'No registered push tokens found for provided users.',
        };
    }

    const messages: PushNotificationPayload[] = uniqueTokens.map((token) => ({
        to: token,
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        priority: payload.priority || 'high',
        channelId: payload.channelId || 'general-alerts',
        sound: payload.sound || 'default',
        badge: payload.badge,
    }));

    return sendExpoPushBatch(messages);
}

/**
 * [MOV-218 Integration] Dispatch Vehicle Arrival Alert to Passenger
 */
export async function dispatchVehicleArrivalAlert(
    userId: string,
    data: {
        vehicleNumber: string;
        routeNumber: string;
        routeName?: string;
        arrivalHalt: string;
        etaMinutes: number;
        bookingId?: string;
    }
): Promise<PushDeliveryResult> {
    const prefs = await getUserNotificationPreferences(userId);
    if (prefs.arrivalAlerts === false || prefs.pushEnabled === false) {
        return {
            success: true,
            status: 'skipped',
            recipientCount: 0,
            reason: 'ARRIVAL_ALERTS_DISABLED_BY_USER_PREFERENCE',
        };
    }

    const routeDisplay = data.routeName ? `${data.routeNumber} (${data.routeName})` : data.routeNumber;
    const etaText = data.etaMinutes <= 1 ? 'is arriving now' : `will arrive in ~${data.etaMinutes} mins`;

    return sendPushNotificationToUser(userId, {
        title: `Bus Arriving • Route ${data.routeNumber} 🚍`,
        body: `Bus ${data.vehicleNumber} ${etaText} at ${data.arrivalHalt}. Please be ready at the boarding platform!`,
        priority: 'high',
        channelId: 'vehicle-arrival',
        sound: 'default',
        data: {
            type: 'VEHICLE_ARRIVAL',
            bookingId: data.bookingId,
            vehicleNumber: data.vehicleNumber,
            routeNumber: data.routeNumber,
            arrivalHalt: data.arrivalHalt,
            etaMinutes: data.etaMinutes,
            route: '/(tabs)/schedule',
        },
    });
}

/**
 * [MOV-277 / MOV-281 Integration] Dispatch Boarding Confirmation Alert
 */
export async function dispatchBoardingAlert(
    userId: string,
    data: {
        bookingId: string;
        vehicleNumber: string;
        routeNumber: string;
        seatNumber: string;
        dropOffHalt: string;
        passengerName?: string;
    }
): Promise<PushDeliveryResult> {
    const prefs = await getUserNotificationPreferences(userId);
    if (prefs.boardingReminders === false || prefs.pushEnabled === false) {
        return {
            success: true,
            status: 'skipped',
            recipientCount: 0,
            reason: 'BOARDING_REMINDERS_DISABLED_BY_USER_PREFERENCE',
        };
    }

    return sendPushNotificationToUser(userId, {
        title: `Boarding Confirmed • Seat ${data.seatNumber} 🎟️`,
        body: `Welcome aboard bus ${data.vehicleNumber} (Route ${data.routeNumber}). Your trip to ${data.dropOffHalt} has commenced!`,
        priority: 'high',
        channelId: 'boarding-alerts',
        sound: 'default',
        data: {
            type: 'BOARDING_CONFIRMED',
            bookingId: data.bookingId,
            vehicleNumber: data.vehicleNumber,
            seatNumber: data.seatNumber,
            dropOffHalt: data.dropOffHalt,
            route: '/(tabs)/ticket',
        },
    });
}

/**
 * [MOV-240 Integration] Dispatch Booking Confirmation Alert
 */
export async function dispatchBookingAlert(
    userId: string,
    data: {
        bookingId: string;
        routeNumber: string;
        seatNumber: string;
        origin: string;
        destination: string;
        fareAmount?: number;
    }
): Promise<PushDeliveryResult> {
    const prefs = await getUserNotificationPreferences(userId);
    if (prefs.bookingAlerts === false || prefs.pushEnabled === false) {
        return {
            success: true,
            status: 'skipped',
            recipientCount: 0,
            reason: 'BOOKING_ALERTS_DISABLED_BY_USER_PREFERENCE',
        };
    }

    return sendPushNotificationToUser(userId, {
        title: `Booking Confirmed #${data.bookingId} 🎫`,
        body: `Seat ${data.seatNumber} booked on Route ${data.routeNumber} (${data.origin} to ${data.destination}). Safe journey!`,
        priority: 'high',
        channelId: 'general-alerts',
        sound: 'default',
        data: {
            type: 'BOOKING_CONFIRMATION',
            bookingId: data.bookingId,
            seatNumber: data.seatNumber,
            route: '/(tabs)/ticket',
        },
    });
}

/**
 * Dispatch Destination Reminder Alert to Passenger
 */
export async function dispatchDestinationReminder(
    userId: string,
    data: {
        bookingId: string;
        destination: string;
        remainingStops?: number;
        estimatedArrivalTime?: string;
    }
): Promise<PushDeliveryResult> {
    const prefs = await getUserNotificationPreferences(userId);
    if (prefs.destinationReminders === false || prefs.pushEnabled === false) {
        return {
            success: true,
            status: 'skipped',
            recipientCount: 0,
            reason: 'DESTINATION_REMINDERS_DISABLED_BY_USER_PREFERENCE',
        };
    }

    const stopsText = data.remainingStops ? `${data.remainingStops} stops remaining.` : '';
    const etaText = data.estimatedArrivalTime ? ` ETA: ${data.estimatedArrivalTime}.` : '';

    return sendPushNotificationToUser(userId, {
        title: `Approaching Destination • ${data.destination} 📍`,
        body: `You are approaching your destination: ${data.destination}. ${stopsText}${etaText}`,
        priority: 'high',
        channelId: 'vehicle-arrival',
        sound: 'default',
        data: {
            type: 'DESTINATION_REMINDER',
            bookingId: data.bookingId,
            destination: data.destination,
            route: '/(tabs)/ticket',
        },
    });
}

/**
 * [MOV-227 Integration] Dispatch Caregiver Journey Tracking Alert
 */
export async function dispatchCaregiverJourneyAlert(
    guardianId: string,
    data: {
        passengerName: string;
        eventType: 'BOARDED' | 'ALIGHTED' | 'DELAYED' | 'NEAR_DESTINATION';
        vehicleNumber: string;
        locationName: string;
        bookingId?: string;
    }
): Promise<PushDeliveryResult> {
    const prefs = await getUserNotificationPreferences(guardianId);
    if (prefs.caregiverUpdates === false || prefs.pushEnabled === false) {
        return {
            success: true,
            status: 'skipped',
            recipientCount: 0,
            reason: 'CAREGIVER_UPDATES_DISABLED_BY_USER_PREFERENCE',
        };
    }

    let title = `Journey Update • ${data.passengerName} 🛡️`;
    let body = `${data.passengerName} has updated their journey status.`;

    if (data.eventType === 'BOARDED') {
        title = `Passenger Boarded • ${data.passengerName} 🚌`;
        body = `${data.passengerName} has safely boarded bus ${data.vehicleNumber} at ${data.locationName}.`;
    } else if (data.eventType === 'ALIGHTED') {
        title = `Trip Completed • ${data.passengerName} ✅`;
        body = `${data.passengerName} has safely reached destination ${data.locationName}.`;
    } else if (data.eventType === 'NEAR_DESTINATION') {
        title = `Arriving Soon • ${data.passengerName} 📍`;
        body = `Bus ${data.vehicleNumber} carrying ${data.passengerName} is approaching ${data.locationName}.`;
    }

    return sendPushNotificationToUser(guardianId, {
        title,
        body,
        priority: 'high',
        channelId: 'caregiver-alerts',
        sound: 'default',
        data: {
            type: 'CAREGIVER_JOURNEY_UPDATE',
            eventType: data.eventType,
            passengerName: data.passengerName,
            vehicleNumber: data.vehicleNumber,
            locationName: data.locationName,
            bookingId: data.bookingId,
            route: '/(tabs)',
        },
    });
}

/**
 * [MOV-236 Integration] Dispatch Emergency SOS Alert to Conductor, Driver & Caregivers
 */
export async function dispatchEmergencySOSAlert(
    targetUserIds: string[],
    data: {
        passengerName: string;
        passengerId: string;
        vehicleNumber?: string;
        routeNumber?: string;
        locationName?: string;
        latitude?: number;
        longitude?: number;
        contactPhone?: string;
    }
): Promise<PushDeliveryResult> {
    const locText = data.locationName ? ` near ${data.locationName}` : '';
    const busText = data.vehicleNumber ? ` on Bus ${data.vehicleNumber}` : '';

    return sendPushNotificationToMultipleUsers(targetUserIds, {
        title: `🚨 EMERGENCY SOS: ${data.passengerName}`,
        body: `URGENT: ${data.passengerName} has triggered an SOS alert${busText}${locText}. Immediate assistance required!`,
        priority: 'max',
        channelId: 'sos-emergency',
        sound: 'default',
        data: {
            type: 'EMERGENCY_SOS',
            passengerName: data.passengerName,
            passengerId: data.passengerId,
            vehicleNumber: data.vehicleNumber,
            routeNumber: data.routeNumber,
            latitude: data.latitude,
            longitude: data.longitude,
            contactPhone: data.contactPhone,
            triggeredAt: new Date().toISOString(),
            route: '/(admin)',
        },
    });
}
