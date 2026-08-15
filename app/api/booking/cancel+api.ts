import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

// POST /api/booking/cancel  { bookingId }
export async function POST(request: Request) {
    try {
        const { bookingId } = await request.json();
        if (!bookingId) {
            return Response.json({ success: false, message: 'bookingId is required.' }, { status: 400, headers: corsHeaders });
        }

        const adminDb = getAdminDb();
        const ref = adminDb.collection('bookings').doc(bookingId);
        const doc = await ref.get();

        if (!doc.exists) {
            return Response.json({ success: false, message: 'Booking not found.' }, { status: 404, headers: corsHeaders });
        }
        if (doc.data()?.status === 'CANCELLED') {
            return Response.json({ success: false, message: 'This booking is already cancelled.' }, { status: 409, headers: corsHeaders });
        }

        await ref.update({ status: 'CANCELLED', cancelledAt: new Date().toISOString() });

        return Response.json({ success: true, message: 'Booking cancelled successfully.' }, { status: 200, headers: corsHeaders });
    } catch (error: any) {
        console.error('Cancel Booking Error:', error);
        return Response.json(
            { success: false, message: 'Failed to cancel booking.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}