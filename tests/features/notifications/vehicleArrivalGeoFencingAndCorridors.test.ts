/**
 * Geo-Fencing, Boundary Physics & Corridor Approach Vectors Test Suite (MOV-218)
 *
 * Validates dynamic distance calculations across varied geographic boundaries,
 * speed transitions (stop-and-go rush hour, highway speeds, stationary at traffic lights),
 * GPS jitter handling, and precise 2,000-meter threshold entry/exit logic.
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

describe('Vehicle Arrival Alerts - Geo-Fencing, Corridor Approach & Velocity Dynamics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Precise 2000m Boundary Entry Testing
  // =========================================================================
  describe('Boundary Entry / Geofence Ingress', () => {
    it('does NOT trigger alert when bus is at 2,050 meters (just outside boundary)', async () => {
      const busId = 'bus-geo-outside-01';
      const routeId = 'route-geo-01';
      const stopName = 'Town Hall Stand';

      // Colombo Town Hall (6.9147, 79.8660)
      const stopLoc = { latitude: 6.9147, longitude: 79.8660 };
      // Position chosen so Haversine is ~2,050m away
      const busLoc = { latitude: 6.8962, longitude: 79.8660, speedKmH: 30 };

      const dist = calculateHaversineDistanceMeters(busLoc, stopLoc);
      expect(dist).toBeGreaterThan(2000);
      expect(dist).toBeLessThan(2100);

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: busLoc.latitude,
            longitude: busLoc.longitude,
            speedKmH: busLoc.speedKmH,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '155',
            stops: [{ stopName, coordinate: stopLoc }],
          },
        ],
        bookings: [
          {
            id: 'bkg-geo-01',
            busId,
            routeId,
            userId: 'user-geo-01',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: stopName, routeNumber: '155' },
            vehicle: { numberPlate: 'WP-NC-1001' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results.length).toBe(0);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-geo-01').get();
      expect(notifs.docs.length).toBe(0);
    });

    it('triggers alert immediately once vehicle crosses into 1,950 meters (inside boundary)', async () => {
      const busId = 'bus-geo-inside-01';
      const routeId = 'route-geo-01';
      const stopName = 'Town Hall Stand';

      const stopLoc = { latitude: 6.9147, longitude: 79.8660 };
      // Position chosen so Haversine is ~1,950m away
      const busLoc = { latitude: 6.8972, longitude: 79.8660, speedKmH: 30 };

      const dist = calculateHaversineDistanceMeters(busLoc, stopLoc);
      expect(dist).toBeLessThanOrEqual(2000);
      expect(dist).toBeGreaterThan(1900);

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: busLoc.latitude,
            longitude: busLoc.longitude,
            speedKmH: busLoc.speedKmH,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '155',
            stops: [{ stopName, coordinate: stopLoc }],
          },
        ],
        bookings: [
          {
            id: 'bkg-geo-02',
            busId,
            routeId,
            userId: 'user-geo-02',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: stopName, routeNumber: '155' },
            vehicle: { numberPlate: 'WP-NC-1001' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results.length).toBe(1);
      expect(results[0].notified).toBe(true);

      const updatedBooking = await fakeDb.collection('bookings').doc('bkg-geo-02').get();
      expect(updatedBooking.data()?.arrivalAlertSent).toBe(true);
      expect(updatedBooking.data()?.arrivalAlertDistanceMeters).toBeCloseTo(dist, 0);
    });
  });

  // =========================================================================
  // 2. Dynamic Speed Scenarios: Traffic Jam vs Express
  // =========================================================================
  describe('Velocity Dynamics & ETA Computations', () => {
    it('accurately computes ETA for a crawling bus in Galle Road peak-hour traffic (5 km/h)', () => {
      const etaTraffic = calculateArrivalEtaMinutes(1000, 5);
      expect(etaTraffic).toBeGreaterThanOrEqual(1);
    });

    it('accurately computes ETA for an expressway bus cruising at 70 km/h', () => {
      const etaExpress = calculateArrivalEtaMinutes(2000, 70);
      expect(etaExpress).toBe(2);
    });

    it('uses fallback urban speed (25 km/h) when vehicle is temporarily stationary at a red light (0 km/h)', () => {
      const etaStationary = calculateArrivalEtaMinutes(1500, 0);
      expect(etaStationary).toBeGreaterThanOrEqual(4);
      expect(etaStationary).toBeLessThanOrEqual(5);
    });

    it('clamps ETA to minimum of 0 when vehicle is 50 meters away', () => {
      const etaClose = calculateArrivalEtaMinutes(50, 40);
      expect(etaClose).toBe(0);
    });
  });

  // =========================================================================
  // 3. Multi-Waypoint Corridor Traversal
  // =========================================================================
  describe('Corridor Waypoints Traversal', () => {
    it('correctly isolates passenger alerts per individual pickup stop along a corridor', async () => {
      const busId = 'bus-corridor-555';
      const routeId = 'route-176-hettiyawatte';

      const corridorStops = [
        { stopName: 'Hettiyawatte', coordinate: { latitude: 6.9550, longitude: 79.8650 } },
        { stopName: 'Maradana Station', coordinate: { latitude: 6.9270, longitude: 79.8650 } },
        { stopName: 'Borella Kanatte', coordinate: { latitude: 6.9110, longitude: 79.8780 } },
        { stopName: 'Narahenpita Junction', coordinate: { latitude: 6.8920, longitude: 79.8820 } },
        { stopName: 'Nugegoda Supermarket', coordinate: { latitude: 6.8724, longitude: 79.8998 } },
      ];

      // Bus is currently near Stop C3 (Borella: 6.9130, 79.8770)
      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.9130,
            longitude: 79.8770,
            speedKmH: 25,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '176',
            stops: corridorStops,
          },
        ],
        bookings: [
          {
            id: 'bkg-c1',
            busId,
            routeId,
            userId: 'user-c1',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Hettiyawatte', routeNumber: '176' },
            vehicle: { numberPlate: 'WP-NA-6060' },
          },
          {
            id: 'bkg-c2',
            busId,
            routeId,
            userId: 'user-c2',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Maradana Station', routeNumber: '176' },
            vehicle: { numberPlate: 'WP-NA-6060' },
          },
          {
            id: 'bkg-c3',
            busId,
            routeId,
            userId: 'user-c3',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Borella Kanatte', routeNumber: '176' },
            vehicle: { numberPlate: 'WP-NA-6060' },
          },
          {
            id: 'bkg-c4',
            busId,
            routeId,
            userId: 'user-c4',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Narahenpita Junction', routeNumber: '176' },
            vehicle: { numberPlate: 'WP-NA-6060' },
          },
          {
            id: 'bkg-c5',
            busId,
            routeId,
            userId: 'user-c5',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Nugegoda Supermarket', routeNumber: '176' },
            vehicle: { numberPlate: 'WP-NA-6060' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results.length).toBe(1); // Only C3 triggered
      expect(results[0].bookingId).toBe('bkg-c3');
      expect(results[0].notified).toBe(true);

      const c3Notif = await fakeDb.collection('notifications').where('userId', '==', 'user-c3').get();
      expect(c3Notif.docs.length).toBe(1);
      expect(c3Notif.docs[0].data().details.startLocation).toBe('Borella Kanatte');

      const c1Notif = await fakeDb.collection('notifications').where('userId', '==', 'user-c1').get();
      expect(c1Notif.docs.length).toBe(0);

      const c4Notif = await fakeDb.collection('notifications').where('userId', '==', 'user-c4').get();
      expect(c4Notif.docs.length).toBe(0);
    });
  });
});
