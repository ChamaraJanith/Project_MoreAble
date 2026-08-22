import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Notification } from '../../../src/entities/notification/model/types';
import { NotificationCard } from '../../../src/features/notifications/ui/NotificationCard';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
    useRouter: () => ({
        push: mockPush,
    }),
}));

const mockMarkNotificationAsRead = jest.fn().mockResolvedValue(true);
jest.mock('../../../src/features/notifications/api/notificationApi', () => ({
    markNotificationAsRead: (id: string) => mockMarkNotificationAsRead(id),
}));

describe('NotificationCard Component', () => {
    const sampleNotification: Notification = {
        id: 'notif_BK-9999',
        notificationId: 'notif_BK-9999',
        userId: 'PA-2026-1024',
        bookingId: 'BK-9999',
        type: 'BOOKING_CONFIRMATION',
        title: 'Booking Confirmed • Route 138 🎟️',
        message: 'Your reservation BK-9999 for Route 138 (Maharagama - Pettah) [Seat S12] has been confirmed.',
        status: 'UNREAD',
        createdAt: '2026-08-21T12:00:00.000Z',
        readAt: null,
        details: {
            bookingId: 'BK-9999',
            vehicleNumber: 'NC-4589',
            routeNumber: '138',
            routeName: 'Maharagama - Pettah',
            seatNumber: 'S12',
            journeyDate: '2026-08-25',
            journeyTime: '10:00 AM',
            startLocation: 'Maharagama',
            endLocation: 'Pettah',
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders notification title, message, snapshot details, and UNREAD tag', () => {
        const { getByText } = render(
            <NotificationCard notification={sampleNotification} />
        );

        expect(getByText('Booking Confirmed • Route 138 🎟️')).toBeTruthy();
        expect(getByText('NEW')).toBeTruthy();
        expect(getByText('BK-9999')).toBeTruthy();
        expect(getByText('NC-4589')).toBeTruthy();
        expect(getByText('138 (Maharagama - Pettah)')).toBeTruthy();
        expect(getByText('S12')).toBeTruthy();
    });

    it('triggers markNotificationAsRead and navigates to ticket screen when tapped', () => {
        const onStatusChange = jest.fn();
        const { getByRole } = render(
            <NotificationCard
                notification={sampleNotification}
                onStatusChange={onStatusChange}
            />
        );

        const cardButton = getByRole('button');
        fireEvent.press(cardButton);

        expect(mockMarkNotificationAsRead).toHaveBeenCalledWith('notif_BK-9999');
        expect(onStatusChange).toHaveBeenCalledWith('notif_BK-9999');
        expect(mockPush).toHaveBeenCalledWith('/(tabs)/booking/ticket/BK-9999');
    });

    it('renders BOARDING_REMINDER notification title, message, vehicle number, boarding location, departure time, and seat number', () => {
        const reminderNotification: Notification = {
            id: 'notif_rem_BK-8888',
            notificationId: 'notif_rem_BK-8888',
            userId: 'PA-2026-1024',
            bookingId: 'BK-8888',
            type: 'BOARDING_REMINDER',
            title: 'Boarding Reminder • Route 138 🚌',
            message: 'Bus ND-5421 for Route 138 (Maharagama - Pettah) will depart in 15 minutes. Please proceed to Maharagama to board your bus (Seat S05).',
            status: 'UNREAD',
            createdAt: '2026-08-22T07:15:00.000Z',
            readAt: null,
            details: {
                bookingId: 'BK-8888',
                vehicleNumber: 'ND-5421',
                routeNumber: '138',
                routeName: 'Maharagama - Pettah',
                seatNumber: 'S05',
                journeyDate: '2026-08-22',
                journeyTime: '07:30 AM',
                startLocation: 'Maharagama',
                endLocation: 'Pettah',
            },
        };

        const { getByText } = render(
            <NotificationCard notification={reminderNotification} />
        );

        expect(getByText('Boarding Reminder • Route 138 🚌')).toBeTruthy();
        expect(getByText('NEW')).toBeTruthy();
        expect(getByText('BK-8888')).toBeTruthy();
        expect(getByText('ND-5421')).toBeTruthy();
        expect(getByText('Maharagama')).toBeTruthy();
        expect(getByText('S05')).toBeTruthy();
        expect(getByText('2026-08-22 (07:30 AM)')).toBeTruthy();
    });
});

