/**
 * Emergency SOS Beacon Dispatcher API (MOV-227 / MOV-230)
 *
 * POST: Triggers high-priority emergency SOS broadcast to all authorized caregivers.
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
    const {
      passengerId,
      passengerName,
      bookingId,
      tripId,
      busId,
      busRegistrationNumber,
      routeNumber,
      boardingStopName,
      destinationStopName,
      currentStopName,
      emergencyNote,
      gpsCoordinates,
    } = body;

    if (!passengerId) {
      return Response.json(
        { success: false, message: 'passengerId is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();

    const payload: CaregiverAlertPayload = {
      bookingId: bookingId || 'SOS-ACTIVE',
      passengerId,
      passengerName: passengerName || 'Passenger',
      tripId: tripId || 'TRIP-UNKNOWN',
      busId: busId || 'BUS-UNKNOWN',
      busRegistrationNumber: busRegistrationNumber || 'Bus Vehicle',
      routeNumber: routeNumber || 'Transit Line',
      boardingStopName: boardingStopName || 'Origin',
      destinationStopName: destinationStopName || 'Destination',
      currentStopName: currentStopName || 'Live GPS Location',
      emergencyNote: emergencyNote || 'Passenger pressed the Emergency Safety SOS button in MoreAble app.',
      gpsCoordinates,
    };

    const dispatchResult = await dispatchCaregiverSafetyAlert('EMERGENCY_SOS', payload, adminDb);

    return Response.json(
      {
        success: true,
        message: `Emergency SOS broadcast dispatched to ${dispatchResult.caregiversNotified} caregivers.`,
        caregiversNotified: dispatchResult.caregiversNotified,
        trackingUrl: dispatchResult.trackingUrl,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('POST /api/caregiver/sos-alert Error:', error);
    return Response.json(
      { success: false, message: 'Failed to dispatch SOS alert', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
