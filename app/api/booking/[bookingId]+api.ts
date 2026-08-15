import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request, { bookingId }: Record<string, string>) {
    try {
        if (!bookingId) {
            return Response.json({ success: false, message: 'bookingId is required.' }, { status: 400, headers: corsHeaders });
        }

        const adminDb = getAdminDb();
        const doc = await adminDb.collection('bookings').doc(bookingId).get();

        if (!doc.exists) {
            return Response.json({ success: false, message: 'Booking not found.' }, { status: 404, headers: corsHeaders });
        }

        return Response.json(
            { success: true, message: 'Booking retrieved successfully.', booking: doc.data() },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Get Booking Error:', error);
        return Response.json(
            { success: false, message: 'Failed to retrieve booking.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}