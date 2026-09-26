// Notification Entity Models and Types

export type NotificationType =
    | 'BOOKING_CONFIRMATION'
    | 'BOARDING_REMINDER'
    | 'VEHICLE_ARRIVAL'
    | 'BOARDING_CONFIRMED'
    | 'CAREGIVER_JOURNEY_UPDATE'
    | 'EMERGENCY_SOS'
    | 'SYSTEM_ALERT';

export type NotificationStatus = 'UNREAD' | 'READ';

export type NotificationPriority = 'default' | 'normal' | 'high' | 'max';

export interface BookingNotificationDetails {
    bookingId?: string;
    vehicleNumber?: string;
    routeNumber?: string;
    routeName?: string;
    seatNumber?: string;
    journeyDate?: string;
    journeyTime?: string;
    startLocation?: string;
    endLocation?: string;
    passengerName?: string;
    boardedAt?: string;
    etaMinutes?: number;
    sosTriggeredAt?: string;
    guardianName?: string;
    latitude?: number;
    longitude?: number;
}

export interface Notification {
    id: string;
    notificationId: string;
    userId: string;
    bookingId?: string;
    type: NotificationType;
    title: string;
    message: string;
    status: NotificationStatus;
    createdAt: string;
    readAt?: string | null;
    details?: BookingNotificationDetails;
}

export interface DevicePushToken {
    userId: string;
    pushToken: string;
    devicePlatform: 'ios' | 'android' | 'web';
    deviceModel?: string;
    appVersion?: string;
    notificationsEnabled: boolean;
    registeredAt: string;
    lastActiveAt: string;
}

export interface PushNotificationPayload {
    to: string | string[];
    title: string;
    body: string;
    data?: Record<string, any>;
    sound?: 'default' | string | null;
    priority?: NotificationPriority;
    channelId?: 'vehicle-arrival' | 'boarding-alerts' | 'caregiver-alerts' | 'sos-emergency' | 'general-alerts';
    badge?: number;
    ttl?: number;
}

export interface PushDeliveryResult {
    success: boolean;
    status: 'ok' | 'error' | 'skipped';
    recipientCount: number;
    ticketIds?: string[];
    errorMessage?: string;
    reason?: string;
}

/**
 * Passenger Notification Preferences (MOV-24 / MOV-240)
 * Allows passengers to granularly configure which notification types they receive.
 * Rule: emergencyAlerts is ALWAYS true and cannot be disabled.
 */
export interface NotificationPreferences {
    /** Booking confirmation, receipt, and payment status updates */
    bookingAlerts: boolean;
    /** 15-minute boarding reminders and departure calls */
    boardingReminders: boolean;
    /** Bus approaching / ETA / arrival alerts at pickup halt */
    arrivalAlerts: boolean;
    /** Approaching drop-off destination alerts */
    destinationReminders: boolean;
    /** Caregiver journey updates and safety synchronization */
    caregiverUpdates: boolean;
    /** Emergency SOS alerts (CRITICAL: Always true, cannot be disabled) */
    emergencyAlerts: boolean;
    /** Master push notification channel switch */
    pushEnabled?: boolean;
    /** Multi-channel Email notifications */
    emailAlerts?: boolean;
    /** Multi-channel SMS text alerts */
    smsAlerts?: boolean;
    /** Timestamp when preferences were last updated */
    updatedAt?: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
    bookingAlerts: true,
    boardingReminders: true,
    arrivalAlerts: true,
    destinationReminders: true,
    caregiverUpdates: true,
    emergencyAlerts: true,
    pushEnabled: true,
    emailAlerts: true,
    smsAlerts: true,
};

export function normalizeNotificationPreferences(
    input?: Partial<NotificationPreferences> | null
): NotificationPreferences {
    return {
        bookingAlerts: input?.bookingAlerts ?? DEFAULT_NOTIFICATION_PREFERENCES.bookingAlerts,
        boardingReminders: input?.boardingReminders ?? DEFAULT_NOTIFICATION_PREFERENCES.boardingReminders,
        arrivalAlerts: input?.arrivalAlerts ?? DEFAULT_NOTIFICATION_PREFERENCES.arrivalAlerts,
        destinationReminders: input?.destinationReminders ?? DEFAULT_NOTIFICATION_PREFERENCES.destinationReminders,
        caregiverUpdates: input?.caregiverUpdates ?? DEFAULT_NOTIFICATION_PREFERENCES.caregiverUpdates,
        emergencyAlerts: true, // STRICT ENTERPRISE RULE: Emergency alerts cannot be disabled
        pushEnabled: input?.pushEnabled ?? DEFAULT_NOTIFICATION_PREFERENCES.pushEnabled,
        emailAlerts: input?.emailAlerts ?? DEFAULT_NOTIFICATION_PREFERENCES.emailAlerts,
        smsAlerts: input?.smsAlerts ?? DEFAULT_NOTIFICATION_PREFERENCES.smsAlerts,
        updatedAt: input?.updatedAt || new Date().toISOString(),
    };
}
