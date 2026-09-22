import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { bookingId } = body;

        if (!bookingId) {
            return Response.json(
                { success: false, message: 'Missing bookingId.' },
                { status: 400, headers: corsHeaders }
            );
        }

        const adminDb = getAdminDb();
        const bookingDocRef = adminDb.collection('bookings').doc(bookingId);

        let confirmedAtTime = '';

        await adminDb.runTransaction(async (transaction: any) => {
            const doc = await transaction.get(bookingDocRef);

            if (!doc.exists) {
                throw new Error('Booking not found.');
            }

            const data = doc.data();
            if (!data.receiverDetails) {
                throw new Error('Booking does not have receiver details assigned.');
            }

            if (data.receiverDetails.confirmed) {
                throw new Error('Receiver details already confirmed.');
            }

            confirmedAtTime = new Date().toISOString();

            transaction.update(bookingDocRef, {
                'receiverDetails.confirmed': true,
                'receiverDetails.confirmedAt': confirmedAtTime,
            });
        });

        return Response.json(
            { success: true, message: 'Receiver details confirmed successfully.', confirmedAt: confirmedAtTime },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('POST /api/booking/confirm-receiver Error:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to confirm receiver details.',
                error: error?.message || 'Internal error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}
