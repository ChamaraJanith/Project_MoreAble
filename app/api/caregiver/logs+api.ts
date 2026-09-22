/**
 * Caregiver Safety Audit Logs API (MOV-227 / MOV-230)
 *
 * GET: Fetches the delivery history of all SMS, Email, and Push alerts for a passenger.
 */

import { CaregiverSafetyLog } from '../../../src/entities/caregiver/model/types';
import { CAREGIVER_LOGS_COLLECTION } from '../../../src/features/caregiver/services/caregiverAlertService';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const passengerId = searchParams.get('passengerId');

    if (!passengerId) {
      return Response.json(
        { success: false, message: 'passengerId query parameter is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();
    const snapshot = await adminDb
      .collection(CAREGIVER_LOGS_COLLECTION)
      .where('passengerId', '==', passengerId)
      .limit(50)
      .get();

    const logs: CaregiverSafetyLog[] = [];
    snapshot.forEach((doc: any) => {
      logs.push(doc.data() as CaregiverSafetyLog);
    });

    // Sort newest first
    logs.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    return Response.json(
      {
        success: true,
        logs,
        count: logs.length,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('GET /api/caregiver/logs Error:', error);
    return Response.json(
      { success: false, message: 'Failed to retrieve safety logs', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
