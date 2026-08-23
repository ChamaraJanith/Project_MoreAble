import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

const VALID_STATUSES = ['NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED'];

// PUT /api/booking/assistance/status
export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const { bookingId, status, notes } = body;

        if (!bookingId || !status) {
            return Response.json(
                { success: false, message: 'bookingId and status are required.' },
                { status: 400, headers: corsHeaders }
            );
        }

        if (!VALID_STATUSES.includes(status)) {
            return Response.json(
                { success: false, message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
                { status: 400, headers: corsHeaders }
            );
        }

        const adminDb = getAdminDb();
        const bookingRef = adminDb.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();

        if (!bookingDoc.exists) {
            return Response.json(
                { success: false, message: 'Booking not found.' },
                { status: 404, headers: corsHeaders }
            );
        }

        const booking = bookingDoc.data();
        const now = new Date().toISOString();

        const updateData: Record<string, any> = {
            assistanceStatus: status,
            assistanceUpdatedAt: now,
        };

        if (typeof notes === 'string') {
            updateData.assistanceNotes = notes.trim();
        }

        await bookingRef.update(updateData);

        // Notify passenger when assistance status changes
        if (booking?.userId && booking.userId !== 'GUEST') {
            const notificationId = `notif_ast_${bookingId}_${Date.now()}`;
            const statusLabels: Record<string, string> = {
                CONFIRMED: 'Acknowledged by Bus Conductor 👨‍✈️',
                IN_PROGRESS: 'Boarding Assistance Active ♿',
                COMPLETED: 'Assistance Completed ✅',
                DECLINED: 'Unable to Fulfill Request ⚠️',
            };

            const busPlate = booking?.vehicle?.numberPlate ? ` (${booking.vehicle.numberPlate})` : '';
            const pickupStop = booking?.journey?.startLocation ? ` at ${booking.journey.startLocation}` : '';

            const statusMessages: Record<string, string> = {
                CONFIRMED: `The bus conductor on vehicle${busPlate} has acknowledged your travel assistance request for seat ${booking.seatNumber}.`,
                IN_PROGRESS: `The bus conductor is actively assisting your boarding${pickupStop}.`,
                COMPLETED: `Your travel assistance for seat ${booking.seatNumber} has been completed successfully. Have a safe journey!`,
                DECLINED: `The bus crew on vehicle${busPlate} was unable to fulfill your assistance request. Please contact support if needed.`,
            };

            const label = statusLabels[status] || status;
            const title = `Travel Assistance • ${label}`;
            const message = statusMessages[status] || `Your travel assistance status for seat ${booking.seatNumber} has been updated to ${status}.`;

            await adminDb.collection('notifications').doc(notificationId).set({
                id: notificationId,
                notificationId,
                userId: booking.userId,
                bookingId,
                type: 'ASSISTANCE_STATUS_UPDATE',
                title,
                message,
                status: 'UNREAD',
                createdAt: now,
                readAt: null,
            });
        }

        return Response.json(
            {
                success: true,
                message: `Assistance status updated to ${status} successfully.`,
                bookingId,
                status,
                updatedAt: now,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Update Assistance Status API Error:', error);
        return Response.json(
            { success: false, message: 'Failed to update assistance status.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}
