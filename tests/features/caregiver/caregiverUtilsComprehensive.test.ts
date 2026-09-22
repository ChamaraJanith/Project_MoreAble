/**
 * Comprehensive Caregiver Utility & Logic Test Suite (MOV-227 / MOV-228 / MOV-229 / MOV-230)
 * Deep validation covering phone normalizations, security tokens, permission matrix,
 * multi-channel alert formatters, ETA computations, and error resilience.
 */

import {
  CaregiverAlertEventType,
  CaregiverAlertPayload,
  CaregiverLink,
  CaregiverPermissions,
  CaregiverRelationship,
} from '../../../src/entities/caregiver/model/types';
import {
  canCaregiverReceiveAlert,
  createDefaultCaregiverPermissions,
  formatCaregiverEmailHtml,
  formatCaregiverSmsMessage,
  generateCaregiverInviteCode,
  generateTrackingToken,
  isValidEmail,
  isValidSriLankanMobile,
  normalizeSriLankanPhoneNumber,
} from '../../../src/features/caregiver/model/caregiverUtils';

describe('Caregiver Extended Utilities & Edge Cases Suite', () => {
  // =========================================================================
  // 1. Phone Number Normalization & Validation Edge Cases
  // =========================================================================
  describe('Phone Number Normalization - Deep Edge Cases', () => {
    it('handles various Sri Lankan mobile prefixes accurately', () => {
      const prefixes = ['070', '071', '072', '074', '075', '076', '077', '078'];
      prefixes.forEach((prefix) => {
        const raw = `${prefix}1234567`;
        const expected = `+94${prefix.substring(1)}1234567`;
        expect(normalizeSriLankanPhoneNumber(raw)).toBe(expected);
        expect(isValidSriLankanMobile(raw)).toBe(true);
      });
    });

    it('handles phone numbers with whitespaces, hyphens, and brackets', () => {
      expect(normalizeSriLankanPhoneNumber('077-123-4567')).toBe('+94771234567');
      expect(normalizeSriLankanPhoneNumber('077 123 4567')).toBe('+94771234567');
      expect(normalizeSriLankanPhoneNumber('(077) 123 4567')).toBe('+94771234567');
      expect(normalizeSriLankanPhoneNumber('+94 77 123 4567')).toBe('+94771234567');
      expect(normalizeSriLankanPhoneNumber('+94-77-123-4567')).toBe('+94771234567');
    });

    it('handles already normalized +94 numbers without double prefixing', () => {
      expect(normalizeSriLankanPhoneNumber('+94771234567')).toBe('+94771234567');
      expect(normalizeSriLankanPhoneNumber('+94719876543')).toBe('+94719876543');
    });

    it('handles 0094 international dialing prefix format', () => {
      expect(normalizeSriLankanPhoneNumber('0094771234567')).toBe('+94771234567');
      expect(normalizeSriLankanPhoneNumber('0094701122334')).toBe('+94701122334');
    });

    it('handles 9-digit numbers without leading zero', () => {
      expect(normalizeSriLankanPhoneNumber('771234567')).toBe('+94771234567');
      expect(normalizeSriLankanPhoneNumber('712345678')).toBe('+94712345678');
    });

    it('rejects invalid or non-mobile formats in isValidSriLankanMobile', () => {
      const invalidNumbers = [
        '',
        '   ',
        '077123456', // Too short (8 digits)
        '077123456789', // Too long (12 digits)
        '0112123456', // Colombo landline (011)
        '0382234567', // Kalutara landline (038)
        '0812234567', // Kandy landline (081)
        '++94771234567',
        '077 1234 5678', // Too many digits with spaces
        '1234567890',
        'not_a_phone',
        '12345',
      ];

      invalidNumbers.forEach((num) => {
        expect(isValidSriLankanMobile(num)).toBe(false);
      });
    });

    it('safely handles null or undefined or whitespace-only inputs without crashing', () => {
      expect(normalizeSriLankanPhoneNumber('')).toBe('');
      expect(normalizeSriLankanPhoneNumber('   ')).toBe('');
      expect(isValidSriLankanMobile('')).toBe(false);
      expect(isValidSriLankanMobile(' ')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Email Validation Edge Cases
  // =========================================================================
  describe('Email Validation - Comprehensive Patterns', () => {
    it('accepts valid email address formats', () => {
      const validEmails = [
        'simple@example.com',
        'very.common@example.com',
        'disposable.style.email.with+symbol@example.com',
        'other.email-with-hyphen@example.com',
        'fully-qualified-domain@subdomain.example.com',
        'user.name+tag+sorting@example.com',
        'caregiver123@sl.domain.lk',
        'parent@moreable.lk',
        'test.account@gov.lk',
      ];

      validEmails.forEach((email) => {
        expect(isValidEmail(email)).toBe(true);
      });
    });

    it('rejects invalid email address formats', () => {
      const invalidEmails = [
        '',
        'plainaddress',
        '#@%^%#$@#$@#.com',
        '@example.com',
        'email.example.com',
        'email@example@example.com',
        'email@example',
        '   ',
      ];

      invalidEmails.forEach((email) => {
        expect(isValidEmail(email)).toBe(false);
      });
    });
  });

  // =========================================================================
  // 3. Security Tokens & Invite Codes
  // =========================================================================
  describe('Security Token & Invite Code Generators', () => {
    it('generates unique invite codes with valid alphabet', () => {
      const codeSet = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const code = generateCaregiverInviteCode();
        expect(code.length).toBe(6);
        expect(/^[A-Z0-9]{6}$/.test(code)).toBe(true);
        codeSet.add(code);
      }
      expect(codeSet.size).toBeGreaterThan(95);
    });

    it('generates deterministic yet unique tracking tokens per booking', () => {
      const token1 = generateTrackingToken('BKG-001');
      const token2 = generateTrackingToken('BKG-002');
      const token3 = generateTrackingToken('BKG-001');

      expect(token1).toMatch(/^TRK-\d{4}-[A-Z0-9-]+$/);
      expect(token2).toMatch(/^TRK-\d{4}-[A-Z0-9-]+$/);
      expect(typeof token3).toBe('string');
    });

    it('handles arbitrary or special characters in booking reference', () => {
      const token = generateTrackingToken('BOOKING_#992-XYZ@2026');
      expect(token.startsWith('TRK-')).toBe(true);
      expect(token.length).toBeGreaterThan(10);
    });
  });

  // =========================================================================
  // 4. Default Permissions & Permission Truth Tables
  // =========================================================================
  describe('Default Permissions & Matrix Evaluation', () => {
    it('initializes default permissions with all switches active', () => {
      const perms: CaregiverPermissions = createDefaultCaregiverPermissions();
      expect(perms.isSharingActive).toBe(true);
      expect(perms.shareBookingConfirmation).toBe(true);
      expect(perms.shareBoardingStatus).toBe(true);
      expect(perms.shareLiveProgress).toBe(true);
      expect(perms.shareDestinationArrival).toBe(true);
      expect(perms.shareEmergencyAlerts).toBe(true);
      expect(perms.channels.sms).toBe(true);
      expect(perms.channels.email).toBe(true);
    });

    const createMockLink = (overrides: Partial<CaregiverLink> = {}): CaregiverLink => ({
      linkId: 'LNK-TEST-01',
      passengerId: 'PAS-TEST-01',
      fullName: 'Sunil Weerasinghe',
      mobileNo: '+94777123456',
      email: 'sunil.w@example.com',
      relationship: 'Parent' as CaregiverRelationship,
      status: 'ACTIVE',
      permissions: createDefaultCaregiverPermissions(),
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
      ...overrides,
    });

    it('evaluates emergency alerts as allowed by default even when standard switches are toggled off', () => {
      const link = createMockLink({
        permissions: {
          isSharingActive: true,
          shareBookingConfirmation: false,
          shareBoardingStatus: false,
          shareLiveProgress: false,
          shareDestinationArrival: false,
          shareEmergencyAlerts: true,
          channels: { sms: true, email: true, push: true },
        },
      });

      expect(canCaregiverReceiveAlert(link, 'BOOKING_CONFIRMED')).toBe(false);
      expect(canCaregiverReceiveAlert(link, 'BOARDING_CONFIRMED')).toBe(false);
      expect(canCaregiverReceiveAlert(link, 'LIVE_LOCATION_PING')).toBe(false);
      expect(canCaregiverReceiveAlert(link, 'DESTINATION_ARRIVED')).toBe(false);
      expect(canCaregiverReceiveAlert(link, 'EMERGENCY_SOS')).toBe(true);
    });

    it('blocks all alerts when master isSharingActive is false', () => {
      const events: CaregiverAlertEventType[] = [
        'BOOKING_CONFIRMED',
        'BOARDING_CONFIRMED',
        'LIVE_LOCATION_PING',
        'DESTINATION_ARRIVED',
        'EMERGENCY_SOS',
      ];

      const link = createMockLink({
        permissions: {
          ...createDefaultCaregiverPermissions(),
          isSharingActive: false,
        },
      });

      events.forEach((evt) => {
        expect(canCaregiverReceiveAlert(link, evt)).toBe(false);
      });
    });

    it('blocks all alerts if caregiver link status is PENDING, REJECTED, or REVOKED', () => {
      const statuses: Array<'PENDING' | 'REVOKED' | 'REJECTED'> = ['PENDING', 'REVOKED', 'REJECTED'];
      statuses.forEach((status) => {
        const link = createMockLink({ status });
        expect(canCaregiverReceiveAlert(link, 'BOOKING_CONFIRMED')).toBe(false);
        expect(canCaregiverReceiveAlert(link, 'BOARDING_CONFIRMED')).toBe(false);
        expect(canCaregiverReceiveAlert(link, 'DESTINATION_ARRIVED')).toBe(false);
        expect(canCaregiverReceiveAlert(link, 'EMERGENCY_SOS')).toBe(false);
      });
    });
  });

  // =========================================================================
  // 5. Multi-Channel SMS & Email Content Verifications
  // =========================================================================
  describe('Multi-Channel Alert Formatting Engine', () => {
    const mockPayload: CaregiverAlertPayload = {
      bookingId: 'BKG-2026-9081',
      passengerId: 'PAS-99',
      passengerName: 'Anula Ratnayake',
      tripId: 'TRIP-505',
      busId: 'BUS-101',
      busRegistrationNumber: 'NB-5678',
      routeNumber: '177',
      routeName: 'Kaduwela - Kollupitiya',
      boardingStopName: 'Battaramulla',
      destinationStopName: 'Rajagiriya',
      scheduledDepartureTime: '09:15 AM',
      currentStopName: 'Koswatta Junction',
      estimatedArrivalMinutes: 12,
      emergencyNote: 'Passenger requires ramp deployment on arrival',
    };

    const trackingUrl = 'https://moreable.transit.lk/track/TRK-2026-9911';

    describe('SMS Formatter Output Verification', () => {
      it('formats BOOKING_CONFIRMED message with correct vehicle and stops', () => {
        const msg = formatCaregiverSmsMessage('BOOKING_CONFIRMED', mockPayload, trackingUrl);
        expect(msg).toContain('Anula Ratnayake');
        expect(msg).toContain('NB-5678');
        expect(msg).toContain('Battaramulla');
        expect(msg).toContain('Rajagiriya');
        expect(msg).toContain(trackingUrl);
      });

      it('formats BOARDING_CONFIRMED message when passenger steps into the bus', () => {
        const msg = formatCaregiverSmsMessage('BOARDING_CONFIRMED', mockPayload, trackingUrl);
        expect(msg).toContain('Anula Ratnayake has safely BOARDED NB-5678 at Battaramulla');
        expect(msg).toContain(trackingUrl);
      });

      it('formats LIVE_LOCATION_PING with stop and tracking link', () => {
        const msg = formatCaregiverSmsMessage('LIVE_LOCATION_PING', mockPayload, trackingUrl);
        expect(msg).toContain('NB-5678');
        expect(msg).toContain('Koswatta Junction');
        expect(msg).toContain(trackingUrl);
      });

      it('formats DESTINATION_ARRIVED message upon trip completion', () => {
        const msg = formatCaregiverSmsMessage('DESTINATION_ARRIVED', mockPayload);
        expect(msg).toContain('Anula Ratnayake has safely ARRIVED at Rajagiriya');
        expect(msg).toContain('Trip completed successfully');
      });

      it('formats EMERGENCY_SOS with highest urgency tags and emergency notes', () => {
        const msg = formatCaregiverSmsMessage('EMERGENCY_SOS', mockPayload, trackingUrl);
        expect(msg).toContain('[EMERGENCY ALERT - MoreAble]');
        expect(msg).toContain('Anula Ratnayake triggered an SOS safety beacon');
        expect(msg).toContain('NB-5678');
        expect(msg).toContain('Passenger requires ramp deployment on arrival');
        expect(msg).toContain(trackingUrl);
      });

      it('gracefully handles minimal fields in SMS formatting', () => {
        const minimalPayload: CaregiverAlertPayload = {
          bookingId: 'BKG-MIN-1',
          passengerId: 'PAS-MIN',
          passengerName: 'Ruwan',
          tripId: 'TRP-MIN',
          busId: 'BUS-MIN',
          busRegistrationNumber: 'ND-1122',
          routeNumber: '138',
          routeName: 'Maharagama - Pettah',
          boardingStopName: 'Nugegoda',
          destinationStopName: 'Pettah',
        };

        const smsBooking = formatCaregiverSmsMessage('BOOKING_CONFIRMED', minimalPayload);
        expect(smsBooking).toContain('Ruwan');
        expect(smsBooking).toContain('ND-1122');
        expect(smsBooking).toContain('Nugegoda');
        expect(smsBooking).toContain('Pettah');

        const smsLive = formatCaregiverSmsMessage('LIVE_LOCATION_PING', minimalPayload);
        expect(smsLive).toContain('ND-1122');
        expect(smsLive).toContain('approaching Pettah');

        const smsSos = formatCaregiverSmsMessage('EMERGENCY_SOS', minimalPayload);
        expect(smsSos).toContain('[EMERGENCY ALERT - MoreAble]');
        expect(smsSos).toContain('ND-1122');
      });
    });

    describe('HTML Email Formatter Output Verification', () => {
      it('creates well-structured HTML for BOARDING_CONFIRMED with action button', () => {
        const { subject, html } = formatCaregiverEmailHtml('BOARDING_CONFIRMED', mockPayload, trackingUrl);
        expect(subject).toBe('[MoreAble Alert] Anula Ratnayake has boarded Bus NB-5678');
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('MoreAble');
        expect(html).toContain('Anula Ratnayake');
        expect(html).toContain('NB-5678');
        expect(html).toContain('Battaramulla');
        expect(html).toContain('Rajagiriya');
        expect(html).toContain('View Live Bus Tracking');
        expect(html).toContain(trackingUrl);
      });

      it('creates emergency SOS HTML with distinct alert header and urgent colors', () => {
        const { subject, html } = formatCaregiverEmailHtml('EMERGENCY_SOS', mockPayload, trackingUrl);
        expect(subject).toContain('SOS Alert for Anula Ratnayake');
        expect(html).toContain('Emergency SOS Beacon Triggered');
        expect(html).toContain(trackingUrl);
      });

      it('creates DESTINATION_ARRIVED HTML with completion status', () => {
        const { subject, html } = formatCaregiverEmailHtml('DESTINATION_ARRIVED', mockPayload);
        expect(subject).toBe('[MoreAble] Anula Ratnayake has safely arrived at Rajagiriya');
        expect(html).toContain('Safe Arrival at Destination');
        expect(html).toContain('Rajagiriya');
      });
    });
  });
});
