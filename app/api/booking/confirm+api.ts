import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { generateBookingId } from '../../../src/shared/utils/bookingId';
import { buildSeatLayout, ELDERLY_SEAT_MIN_AGE, findSeat } from '../../../src/shared/utils/seatLayout';

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
        const { tripId, seatNumber, passengerId, origin, destination } = body;

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

        // Rebuild the layout server-side and locate the requested seat in it —
        // this is the single source of truth for its category, pairing and
        // any age restriction, regardless of what the client sent.
        const layout = buildSeatLayout(bus);
        const seat = findSeat(layout, seatNumber);

        if (!seat) {
            return Response.json(
                { success: false, message: 'Invalid seat number for this bus.' },
                { status: 400, headers: corsHeaders }
            );
        }

        // ---- Elderly seat age enforcement ----
        if (seat.category === 'ELDERLY') {
            if (!passengerId) {
                return Response.json(
                    {
                        success: false,
                        message: `This seat is reserved for passengers aged ${seat.minAge ?? ELDERLY_SEAT_MIN_AGE} and above. Please log in with your registered account to book it.`,
                    },
                    { status: 403, headers: corsHeaders }
                );
            }

            const userDoc = await adminDb.collection('users').doc(passengerId).get();
            const age = userDoc.exists ? Number(userDoc.data()?.calculatedAge || 0) : 0;

            if (!userDoc.exists || age < (seat.minAge ?? ELDERLY_SEAT_MIN_AGE)) {
                return Response.json(
                    {
                        success: false,
                        message: `This seat is reserved for passengers aged ${seat.minAge ?? ELDERLY_SEAT_MIN_AGE} and above.`,
                    },
                    { status: 403, headers: corsHeaders }
                );
            }
        }

        const routeDoc = await adminDb.collection('routes').doc(trip.routeId).get();
        const route = routeDoc.exists ? routeDoc.data() : null;

        // A wheelchair booking always reserves its paired guardian seat too —
        // both seat numbers are held under the same booking document.
        const seatsToReserve = seat.pairedSeatNumber ? [seat.seatNumber, seat.pairedSeatNumber] : [seat.seatNumber];

        const bookingsRef = adminDb.collection('bookings');

        const booking = await adminDb.runTransaction(async (transaction: any) => {
            const bySeatNumber = await transaction.get(
                bookingsRef.where('tripId', '==', tripId).where('status', '==', 'CONFIRMED').where('seatNumber', 'in', seatsToReserve)
            );
            const byPairedSeatNumber = await transaction.get(
                bookingsRef
                    .where('tripId', '==', tripId)
                    .where('status', '==', 'CONFIRMED')
                    .where('pairedSeatNumber', 'in', seatsToReserve)
            );

            if (!bySeatNumber.empty || !byPairedSeatNumber.empty) {
                throw new Error('SEAT_TAKEN');
            }

            const bookingId = await generateBookingId(adminDb);
            const now = new Date().toISOString();

            const qrPayload = JSON.stringify({
                bookingId,
                tripId,
                seatNumber: seat.seatNumber,
                pairedSeatNumber: seat.pairedSeatNumber,
                numberPlate: bus.numberPlate,
                departureTime: trip.departureTime,
            });

            const newBooking = {
                bookingId,
                userId: passengerId || 'GUEST',
                tripId,
                routeId: trip.routeId,
                busId: trip.busId,
                seatNumber: seat.seatNumber,
                seatCategory: seat.category,
                isPrioritySeat: seat.category === 'PRIORITY',
                pairedSeatNumber: seat.pairedSeatNumber,
                status: 'CONFIRMED',
                journey: {
                    routeNumber: route?.routeNumber ?? '—',
                    routeName: route?.routeName ?? '—',
                    // Prefer what the passenger actually searched for (mid-route stops
                    // like Malabe) over the route's own full termini.
                    startLocation: origin || route?.startLocation || '—',
                    endLocation: destination || route?.endLocation || '—',
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
                {
                    success: false,
                    message: 'This seat (or its paired guardian seat) was just taken by another passenger. Please choose another seat.',
                },
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