/**
 * Caregiver Permissions & Sharing Control Tests (MOV-229)
 */

import { PUT } from '../../../app/api/caregiver/permissions+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
  getAdminDb: () => mockGetAdminDb(),
}));

describe('Caregiver Permissions API (/api/caregiver/permissions)', () => {
  const PASSENGER_ID = 'PAS-2026-00001';
  const LINK_ID = 'LNK-2026-00001';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('PUT updates granular permissions for a specific caregiver', async () => {
    const fakeDb = createFakeFirestore({
      caregiver_links: [
        {
          linkId: LINK_ID,
          passengerId: PASSENGER_ID,
          fullName: 'Nalini Shantha',
          permissions: {
            isSharingActive: true,
            shareBookingConfirmation: true,
            shareBoardingStatus: true,
            shareLiveProgress: true,
            shareDestinationArrival: true,
            channels: { sms: true, email: true, push: true },
          },
        },
      ],
    });

    mockGetAdminDb.mockReturnValue(fakeDb);

    const payload = {
      linkId: LINK_ID,
      passengerId: PASSENGER_ID,
      permissions: {
        shareDestinationArrival: false,
        channels: { sms: true, email: false, push: true },
      },
    };

    const req = new Request('http://localhost/api/caregiver/permissions', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    const res = await PUT(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.permissions.shareDestinationArrival).toBe(false);
    expect(json.permissions.shareBoardingStatus).toBe(true); // Retained
    expect(json.permissions.channels.email).toBe(false);
  });

  it('PUT applies master sharing toggle to all caregivers of the passenger', async () => {
    const fakeDb = createFakeFirestore({
      caregiver_links: [
        {
          linkId: 'LNK-1',
          passengerId: PASSENGER_ID,
          fullName: 'Caregiver 1',
          permissions: { isSharingActive: true },
        },
        {
          linkId: 'LNK-2',
          passengerId: PASSENGER_ID,
          fullName: 'Caregiver 2',
          permissions: { isSharingActive: true },
        },
      ],
    });

    mockGetAdminDb.mockReturnValue(fakeDb);

    const payload = {
      passengerId: PASSENGER_ID,
      masterSharingActive: false,
    };

    const req = new Request('http://localhost/api/caregiver/permissions', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    const res = await PUT(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.isSharingActive).toBe(false);
  });

  it('PUT rejects unauthorized attempts to update permissions for another passenger', async () => {
    const fakeDb = createFakeFirestore({
      caregiver_links: [
        {
          linkId: LINK_ID,
          passengerId: 'ANOTHER_PASSENGER',
          fullName: 'Caregiver X',
        },
      ],
    });

    mockGetAdminDb.mockReturnValue(fakeDb);

    const payload = {
      linkId: LINK_ID,
      passengerId: PASSENGER_ID, // Different passenger
      permissions: { isSharingActive: false },
    };

    const req = new Request('http://localhost/api/caregiver/permissions', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    const res = await PUT(req);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });
});
