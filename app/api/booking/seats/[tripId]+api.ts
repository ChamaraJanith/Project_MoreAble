// GET /api/booking/seats/TRIP-2026-00001
import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request, { tripId }: Record<string, string>) {
    try {
        if (!tripId) {
            return Response.json({ message: 'tripId is required.' }, { status: 400, headers: corsHeaders });
        }

        const adminDb = getAdminDb();

        // 1. Confirm the trip exists (so we don't return seats for a bad tripId)
        const tripDoc = await adminDb.collection('trips').doc(tripId).get();
        if (!tripDoc.exists) {
            return Response.json({ message: 'Trip not found.' }, { status: 404, headers: corsHeaders });
        }
        const trip = tripDoc.data();

        // 2. Get bus details (for vehicle number / total seats context)
        const busDoc = await adminDb.collection('buses').doc(trip.busId).get();
        const bus = busDoc.exists ? busDoc.data() : null;

        // 3. Get all seats under trips/{tripId}/seats
        const seatsSnapshot = await adminDb
            .collection('trips').doc(tripId).collection('seats')
            .get();

        const seats = seatsSnapshot.docs
            .map((doc: any) => doc.data())
            .sort((a: any, b: any) => a.seatNumber.localeCompare(b.seatNumber));

        return Response.json({
            tripId,
            vehicleNumber: bus?.vehicleNumber || 'N/A',
            totalSeats: bus?.totalSeats || seats.length,
            seats,
        }, { status: 200, headers: corsHeaders });

    } catch (error: any) {
        console.error('Get Seat Availability Error:', error);
        return Response.json(
            { message: 'Internal server error while fetching seat availability.', error: error.message },
            { status: 500, headers: corsHeaders }
        );
    }
}