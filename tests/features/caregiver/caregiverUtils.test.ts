/**
 * Caregiver Utilities & Formatting Test Suite (MOV-227 / MOV-228 / MOV-229 / MOV-230)
 */

import { CaregiverAlertPayload, CaregiverLink } from '../../../src/entities/caregiver/model/types';
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

describe('Caregiver Utilities & Formatting Engine', () => {
  describe('Phone Number Normalization & Validation', () => {
    it('normalizes local Sri Lankan phone numbers with leading 0 to +94 format', () => {
      expect(normalizeSriLankanPhoneNumber('0771234567')).toBe('+94771234567');
      expect(normalizeSriLankanPhoneNumber('0718899000')).toBe('+94718899000');
    });

    it('handles phone numbers without leading 0 or already in international format', () => {
      expect(normalizeSriLankanPhoneNumber('771234567')).toBe('+94771234567');
      expect(normalizeSriLankanPhoneNumber('+94771234567')).toBe('+94771234567');
      expect(normalizeSriLankanPhoneNumber('0094771234567')).toBe('+94771234567');
    });

    it('validates authentic Sri Lankan mobile numbers', () => {
      expect(isValidSriLankanMobile('0771234567')).toBe(true);
      expect(isValidSriLankanMobile('0712345678')).toBe(true);
      expect(isValidSriLankanMobile('0765554443')).toBe(true);
      expect(isValidSriLankanMobile('+94771234567')).toBe(true);

      // Invalid cases
      expect(isValidSriLankanMobile('12345')).toBe(false);
      expect(isValidSriLankanMobile('0112345678')).toBe(false); // Landline
      expect(isValidSriLankanMobile('invalid_phone')).toBe(false);
    });
  });

  describe('Email Validation', () => {
    it('validates standard email addresses correctly', () => {
      expect(isValidEmail('caregiver@example.com')).toBe(true);
      expect(isValidEmail('guardian.parent@domain.lk')).toBe(true);
      expect(isValidEmail('not-an-email')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  describe('Invite Code & Tracking Token Builders', () => {
    it('generates a 6-character alphanumeric invite code', () => {
      const code = generateCaregiverInviteCode();
      expect(typeof code).toBe('string');
      expect(code.length).toBe(6);
      expect(/^[A-Z0-9]{6}$/.test(code)).toBe(true);
    });

    it('generates a secure tracking token prefixed with TRK and current year', () => {
      const token = generateTrackingToken('BKG-2026-00001');
      expect(token.startsWith('TRK-')).toBe(true);
      expect(token).toContain(String(new Date().getFullYear()));
    });
  });

  describe('Permission Verifier (canCaregiverReceiveAlert)', () => {
    const baseLink: CaregiverLink = {
      linkId: 'LNK-1',
      passengerId: 'PAS-1',
      fullName: 'Kamal Perera',
      mobileNo: '+94771234567',
      email: 'kamal@example.com',
      relationship: 'Father',
      status: 'ACTIVE',
      permissions: createDefaultCaregiverPermissions(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    it('allows all default events when master sharing is active', () => {
      expect(canCaregiverReceiveAlert(baseLink, 'BOOKING_CONFIRMED')).toBe(true);
      expect(canCaregiverReceiveAlert(baseLink, 'BOARDING_CONFIRMED')).toBe(true);
      expect(canCaregiverReceiveAlert(baseLink, 'LIVE_LOCATION_PING')).toBe(true);
      expect(canCaregiverReceiveAlert(baseLink, 'DESTINATION_ARRIVED')).toBe(true);
      expect(canCaregiverReceiveAlert(baseLink, 'EMERGENCY_SOS')).toBe(true);
    });

    it('rejects alerts if master sharing is disabled', () => {
      const disabledLink: CaregiverLink = {
        ...baseLink,
        permissions: {
          ...baseLink.permissions,
          isSharingActive: false,
        },
      };
      expect(canCaregiverReceiveAlert(disabledLink, 'BOOKING_CONFIRMED')).toBe(false);
      expect(canCaregiverReceiveAlert(disabledLink, 'BOARDING_CONFIRMED')).toBe(false);
      expect(canCaregiverReceiveAlert(disabledLink, 'DESTINATION_ARRIVED')).toBe(false);
    });

    it('respects granular switches when specific permission is off', () => {
      const customizedLink: CaregiverLink = {
        ...baseLink,
        permissions: {
          ...baseLink.permissions,
          shareBookingConfirmation: false,
          shareBoardingStatus: true,
          shareDestinationArrival: false,
        },
      };
      expect(canCaregiverReceiveAlert(customizedLink, 'BOOKING_CONFIRMED')).toBe(false);
      expect(canCaregiverReceiveAlert(customizedLink, 'BOARDING_CONFIRMED')).toBe(true);
      expect(canCaregiverReceiveAlert(customizedLink, 'DESTINATION_ARRIVED')).toBe(false);
      expect(canCaregiverReceiveAlert(customizedLink, 'EMERGENCY_SOS')).toBe(true);
    });

    it('rejects all alerts if caregiver link status is not ACTIVE', () => {
      const revokedLink: CaregiverLink = {
        ...baseLink,
        status: 'REVOKED',
      };
      expect(canCaregiverReceiveAlert(revokedLink, 'BOARDING_CONFIRMED')).toBe(false);
    });
  });

  describe('SMS Message Formatter', () => {
    const payload: CaregiverAlertPayload = {
      bookingId: 'BKG-101',
      passengerId: 'PAS-1',
      passengerName: 'Nimali Silva',
      tripId: 'TRIP-1',
      busId: 'BUS-1',
      busRegistrationNumber: 'ND-8890',
      routeNumber: '100',
      routeName: 'Colombo - Panadura',
      boardingStopName: 'Colombo Fort',
      destinationStopName: 'Galle Face',
    };

    it('formats booking confirmation SMS with tracking URL', () => {
      const sms = formatCaregiverSmsMessage('BOOKING_CONFIRMED', payload, 'https://moreable.app/track/TRK-123');
      expect(sms).toContain('Trip booked for Nimali Silva');
      expect(sms).toContain('ND-8890');
      expect(sms).toContain('Colombo Fort to Galle Face');
      expect(sms).toContain('Track live: https://moreable.app/track/TRK-123');
    });

    it('formats boarding confirmation SMS', () => {
      const sms = formatCaregiverSmsMessage('BOARDING_CONFIRMED', payload);
      expect(sms).toContain('Nimali Silva has safely BOARDED ND-8890 at Colombo Fort');
    });

    it('formats safe destination arrival SMS', () => {
      const sms = formatCaregiverSmsMessage('DESTINATION_ARRIVED', payload);
      expect(sms).toContain('Nimali Silva has safely ARRIVED at Galle Face');
      expect(sms).toContain('Trip completed successfully');
    });

    it('formats emergency SOS beacon SMS with high priority wording', () => {
      const sosPayload = {
        ...payload,
        emergencyNote: 'Wheelchair ramp assistance required',
      };
      const sms = formatCaregiverSmsMessage('EMERGENCY_SOS', sosPayload, 'https://moreable.app/track/TRK-SOS');
      expect(sms).toContain('[EMERGENCY ALERT - MoreAble]');
      expect(sms).toContain('triggered an SOS safety beacon');
      expect(sms).toContain('Wheelchair ramp assistance required');
      expect(sms).toContain('https://moreable.app/track/TRK-SOS');
    });
  });

  describe('HTML Email Formatter', () => {
    const payload: CaregiverAlertPayload = {
      bookingId: 'BKG-101',
      passengerId: 'PAS-1',
      passengerName: 'Nimali Silva',
      tripId: 'TRIP-1',
      busId: 'BUS-1',
      busRegistrationNumber: 'ND-8890',
      routeNumber: '100',
      routeName: 'Colombo - Panadura',
      boardingStopName: 'Colombo Fort',
      destinationStopName: 'Galle Face',
      scheduledDepartureTime: '08:30 AM',
    };

    it('generates HTML email with responsive styling and tracking CTA', () => {
      const { subject, html } = formatCaregiverEmailHtml('BOARDING_CONFIRMED', payload, 'https://moreable.app/track/TRK-456');
      expect(subject).toContain('Nimali Silva has boarded Bus ND-8890');
      expect(html).toContain('MoreAble');
      expect(html).toContain('Colombo Fort');
      expect(html).toContain('Galle Face');
      expect(html).toContain('View Live Bus Tracking');
      expect(html).toContain('https://moreable.app/track/TRK-456');
    });

    it('generates emergency SOS HTML email with urgent alert subject', () => {
      const { subject, html } = formatCaregiverEmailHtml('EMERGENCY_SOS', payload);
      expect(subject).toContain('URGENT EMERGENCY');
      expect(html).toContain('Emergency SOS Beacon Triggered');
    });
  });
});
