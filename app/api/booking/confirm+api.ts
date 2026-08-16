import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { computeRouteSegmentDistance } from '../../../src/shared/server/routeDistance';
import { generateBookingId } from '../../../src/shared/utils/bookingId';
import { calculateFare } from '../../../src/shared/utils/fare';
import { normalizeLocation } from '../../../src/shared/utils/location';

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
        const { tripId, seatNumber, isPrioritySeat, passengerId, origin, destination, assistanceRequested, specialRequests } = body;

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
        const stops: string[] = route && Array.isArray(route.stops) ? route.stops : [];

        // ---- Authoritative fare calculation ----
        // The actual searched origin/destination (mid-route stops like
        // Malabe) take priority over the route's own full endpoints, so a
        // shorter sub-journey is never charged the whole route's fare.
        const journeyOrigin = origin || route?.startLocation || null;
        const journeyDestination = destination || route?.endLocation || null;

        let fare = calculateFare(0, true);

        if (journeyOrigin && journeyDestination && stops.length > 0) {
            const normalizedStops = stops.map((s) => normalizeLocation(s));
            const originIndex = normalizedStops.indexOf(normalizeLocation(journeyOrigin));
            const destinationIndex = normalizedStops.indexOf(normalizeLocation(journeyDestination));

            if (originIndex !== -1 && destinationIndex !== -1 && originIndex < destinationIndex) {
                const { distanceKm, isPrecise } = await computeRouteSegmentDistance(
                    adminDb,
                    stops,
                    originIndex,
                    destinationIndex,
                    route?.distanceKm ?? null
                );
                fare = calculateFare(distanceKm, isPrecise);
            } else if (route?.distanceKm != null) {
                // Origin/destination weren't recognised on this route (e.g. an
                // older booking link) — fall back to the full route distance
                // rather than charging LKR 0.
                fare = calculateFare(route.distanceKm, true);
            }
        } else if (route?.distanceKm != null) {
            fare = calculateFare(route.distanceKm, true);
        }

        const bookingsRef = adminDb.collection('bookings');

        const booking = await adminDb.runTransaction(async (transaction: any) => {
            const existingSnapshot = await transaction.get(
                bookingsRef.where('tripId', '==', tripId).where('seatNumber', '==', seatNumber).where('status', '==', 'CONFIRMED')
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
                    startLocation: journeyOrigin ?? '—',
                    endLocation: journeyDestination ?? '—',
                    departureTime: trip.departureTime,
                    estimatedArrivalTime: trip.estimatedArrivalTime,
                },
                vehicle: {
                    numberPlate: bus.numberPlate,
                    busModel: bus.busModel,
                    manufacturer: bus.manufacturer,
                },
                fare,
                assistanceRequested: {
                    boardingAssistance: !!assistanceRequested?.boardingAssistance,
                    walkingAssistance: !!assistanceRequested?.walkingAssistance,
                    prioritySeatAssistance: !!assistanceRequested?.prioritySeatAssistance,
                },
                specialRequests: typeof specialRequests === 'string' ? specialRequests.trim() : '',
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