/**
 * Caregiver Backend API Routes Integration & Unit Test Suite (MOV-227 / MOV-228 / MOV-229 / MOV-230)
 * Tests HTTP Request/Response cycles, query validations, status codes, and error handlers
 * for all caregiver backend API route handlers.
 */

import { GET as getCaregivers, POST as linkCaregiver, DELETE as unlinkCaregiver, OPTIONS as optionsCaregiver } from '../../../app/api/caregiver/link+api';
import { PUT as updatePermissions, OPTIONS as optionsPermissions } from '../../../app/api/caregiver/permissions+api';
import { POST as triggerSos, OPTIONS as optionsSos } from '../../../app/api/caregiver/sos-alert+api';
import { GET as getLogs, OPTIONS as optionsLogs } from '../../../app/api/caregiver/logs+api';

// In-memory data structures for API tests
const mockStore: {
  caregivers: Record<string, any>;
  users: Record<string, any>;
  logs: any[];
} = {
  caregivers: {},
  users: {},
  logs: [],
};

const mockAdminDb: any = {
  collection: (collName: string) => ({
    doc: (docId: string) => ({
      get: async () => {
        if (collName === 'caregiver_links' || collName === 'caregivers') {
          const data = mockStore.caregivers[docId];
          return { exists: !!data, data: () => data };
        }
        if (collName === 'users') {
          const data = mockStore.users[docId];
          return { exists: !!data, data: () => data };
        }
        return { exists: false, data: () => null };
      },
      set: async (data: any, options?: any) => {
        if (collName === 'caregiver_links' || collName === 'caregivers') {
          mockStore.caregivers[docId] = { ...(mockStore.caregivers[docId] || {}), ...data };
        } else if (collName === 'caregiver_safety_logs' || collName === 'caregiverSafetyLogs') {
          mockStore.logs.push({ logId: docId, ...data });
        }
        return Promise.resolve();
      },
      delete: async () => {
        if (collName === 'caregiver_links' || collName === 'caregivers') {
          delete mockStore.caregivers[docId];
        }
        return Promise.resolve();
      },
    }),
    where: (field: string, op: string, val: any) => ({
      where: (f2: string, op2: string, v2: any) => ({
        get: async () => {
          const docs = Object.values(mockStore.caregivers)
            .filter((c: any) => c[field] === val && (!f2 || c[f2] === v2))
            .map((c: any) => ({
              id: c.linkId,
              data: () => c,
              ref: {
                id: c.linkId,
              },
            }));
          return {
            empty: docs.length === 0,
            docs,
            forEach: (fn: any) => docs.forEach(fn),
          };
        },
      }),
      get: async () => {
        if (collName === 'caregiver_links' || collName === 'caregivers') {
          const docs = Object.values(mockStore.caregivers)
            .filter((c: any) => c[field] === val)
            .map((c: any) => ({
              id: c.linkId,
              data: () => c,
              ref: {
                id: c.linkId,
              },
            }));
          return {
            empty: docs.length === 0,
            docs,
            forEach: (fn: any) => docs.forEach(fn),
          };
        }
        return { empty: true, docs: [], forEach: () => {} };
      },
      orderBy: () => ({
        limit: () => ({
          get: async () => ({
            empty: mockStore.logs.length === 0,
            docs: mockStore.logs.map((l) => ({ id: l.logId, data: () => l })),
            forEach: (fn: any) =>
              mockStore.logs.map((l) => ({ id: l.logId, data: () => l })).forEach(fn),
          }),
        }),
      }),
    }),
  }),
  batch: () => {
    const ops: any[] = [];
    return {
      set: (ref: any, data: any, options?: any) => {
        ops.push({ ref, data });
      },
      commit: async () => {
        for (const op of ops) {
          const docId = op.ref.id;
          if (mockStore.caregivers[docId]) {
            mockStore.caregivers[docId] = { ...mockStore.caregivers[docId], ...op.data };
          }
        }
        return Promise.resolve();
      },
    };
  },
};

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
  getAdminDb: () => mockAdminDb,
}));

jest.mock('../../../src/features/caregiver/services/caregiverAlertService', () => {
  const actual = jest.requireActual('../../../src/features/caregiver/services/caregiverAlertService');
  return {
    ...actual,
    syncRegisteredGuardianAsCaregiver: jest.fn().mockResolvedValue(null),
    dispatchCaregiverSafetyAlert: jest.fn().mockResolvedValue({ caregiversNotified: 1 }),
  };
});

describe('Caregiver Backend API Route Handlers Suite', () => {
  beforeEach(() => {
    mockStore.caregivers = {};
    mockStore.users = {
      'PAS-USER-1': {
        userId: 'PAS-USER-1',
        userName: 'Nimal Bandara',
        email: 'nimal@example.com',
        phoneNumber: '+94771234567',
      },
    };
    mockStore.logs = [];
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. CORS Preflight Handlers
  // =========================================================================
  describe('CORS Options Handlers', () => {
    it('returns status 204 for all OPTIONS preflight requests', async () => {
      const resLink = await optionsCaregiver();
      expect(resLink.status).toBe(204);

      const resPerms = await optionsPermissions();
      expect(resPerms.status).toBe(204);

      const resSos = await optionsSos();
      expect(resSos.status).toBe(204);

      const resLogs = await optionsLogs();
      expect(resLogs.status).toBe(204);
    });
  });

  // =========================================================================
  // 2. /api/caregiver/link (GET, POST, DELETE)
  // =========================================================================
  describe('GET /api/caregiver/link', () => {
    it('returns 400 Bad Request when passengerId query param is omitted', async () => {
      const req = new Request('http://localhost/api/caregiver/link');
      const res = await getCaregivers(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain('passengerId query parameter is required');
    });

    it('returns 200 with caregiver list when passengerId is provided', async () => {
      mockStore.caregivers['LNK-101'] = {
        linkId: 'LNK-101',
        passengerId: 'PAS-USER-1',
        fullName: 'Chathura Bandara',
        mobileNo: '+94778899000',
        email: 'chathura@example.com',
        relationship: 'Brother',
        status: 'ACTIVE',
        isPrimaryGuardian: false,
      };

      const req = new Request('http://localhost/api/caregiver/link?passengerId=PAS-USER-1');
      const res = await getCaregivers(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.caregivers.length).toBe(1);
      expect(data.caregivers[0].fullName).toBe('Chathura Bandara');
    });
  });

  describe('POST /api/caregiver/link', () => {
    it('validates required fields on link creation', async () => {
      const req = new Request('http://localhost/api/caregiver/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passengerId: 'PAS-USER-1' }),
      });
      const res = await linkCaregiver(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain('Full Name, and at least one contact method');
    });

    it('validates Sri Lankan mobile number format', async () => {
      const req = new Request('http://localhost/api/caregiver/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passengerId: 'PAS-USER-1',
          fullName: 'Kusum Silva',
          mobileNo: '12345',
        }),
      });
      const res = await linkCaregiver(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain('valid 10-digit Sri Lankan mobile number');
    });

    it('validates email format if email is provided', async () => {
      const req = new Request('http://localhost/api/caregiver/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passengerId: 'PAS-USER-1',
          fullName: 'Kusum Silva',
          email: 'invalid-email-address',
        }),
      });
      const res = await linkCaregiver(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toContain('valid email address');
    });

    it('successfully creates and saves a new caregiver link', async () => {
      const req = new Request('http://localhost/api/caregiver/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passengerId: 'PAS-USER-1',
          fullName: 'Kusum Silva',
          mobileNo: '0771234567',
          email: 'kusum@example.com',
          relationship: 'Mother',
        }),
      });
      const res = await linkCaregiver(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.link.fullName).toBe('Kusum Silva');
      expect(data.link.mobileNo).toBe('+94771234567');
      expect(data.link.status).toBe('ACTIVE');
    });
  });

  describe('DELETE /api/caregiver/link', () => {
    it('returns 400 if linkId or passengerId is missing', async () => {
      const req = new Request('http://localhost/api/caregiver/link?linkId=LNK-1');
      const res = await unlinkCaregiver(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('returns 404 if caregiver link does not exist', async () => {
      const req = new Request('http://localhost/api/caregiver/link?linkId=NON_EXISTENT&passengerId=PAS-USER-1');
      const res = await unlinkCaregiver(req);
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toContain('not found');
    });

    it('returns 403 if unauthorized user attempts to delete link', async () => {
      mockStore.caregivers['LNK-OTHER'] = {
        linkId: 'LNK-OTHER',
        passengerId: 'DIFFERENT_PASSENGER',
        fullName: 'Someone Else',
      };

      const req = new Request('http://localhost/api/caregiver/link?linkId=LNK-OTHER&passengerId=PAS-USER-1');
      const res = await unlinkCaregiver(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toContain('Unauthorized');
    });

    it('successfully removes caregiver link when authorized', async () => {
      mockStore.caregivers['LNK-VALID'] = {
        linkId: 'LNK-VALID',
        passengerId: 'PAS-USER-1',
        fullName: 'Caregiver To Delete',
      };

      const req = new Request('http://localhost/api/caregiver/link?linkId=LNK-VALID&passengerId=PAS-USER-1');
      const res = await unlinkCaregiver(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockStore.caregivers['LNK-VALID']).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. /api/caregiver/permissions (PUT)
  // =========================================================================
  describe('PUT /api/caregiver/permissions', () => {
    it('validates passengerId existence', async () => {
      const req = new Request('http://localhost/api/caregiver/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await updatePermissions(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('updates master isSharingActive switch for all passenger caregiver links', async () => {
      mockStore.caregivers['LNK-P1'] = {
        linkId: 'LNK-P1',
        passengerId: 'PAS-USER-1',
        permissions: { isSharingActive: true },
      };
      mockStore.caregivers['LNK-P2'] = {
        linkId: 'LNK-P2',
        passengerId: 'PAS-USER-1',
        permissions: { isSharingActive: true },
      };

      const req = new Request('http://localhost/api/caregiver/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passengerId: 'PAS-USER-1',
          masterSharingActive: false,
        }),
      });

      const res = await updatePermissions(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.isSharingActive).toBe(false);
    });
  });

  // =========================================================================
  // 4. /api/caregiver/sos-alert (POST)
  // =========================================================================
  describe('POST /api/caregiver/sos-alert', () => {
    it('rejects SOS trigger without passengerId', async () => {
      const req = new Request('http://localhost/api/caregiver/sos-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await triggerSos(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
    });

    it('dispatches emergency SOS alert for valid passenger', async () => {
      const req = new Request('http://localhost/api/caregiver/sos-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passengerId: 'PAS-USER-1',
          note: 'Emergency brake assistance requested',
        }),
      });

      const res = await triggerSos(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });
  });
});
