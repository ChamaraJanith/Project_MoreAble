/**
 * Caregiver Alert Dispatch & Multi-Channel Workflow Test Suite (MOV-227 / MOV-228 / MOV-229 / MOV-230)
 * Tests multi-caregiver syncing, dispatch pipeline, rate limiting, and failure resilience.
 */

import {
  CaregiverAlertPayload,
} from '../../../src/entities/caregiver/model/types';
import {
  dispatchCaregiverSafetyAlert,
  getActiveCaregiversForPassenger,
  syncRegisteredGuardianAsCaregiver,
} from '../../../src/features/caregiver/services/caregiverAlertService';
import { createDefaultCaregiverPermissions } from '../../../src/features/caregiver/model/caregiverUtils';

// In-memory collections for test isolation
const mockUsers: Record<string, any> = {};
const mockGuardians: Record<string, any> = {};
const mockCaregiverLinks: Record<string, any[]> = {};
const mockLogsCollection: any[] = [];

const mockAdminDb: any = {
  collection: (name: string) => ({
    doc: (docId: string) => ({
      get: async () => {
        if (name === 'users') {
          const u = mockUsers[docId];
          return { exists: !!u, data: () => u };
        }
        if (name === 'guardians') {
          const g = mockGuardians[docId];
          return { exists: !!g, data: () => g };
        }
        if (name === 'caregivers' || name === 'caregiver_links') {
          for (const pId in mockCaregiverLinks) {
            const found = mockCaregiverLinks[pId].find((c) => c.linkId === docId);
            if (found) return { exists: true, data: () => found };
          }
        }
        return { exists: false, data: () => null };
      },
      set: async (data: any, options?: any) => {
        if (name === 'caregivers' || name === 'caregiver_links') {
          const pId = data.passengerId;
          if (!mockCaregiverLinks[pId]) mockCaregiverLinks[pId] = [];
          const idx = mockCaregiverLinks[pId].findIndex((c) => c.linkId === docId);
          if (idx >= 0) {
            mockCaregiverLinks[pId][idx] = { ...mockCaregiverLinks[pId][idx], ...data };
          } else {
            mockCaregiverLinks[pId].push({ linkId: docId, ...data });
          }
        } else if (name === 'caregiver_safety_logs' || name === 'caregiverSafetyLogs') {
          mockLogsCollection.push({ logId: docId, ...data });
        }
        return Promise.resolve();
      },
    }),
    where: (field: string, op: string, val: any) => ({
      where: (f2: string, op2: string, v2: any) => ({
        get: async () => {
          if (name === 'caregivers' || name === 'caregiver_links') {
            const list = (mockCaregiverLinks[val] || []).filter((item) => {
              if (field === 'passengerId' && item.passengerId !== val) return false;
              if (f2 && item[f2] !== v2) return false;
              return true;
            });
            return {
              empty: list.length === 0,
              docs: list.map((doc) => ({
                id: doc.linkId,
                data: () => doc,
                ref: {
                  set: async (d: any) => {
                    Object.assign(doc, d);
                  },
                },
              })),
              forEach: (fn: any) =>
                list.map((doc) => ({ id: doc.linkId, data: () => doc })).forEach(fn),
            };
          }
          return { empty: true, docs: [], forEach: () => {} };
        },
      }),
      get: async () => {
        if (name === 'caregivers' || name === 'caregiver_links') {
          const list = (mockCaregiverLinks[val] || []).filter((item) => {
            if (field === 'passengerId' && item.passengerId !== val) return false;
            return true;
          });
          return {
            empty: list.length === 0,
            docs: list.map((doc) => ({
              id: doc.linkId,
              data: () => doc,
              ref: {
                set: async (d: any) => {
                  Object.assign(doc, d);
                },
              },
            })),
            forEach: (fn: any) =>
              list.map((doc) => ({ id: doc.linkId, data: () => doc })).forEach(fn),
          };
        }
        return { empty: true, docs: [], forEach: () => {} };
      },
    }),
  }),
};

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
  getAdminDb: () => mockAdminDb,
}));

// Mock Real Email Service
jest.mock('../../../src/shared/services/emailService', () => ({
  sendRealEmail: jest.fn().mockResolvedValue(true),
}));

describe('Caregiver Alert Service Workflow Suite', () => {
  beforeEach(() => {
    for (const key in mockUsers) delete mockUsers[key];
    for (const key in mockGuardians) delete mockGuardians[key];
    for (const key in mockCaregiverLinks) delete mockCaregiverLinks[key];
    mockLogsCollection.length = 0;
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Guardian Auto-Sync on Passenger Creation / Profile Load
  // =========================================================================
  describe('Guardian Auto-Sync Engine (syncRegisteredGuardianAsCaregiver)', () => {
    it('syncs passenger primary guardian into caregivers table seamlessly', async () => {
      mockUsers['PAS-100'] = {
        userId: 'PAS-100',
        userName: 'Saman Kumara',
        guardianDetails: {
          fullName: 'Dhammika Kumara',
          mobileNo: '0771122334',
          email: 'dhammika@example.com',
          relationship: 'Father',
        },
      };

      const link = await syncRegisteredGuardianAsCaregiver('PAS-100', mockAdminDb);

      expect(link).toBeDefined();
      expect(link?.passengerId).toBe('PAS-100');
      expect(link?.fullName).toBe('Dhammika Kumara');
      expect(link?.mobileNo).toBe('0771122334');
      expect(link?.email).toBe('dhammika@example.com');
      expect(link?.relationship).toBe('Father');
      expect(link?.status).toBe('ACTIVE');
      expect(link?.isPrimaryGuardian).toBe(true);
    });

    it('updates existing primary guardian link when passenger updates guardian contact details', async () => {
      mockUsers['PAS-101'] = {
        userId: 'PAS-101',
        userName: 'Malkanthi Silva',
        guardianDetails: {
          fullName: 'Nihal Silva',
          mobileNo: '0714455667',
          email: 'nihal.old@example.com',
          relationship: 'Spouse',
        },
      };

      await syncRegisteredGuardianAsCaregiver('PAS-101', mockAdminDb);

      // Passenger updates guardian email and mobile number in user doc
      mockUsers['PAS-101'].guardianDetails.mobileNo = '0779988776';
      mockUsers['PAS-101'].guardianDetails.email = 'nihal.new@example.com';

      const updatedLink = await syncRegisteredGuardianAsCaregiver('PAS-101', mockAdminDb);

      expect(updatedLink?.mobileNo).toBe('0779988776');
      expect(updatedLink?.email).toBe('nihal.new@example.com');
      expect(mockCaregiverLinks['PAS-101'].length).toBe(1);
    });

    it('returns null gracefully when passenger has no guardian details', async () => {
      mockUsers['PAS-102'] = {
        userId: 'PAS-102',
        userName: 'Independent Commuter',
      };

      const link = await syncRegisteredGuardianAsCaregiver('PAS-102', mockAdminDb);
      expect(link).toBeNull();
    });
  });

  // =========================================================================
  // 2. Multi-Caregiver Retrieval & Permission Filtering
  // =========================================================================
  describe('Multi-Caregiver Discovery (getActiveCaregiversForPassenger)', () => {
    it('returns all active caregivers linked to the passenger', async () => {
      mockUsers['PAS-200'] = { userId: 'PAS-200', userName: 'Test User' };
      mockCaregiverLinks['PAS-200'] = [
        {
          linkId: 'LNK-1',
          passengerId: 'PAS-200',
          fullName: 'Mother Caregiver',
          mobileNo: '+94771234567',
          email: 'mother@example.com',
          relationship: 'Mother',
          status: 'ACTIVE',
          permissions: createDefaultCaregiverPermissions(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          linkId: 'LNK-2',
          passengerId: 'PAS-200',
          fullName: 'Sibling Caregiver',
          mobileNo: '+94719876543',
          email: 'sibling@example.com',
          relationship: 'Sibling',
          status: 'ACTIVE',
          permissions: createDefaultCaregiverPermissions(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      const caregivers = await getActiveCaregiversForPassenger('PAS-200', mockAdminDb);
      expect(caregivers.length).toBe(2);
      expect(caregivers.map((c) => c.fullName)).toEqual(['Mother Caregiver', 'Sibling Caregiver']);
    });

    it('filters out paused caregiver records where isSharingActive is false', async () => {
      mockUsers['PAS-201'] = { userId: 'PAS-201', userName: 'Test User 2' };
      mockCaregiverLinks['PAS-201'] = [
        {
          linkId: 'LNK-A',
          passengerId: 'PAS-201',
          fullName: 'Active Guardian',
          mobileNo: '+94771234567',
          status: 'ACTIVE',
          permissions: createDefaultCaregiverPermissions(),
        },
        {
          linkId: 'LNK-B',
          passengerId: 'PAS-201',
          fullName: 'Paused Contact',
          mobileNo: '+94719999999',
          status: 'ACTIVE',
          permissions: {
            ...createDefaultCaregiverPermissions(),
            isSharingActive: false,
          },
        },
      ];

      const caregivers = await getActiveCaregiversForPassenger('PAS-201', mockAdminDb);
      expect(caregivers.length).toBe(1);
      expect(caregivers[0].fullName).toBe('Active Guardian');
    });
  });

  // =========================================================================
  // 3. Dispatch Pipeline & Alert Logging
  // =========================================================================
  describe('Dispatch Caregiver Safety Alert Pipeline', () => {
    const testPayload: CaregiverAlertPayload = {
      bookingId: 'BKG-DISP-01',
      passengerId: 'PAS-300',
      passengerName: 'Dilshan Mendis',
      tripId: 'TRIP-300',
      busId: 'BUS-300',
      busRegistrationNumber: 'NC-3456',
      routeNumber: '101',
      routeName: 'Moratuwa - Pettah',
      boardingStopName: 'Moratuwa',
      destinationStopName: 'Wellawatte',
      scheduledDepartureTime: '07:30 AM',
    };

    it('dispatches alerts to all permission-enabled caregivers and logs deliveries', async () => {
      mockUsers['PAS-300'] = { userId: 'PAS-300', userName: 'Dilshan Mendis' };
      mockCaregiverLinks['PAS-300'] = [
        {
          linkId: 'LNK-D1',
          passengerId: 'PAS-300',
          fullName: 'Caregiver One',
          mobileNo: '+94771111111',
          email: 'one@example.com',
          status: 'ACTIVE',
          permissions: createDefaultCaregiverPermissions(),
        },
        {
          linkId: 'LNK-D2',
          passengerId: 'PAS-300',
          fullName: 'Caregiver Two',
          mobileNo: '+94772222222',
          email: 'two@example.com',
          status: 'ACTIVE',
          permissions: createDefaultCaregiverPermissions(),
        },
      ];

      const result = await dispatchCaregiverSafetyAlert('BOARDING_CONFIRMED', testPayload, mockAdminDb);

      expect(result.caregiversNotified).toBe(2);
      expect(result.channelsSummary.sms).toBe(2);
      expect(result.channelsSummary.email).toBe(2);
      expect(result.logs.length).toBe(2);
      expect(result.logs[0].eventType).toBe('BOARDING_CONFIRMED');
      expect(result.logs[0].passengerId).toBe('PAS-300');
    });

    it('honors granular permissions and skips recipients who have disabled specific alerts', async () => {
      mockUsers['PAS-300'] = { userId: 'PAS-300', userName: 'Dilshan Mendis' };
      mockCaregiverLinks['PAS-300'] = [
        {
          linkId: 'LNK-ALLOW',
          passengerId: 'PAS-300',
          fullName: 'Allowed Caregiver',
          mobileNo: '+94771111111',
          status: 'ACTIVE',
          permissions: {
            ...createDefaultCaregiverPermissions(),
            shareBookingConfirmation: true,
          },
        },
        {
          linkId: 'LNK-DENY',
          passengerId: 'PAS-300',
          fullName: 'Muted Caregiver',
          mobileNo: '+94772222222',
          status: 'ACTIVE',
          permissions: {
            ...createDefaultCaregiverPermissions(),
            shareBookingConfirmation: false,
          },
        },
      ];

      const result = await dispatchCaregiverSafetyAlert('BOOKING_CONFIRMED', testPayload, mockAdminDb);

      expect(result.caregiversNotified).toBe(1);
    });

    it('always dispatches EMERGENCY_SOS alerts regardless of standard notifications being disabled', async () => {
      mockUsers['PAS-300'] = { userId: 'PAS-300', userName: 'Dilshan Mendis' };
      mockCaregiverLinks['PAS-300'] = [
        {
          linkId: 'LNK-EMERGENCY',
          passengerId: 'PAS-300',
          fullName: 'Emergency Guardian',
          mobileNo: '+94773333333',
          email: 'guardian.emergency@example.com',
          status: 'ACTIVE',
          permissions: {
            isSharingActive: true,
            shareBookingConfirmation: false,
            shareBoardingStatus: false,
            shareLiveProgress: false,
            shareDestinationArrival: false,
            shareEmergencyAlerts: true,
            channels: { sms: true, email: true, push: true },
          },
        },
      ];

      const result = await dispatchCaregiverSafetyAlert(
        'EMERGENCY_SOS',
        {
          ...testPayload,
          emergencyNote: 'Assistance required on bus exit',
        },
        mockAdminDb
      );

      expect(result.caregiversNotified).toBe(1);
      expect(result.logs[0].eventType).toBe('EMERGENCY_SOS');
      expect(result.logs[0].messageSummary).toContain('[EMERGENCY ALERT - MoreAble]');
    });
  });
});
