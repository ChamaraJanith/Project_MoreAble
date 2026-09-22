/**
 * Caregiver Client Service Test Suite (MOV-227 / MOV-228 / MOV-229 / MOV-230)
 */

import {
  fetchCaregiverSafetyLogs,
  fetchLiveTrackingByToken,
  fetchPassengerCaregivers,
  linkNewCaregiver,
  removeCaregiverLink,
  setMasterSharingStatus,
  triggerEmergencySosBeacon,
  updateCaregiverPermissions,
} from '../../../src/features/caregiver/api/caregiverService';

jest.mock('../../../src/shared/api/config', () => ({
  API_BASE_URL: 'http://localhost',
}));

describe('Caregiver Client Service (caregiverService.ts)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('fetchPassengerCaregivers returns caregiver list on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        caregivers: [{ linkId: 'LNK-1', fullName: 'Kamal Perera' }],
      }),
    });

    const list = await fetchPassengerCaregivers('PAS-1');
    expect(list.length).toBe(1);
    expect(list[0].fullName).toBe('Kamal Perera');
  });

  it('linkNewCaregiver sends POST request and returns created link', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        link: { linkId: 'LNK-2', fullName: 'Sunil Silva' },
      }),
    });

    const res = await linkNewCaregiver({
      passengerId: 'PAS-1',
      fullName: 'Sunil Silva',
      mobileNo: '0771234567',
      email: 'sunil@example.com',
    });

    expect(res.success).toBe(true);
    expect(res.link?.fullName).toBe('Sunil Silva');
  });

  it('removeCaregiverLink sends DELETE request and returns boolean result', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const ok = await removeCaregiverLink('LNK-1', 'PAS-1');
    expect(ok).toBe(true);
  });

  it('updateCaregiverPermissions sends PUT request and returns success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const ok = await updateCaregiverPermissions('LNK-1', 'PAS-1', { shareBoardingStatus: false });
    expect(ok).toBe(true);
  });

  it('setMasterSharingStatus sends master toggle and returns success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const ok = await setMasterSharingStatus('PAS-1', false);
    expect(ok).toBe(true);
  });

  it('fetchLiveTrackingByToken retrieves live tracking payload without login', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        tracking: {
          bookingId: 'BKG-1',
          passengerName: 'Nimal',
          busRegistrationNumber: 'ND-8890',
          journeyStatus: 'IN_TRANSIT',
        },
      }),
    });

    const tracking = await fetchLiveTrackingByToken('TRK-TOKEN-123');
    expect(tracking).toBeDefined();
    expect(tracking?.busRegistrationNumber).toBe('ND-8890');
  });

  it('triggerEmergencySosBeacon sends SOS payload', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, message: 'SOS sent' }),
    });

    const res = await triggerEmergencySosBeacon({ passengerId: 'PAS-1' });
    expect(res.success).toBe(true);
  });

  it('fetchCaregiverSafetyLogs returns logs list', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        logs: [{ logId: 'LOG-1', eventType: 'BOOKING_CONFIRMED' }],
      }),
    });

    const logs = await fetchCaregiverSafetyLogs('PAS-1');
    expect(logs.length).toBe(1);
    expect(logs[0].eventType).toBe('BOOKING_CONFIRMED');
  });
});
