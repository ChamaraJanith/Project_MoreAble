/**
 * Vehicle Arrival Alert Processing API Endpoint (MOV-218 / MOV-221)
 *
 * GET / POST: Evaluates real-time bus proximity to passenger boarding stops
 * and dispatches in-app and push notifications for vehicles approaching pickup points.
 */

import { processAllPendingVehicleArrivalAlerts, processVehicleArrivalAlertsForBus } from '../../../../src/features/notifications/services/vehicleArrivalService';
import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function handleProcessVehicleArrival(request: Request) {
  try {
    const adminDb = getAdminDb();
    const url = new URL(request.url);
    const busId = url.searchParams.get('busId');

    let responseData;

    if (busId) {
      // Evaluate for a single specific bus
      const results = await processVehicleArrivalAlertsForBus(busId, adminDb);
      responseData = {
        success: true,
        message: `Processed arrival checks for bus ${busId}. Dispatched ${results.length} alert(s).`,
        processedBuses: 1,
        alertsDispatched: results.length,
        results,
        evaluatedAt: new Date().toISOString(),
      };
    } else {
      // Evaluate across all active vehicle locations in batch mode
      const summary = await processAllPendingVehicleArrivalAlerts(adminDb);
      responseData = {
        success: true,
        message: `Processed ${summary.processedBuses} active buses. Dispatched ${summary.alertsDispatched} arrival alert(s).`,
        ...summary,
        evaluatedAt: new Date().toISOString(),
      };
    }

    return Response.json(responseData, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    console.error('Process Vehicle Arrival API Error:', error);
    return Response.json(
      {
        success: false,
        message: 'Failed to process vehicle arrival alerts.',
        error: error?.message || 'Internal error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

export const GET = handleProcessVehicleArrival;
export const POST = handleProcessVehicleArrival;
