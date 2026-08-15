import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { generateBookingId } from '../../../src/shared/utils/bookingId';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

// POST /api/booking/confirm
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { tripId, seatNumber, isPrioritySeat, passengerId } = body;

        if (!tripId || !seatNumber) {
            return Response.json(
                { success: false, message: 'tripId and seatNumber are required.' },
                { status: 400, headers: corsHeaders }
            );
        }

        const adminDb = getAdminDb();

        const tripDoc = await adminDb.collection('trips').doc(tripId).get();
        if (!tripDoc.exists) {
            return Response.json({ success: false, message: 'Trip not found.' }, { status: 404, headers: corsHeaders });
        }
        const trip = tripDoc.data();

        if (trip.status !== 'ACTIVE') {
            return Response.json(
                { success: false, message: 'This trip is no longer available for booking.' },
                { status: 409, headers: corsHeaders }
            );
        }

        const busDoc = await adminDb.collection('buses').doc(trip.busId).get();
        if (!busDoc.exists || busDoc.data()?.status !== 'ACTIVE') {
            return Response.json(
                { success: false, message: 'The bus for this trip is no longer available.' },
                { status: 409, headers: corsHeaders }
            );
        }
        const bus = busDoc.data();

        const routeDoc = await adminDb.collection('routes').doc(trip.routeId).get();
        const route = routeDoc.exists ? routeDoc.data() : null;

        const bookingsRef = adminDb.collection('bookings');

        // Transaction re-checks the seat right before writing, so two
        // passengers can never both be confirmed into the same seat.
        const booking = await adminDb.runTransaction(async (transaction: any) => {
            const existingSnapshot = await transaction.get(
                bookingsRef
                    .where('tripId', '==', tripId)
                    .where('seatNumber', '==', seatNumber)
                    .where('status', '==', 'CONFIRMED')
            );

            if (!existingSnapshot.empty) {
                throw new Error('SEAT_TAKEN');
            }

            const bookingId = await generateBookingId(adminDb);
            const now = new Date().toISOString();

            const qrPayload = JSON.stringify({
                bookingId,
                tripId,
                seatNumber,
                numberPlate: bus.numberPlate,
                departureTime: trip.departureTime,
            });

            const newBooking = {
                bookingId,
                userId: passengerId || 'GUEST',
                tripId,
                routeId: trip.routeId,
                busId: trip.busId,
                seatNumber,
                isPrioritySeat: !!isPrioritySeat,
                status: 'CONFIRMED',
                journey: {
                    routeNumber: route?.routeNumber ?? '—',
                    routeName: route?.routeName ?? '—',
                    startLocation: route?.startLocation ?? '—',
                    endLocation: route?.endLocation ?? '—',
                    departureTime: trip.departureTime,
                    estimatedArrivalTime: trip.estimatedArrivalTime,
                },
                vehicle: {
                    numberPlate: bus.numberPlate,
                    busModel: bus.busModel,
                    manufacturer: bus.manufacturer,
                },
                qrPayload,
                createdAt: now,
            };

            transaction.set(bookingsRef.doc(bookingId), newBooking);
            return newBooking;
        });

        return Response.json(
            { success: true, message: 'Booking confirmed successfully.', booking },
            { status: 201, headers: corsHeaders }
        );
    } catch (error: any) {
        if (error.message === 'SEAT_TAKEN') {
            return Response.json(
                { success: false, message: 'This seat was just taken by another passenger. Please choose another seat.' },
                { status: 409, headers: corsHeaders }
            );
        }
        console.error('Confirm Booking API Error:', error);
        return Response.json(
            { success: false, message: 'Failed to confirm booking.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}