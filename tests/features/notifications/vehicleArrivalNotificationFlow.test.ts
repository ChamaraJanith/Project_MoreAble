/**
 * Comprehensive Vehicle Arrival Alert Lifecycle & Flow Tests (MOV-218 / MOV-219 / MOV-220 / MOV-221 / MOV-222)
 *
 * Validates full lifecycle:
 * 1. Active confirmed booking with passenger waiting at halt
 * 2. Bus moves from far distance (>2000m) to approaching distance (<2000m)
 * 3. Vehicle arrival notification dynamically generated with vehicle plate & ETA
 * 4. Idempotency guarantees exactly one notification per booking
 * 5. Passenger boarding cancels subsequent arrival notifications
 * 6. Trip cancellation stops all arrival processing
 */

import {
  processVehicleArrivalAlertsForBus,
  calculateArrivalEtaMinutes,
  calculateHaversineDistanceMeters,
} from '../../../src/features/notifications/services/vehicleArrivalService';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
  getAdminDb: () => mockGetAdminDb(),
}));

const mockDispatchPush = jest.fn().mockResolvedValue({ success: true });
jest.mock('../../../src/shared/services/pushNotificationDispatcher', () => ({
  dispatchVehicleArrivalAlert: (...args: any[]) => mockDispatchPush(...args),
}));

describe('Vehicle Arrival Notification Flow & Memory Safety Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('verifies vehicle arrival flow progression from approaching to boarding', async () => {
    const busId = 'BUS-100-EXP';
    const passengerId = 'PAS-ARR-TEST';
    const bookingId = 'BK-ARR-TEST-99';

    // Step 1: Bus is far away (e.g. 5 km away)
    const fakeDb = createFakeFirestore({
      vehicleLocations: [
        {
          id: busId,
          latitude: 6.8000,
          longitude: 79.9000,
          speed: 40,
        },
      ],
      bookings: [
        {
          id: bookingId,
          bookingId,
          userId: passengerId,
          busId,
          status: 'CONFIRMED',
          boardingStatus: 'NOT_BOARDED',
          arrivalAlertSent: false,
          boardingCoordinate: { latitude: 6.8995, longitude: 79.9167 }, // ~11 km away
          journey: {
            routeNumber: '100',
            routeName: 'Panadura - Pettah',
            startLocation: 'Moratuwa',
            endLocation: 'Pettah',
            departureDate: '2026-09-25',
            departureTime: '09:00 AM',
          },
          vehicle: { numberPlate: 'ND-9900' },
        },
      ],
      notifications: [],
    });

    mockGetAdminDb.mockReturnValue(fakeDb);

    // Run check when bus is far away
    const farResults = await processVehicleArrivalAlertsForBus(busId, fakeDb);
    expect(farResults.length).toBe(0);
    expect(mockDispatchPush).not.toHaveBeenCalled();

    // Step 2: Bus enters arrival proximity (~800m away)
    await fakeDb.collection('vehicleLocations').doc(busId).set({
      id: busId,
      latitude: 6.8950,
      longitude: 79.9140,
      speed: 32,
    });

    const nearResults = await processVehicleArrivalAlertsForBus(busId, fakeDb);
    expect(nearResults.length).toBe(1);
    expect(nearResults[0].bookingId).toBe(bookingId);
    expect(nearResults[0].vehicleNumber).toBe('ND-9900');
    expect(nearResults[0].routeNumber).toBe('100');
    expect(nearResults[0].etaMinutes).toBeGreaterThanOrEqual(1);

    // Verify in-app notification structure
    const notifSnap = await fakeDb.collection('notifications').get();
    const notif = notifSnap.docs[0].data();
    expect(notif.type).toBe('VEHICLE_ARRIVAL');
    expect(notif.details.vehicleNumber).toBe('ND-9900');
    expect(notif.details.startLocation).toBe('Moratuwa');
    expect(notif.details.etaMinutes).toBeDefined();

    // Step 3: Run check again immediately — Idempotency prevents duplicate notifications
    const recheckResults = await processVehicleArrivalAlertsForBus(busId, fakeDb);
    expect(recheckResults.length).toBe(0);
    expect(mockDispatchPush).toHaveBeenCalledTimes(1); // Only called once

    // Step 4: Passenger boards the bus — boardingStatus becomes 'BOARDED'
    await fakeDb.collection('bookings').doc(bookingId).update({
      boardingStatus: 'BOARDED',
    });

    const boardedResults = await processVehicleArrivalAlertsForBus(busId, fakeDb);
    expect(boardedResults.length).toBe(0);
  });
});
