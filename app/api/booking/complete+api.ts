/**
 * Booking Completion & Safe Arrival Dispatcher API (MOV-227 / MOV-230)
 *
 * POST: Marks passenger booking as completed / arrived and dispatches
 * safe arrival notifications (SMS, Email, Push) to all authorized caregivers.
 */

import { CaregiverAlertPayload } from '../../../src/entities/caregiver/model/types';
import { dispatchCaregiverSafetyAlert } from '../../../src/features/caregiver/services/caregiverAlertService';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { bookingId, conductorId, arrivalHalt } = body;

    if (!bookingId) {
      return Response.json(
        { success: false, message: 'bookingId is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const bookingsRef = adminDb.collection('bookings');
    const bookingDocRef = bookingsRef.doc(bookingId);
    const bookingDoc = await bookingDocRef.get();

    if (!bookingDoc.exists) {
      return Response.json(
        { success: false, message: `Booking ${bookingId} not found.` },
        { status: 404, headers: corsHeaders }
      );
    }

    const bookingData = bookingDoc.data() as any;
    const now = new Date().toISOString();

    const destinationHalt = arrivalHalt || bookingData.journey?.endLocation || bookingData.destination || 'Destination Point';
    const originHalt = bookingData.journey?.startLocation || bookingData.origin || 'Origin Point';
    const passengerId = bookingData.passengerId || bookingData.userId;
    const busNumber = bookingData.busRegistrationNumber || bookingData.journey?.vehicleNumber || 'Transit Bus';

    // Fetch passenger name if not on booking
    let passengerName = bookingData.passengerName || 'Passenger';
    if (passengerId && passengerId !== 'GUEST') {
      const userDoc = await adminDb.collection('users').doc(passengerId).get();
      if (userDoc.exists) {
        passengerName = userDoc.data()?.userName || passengerName;
      }
    }

    // 1. Update Booking status to COMPLETED
    await bookingDocRef.update({
      status: 'COMPLETED',
      alightedAt: now,
      alightedLocation: destinationHalt,
      completedBy: conductorId || 'CONDUCTOR_ALIGHTING',
      updatedAt: now,
    });

    // 2. Dispatch Safe Arrival SMS/Email/Push alerts to all active caregivers
    const alertPayload: CaregiverAlertPayload = {
      bookingId,
      passengerId,
      passengerName,
      tripId: bookingData.tripId || bookingData.journey?.tripId || '',
      busId: bookingData.busId || bookingData.journey?.busId || '',
      busRegistrationNumber: busNumber,
      routeNumber: bookingData.journey?.routeNumber || bookingData.routeNumber || '',
      routeName: bookingData.journey?.routeName || bookingData.routeName || '',
      boardingStopName: originHalt,
      destinationStopName: destinationHalt,
      currentStopName: destinationHalt,
    };

    const dispatchResult = await dispatchCaregiverSafetyAlert('DESTINATION_ARRIVED', alertPayload, adminDb);

    return Response.json(
      {
        success: true,
        message: `Passenger journey completed. Safe arrival alerts sent to ${dispatchResult.caregiversNotified} caregivers.`,
        bookingId,
        caregiversNotified: dispatchResult.caregiversNotified,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('POST /api/booking/complete Error:', error);
    return Response.json(
      { success: false, message: 'Failed to complete booking', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
