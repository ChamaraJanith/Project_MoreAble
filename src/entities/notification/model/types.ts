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
}
