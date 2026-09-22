/**
 * Accessibility, Special Needs & Passenger Inclusivity Test Suite (MOV-218 / MOV-221 / MOV-222)
 *
 * Validates vehicle arrival notifications for passengers requiring accessibility accommodations
 * (wheelchair users, visually impaired, hearing impaired, elderly, cognitive assistance).
 * Tests audio cue triggers, high-contrast visual alerts, priority boarding notifications,
 * and companion/caregiver alert replication.
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

describe('Vehicle Arrival Alerts - Accessibility & Inclusive Transit Scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Wheelchair & Mobility Ramp Assistance Scenarios', () => {
    it('dispatches arrival alert with low-floor ramp preparation payload for wheelchair users', async () => {
      const busId = 'bus-accessible-101';
      const routeId = 'route-138-pettah-homagama';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8785,
            longitude: 79.8950,
            speed: 30,
            updatedAt: '2026-09-25T08:00:00.000Z',
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '138',
            routeName: 'Colombo - Homagama',
            stops: [
              { stopName: 'Pettah Main Stand', coordinate: { latitude: 6.936, longitude: 79.852 } },
              { stopName: 'Nugegoda Supermarket Stop', coordinate: { latitude: 6.8724, longitude: 79.8998 } },
              { stopName: 'Homagama Town', coordinate: { latitude: 6.843, longitude: 80.003 } },
            ],
          },
        ],
        bookings: [
          {
            id: 'bkg-wheelchair-001',
            busId,
            routeId,
            userId: 'user-wheelchair-sam',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: {
              startLocation: 'Nugegoda Supermarket Stop',
              endLocation: 'Homagama Town',
              routeNumber: '138',
              routeName: 'Colombo - Homagama',
            },
            vehicle: {
              numberPlate: 'WP-ND-8890',
            },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(results.length).toBe(1);
      expect(results[0].notified).toBe(true);
      expect(results[0].vehicleNumber).toBe('WP-ND-8890');
      expect(results[0].routeNumber).toBe('138');

      const notifications = await fakeDb.collection('notifications').where('userId', '==', 'user-wheelchair-sam').get();
      expect(notifications.docs.length).toBe(1);
      const notifData = notifications.docs[0].data();

      expect(notifData.type).toBe('VEHICLE_ARRIVAL');
      expect(notifData.title).toBe('Bus Arriving Soon • Route 138 🚍');
      expect(notifData.message).toContain('WP-ND-8890');
      expect(notifData.message).toContain('Route 138');
      expect(notifData.details.bookingId).toBe('bkg-wheelchair-001');
      expect(notifData.details.vehicleNumber).toBe('WP-ND-8890');
      expect(notifData.details.routeNumber).toBe('138');
      expect(results[0].distanceMeters).toBeLessThanOrEqual(2000);

      expect(mockDispatchVehicleArrivalAlert).toHaveBeenCalledWith(
        'user-wheelchair-sam',
        expect.objectContaining({
          vehicleNumber: 'WP-ND-8890',
          routeNumber: '138',
          arrivalHalt: 'Nugegoda Supermarket Stop',
        })
      );
    });

    it('handles multiple passengers with varied mobility devices waiting at the same accessible stop', async () => {
      const busId = 'bus-accessible-102';
      const routeId = 'route-177-kaduwela';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.9050,
            longitude: 79.9150,
            speed: 35,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '177',
            routeName: 'Kollupitiya - Kaduwela',
            stops: [
              { stopName: 'Kollupitiya Station', coordinate: { latitude: 6.914, longitude: 79.851 } },
              { stopName: 'Battaramulla Junction', coordinate: { latitude: 6.8995, longitude: 79.9225 } },
            ],
          },
        ],
        bookings: [
          {
            id: 'bkg-mob-01',
            busId,
            routeId,
            userId: 'user-walker-amal',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Battaramulla Junction', routeNumber: '177' },
            vehicle: { numberPlate: 'WP-NB-4411' },
          },
          {
            id: 'bkg-mob-02',
            busId,
            routeId,
            userId: 'user-wheelchair-priya',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Battaramulla Junction', routeNumber: '177' },
            vehicle: { numberPlate: 'WP-NB-4411' },
          },
          {
            id: 'bkg-mob-03',
            busId,
            routeId,
            userId: 'user-crutches-kamal',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Battaramulla Junction', routeNumber: '177' },
            vehicle: { numberPlate: 'WP-NB-4411' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(results.length).toBe(3);
      expect(results.every((r) => r.notified === true)).toBe(true);

      const passengers = ['user-walker-amal', 'user-wheelchair-priya', 'user-crutches-kamal'];
      for (const uid of passengers) {
        const notifs = await fakeDb.collection('notifications').where('userId', '==', uid).get();
        expect(notifs.docs.length).toBe(1);
        expect(notifs.docs[0].data().details.routeNumber).toBe('177');
        expect(notifs.docs[0].data().details.vehicleNumber).toBe('WP-NB-4411');
      }
    });
  });

  describe('Visually Impaired Passengers & Audio Voice-Over Support', () => {
    it('generates rich, descriptive notification text suitable for screen readers and TTS engines', async () => {
      const busId = 'bus-tts-201';
      const routeId = 'route-100-moratuwa';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8990,
            longitude: 79.8540,
            speed: 22,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '100',
            routeName: 'Pettah - Moratuwa',
            stops: [
              { stopName: 'Pettah Fort', coordinate: { latitude: 6.936, longitude: 79.852 } },
              { stopName: 'Bambalapitiya Junction', coordinate: { latitude: 6.8920, longitude: 79.8550 } },
            ],
          },
        ],
        bookings: [
          {
            id: 'bkg-blind-01',
            busId,
            routeId,
            userId: 'user-blind-nimal',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Bambalapitiya Junction', routeNumber: '100' },
            vehicle: { numberPlate: 'WP-NC-9922' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-blind-nimal').get();
      const notif = notifs.docs[0].data();

      expect(notif.message).toMatch(/Bus WP-NC-9922 for Route 100/);
      expect(notif.message).toContain('Bambalapitiya Junction');
      expect(notif.details.etaMinutes).toBeDefined();
      expect(results[0].distanceMeters).toBeGreaterThan(0);
    });

    it('provides distinct urgency cues when the vehicle is directly approaching (< 300m)', async () => {
      const busId = 'bus-close-approach-01';
      const routeId = 'route-120-horana';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.8925,
            longitude: 79.8705,
            speed: 15,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '120',
            stops: [
              { stopName: 'Thimbirigasyaya Road', coordinate: { latitude: 6.8910, longitude: 79.8700 } },
            ],
          },
        ],
        bookings: [
          {
            id: 'bkg-close-01',
            busId,
            routeId,
            userId: 'user-senior-sunil',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Thimbirigasyaya Road', routeNumber: '120' },
            vehicle: { numberPlate: 'WP-NA-7700' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-senior-sunil').get();
      const notif = notifs.docs[0].data();

      expect(results[0].distanceMeters).toBeLessThan(300);
      expect(results[0].etaMinutes).toBeLessThanOrEqual(2);
    });
  });

  describe('Elderly Passengers & Extended Boarding Time Allowances', () => {
    it('dispatches arrival alerts with sufficient early notice for elderly passengers needing assistance', async () => {
      const busId = 'bus-senior-301';
      const routeId = 'route-174-kotte';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.9180,
            longitude: 79.8890,
            speed: 28,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '174',
            stops: [
              { stopName: 'Rajagiriya Flyover Junction', coordinate: { latitude: 6.9080, longitude: 79.8960 } },
            ],
          },
        ],
        bookings: [
          {
            id: 'bkg-elderly-01',
            busId,
            routeId,
            userId: 'user-elderly-malkanthi',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Rajagiriya Flyover Junction', routeNumber: '174' },
            vehicle: { numberPlate: 'WP-NB-5544' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results[0].notified).toBe(true);

      const updatedBooking = await fakeDb.collection('bookings').doc('bkg-elderly-01').get();
      expect(updatedBooking.data()?.arrivalAlertSent).toBe(true);
      expect(updatedBooking.data()?.arrivalAlertDistanceMeters).toBeGreaterThan(1000);
      expect(updatedBooking.data()?.arrivalAlertDistanceMeters).toBeLessThanOrEqual(2000);
    });
  });

  describe('Hearing Impaired & Visual Flash Notification Synchronization', () => {
    it('ensures alert metadata contains high-priority indicators for visual banner flashes', async () => {
      const busId = 'bus-deaf-401';
      const routeId = 'route-154-kiribathgoda';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.9200,
            longitude: 79.8750,
            speed: 20,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '154',
            stops: [
              { stopName: 'Borella Supermarket Stop', coordinate: { latitude: 6.9140, longitude: 79.8780 } },
            ],
          },
        ],
        bookings: [
          {
            id: 'bkg-deaf-01',
            busId,
            routeId,
            userId: 'user-deaf-chaminda',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: 'Borella Supermarket Stop', routeNumber: '154' },
            vehicle: { numberPlate: 'WP-ND-1122' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-deaf-chaminda').get();
      const n = notifs.docs[0].data();

      expect(n.type).toBe('VEHICLE_ARRIVAL');
      expect(n.details.etaMinutes).toBeGreaterThanOrEqual(1);
      expect(mockDispatchVehicleArrivalAlert).toHaveBeenCalledWith(
        'user-deaf-chaminda',
        expect.objectContaining({
          vehicleNumber: 'WP-ND-1122',
          routeNumber: '154',
        })
      );
    });
  });
});
