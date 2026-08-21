// Notification Entity Models and Types

export type NotificationType = 'BOOKING_CONFIRMATION';
export type NotificationStatus = 'UNREAD' | 'READ';

export interface BookingNotificationDetails {
    bookingId: string;
    vehicleNumber: string;
    routeNumber: string;
    routeName: string;
    seatNumber: string;
    journeyDate: string;
    journeyTime: string;
    startLocation: string;
    endLocation: string;
}

export interface Notification {
    id: string;
    notificationId: string;
    userId: string;
    bookingId: string;
    type: NotificationType;
    title: string;
    message: string;
    status: NotificationStatus;
    createdAt: string;
    readAt?: string | null;
    details: BookingNotificationDetails;
}
