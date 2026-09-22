/**
 * Multi-Route Sri Lankan Multimodal Transit Hubs Integration Test Suite (MOV-218)
 *
 * Tests dense transit hubs with multiple overlapping routes, heavy passenger concurrency,
 * bus platform assignments, multi-corridor arrivals, and batch alert processing across
 * Makumbura Multimodal Transport Center (MMTC), Pettah Central, Kadawatha, Kandy, Galle,
 * Kurunegala, Jaffna, and Matara transit hubs.
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

describe('Vehicle Arrival Alerts - Multi-Route Transit Hubs & Heavy Concurrency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Makumbura Multimodal Transport Center (MMTC) Kottawa
  // =========================================================================
  describe('Makumbura Multimodal Transport Center (MMTC) Hub', () => {
    it('processes alerts for 4 different express highway & feeder buses arriving at MMTC simultaneously', async () => {
      const mmtcStopName = 'Makumbura MMTC';
      const mmtcLocation = { latitude: 6.8406, longitude: 79.9678 };

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: 'bus-ex-galle-10',
            latitude: 6.8480,
            longitude: 79.9620,
            speed: 45,
          },
          {
            id: 'bus-ex-matara-20',
            latitude: 6.8320,
            longitude: 79.9710,
            speed: 50,
          },
          {
            id: 'bus-122-local-30',
            latitude: 6.8450,
            longitude: 79.9600,
            speed: 25,
          },
          {
            id: 'bus-138-local-40',
            // Bus is 5km away -> should NOT trigger alert
            latitude: 6.8750,
            longitude: 79.9200,
            speed: 30,
          },
        ],
        routes: [
          {
            id: 'route-ex-01-galle',
            routeNumber: 'EX1-01',
            routeName: 'MMTC Kottawa - Galle Highway Express',
            stops: [{ stopName: mmtcStopName, coordinate: mmtcLocation }],
          },
          {
            id: 'route-ex-02-matara',
            routeNumber: 'EX1-02',
            routeName: 'MMTC Kottawa - Matara Highway Express',
            stops: [{ stopName: mmtcStopName, coordinate: mmtcLocation }],
          },
          {
            id: 'route-122-avissawella',
            routeNumber: '122',
            routeName: 'Pettah - Avissawella via Kottawa',
            stops: [{ stopName: mmtcStopName, coordinate: mmtcLocation }],
          },
          {
            id: 'route-138-homagama',
            routeNumber: '138',
            routeName: 'Pettah - Homagama',
            stops: [{ stopName: mmtcStopName, coordinate: mmtcLocation }],
          },
        ],
        bookings: [
          {
            id: 'bkg-galle-1',
            busId: 'bus-ex-galle-10',
            routeId: 'route-ex-01-galle',
            userId: 'user-galle-traveler',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: mmtcStopName, routeNumber: 'EX1-01' },
            vehicle: { numberPlate: 'WP-ND-5001' },
          },
          {
            id: 'bkg-matara-1',
            busId: 'bus-ex-matara-20',
            routeId: 'route-ex-02-matara',
            userId: 'user-matara-traveler',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: mmtcStopName, routeNumber: 'EX1-02' },
            vehicle: { numberPlate: 'WP-ND-5002' },
          },
          {
            id: 'bkg-avissawella-1',
            busId: 'bus-122-local-30',
            routeId: 'route-122-avissawella',
            userId: 'user-avissawella-commuter',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: mmtcStopName, routeNumber: '122' },
            vehicle: { numberPlate: 'WP-NB-8812' },
          },
          {
            id: 'bkg-homagama-1',
            busId: 'bus-138-local-40',
            routeId: 'route-138-homagama',
            userId: 'user-homagama-commuter',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: mmtcStopName, routeNumber: '138' },
            vehicle: { numberPlate: 'WP-NA-3399' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      // Process batch
      const batchResult = await processAllPendingVehicleArrivalAlerts(fakeDb);

      // 3 buses are within 2km threshold, 1 is outside
      expect(batchResult.processedBuses).toBe(4);
      expect(batchResult.alertsDispatched).toBe(3);
      expect(batchResult.results.length).toBe(3);

      // Verify individual user notifications
      const galleNotif = await fakeDb.collection('notifications').where('userId', '==', 'user-galle-traveler').get();
      expect(galleNotif.docs.length).toBe(1);
      expect(galleNotif.docs[0].data().details.routeNumber).toBe('EX1-01');

      const mataraNotif = await fakeDb.collection('notifications').where('userId', '==', 'user-matara-traveler').get();
      expect(mataraNotif.docs.length).toBe(1);
      expect(mataraNotif.docs[0].data().details.routeNumber).toBe('EX1-02');

      const avissawellaNotif = await fakeDb.collection('notifications').where('userId', '==', 'user-avissawella-commuter').get();
      expect(avissawellaNotif.docs.length).toBe(1);
      expect(avissawellaNotif.docs[0].data().details.routeNumber).toBe('122');

      const homagamaNotif = await fakeDb.collection('notifications').where('userId', '==', 'user-homagama-commuter').get();
      expect(homagamaNotif.docs.length).toBe(0); // Bus was 5km away
    });
  });

  // =========================================================================
  // 2. Pettah Bastian Mawatha & Central Bus Terminal
  // =========================================================================
  describe('Pettah Bastian Mawatha Multi-Stand Transit Concurrency', () => {
    it('dispatches arrival alerts to 15 concurrent passengers across terminal queues', async () => {
      const busId = 'bus-pettah-exp-99';
      const routeId = 'route-01-kandy';
      const pettahStopName = 'Bastian Mawatha Terminal Stand 4';

      const bookingsList: any[] = [];
      for (let i = 1; i <= 15; i++) {
        bookingsList.push({
          id: `bkg-kandy-passenger-${i}`,
          busId,
          routeId,
          userId: `user-kandy-${i}`,
          status: 'CONFIRMED',
          boardingStatus: 'WAITING',
          arrivalAlertSent: false,
          seatNumber: `Seat-${i}`,
          journey: { startLocation: pettahStopName, routeNumber: '01' },
          vehicle: { numberPlate: 'WP-ND-9900' },
        });
      }

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.9390,
            longitude: 79.8510,
            speed: 20,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '01',
            routeName: 'Colombo - Kandy Intercity AC',
            stops: [
              { stopName: pettahStopName, coordinate: { latitude: 6.9358, longitude: 79.8540 } },
              { stopName: 'Kadawatha Interchange', coordinate: { latitude: 6.9980, longitude: 79.9540 } },
            ],
          },
        ],
        bookings: bookingsList,
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);

      expect(results.length).toBe(15);
      expect(results.every((r) => r.notified === true)).toBe(true);

      // Verify notifications and push calls
      expect(mockDispatchVehicleArrivalAlert).toHaveBeenCalledTimes(15);

      const allNotifs = await fakeDb.collection('notifications').get();
      expect(allNotifs.docs.length).toBe(15);

      for (let i = 1; i <= 15; i++) {
        const userNotif = await fakeDb.collection('notifications').where('userId', '==', `user-kandy-${i}`).get();
        expect(userNotif.docs.length).toBe(1);
        expect(userNotif.docs[0].data().details.routeNumber).toBe('01');
        expect(userNotif.docs[0].data().details.vehicleNumber).toBe('WP-ND-9900');
      }
    });
  });

  // =========================================================================
  // 3. Galle Fort & Central Bus Station Coastal Terminal
  // =========================================================================
  describe('Galle Central Coastal Bus Station', () => {
    it('alerts southern coastal passengers approaching Galle International Cricket Stadium stop', async () => {
      const busId = 'bus-galle-coastal-01';
      const routeId = 'route-350-matara-galle';
      const stopName = 'Galle Cricket Stadium / Bus Stand';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 6.0230,
            longitude: 80.2240,
            speed: 40,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '350',
            routeName: 'Matara - Galle - Colombo',
            stops: [
              { stopName, coordinate: { latitude: 6.0330, longitude: 80.2170 } },
            ],
          },
        ],
        bookings: [
          {
            id: 'bkg-galle-tourist-01',
            busId,
            routeId,
            userId: 'user-galle-passenger',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: stopName, routeNumber: '350' },
            vehicle: { numberPlate: 'SP-ND-3344' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-galle-passenger').get();
      expect(notifs.docs.length).toBe(1);
      expect(notifs.docs[0].data().details.routeNumber).toBe('350');
      expect(notifs.docs[0].data().details.vehicleNumber).toBe('SP-ND-3344');
    });
  });

  // =========================================================================
  // 4. Northern Province Transit Hubs (Jaffna Central)
  // =========================================================================
  describe('Jaffna Central Transit Hub', () => {
    it('accurately triggers arrival alerts for Northern transit users in Jaffna', async () => {
      const busId = 'bus-jaffna-express-01';
      const routeId = 'route-87-jaffna-colombo';
      const stopName = 'Jaffna Main Bus Stand';

      const fakeDb = createFakeFirestore({
        vehicleLocations: [
          {
            id: busId,
            latitude: 9.6610,
            longitude: 80.0220,
            speed: 30,
          },
        ],
        routes: [
          {
            id: routeId,
            routeNumber: '87',
            routeName: 'Colombo - Vavuniya - Jaffna Night Express',
            stops: [
              { stopName, coordinate: { latitude: 9.6640, longitude: 80.0160 } },
            ],
          },
        ],
        bookings: [
          {
            id: 'bkg-jaffna-01',
            busId,
            routeId,
            userId: 'user-jaffna-resident',
            status: 'CONFIRMED',
            boardingStatus: 'WAITING',
            arrivalAlertSent: false,
            journey: { startLocation: stopName, routeNumber: '87' },
            vehicle: { numberPlate: 'NP-ND-7711' },
          },
        ],
        notifications: [],
      });

      mockGetAdminDb.mockReturnValue(fakeDb);

      const results = await processVehicleArrivalAlertsForBus(busId, fakeDb);
      expect(results[0].notified).toBe(true);

      const notifs = await fakeDb.collection('notifications').where('userId', '==', 'user-jaffna-resident').get();
      expect(notifs.docs.length).toBe(1);
      expect(notifs.docs[0].data().title).toBe('Bus Arriving Soon • Route 87 🚍');
      expect(notifs.docs[0].data().details.routeNumber).toBe('87');
      expect(notifs.docs[0].data().details.vehicleNumber).toBe('NP-ND-7711');
    });
  });
});
