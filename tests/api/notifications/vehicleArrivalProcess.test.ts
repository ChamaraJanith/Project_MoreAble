/**
 * Vehicle Arrival Processing API Route Test Suite (MOV-218 / MOV-221)
 * Tests GET and POST on /api/notifications/vehicle-arrival/process with single bus and batch modes.
 */

import { GET as getProcessArrival, POST as postProcessArrival, OPTIONS as optionsProcessArrival } from '../../../app/api/notifications/vehicle-arrival/process+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
  getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/services/pushNotificationDispatcher', () => ({
  dispatchVehicleArrivalAlert: jest.fn().mockResolvedValue({ success: true }),
}));

function buildRequest(path: string, method: string = 'GET'): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Vehicle Arrival Processing API Route (/api/notifications/vehicle-arrival/process)', () => {
  let fakeDb: any;

  beforeEach(() => {
    jest.clearAllMocks();
    fakeDb = createFakeFirestore({
      vehicleLocations: [
        {
          id: 'BUS-177',
          latitude: 6.9000,
          longitude: 79.9160,
          speed: 30,
        },
      ],
      bookings: [
        {
          id: 'BK-177-01',
          bookingId: 'BK-177-01',
          userId: 'PAS-177-USER',
          busId: 'BUS-177',
          status: 'CONFIRMED',
          boardingCoordinate: { latitude: 6.8995, longitude: 79.9167 },
          journey: {
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            startLocation: 'Battaramulla',
            endLocation: 'Kollupitiya',
          },
          vehicle: { numberPlate: 'NB-5678' },
          arrivalAlertSent: false,
        },
      ],
      notifications: [],
    });
    mockGetAdminDb.mockReturnValue(fakeDb);
  });

  it('handles OPTIONS preflight with 204 status', async () => {
    const res = await optionsProcessArrival();
    expect(res.status).toBe(204);
  });

  it('GET /api/notifications/vehicle-arrival/process with busId processes specific bus', async () => {
    const req = buildRequest('/api/notifications/vehicle-arrival/process?busId=BUS-177', 'GET');
    const res = await getProcessArrival(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.processedBuses).toBe(1);
    expect(json.alertsDispatched).toBe(1);
    expect(json.results[0].bookingId).toBe('BK-177-01');
    expect(json.results[0].vehicleNumber).toBe('NB-5678');
  });

  it('POST /api/notifications/vehicle-arrival/process evaluates in batch mode across all active buses', async () => {
    const req = buildRequest('/api/notifications/vehicle-arrival/process', 'POST');
    const res = await postProcessArrival(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.processedBuses).toBe(1);
    expect(json.alertsDispatched).toBe(1);
  });
});
