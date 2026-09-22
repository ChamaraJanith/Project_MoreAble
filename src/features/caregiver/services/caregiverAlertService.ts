/**
 * Caregiver Alert Dispatcher & Guardian Sync Service (MOV-227 / MOV-230)
 *
 * Coordinates multi-channel alert dispatching (SMS, HTML Email, Push Notifications)
 * to authorized caregivers and synchronizes legacy/registration guardians into the
 * multi-caregiver link repository.
 */

import {
  CaregiverAlertEventType,
  CaregiverAlertPayload,
  CaregiverDispatchChannel,
  CaregiverLink,
  CaregiverSafetyLog,
} from '../../../entities/caregiver/model/types';
import { getAdminDb } from '../../../shared/config/firebaseAdmin';
import { sendPushNotificationToUser } from '../../../shared/services/pushNotificationDispatcher';
import { sendRealEmail } from '../../../shared/services/emailService';
import {
  canCaregiverReceiveAlert,
  createDefaultCaregiverPermissions,
  formatCaregiverEmailHtml,
  formatCaregiverSmsMessage,
  generateTrackingToken,
} from '../model/caregiverUtils';

export const CAREGIVER_LINKS_COLLECTION = 'caregiver_links';
export const CAREGIVER_LOGS_COLLECTION = 'caregiver_safety_logs';

/**
 * Synchronizes the registered Guardian from the teammate's registration flow
 * (`users` / `guardians` collection) into `caregiver_links` as the primary caregiver.
 */
export async function syncRegisteredGuardianAsCaregiver(
  passengerId: string,
  adminDb = getAdminDb()
): Promise<CaregiverLink | null> {
  if (!passengerId) return null;

  try {
    const userDoc = await adminDb.collection('users').doc(passengerId).get();
    if (!userDoc.exists) return null;

    const userData = userDoc.data() || {};
    const guardianId = userData.guardianId;
    const guardianDetails = userData.guardianDetails;

    let fullName = guardianDetails?.fullName || '';
    let mobileNo = guardianDetails?.mobileNo || '';
    let email = guardianDetails?.email || '';
    let nicNo = guardianDetails?.nicNo || '';
    let relationship = guardianDetails?.relationship || 'Guardian';

    // If guardianId exists, fetch latest from guardians collection
    if (guardianId) {
      const gDoc = await adminDb.collection('guardians').doc(guardianId).get();
      if (gDoc.exists) {
        const gData = gDoc.data() || {};
        fullName = gData.fullName || fullName;
        mobileNo = gData.mobileNo || mobileNo;
        email = gData.email || email;
        nicNo = gData.nicNo || nicNo;
        relationship = gData.relationship || relationship;
      }
    }

    if (!fullName || (!mobileNo && !email)) {
      return null;
    }

    // Check if link already exists in caregiver_links for this passenger & guardian
    const existingSnap = await adminDb
      .collection(CAREGIVER_LINKS_COLLECTION)
      .where('passengerId', '==', passengerId)
      .where('isPrimaryGuardian', '==', true)
      .get();

    const now = new Date().toISOString();

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      const existingLink = existingDoc.data() as CaregiverLink;
      // Sync latest contact info if changed
      if (
        existingLink.fullName !== fullName ||
        existingLink.mobileNo !== mobileNo ||
        existingLink.email !== email ||
        existingLink.relationship !== relationship
      ) {
        await existingDoc.ref.set(
          {
            fullName,
            mobileNo,
            email,
            nicNo,
            relationship,
            updatedAt: now,
          },
          { merge: true }
        );
      }
      return {
        ...existingLink,
        fullName,
        mobileNo,
        email,
        relationship,
      };
    }

    // Create primary caregiver link record
    const linkId = `LNK-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`;
    const primaryLink: CaregiverLink = {
      linkId,
      passengerId,
      passengerName: userData.userName || 'Passenger',
      caregiverId: guardianId || null,
      fullName,
      mobileNo,
      email,
      nicNo,
      relationship,
      isPrimaryGuardian: true,
      status: 'ACTIVE',
      permissions: createDefaultCaregiverPermissions(),
      createdAt: now,
      updatedAt: now,
    };

    await adminDb.collection(CAREGIVER_LINKS_COLLECTION).doc(linkId).set(primaryLink);
    return primaryLink;
  } catch (err) {
    console.error('syncRegisteredGuardianAsCaregiver error:', err);
    return null;
  }
}

/**
 * Fetches all active caregiver links for a given passenger.
 */
export async function getActiveCaregiversForPassenger(
  passengerId: string,
  adminDb = getAdminDb()
): Promise<CaregiverLink[]> {
  if (!passengerId) return [];

  // Ensure registration guardian is synced
  await syncRegisteredGuardianAsCaregiver(passengerId, adminDb);

  const snapshot = await adminDb
    .collection(CAREGIVER_LINKS_COLLECTION)
    .where('passengerId', '==', passengerId)
    .where('status', '==', 'ACTIVE')
    .get();

  const links: CaregiverLink[] = [];
  snapshot.forEach((doc: any) => {
    const data = doc.data() as CaregiverLink;
    if (data.permissions?.isSharingActive !== false) {
      links.push(data);
    }
  });

  return links;
}

export interface DispatchAlertResult {
  caregiversNotified: number;
  channelsSummary: {
    sms: number;
    email: number;
    push: number;
  };
  trackingToken?: string;
  trackingUrl?: string;
  logs: CaregiverSafetyLog[];
}

/**
 * Dispatches multi-channel safety alerts (SMS, Email, Push) to all active caregivers.
 */
export async function dispatchCaregiverSafetyAlert(
  eventType: CaregiverAlertEventType,
  payload: CaregiverAlertPayload,
  adminDb = getAdminDb()
): Promise<DispatchAlertResult> {
  const result: DispatchAlertResult = {
    caregiversNotified: 0,
    channelsSummary: { sms: 0, email: 0, push: 0 },
    logs: [],
  };

  if (!payload.passengerId) return result;

  // Resolve actual Passenger Name if payload has passengerId as name
  if (!payload.passengerName || payload.passengerName === payload.passengerId || payload.passengerName.startsWith('PAS-')) {
    try {
      const userDoc = await adminDb.collection('users').doc(payload.passengerId).get();
      if (userDoc.exists) {
        const u = userDoc.data() || {};
        payload.passengerName = u.userName || u.fullName || u.displayName || payload.passengerName;
      }
    } catch (_) {}
  }

  // Resolve actual Bus Number Plate if payload is missing plate or has busId
  if (!payload.busRegistrationNumber || payload.busRegistrationNumber === payload.busId || payload.busRegistrationNumber.startsWith('BUS-') || payload.busRegistrationNumber === 'Bus') {
    if (payload.busId) {
      try {
        const busDoc = await adminDb.collection('buses').doc(payload.busId).get();
        if (busDoc.exists) {
          const b = busDoc.data() || {};
          payload.busRegistrationNumber = b.numberPlate || b.registrationNumber || b.plateNumber || payload.busRegistrationNumber;
        }
      } catch (_) {}
    }
  }

  // Retrieve active caregivers
  const caregivers = await getActiveCaregiversForPassenger(payload.passengerId, adminDb);
  if (!caregivers || caregivers.length === 0) return result;

  // Generate or reuse tracking token
  const trackingToken = payload.trackingToken || generateTrackingToken(payload.bookingId || payload.passengerId);
  const baseUrl = process.env.EXPO_PUBLIC_APP_URL || process.env.EXPO_PUBLIC_API_URL || 'http://192.168.8.127:8081';
  const trackingUrl = `${baseUrl}/track/${trackingToken}`;

  result.trackingToken = trackingToken;
  result.trackingUrl = trackingUrl;

  const now = new Date().toISOString();

  for (const caregiver of caregivers) {
    if (!canCaregiverReceiveAlert(caregiver, eventType)) {
      continue;
    }

    const channelsDelivered: CaregiverDispatchChannel[] = [];
    const ch = caregiver.permissions.channels;

    // 1. SMS Dispatch
    if (ch?.sms !== false && caregiver.mobileNo) {
      const smsMessage = formatCaregiverSmsMessage(eventType, payload, trackingUrl);
      // In production environment, integrate with Sri Lankan SMS gateway (e.g. Mobitel/Dialog/Twilio)
      console.log(`[SMS DISPATCH to ${caregiver.mobileNo} (${caregiver.fullName})]: ${smsMessage}`);
      channelsDelivered.push('SMS');
      result.channelsSummary.sms++;
    }

    // 2. Email Dispatch
    if (ch?.email !== false && caregiver.email) {
      const { subject, html } = formatCaregiverEmailHtml(eventType, payload, trackingUrl);
      console.log(`[EMAIL DISPATCH to ${caregiver.email} (${caregiver.fullName})]: Subject: ${subject}`);
      sendRealEmail({
        to: caregiver.email,
        subject,
        html,
        text: formatCaregiverSmsMessage(eventType, payload, trackingUrl),
      }).catch((emailErr) => console.warn('Email dispatch warning:', emailErr));
      channelsDelivered.push('EMAIL');
      result.channelsSummary.email++;
    }

    // 3. Mobile App Push Dispatch (if caregiver is also a registered app user)
    if (ch?.push !== false && caregiver.caregiverId) {
      try {
        await sendPushNotificationToUser(caregiver.caregiverId, {
          title: `Transit Update: ${payload.passengerName || 'Passenger'}`,
          body: formatCaregiverSmsMessage(eventType, payload),
          data: {
            eventType,
            bookingId: payload.bookingId,
            passengerId: payload.passengerId,
            trackingToken,
            trackingUrl,
          },
        });
        channelsDelivered.push('PUSH');
        result.channelsSummary.push++;
      } catch (pushErr) {
        console.warn(`Push dispatch failed for caregiver ${caregiver.caregiverId}:`, pushErr);
      }
    }

    if (channelsDelivered.length > 0) {
      result.caregiversNotified++;

      const logId = `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const logEntry: CaregiverSafetyLog = {
        logId,
        passengerId: payload.passengerId,
        caregiverId: caregiver.caregiverId || undefined,
        caregiverName: caregiver.fullName,
        caregiverMobile: caregiver.mobileNo,
        caregiverEmail: caregiver.email,
        eventType,
        channelsDelivered,
        messageSummary: formatCaregiverSmsMessage(eventType, payload),
        trackingToken,
        status: 'DELIVERED',
        timestamp: now,
      };

      result.logs.push(logEntry);

      // Save safety audit log asynchronously
      adminDb.collection(CAREGIVER_LOGS_COLLECTION).doc(logId).set(logEntry).catch(console.error);
    }
  }

  return result;
}
