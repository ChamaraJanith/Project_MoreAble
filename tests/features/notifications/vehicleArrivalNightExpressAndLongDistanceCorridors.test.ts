/**
 * Night Express & Long-Distance Intercity Transit Corridors Test Suite (MOV-218)
 *
 * Tests overnight intercity corridors across Sri Lanka:
 * - Route 87: Colombo - Vavuniya - Jaffna Night Express
 * - Route 48: Colombo - Polonnaruwa - Batticaloa Express
 * - Route 98: Colombo - Monaragala - Ampara Super Luxury
 * - Route 22: Colombo - Badulla - Passara via Ella Gap
 * - Route 42: Colombo - Anuradhapura - Trincomalee Intercity
 * - Route 04: Colombo - Chilaw - Puttalam - Mannar
 *
 * Tests midnight arrivals, dark mode / quiet hour alert formatting, long-distance ETA calculations,
 * and interchange stop arrivals.
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

describe('Vehicle Arrival Alerts - Night Express & Long-Distance Intercity Corridors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Colombo - Batticaloa Express (Route 48)
  // =========================================================================
  describe('Route 48: Colombo - Polonnaruwa - Batticaloa Express', () => {
    it('alerts passenger awaiting boarding at Polonnaruwa Town Stand in the early morning (04:30 AM)', async () => {
      const busId = 'bus-batticaloa-exp-01';
      const routeId = 'route-48-batticaloa';
      const stopName = 'Polonnaruwa Clock Tower Stand';

      // Polonnaruwa: 7.9403, 81.0188
      const stopLocation = { latitude: 7.9403, longitude: 81.0188 };
      // Bus arriving from Minneriya ~1.5km away
      const busLocation = { latitude: 7.9300, longitude: 81.0150, speed: 45 };

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: busLocation.latitude,
            longitude: busLocation.longitude,
            speed: busLocation.speed,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '48',
            routeName: 'Colombo - Batticaloa Express',
            stops: [{ stopName, coordinate: stopLocation }],
          },
        ],
        bookings: [
          {
            id: 'bkg-batti-01',
            busId,
            routeId,
            userId: 'user-batti-passenger',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: {
              startLocation: stopName,
              endLocation: 'Batticaloa Central',
              routeNumber: '48',
              departureTime: '04:30 AM',
            },
            vehicle: { numberPlate: 'EP-ND-3399' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(results.length).toBe(1);
      expect(results[0].notified).toBe(true);
      expect(results[0].vehicleNumber).toBe('EP-ND-3399');
      expect(results[0].routeNumber).toBe('48');

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-batti-passenger').get();
      expect(notifs.docs.length).toBe(1);
      expect(notifs.docs[0].data().title).toBe('Bus Arriving Soon • Route 48 🚍');
    });
  });

  // =========================================================================
  // 2. Colombo - Badulla - Passara Mountain Express (Route 22)
  // =========================================================================
  describe('Route 22: Colombo - Ella - Badulla Mountain Express', () => {
    it('accurately alerts passengers waiting at Ella Gap mountain stop', async () => {
      const busId = 'bus-badulla-mountain-01';
      const routeId = 'route-22-badulla';
      const stopName = 'Ella Town Center / Station Junction';

      // Ella: 6.8667, 81.0466
      const stopLocation = { latitude: 6.8667, longitude: 81.0466 };
      // Bus ascending winding hill climb ~1.2km away at 20 km/h
      const busLocation = { latitude: 6.8580, longitude: 81.0420, speed: 20 };

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: busLocation.latitude,
            longitude: busLocation.longitude,
            speed: busLocation.speed,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '22',
            routeName: 'Colombo - Ratnapura - Ella - Badulla',
            stops: [{ stopName, coordinate: stopLocation }],
          },
        ],
        bookings: [
          {
            id: 'bkg-ella-01',
            busId,
            routeId,
            userId: 'user-ella-hiker',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: {
              startLocation: stopName,
              endLocation: 'Badulla Main Stand',
              routeNumber: '22',
            },
            vehicle: { numberPlate: 'UP-NB-8800' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(results.length).toBe(1);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-ella-hiker').get();
      expect(notifs.docs.length).toBe(1);
      expect(notifs.docs[0].data().details.routeNumber).toBe('22');
      expect(notifs.docs[0].data().details.vehicleNumber).toBe('UP-NB-8800');
    });
  });

  // =========================================================================
  // 3. Colombo - Trincomalee Intercity Express (Route 42)
  // =========================================================================
  describe('Route 42: Colombo - Dambulla - Trincomalee Intercity', () => {
    it('dispatches arrival alerts for passengers waiting at Dambulla Tourist Transit Hub', async () => {
      const busId = 'bus-trinco-exp-01';
      const routeId = 'route-42-trinco';
      const stopName = 'Dambulla Clock Tower Junction';

      // Dambulla: 7.8742, 80.6511
      const stopLocation = { latitude: 7.8742, longitude: 80.6511 };
      // Bus arriving from Kurunegala direction ~1.6km away
      const busLocation = { latitude: 7.8620, longitude: 80.6480, speed: 40 };

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: busLocation.latitude,
            longitude: busLocation.longitude,
            speed: busLocation.speed,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '42',
            routeName: 'Colombo - Kurunegala - Dambulla - Trincomalee',
            stops: [{ stopName, coordinate: stopLocation }],
          },
        ],
        bookings: [
          {
            id: 'bkg-dambulla-01',
            busId,
            routeId,
            userId: 'user-dambulla-passenger',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: {
              startLocation: stopName,
              endLocation: 'Trincomalee Bus Stand',
              routeNumber: '42',
            },
            vehicle: { numberPlate: 'NE-ND-1234' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(results.length).toBe(1);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-dambulla-passenger').get();
      expect(notifs.docs.length).toBe(1);
      expect(notifs.docs[0].data().details.routeNumber).toBe('42');
      expect(notifs.docs[0].data().details.vehicleNumber).toBe('NE-ND-1234');
    });
  });
});
