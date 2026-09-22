/**
 * Zero-Login Live Caregiver Journey Tracking Tests (MOV-227 / MOV-230)
 */

import { GET } from '../../../app/api/caregiver/track+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
  getAdminDb: () => mockGetAdminDb(),
}));

describe('Caregiver Live Tracking API (/api/caregiver/track)', () => {
  const TRACKING_TOKEN = 'TRK-2026-BKG101-XYZ';
  const BOOKING_ID = 'BKG-2026-00101';
  const BUS_ID = 'BUS-101';
  const PASSENGER_ID = 'PAS-2026-00001';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/caregiver/track returns real-time bus telemetry & journey timeline by token without requiring login', async () => {
    const fakeDb = createFakeFirestore({
      bookings: [
        {
          id: BOOKING_ID,
          bookingId: BOOKING_ID,
          trackingToken: TRACKING_TOKEN,
          passengerId: PASSENGER_ID,
          userId: PASSENGER_ID,
          passengerName: 'Anula Weerasinghe',
          busId: BUS_ID,
          tripId: 'TRIP-101',
          status: 'IN_TRANSIT',
          journey: {
            startLocation: 'Kaduwela',
            endLocation: 'Kollupitiya',
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            departureTime: '07:30 AM',
            arrivalTime: '08:20 AM',
          },
        },
      ],
      users: [
        {
          passengerId: PASSENGER_ID,
          userName: 'Anula Weerasinghe',
          isWheelchairUser: true,
          hasAccessibilityNeeds: true,
        },
      ],
      buses: [
        {
          id: BUS_ID,
          busId: BUS_ID,
          registrationNumber: 'NB-4422',
          model: 'Ashok Leyland Low Floor',
          driverName: 'Jagath Kumara',
          driverPhone: '+94712223344',
        },
      ],
      vehicleLocations: [
        {
          id: BUS_ID,
          latitude: 6.9147,
          longitude: 79.8732,
          speed: 42,
          heading: 270,
          recordedAt: new Date().toISOString(),
        },
      ],
    });

    mockGetAdminDb.mockReturnValue(fakeDb);

    const req = new Request(`http://localhost/api/caregiver/track?token=${TRACKING_TOKEN}`);
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.tracking.passengerName).toBe('Anula Weerasinghe');
    expect(json.tracking.busRegistrationNumber).toBe('NB-4422');
    expect(json.tracking.currentLocation.latitude).toBeCloseTo(6.9147);
    expect(json.tracking.currentLocation.longitude).toBeCloseTo(79.8732);
    expect(json.tracking.currentLocation.speedKmH).toBe(42);
    expect(json.tracking.driverName).toBe('Jagath Kumara');
    expect(json.tracking.accessibilityNeeds).toContain('Wheelchair Access');
    expect(json.tracking.stopsTimeline.length).toBeGreaterThan(0);
    expect(json.tracking.emergencyPhone).toBe('1990');
  });

  it('GET /api/caregiver/track returns 404 for invalid or missing tracking tokens', async () => {
    const fakeDb = createFakeFirestore({ bookings: [] });
    mockGetAdminDb.mockReturnValue(fakeDb);

    const req = new Request('http://localhost/api/caregiver/track?token=INVALID_TOKEN');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
    expect(json.message).toContain('Invalid or expired tracking link');
  });
});
