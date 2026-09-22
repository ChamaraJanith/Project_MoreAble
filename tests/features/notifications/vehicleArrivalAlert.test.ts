/**
 * Vehicle Arrival Alert & Proximity Unit/Integration Test Suite (MOV-218 / MOV-219 / MOV-220 / MOV-221)
 *
 * Tests distance calculations, dynamic ETA algorithms, threshold triggers,
 * idempotency, Firestore notification writes, and push notification dispatch.
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

describe('Vehicle Arrival Alert Engine Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Distance & ETA Computation Unit Tests (MOV-219 / MOV-220)
  // =========================================================================
  describe('Haversine Distance & ETA Calculations', () => {
    it('calculates accurate distance between Colombo Fort and Galle Face (~1.5 km)', () => {
      const colomboFort = { latitude: 6.9344, longitude: 79.8428 };
      const galleFace = { latitude: 6.9234, longitude: 79.8453 };

      const distance = calculateHaversineDistanceMeters(colomboFort, galleFace);
      expect(distance).toBeGreaterThan(1100);
      expect(distance).toBeLessThan(1400);
    });

    it('returns 0 for identical coordinates', () => {
      const loc = { latitude: 6.9000, longitude: 79.8600 };
      expect(calculateHaversineDistanceMeters(loc, loc)).toBe(0);
    });

    it('returns Infinity for invalid coordinates without crashing', () => {
      expect(calculateHaversineDistanceMeters({ latitude: NaN as any, longitude: 79 }, { latitude: 6, longitude: 79 })).toBe(Infinity);
      expect(calculateHaversineDistanceMeters(null as any, { latitude: 6, longitude: 79 })).toBe(Infinity);
    });

    it('calculates ETA dynamically based on distance and vehicle speed', () => {
      // 2000m at 40 km/h: ~3-4 mins
      const etaMoving = calculateArrivalEtaMinutes(2000, 40);
      expect(etaMoving).toBeGreaterThanOrEqual(3);
      expect(etaMoving).toBeLessThanOrEqual(4);

      // 2000m when bus is stationary (<10 km/h), falls back to urban average 25 km/h -> ~5 mins
      const etaStationary = calculateArrivalEtaMinutes(2000, 0);
      expect(etaStationary).toBe(5);

      // Close proximity (<100m) returns 0 mins (arrived now)
      expect(calculateArrivalEtaMinutes(50, 20)).toBe(0);
    });
  });

  // =========================================================================
  // 2. Bus Arrival Evaluation & Threshold Dispatch (MOV-221)
  // =========================================================================
  describe('processVehicleArrivalAlertsForBus', () => {
    it('dispatches arrival alert when bus is within 2000m of passenger pickup stop', async () => {
      const busId = 'BUS-138';
      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8520, // Near Maharagama
            longitude: 79.9270,
            speed: 35,
          },
        ],
        bookings: [
          {
            id: 'BK-ARR-01',
            bookingId: 'BK-ARR-01',
            userId: 'PAS-001',
            busId: 'BUS-138',
            routeId: 'ROUTE-138',
            status: 'CONFIRMED',
            boardingStatus: 'NOT_BOARDED',
            seatNumber: 'S04',
            arrivalAlertSent: false,
            journey: {
              startLocation: 'Maharagama',
              endLocation: 'Pettah',
              routeNumber: '138',
              routeName: 'Maharagama - Pettah',
              departureDate: '2026-09-25',
              departureTime: '08:00 AM',
            },
            vehicle: {
              numberPlate: 'ND-5421',
            },
          },
        ],
        routes: [
          {
            id: 'ROUTE-138',
            routeNumber: '138',
            stops: [
              {
                stopName: 'Maharagama',
                coordinate: { latitude: 6.8510, longitude: 79.9280 }, // ~150m away from bus
              },
              {
                stopName: 'Pettah',
                coordinate: { latitude: 6.9344, longitude: 79.8428 },
              },
            ],
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(results.length).toBe(1);
      expect(results[0].bookingId).toBe('BK-ARR-01');
      expect(results[0].vehicleNumber).toBe('ND-5421');
      expect(results[0].routeNumber).toBe('138');
      expect(results[0].notified).toBe(true);

      // Verify notification document created in Firestore
      const notifSnap = await fakeDb.collection('notifications').get();
      const notif = notifSnap.docs[0].data();
      expect(notif.type).toBe('VEHICLE_ARRIVAL');
      expect(notif.title).toContain('Bus Arriving Soon');
      expect(notif.message).toContain('Bus ND-5421 for Route 138');
      expect(notif.details.startLocation).toBe('Maharagama');

      // Verify booking updated with arrivalAlertSent = true
      const updatedBooking = (await fakeDb.collection('bookings').doc('BK-ARR-01').get()).data();
      expect(updatedBooking?.arrivalAlertSent).toBe(true);

      // Verify push dispatcher was invoked
      expect(mockDispatchVehicleArrivalAlert).toHaveBeenCalledWith(
        'PAS-001',
        expect.objectContaining({
          vehicleNumber: 'ND-5421',
          routeNumber: '138',
          arrivalHalt: 'Maharagama',
        })
      );
    });

    it('does NOT dispatch alert if bus is beyond 2000m threshold', async () => {
      const busId = 'BUS-FAR';
      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.9344, // Pettah (~15 km away)
            longitude: 79.8428,
            speed: 40,
          },
        ],
        bookings: [
          {
            id: 'BK-FAR-01',
            bookingId: 'BK-FAR-01',
            userId: 'PAS-002',
            busId: 'BUS-FAR',
            status: 'CONFIRMED',
            boardingCoordinate: { latitude: 6.8510, longitude: 79.9280 }, // Maharagama
            journey: {
              startLocation: 'Maharagama',
              routeNumber: '138',
            },
            vehicle: { numberPlate: 'NC-9988' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results.length).toBe(0);
      expect(mockDispatchVehicleArrivalAlert).not.toHaveBeenCalled();
    });

    it('ensures idempotency and skips already alerted bookings', async () => {
      const busId = 'BUS-138';
      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8510,
            longitude: 79.9280,
          },
        ],
        bookings: [
          {
            id: 'BK-ALREADY-NOTIFIED',
            bookingId: 'BK-ALREADY-NOTIFIED',
            userId: 'PAS-003',
            busId: 'BUS-138',
            status: 'CONFIRMED',
            arrivalAlertSent: true, // Already sent
            boardingCoordinate: { latitude: 6.8510, longitude: 79.9280 },
            journey: { startLocation: 'Maharagama', routeNumber: '138' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results.length).toBe(0);
      expect(mockDispatchVehicleArrivalAlert).not.toHaveBeenCalled();
    });

    it('skips cancelled or already boarded bookings', async () => {
      const busId = 'BUS-138';
      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8510,
            longitude: 79.9280,
          },
        ],
        bookings: [
          {
            id: 'BK-BOARDED',
            bookingId: 'BK-BOARDED',
            userId: 'PAS-004',
            busId: 'BUS-138',
            status: 'CONFIRMED',
            boardingStatus: 'BOARDED', // Passenger already boarded
            boardingCoordinate: { latitude: 6.8510, longitude: 79.9280 },
            journey: { startLocation: 'Maharagama', routeNumber: '138' },
          },
          {
            id: 'BK-CANCELLED',
            bookingId: 'BK-CANCELLED',
            userId: 'PAS-005',
            busId: 'BUS-138',
            status: 'CANCELLED', // Booking was cancelled
            boardingCoordinate: { latitude: 6.8510, longitude: 79.9280 },
            journey: { startLocation: 'Maharagama', routeNumber: '138' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results.length).toBe(0);
      expect(mockDispatchVehicleArrivalAlert).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. Batch Processor Tests
  // =========================================================================
  describe('processAllPendingVehicleArrivalAlerts', () => {
    it('evaluates all active vehicle locations in system', async () => {
      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          { id: 'BUS-A', latitude: 6.8510, longitude: 79.9280 },
          { id: 'BUS-B', latitude: 6.9000, longitude: 79.9100 },
        ],
        bookings: [
          {
            id: 'BK-A1',
            bookingId: 'BK-A1',
            userId: 'USER-A',
            busId: 'BUS-A',
            status: 'CONFIRMED',
            boardingCoordinate: { latitude: 6.8512, longitude: 79.9282 },
            journey: { startLocation: 'Maharagama', routeNumber: '138' },
            vehicle: { numberPlate: 'ND-1111' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const summary = await processAllPendingVehicleArrivalAlerts(fakeDb);
      expect(summary.processedBuses).toBe(2);
      expect(summary.alertsDispatched).toBe(1);
    });
  });
});
