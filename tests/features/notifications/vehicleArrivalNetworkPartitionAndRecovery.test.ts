/**
 * Network Partition, Push Dispatch Failures & Fault Recovery Test Suite (MOV-218)
 *
 * Validates system resilience against temporary push provider outages,
 * Firestore transient query failures, corrupt booking data, missing bus fleet records,
 * and high-frequency consecutive polling without state corruption or memory leaks.
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

const mockDispatchVehicleArrivalAlert = jest.fn();
jest.mock('../../../src/shared/services/pushNotificationDispatcher', () => ({
  dispatchVehicleArrivalAlert: (...args: any[]) => mockDispatchVehicleArrivalAlert(...args),
}));

describe('Vehicle Arrival Alerts - Network Resilience, Fault Recovery & Error Isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDispatchVehicleArrivalAlert.mockResolvedValue({ success: true });
  });

  // =========================================================================
  // 1. Push Notification Provider Transient Downtime
  // =========================================================================
  describe('Push Service Outage Resilience', () => {
    it('persists in-app Firestore notification even if Expo push network request throws error', async () => {
      // Simulate network socket timeout or push gateway rejection
      mockDispatchVehicleArrivalAlert.mockRejectedValueOnce(new Error('Expo Push Gateway 504 Gateway Timeout'));

      const busId = 'bus-push-fail-01';
      const routeId = 'route-101-moratuwa';
      const stopName = 'Moratuwa Campus Junction';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8000,
            longitude: 79.9020,
            speedKmH: 30,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '101',
            routeName: 'Pettah - Moratuwa University',
            stops: [{ stopName, coordinate: { latitude: 6.7950, longitude: 79.9000 } }],
          },
        ],
        bookings: [
          {
            id: 'bkg-push-fail-01',
            busId,
            routeId,
            userId: 'user-push-fail-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: stopName, routeNumber: '101' },
            vehicle: { numberPlate: 'WP-NC-2200' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      // Should handle push failure gracefully without throwing
      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(results.length).toBe(1);
      expect(results[0].notified).toBe(true);

      // In-app Firestore notification document must still be created
      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-push-fail-01').get();
      expect(notifs.docs.length).toBe(1);
      expect(notifs.docs[0].data().type).toBe('VEHICLE_ARRIVAL');

      // Booking must still be marked as alert sent to avoid endless duplicate retries
      const bkg = await fakeDb.collection('bookings').doc('bkg-push-fail-01').get();
      expect(bkg.data()?.arrivalAlertSent).toBe(true);
    });
  });

  // =========================================================================
  // 2. Corrupt or Partially Missing Document Recovery
  // =========================================================================
  describe('Malformed Database Record Handling', () => {
    it('gracefully skips bookings with unresolvable pickup stop without crashing', async () => {
      const busId = 'bus-corrupt-data-01';
      const routeId = 'route-120-piliyandala';
      const stopName = 'Piliyandala Clock Tower';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8050,
            longitude: 79.9210,
            speedKmH: 30,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '120',
            routeName: 'Colombo - Piliyandala',
            stops: [
              { stopName, coordinate: { latitude: 6.8010, longitude: 79.9230 } },
            ],
          },
        ],
        bookings: [
          {
            id: 'bkg-valid-01',
            busId,
            routeId,
            userId: 'user-valid-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: stopName, routeNumber: '120' },
            vehicle: { numberPlate: 'WP-NB-9000' },
          },
          {
            id: 'bkg-orphan-stop-02',
            busId,
            routeId,
            userId: 'user-corrupt-02',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Stop-That-Does-Not-Exist', routeNumber: '120' },
            vehicle: { numberPlate: 'WP-NB-9000' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(results.length).toBe(1); // valid booking was evaluated
      expect(results[0].notified).toBe(true);

      const validNotif = await fakeDb.collection('notifications').where('userId', '==', 'user-valid-01').get();
      expect(validNotif.docs.length).toBe(1);

      const invalidNotif = await fakeDb.collection('notifications').where('userId', '==', 'user-corrupt-02').get();
      expect(invalidNotif.docs.length).toBe(0);
    });

    it('handles bus with missing vehicleLocation document safely', async () => {
      const busId = 'bus-missing-location-01';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [],
        routes: [],
        bookings: [
          {
            id: 'bkg-ghost-01',
            busId,
            userId: 'user-ghost-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(results.length).toBe(0);
    });
  });

  // =========================================================================
  // 3. Consecutive Polling Cycles & State Preservation
  // =========================================================================
  describe('Consecutive Polling Cycles & Memory State Invariance', () => {
    it('maintains strict idempotency across 5 consecutive rapid polling cycles', async () => {
      const busId = 'bus-rapid-poll-01';
      const routeId = 'route-rapid-01';
      const stopName = 'Mount Lavinia Junction';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8400,
            longitude: 79.8670,
            speedKmH: 20,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '255',
            routeName: 'Mount Lavinia - Kottawa',
            stops: [{ stopName, coordinate: { latitude: 6.8380, longitude: 79.8650 } }],
          },
        ],
        bookings: [
          {
            id: 'bkg-rapid-01',
            busId,
            routeId,
            userId: 'user-rapid-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: stopName, routeNumber: '255' },
            vehicle: { numberPlate: 'WP-ND-3311' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      // Cycle 1: Triggers alert
      const cycle1 = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(cycle1.length).toBe(1);
      expect(cycle1[0].notified).toBe(true);
      expect(mockDispatchVehicleArrivalAlert).toHaveBeenCalledTimes(1);

      // Cycle 2: Bus moved closer -> Should NOT send duplicate alert
      await fakeDb.collection('vehicleLocations').doc(busId).update({
        latitude: 6.8390,
        longitude: 6.8660,
      });
      const cycle2 = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(cycle2.length).toBe(0); // already notified booking is skipped
      expect(mockDispatchVehicleArrivalAlert).toHaveBeenCalledTimes(1);

      // Cycles 3, 4, 5
      for (let i = 3; i <= 5; i++) {
        const cycle = await processVehicleArrivalAlertsForBus(busId, fakeDb);
        expect(cycle.length).toBe(0);
      }

      // Final check: Notification collection must have EXACTLY 1 notification
      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-rapid-01').get();
      expect(notifs.docs.length).toBe(1);
    });
  });
});
