/**
 * Caregiver Linking & Management API Route Tests (MOV-228)
 */

import { DELETE, GET, POST } from '../../../app/api/caregiver/link+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
  getAdminDb: () => mockGetAdminDb(),
}));

describe('Caregiver Linking API (/api/caregiver/link)', () => {
  const PASSENGER_ID = 'PAS-2026-00001';
  const GUARDIAN_ID = 'GUD-2026-00001';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/caregiver/link automatically synchronizes registration guardian if not mirrored', async () => {
    const fakeDb = createFakeFirestore({
      users: [
        {
          passengerId: PASSENGER_ID,
          userName: 'Sunil Shantha',
          guardianId: GUARDIAN_ID,
          guardianDetails: {
            fullName: 'Nalini Shantha',
            mobileNo: '0771234567',
            email: 'nalini@example.com',
            relationship: 'Mother',
          },
        },
      ],
      guardians: [
        {
          guardianId: GUARDIAN_ID,
          fullName: 'Nalini Shantha',
          mobileNo: '0771234567',
          email: 'nalini@example.com',
          relationship: 'Mother',
        },
      ],
      caregiver_links: [],
    });

    mockGetAdminDb.mockReturnValue(fakeDb);

    const req = new Request(`http://localhost/api/caregiver/link?passengerId=${PASSENGER_ID}`);
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.caregivers.length).toBe(1);
    expect(json.caregivers[0].fullName).toBe('Nalini Shantha');
    expect(json.caregivers[0].isPrimaryGuardian).toBe(true);
    expect(json.caregivers[0].permissions.isSharingActive).toBe(true);
  });

  it('POST /api/caregiver/link links a new caregiver with validated inputs and invite code', async () => {
    const fakeDb = createFakeFirestore({
      users: [
        {
          passengerId: PASSENGER_ID,
          userName: 'Sunil Shantha',
        },
      ],
      caregiver_links: [],
    });

    mockGetAdminDb.mockReturnValue(fakeDb);

    const payload = {
      passengerId: PASSENGER_ID,
      fullName: 'Dr. Bandara',
      mobileNo: '0714567890',
      email: 'dr.bandara@hospital.lk',
      relationship: 'Doctor / Medical Aid',
    };

    const req = new Request('http://localhost/api/caregiver/link', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.link.fullName).toBe('Dr. Bandara');
    expect(json.link.mobileNo).toBe('+94714567890');
    expect(json.link.inviteCode).toBeDefined();
    expect(json.link.inviteCode.length).toBe(6);
    expect(json.link.permissions.shareBoardingStatus).toBe(true);
  });

  it('POST /api/caregiver/link rejects invalid mobile phone formats', async () => {
    const fakeDb = createFakeFirestore({ users: [], caregiver_links: [] });
    mockGetAdminDb.mockReturnValue(fakeDb);

    const payload = {
      passengerId: PASSENGER_ID,
      fullName: 'Test Person',
      mobileNo: '12345', // Invalid
    };

    const req = new Request('http://localhost/api/caregiver/link', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.message).toContain('valid 10-digit Sri Lankan mobile');
  });

  it('DELETE /api/caregiver/link removes caregiver when authorized', async () => {
    const LINK_ID = 'LNK-2026-99999';
    const fakeDb = createFakeFirestore({
      caregiver_links: [
        {
          linkId: LINK_ID,
          passengerId: PASSENGER_ID,
          fullName: 'Dr. Bandara',
        },
      ],
    });

    mockGetAdminDb.mockReturnValue(fakeDb);

    const req = new Request(`http://localhost/api/caregiver/link?linkId=${LINK_ID}&passengerId=${PASSENGER_ID}`, {
      method: 'DELETE',
    });

    const res = await DELETE(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });
});
