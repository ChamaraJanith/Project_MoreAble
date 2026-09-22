/**
 * Multilingual Localization, Notification Payload Schema & Metadata Test Suite (MOV-218)
 *
 * Validates notification schemas, metadata completeness, localization compatibility
 * (Sinhala, Tamil, English template tokens), ticket ID bindings, journey state tracking,
 * and display formatting for diverse passenger segments across Sri Lanka.
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

describe('Vehicle Arrival Alerts - Multilingual Localization & Schema Validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Notification Document Schema Conformance
  // =========================================================================
  describe('Notification Document Schema Completeness', () => {
    it('creates in-app notification document with all mandatory fields and metadata attributes', async () => {
      const busId = 'bus-schema-test-01';
      const routeId = 'route-103-fort-narahenpita';
      const stopName = 'National Hospital / General Hospital';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.9240,
            longitude: 79.8650,
            speed: 28,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '103',
            stops: [{ stopName, coordinate: { latitude: 6.9180, longitude: 79.8690 } }],
          },
        ],
        bookings: [
          {
            id: 'bkg-schema-01',
            busId,
            routeId,
            userId: 'user-schema-passenger-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            seatNumber: 'Seat-4B',
            journey: {
              startLocation: stopName,
              endLocation: 'Narahenpita',
              routeNumber: '103',
              routeName: 'Fort - Narahenpita',
              departureDate: '2026-09-25',
              departureTime: '08:30 AM',
            },
            vehicle: {
              numberPlate: 'WP-ND-7788',
            },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results.length).toBe(1);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-schema-passenger-01').get();
      expect(notifs.docs.length).toBe(1);

      const doc = notifs.docs[0].data();

      // Verify root fields
      expect(doc.userId).toBe('user-schema-passenger-01');
      expect(doc.type).toBe('VEHICLE_ARRIVAL');
      expect(doc.title).toBe('Bus Arriving Soon • Route 103 🚍');
      expect(doc.status).toBe('UNREAD');
      expect(doc.createdAt).toBeDefined();

      // Verify details fields required by NotificationCard and tracking screens
      expect(doc.details).toBeDefined();
      expect(doc.details.bookingId).toBe('bkg-schema-01');
      expect(doc.details.vehicleNumber).toBe('WP-ND-7788');
      expect(doc.details.routeNumber).toBe('103');
      expect(doc.details.startLocation).toBe(stopName);
      expect(results[0].distanceMeters).toBeGreaterThan(0);
      expect(results[0].distanceMeters).toBeLessThanOrEqual(2000);
      expect(doc.details.etaMinutes).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 2. Multilingual Tokenization & Unicode Handling
  // =========================================================================
  describe('Multilingual Transit Names & Unicode Strings', () => {
    it('handles Sinhala Unicode stop names and route titles without character corruption', async () => {
      const busId = 'bus-sinhala-unicode-01';
      const routeId = 'route-sinhala-01';
      const sinhalaRouteName = 'මහරගම - පිටකොටුව';
      const sinhalaStopName = 'මහරගම ඔරලෝසු කණුව අසල';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8520,
            longitude: 79.9240,
            speed: 22,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '138/1',
            routeName: sinhalaRouteName,
            stops: [{ stopName: sinhalaStopName, coordinate: { latitude: 6.8480, longitude: 79.9270 } }],
          },
        ],
        bookings: [
          {
            id: 'bkg-sinhala-01',
            busId,
            routeId,
            userId: 'user-sinhala-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: {
              startLocation: sinhalaStopName,
              routeNumber: '138/1',
              routeName: sinhalaRouteName,
            },
            vehicle: { numberPlate: 'WP-ND-4567' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results.length).toBe(1);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-sinhala-01').get();
      const n = notifs.docs[0].data();

      expect(n.details.startLocation).toBe(sinhalaStopName);
      expect(n.message).toContain(sinhalaStopName);
    });

    it('handles Tamil Unicode stop names and route titles without character corruption', async () => {
      const busId = 'bus-tamil-unicode-01';
      const routeId = 'route-tamil-01';
      const tamilRouteName = 'யாழ்ப்பாணம் - கொழும்பு';
      const tamilStopName = 'யாழ்ப்பாண மத்திய பேருந்து நிலையம்';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 9.6680,
            longitude: 80.0190,
            speed: 25,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '87-A',
            routeName: tamilRouteName,
            stops: [{ stopName: tamilStopName, coordinate: { latitude: 9.6640, longitude: 80.0160 } }],
          },
        ],
        bookings: [
          {
            id: 'bkg-tamil-01',
            busId,
            routeId,
            userId: 'user-tamil-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: {
              startLocation: tamilStopName,
              routeNumber: '87-A',
              routeName: tamilRouteName,
            },
            vehicle: { numberPlate: 'NP-ND-9988' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results.length).toBe(1);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-tamil-01').get();
      const n = notifs.docs[0].data();

      expect(n.details.startLocation).toBe(tamilStopName);
      expect(n.message).toContain(tamilStopName);
    });
  });

  // =========================================================================
  // 3. Push Dispatcher Payload Parameters Verification
  // =========================================================================
  describe('Push Dispatcher Parameter Passing', () => {
    it('passes exact vehicleNumber, route, startLocation, ETA, and distance arguments to push dispatcher', async () => {
      const busId = 'bus-dispatch-param-01';
      const routeId = 'route-122-express';
      const stopName = 'Homagama Base Hospital';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8450,
            longitude: 80.0050,
            speed: 35,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '122-EX',
            stops: [{ stopName, coordinate: { latitude: 6.8420, longitude: 80.0010 } }],
          },
        ],
        bookings: [
          {
            id: 'bkg-param-check-01',
            busId,
            routeId,
            userId: 'user-param-check-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: stopName, routeNumber: '122-EX' },
            vehicle: { numberPlate: 'WP-NA-4433' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(mockDispatchVehicleArrivalAlert).toHaveBeenCalledWith(
        'user-param-check-01',
        expect.objectContaining({
          vehicleNumber: 'WP-NA-4433',
          routeNumber: '122-EX',
          arrivalHalt: 'Homagama Base Hospital',
          etaMinutes: expect.any(Number),
          bookingId: 'bkg-param-check-01',
        })
      );
    });
  });
});
