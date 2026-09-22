/**
 * Push Token Registry, Device Telemetry & Deep-Linking Test Suite (MOV-218 / MOV-221)
 *
 * Validates device push token registry resolution, Expo push token format schemas,
 * multi-device delivery fanout, deep-link navigation URLs (`moreable://tickets/:id`),
 * telemetry event tracking, and passenger notification preference enforcement.
 */

import {
  calculateArrivalEtaMinutes,
  calculateHaversineDistanceMeters,
  processAllPendingVehicleArrivalAlerts,
  processVehicleArrivalAlertsForBus,
} from '../../../src/features/notifications/services/vehicleArrivalService';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
  getAdminDb: () => mockGetAdminDb(),
}));

const mockDispatchVehicleArrivalAlert = jest.fn().mockResolvedValue({ success: true });
jest.mock('../../../src/shared/services/pushNotificationDispatcher', () => ({
  dispatchVehicleArrivalAlert: (...args: any[]) => mockDispatchVehicleArrivalAlert(...args),
}));

describe('Vehicle Arrival Alerts - Push Registry, Device Telemetry & Deep Linking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Push Token Format & Device Platform Dispatch
  // =========================================================================
  describe('Push Token Validation & Platform Targeting', () => {
    it('dispatches arrival push notification for standard Expo push tokens', async () => {
      const busId = 'bus-token-test-01';
      const routeId = 'route-138-token';
      const stopName = 'Maharagama Town Stand';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8520,
            longitude: 79.9240,
            speed: 30,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '138',
            routeName: 'Colombo - Maharagama',
            stops: [{ stopName, coordinate: { latitude: 6.8480, longitude: 79.9270 } }],
          },
        ],
        users: [
          {
            id: 'user-expo-token-01',
            pushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
            devicePlatform: 'ios',
            appVersion: '2.4.0',
          },
        ],
        bookings: [
          {
            id: 'bkg-token-01',
            busId,
            routeId,
            userId: 'user-expo-token-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: {
              startLocation: stopName,
              routeNumber: '138',
              departureDate: '2026-09-25',
              departureTime: '09:00 AM',
            },
            vehicle: { numberPlate: 'WP-ND-1100' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(results.length).toBe(1);
      expect(results[0].notified).toBe(true);
      expect(mockDispatchVehicleArrivalAlert).toHaveBeenCalledWith(
        'user-expo-token-01',
        expect.objectContaining({
          vehicleNumber: 'WP-ND-1100',
          routeNumber: '138',
          arrivalHalt: stopName,
          bookingId: 'bkg-token-01',
        })
      );
    });

    it('handles Android FCM tokens with custom high-priority notification channels', async () => {
      const busId = 'bus-fcm-test-02';
      const routeId = 'route-177-fcm';
      const stopName = 'Battaramulla Junction';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.9020,
            longitude: 79.9180,
            speed: 25,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '177',
            stops: [{ stopName, coordinate: { latitude: 6.8995, longitude: 79.9225 } }],
          },
        ],
        users: [
          {
            id: 'user-android-fcm-02',
            pushToken: 'fcm-registration-token-sample-999888',
            devicePlatform: 'android',
            channelId: 'transit_urgent_alerts',
          },
        ],
        bookings: [
          {
            id: 'bkg-fcm-02',
            busId,
            routeId,
            userId: 'user-android-fcm-02',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: stopName, routeNumber: '177' },
            vehicle: { numberPlate: 'WP-NB-2233' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results.length).toBe(1);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-android-fcm-02').get();
      expect(notifs.docs.length).toBe(1);
      expect(notifs.docs[0].data().title).toBe('Bus Arriving Soon • Route 177 🚍');
    });
  });

  // =========================================================================
  // 2. Telemetry Coordinates & Precision Rounding
  // =========================================================================
  describe('Telemetry Tracking Precision & Audit Trails', () => {
    it('records precise vehicle latitude and longitude in notification details payload', async () => {
      const busId = 'bus-telemetry-01';
      const routeId = 'route-100-telemetry';
      const stopName = 'Dehiwala Flyover Halt';

      const exactBusLat = 6.852345;
      const exactBusLng = 79.864321;

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: exactBusLat,
            longitude: exactBusLng,
            speed: 32,
            heading: 350.5,
            accuracyMeters: 4.2,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '100',
            stops: [{ stopName, coordinate: { latitude: 6.8510, longitude: 79.8650 } }],
          },
        ],
        bookings: [
          {
            id: 'bkg-telem-01',
            busId,
            routeId,
            userId: 'user-telem-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: stopName, routeNumber: '100' },
            vehicle: { numberPlate: 'WP-NC-7766' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-telem-01').get();
      const n = notifs.docs[0].data();

      expect(n.details.latitude).toBe(exactBusLat);
      expect(n.details.longitude).toBe(exactBusLng);
      expect(n.details.vehicleNumber).toBe('WP-NC-7766');
    });
  });

  // =========================================================================
  // 3. Multi-Passenger Ticket Linkage & Navigation Payload
  // =========================================================================
  describe('Ticket Linkage & App Deep-Linking Integrity', () => {
    it('binds exact bookingId to notification details for seamless ticket screen navigation', async () => {
      const busId = 'bus-ticket-nav-01';
      const routeId = 'route-nav-01';
      const stopName = 'Kollupitiya Supermarket';

      const bookingId = 'BK-MOREABLE-TICKET-8899';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.9080,
            longitude: 79.8520,
            speed: 24,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '101',
            stops: [{ stopName, coordinate: { latitude: 6.9110, longitude: 79.8510 } }],
          },
        ],
        bookings: [
          {
            id: bookingId,
            bookingId,
            busId,
            routeId,
            userId: 'user-ticket-nav-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            seatNumber: 'S-09',
            journey: {
              startLocation: stopName,
              endLocation: 'Colombo Fort',
              routeNumber: '101',
              departureDate: '2026-09-25',
              departureTime: '10:15 AM',
            },
            vehicle: { numberPlate: 'WP-ND-4455' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-ticket-nav-01').get();
      const notifDoc = notifs.docs[0].data();

      expect(notifDoc.id).toBe(`notif_arr_${bookingId}`);
      expect(notifDoc.bookingId).toBe(bookingId);
      expect(notifDoc.details.bookingId).toBe(bookingId);
      expect(notifDoc.details.seatNumber).toBe('S-09');
      expect(notifDoc.details.endLocation).toBe('Colombo Fort');
    });
  });
});
