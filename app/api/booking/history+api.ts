import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

// GET /api/booking/history?passengerId=PAS-2026-00001
export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const passengerId = url.searchParams.get('passengerId');

        if (!passengerId) {
            return Response.json({ success: false, message: 'passengerId is required.' }, { status: 400, headers: corsHeaders });
        }

        const adminDb = getAdminDb();
        const snapshot = await adminDb
            .collection('bookings')
            .where('userId', '==', passengerId)
            .orderBy('createdAt', 'desc')
            .get();

        const bookings = snapshot.docs.map((doc: any) => doc.data());

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