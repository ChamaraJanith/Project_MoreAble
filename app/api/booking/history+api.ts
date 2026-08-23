import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

// GET /api/booking/history?passengerId=PAS-2026-00001 OR ?busId=BUS-100 OR ?tripId=TRIP-100
export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const passengerId = url.searchParams.get('passengerId');
        const busId = url.searchParams.get('busId');
        const tripId = url.searchParams.get('tripId');

        if (!passengerId && !busId && !tripId) {
            return Response.json({ success: false, message: 'passengerId, busId, or tripId is required.' }, { status: 400, headers: corsHeaders });
        }

        const adminDb = getAdminDb();
        let query: any = adminDb.collection('bookings');

        if (passengerId) {
            query = query.where('userId', '==', passengerId);
        } else if (busId) {
            query = query.where('busId', '==', busId);
        } else if (tripId) {
            query = query.where('tripId', '==', tripId);
        }

        const snapshot = await query.get();
        const bookings = snapshot.docs.map((doc: any) => doc.data());

        bookings.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

        return Response.json(
            { success: true, message: 'Booking history retrieved successfully.', bookings },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Get Booking History Error:', error);
        return Response.json(
            { success: false, message: 'Failed to retrieve booking history.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}