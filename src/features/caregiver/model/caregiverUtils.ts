/**
 * Caregiver Utilities & Formatting Engine (MOV-227 / MOV-228 / MOV-229 / MOV-230)
 *
 * Implements SMS message templates, HTML email generators, phone number sanitizers,
 * permission verifiers, and secure tracking token builders.
 */

import {
  CaregiverAlertEventType,
  CaregiverAlertPayload,
  CaregiverLink,
  CaregiverPermissions,
} from '../../../entities/caregiver/model/types';

/**
 * Generates default permissions for a newly linked caregiver or synchronized guardian.
 */
export function createDefaultCaregiverPermissions(): CaregiverPermissions {
  return {
    isSharingActive: true,
    shareBookingConfirmation: true,
    shareBoardingStatus: true,
    shareLiveProgress: true,
    shareDestinationArrival: true,
    shareEmergencyAlerts: true,
    channels: {
      sms: true,
      email: true,
      push: true,
    },
  };
}

/**
 * Normalizes a Sri Lankan phone number to consistent international +94 format.
 * Examples: '0771234567' -> '+94771234567', '771234567' -> '+94771234567'
 */
export function normalizeSriLankanPhoneNumber(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/[^0-9+]/g, '');

  if (cleaned.startsWith('+94')) {
    return cleaned;
  }
  if (cleaned.startsWith('0094')) {
    return `+94${cleaned.slice(4)}`;
  }
  if (cleaned.startsWith('0')) {
    return `+94${cleaned.slice(1)}`;
  }
  if (cleaned.length === 9) {
    return `+94${cleaned}`;
  }
  return cleaned;
}

/**
 * Validates Sri Lankan mobile phone numbers.
 */
export function isValidSriLankanMobile(phone: string): boolean {
  const normalized = normalizeSriLankanPhoneNumber(phone);
  // Sri Lankan mobile prefix starts with +947 followed by 8 digits
  return /^\+947[0-9]{8}$/.test(normalized);
}

/**
 * Validates basic email formatting.
 */
export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Formats a 6-character alphanumeric pairing/invite code.
 */
export function generateCaregiverInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Generates a unique tracking token for zero-login web tracking.
 * Format: TRK-{YEAR}-{TIMESTAMP_HASH}-{RANDOM}
 */
export function generateTrackingToken(bookingId: string): string {
  const cleanId = bookingId ? bookingId.replace(/[^A-Za-z0-9]/g, '') : 'LIVE';
  const salt = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TRK-${new Date().getFullYear()}-${cleanId.slice(-6)}-${salt}`;
}

/**
 * Checks if a caregiver is authorized to receive an alert of the given type.
 */
export function canCaregiverReceiveAlert(
  link: CaregiverLink,
  eventType: CaregiverAlertEventType
): boolean {
  if (!link || link.status !== 'ACTIVE') return false;
  const p = link.permissions;
  if (!p || !p.isSharingActive) return false;

  switch (eventType) {
    case 'BOOKING_CONFIRMED':
      return Boolean(p.shareBookingConfirmation);
    case 'BOARDING_CONFIRMED':
      return Boolean(p.shareBoardingStatus);
    case 'LIVE_LOCATION_PING':
    case 'DELAY_DETECTED':
      return Boolean(p.shareLiveProgress);
    case 'DESTINATION_ARRIVED':
      return Boolean(p.shareDestinationArrival);
    case 'EMERGENCY_SOS':
      return Boolean(p.shareEmergencyAlerts);
    default:
      return false;
  }
}

/**
 * Formats concise, informative SMS messages for transit safety updates.
 */
export function formatCaregiverSmsMessage(
  eventType: CaregiverAlertEventType,
  payload: CaregiverAlertPayload,
  trackingUrl?: string
): string {
  const name = payload.passengerName || 'Your loved one';
  const bus = payload.busRegistrationNumber || payload.busId || 'Bus';
  const route = payload.routeNumber ? `Route ${payload.routeNumber}` : 'Transit';
  const from = payload.boardingStopName || 'Origin';
  const to = payload.destinationStopName || 'Destination';
  const linkText = trackingUrl ? ` Track live: ${trackingUrl}` : '';

  switch (eventType) {
    case 'BOOKING_CONFIRMED':
      return `[MoreAble Safety] Trip booked for ${name} on ${bus} (${route}) from ${from} to ${to}.${linkText}`;

    case 'BOARDING_CONFIRMED':
      return `[MoreAble Safety] ${name} has safely BOARDED ${bus} at ${from}. Expected at ${to}.${linkText}`;

    case 'DELAY_DETECTED':
      const delayMins = payload.estimatedArrivalMinutes ? `~${payload.estimatedArrivalMinutes} min` : 'a brief delay';
      return `[MoreAble Safety Update] ${bus} carrying ${name} is experiencing ${delayMins} delay near ${payload.currentStopName || 'en-route'}.${linkText}`;

    case 'DESTINATION_ARRIVED':
      return `[MoreAble Safety] ${name} has safely ARRIVED at ${to}. Trip completed successfully.`;

    case 'EMERGENCY_SOS':
      const extra = payload.emergencyNote ? ` Note: "${payload.emergencyNote}"` : '';
      return `[EMERGENCY ALERT - MoreAble] ${name} triggered an SOS safety beacon on ${bus} near ${payload.currentStopName || from}!${extra}${linkText} Please call passenger or driver immediately.`;

    case 'LIVE_LOCATION_PING':
    default:
      return `[MoreAble Safety] ${name} is currently traveling on ${bus} approaching ${payload.currentStopName || to}.${linkText}`;
  }
}

/**
 * Generates a clean, accessible HTML email template for caregiver updates.
 */
export function formatCaregiverEmailHtml(
  eventType: CaregiverAlertEventType,
  payload: CaregiverAlertPayload,
  trackingUrl?: string
): { subject: string; html: string } {
  const name = payload.passengerName || 'Passenger';
  const bus = payload.busRegistrationNumber || payload.busId || 'Express Bus';
  const route = payload.routeNumber ? `Route ${payload.routeNumber} (${payload.routeName || 'Standard Service'})` : 'Public Bus Service';
  const from = payload.boardingStopName || 'Origin Point';
  const to = payload.destinationStopName || 'Destination Point';

  let subject = `[MoreAble Safety] Journey update for ${name}`;
  let headline = `Journey Status Update`;
  let badgeColor = '#0284C7';
  let badgeText = 'STATUS UPDATE';
  let statusDetail = `${name} is traveling safely on public transit.`;

  if (eventType === 'BOOKING_CONFIRMED') {
    subject = `[MoreAble] Trip Confirmed for ${name} (${from} ➔ ${to})`;
    headline = `Trip Booking Confirmed`;
    badgeColor = '#0D9488';
    badgeText = 'BOOKING CONFIRMED';
    statusDetail = `${name} has reserved a travel seat on ${bus}. Scheduled departure: ${payload.scheduledDepartureTime || 'Scheduled Time'}.`;
  } else if (eventType === 'BOARDING_CONFIRMED') {
    subject = `[MoreAble Alert] ${name} has boarded Bus ${bus}`;
    headline = `Passenger Safely Boarded`;
    badgeColor = '#16A34A';
    badgeText = 'BOARDED SAFELY';
    statusDetail = `${name} has scanned their ticket and successfully boarded the vehicle at ${from}.`;
  } else if (eventType === 'DELAY_DETECTED') {
    subject = `[MoreAble Notice] Transit Delay Alert for ${name}`;
    headline = `Transit Delay Notice`;
    badgeColor = '#D97706';
    badgeText = 'TRANSIT DELAY';
    statusDetail = `Bus ${bus} is moving slower due to traffic near ${payload.currentStopName || 'en route'}.`;
  } else if (eventType === 'DESTINATION_ARRIVED') {
    subject = `[MoreAble] ${name} has safely arrived at ${to}`;
    headline = `Safe Arrival at Destination`;
    badgeColor = '#10B981';
    badgeText = 'ARRIVED SAFELY';
    statusDetail = `${name} has reached ${to} and alighted safely. The journey is now complete.`;
  } else if (eventType === 'EMERGENCY_SOS') {
    subject = `🚨 [URGENT EMERGENCY] SOS Alert for ${name} on Bus ${bus}`;
    headline = `Emergency SOS Beacon Triggered`;
    badgeColor = '#DC2626';
    badgeText = 'EMERGENCY SOS';
    statusDetail = `An emergency safety beacon was triggered by or for ${name}. Immediate attention is advised.`;
  }

  const trackingButton = trackingUrl
    ? `
    <div style="margin: 28px 0; text-align: center;">
      <a href="${trackingUrl}" style="background-color: #0284C7; color: #ffffff; padding: 14px 28px; font-weight: 700; font-size: 16px; border-radius: 8px; text-decoration: none; display: inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        📍 View Live Bus Tracking (No Login Required)
      </a>
      <p style="font-size: 12px; color: #64748B; margin-top: 8px;">Tap link to view real-time bus location, live GPS position & estimated arrival time.</p>
    </div>`
    : '';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8FAFC; margin: 0; padding: 24px; color: #1E293B;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #FFFFFF; border-radius: 12px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);">
    
    <!-- Brand Header -->
    <div style="background-color: #0F172A; padding: 20px 24px; border-bottom: 3px solid #0284C7;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <h1 style="color: #FFFFFF; font-size: 20px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">MoreAble <span style="color: #38BDF8; font-size: 14px; font-weight: 500;">Safety Network</span></h1>
        <span style="background-color: ${badgeColor}; color: #FFFFFF; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase;">${badgeText}</span>
      </div>
    </div>

    <!-- Main Body Content -->
    <div style="padding: 24px;">
      <h2 style="font-size: 20px; font-weight: 700; color: #0F172A; margin: 0 0 8px 0;">${headline}</h2>
      <p style="font-size: 15px; line-height: 1.5; color: #334155; margin: 0 0 20px 0;">${statusDetail}</p>

      <!-- Journey Card -->
      <div style="background-color: #F1F5F9; border-radius: 8px; padding: 18px; border: 1px solid #CBD5E1; margin-bottom: 20px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748B; font-weight: 600; width: 35%;">Passenger:</td>
            <td style="padding: 6px 0; color: #0F172A; font-weight: 700;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Vehicle:</td>
            <td style="padding: 6px 0; color: #0F172A; font-weight: 600;">${bus} (${route})</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Boarding Stop:</td>
            <td style="padding: 6px 0; color: #0F172A; font-weight: 600;">${from}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Destination:</td>
            <td style="padding: 6px 0; color: #0F172A; font-weight: 600;">${to}</td>
          </tr>
          ${payload.scheduledDepartureTime ? `
          <tr>
            <td style="padding: 6px 0; color: #64748B; font-weight: 600;">Departure:</td>
            <td style="padding: 6px 0; color: #0F172A; font-weight: 600;">${payload.scheduledDepartureTime}</td>
          </tr>` : ''}
        </table>
      </div>

      <!-- Live Tracking CTA -->
      ${trackingButton}

      <!-- Safety Notice -->
      <div style="background-color: #EFF6FF; border-left: 4px solid #3B82F6; padding: 12px 16px; border-radius: 4px; margin-top: 24px;">
        <p style="font-size: 13px; color: #1E40AF; margin: 0; line-height: 1.4;">
          <strong>Why did you receive this?</strong> You are listed as an authorized caregiver/guardian for ${name}. You can manage notifications directly through the passenger's MoreAble safety settings.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color: #F8FAFC; border-top: 1px solid #E2E8F0; padding: 16px 24px; text-align: center;">
      <p style="font-size: 12px; color: #94A3B8; margin: 0;">MoreAble Accessible Transit Platform • Automated Passenger Safety Dispatcher</p>
    </div>

  </div>
</body>
</html>
`;

  return { subject, html };
}
