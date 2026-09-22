/**
 * Caregiver Alert Dispatcher & Emergency SOS Tests (MOV-227 / MOV-230)
 */

import { GET as getLogs } from '../../../app/api/caregiver/logs+api';
import { POST as postSosAlert } from '../../../app/api/caregiver/sos-alert+api';
import { CaregiverAlertPayload } from '../../../src/entities/caregiver/model/types';
import { dispatchCaregiverSafetyAlert } from '../../../src/features/caregiver/services/caregiverAlertService';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
  getAdminDb: () => mockGetAdminDb(),
}));

describe('Caregiver Alert Dispatcher & Safety Engine', () => {
  const PASSENGER_ID = 'PAS-2026-00001';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches multi-channel alerts (SMS, Email) to authorized caregivers and writes safety audit logs', async () => {
    const fakeDb = createFakeFirestore({
      caregiver_links: [
        {
          linkId: 'LNK-1',
          passengerId: PASSENGER_ID,
          fullName: 'Saman Silva',
          mobileNo: '+94771234567',
          email: 'saman@example.com',
          status: 'ACTIVE',
          permissions: {
            isSharingActive: true,
            shareBoardingStatus: true,
            shareBookingConfirmation: true,
            shareLiveProgress: true,
            shareDestinationArrival: true,
            shareEmergencyAlerts: true,
            channels: { sms: true, email: true, push: false },
          },
        },
      ],
      caregiver_safety_logs: [],
    });

    mockGetAdminDb.mockReturnValue(fakeDb);

    const payload: CaregiverAlertPayload = {
      bookingId: 'BKG-999',
      passengerId: PASSENGER_ID,
      passengerName: 'Kusum Silva',
      tripId: 'TRIP-10',
      busId: 'BUS-10',
      busRegistrationNumber: 'ND-8890',
      routeNumber: '100',
      boardingStopName: 'Moratuwa',
      destinationStopName: 'Colombo Fort',
    };

    const result = await dispatchCaregiverSafetyAlert('BOARDING_CONFIRMED', payload, fakeDb);

    expect(result.caregiversNotified).toBe(1);
    expect(result.channelsSummary.sms).toBe(1);
    expect(result.channelsSummary.email).toBe(1);
    expect(result.trackingToken).toBeDefined();
    expect(result.trackingUrl).toContain('/track/');
    expect(result.logs.length).toBe(1);
    expect(result.logs[0].eventType).toBe('BOARDING_CONFIRMED');
    expect(result.logs[0].status).toBe('DELIVERED');
  });

  it('POST /api/caregiver/sos-alert triggers emergency safety broadcast', async () => {
    const fakeDb = createFakeFirestore({
      caregiver_links: [
        {
          linkId: 'LNK-1',
          passengerId: PASSENGER_ID,
          fullName: 'Saman Silva',
          mobileNo: '+94771234567',
          email: 'saman@example.com',
          status: 'ACTIVE',
          permissions: {
            isSharingActive: true,
            shareEmergencyAlerts: true,
            channels: { sms: true, email: true, push: false },
          },
        },
      ],
      caregiver_safety_logs: [],
    });

    mockGetAdminDb.mockReturnValue(fakeDb);

    const req = new Request('http://localhost/api/caregiver/sos-alert', {
      method: 'POST',
      body: JSON.stringify({
        passengerId: PASSENGER_ID,
        passengerName: 'Kusum Silva',
        emergencyNote: 'Medical assistance requested on bus',
      }),
    });

    const res = await postSosAlert(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.caregiversNotified).toBe(1);
  });

  it('GET /api/caregiver/logs returns delivery history for a passenger', async () => {
    const fakeDb = createFakeFirestore({
      caregiver_safety_logs: [
        {
          logId: 'LOG-1',
          passengerId: PASSENGER_ID,
          caregiverName: 'Saman Silva',
          eventType: 'BOOKING_CONFIRMED',
          channelsDelivered: ['SMS', 'EMAIL'],
          messageSummary: 'Trip booked for Kusum Silva',
          status: 'DELIVERED',
          timestamp: '2026-09-22T10:00:00.000Z',
        },
      ],
    });

    mockGetAdminDb.mockReturnValue(fakeDb);

    const req = new Request(`http://localhost/api/caregiver/logs?passengerId=${PASSENGER_ID}`);
    const res = await getLogs(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.logs.length).toBe(1);
    expect(json.logs[0].eventType).toBe('BOOKING_CONFIRMED');
  });
});
