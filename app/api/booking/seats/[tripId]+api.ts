import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';
import { loadAccessibilityScoreEvidence } from '../../../../src/shared/server/accessibilityScoreEvidence';
import { computeAccessibilityScore } from '../../../../src/shared/utils/accessibility';
import { buildBookedSeatMap } from '../../../../src/shared/utils/bookedSeats';
import { applyBookedSeats, buildSeatLayout, flattenSeats } from '../../../../src/shared/utils/seatLayout';

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
            return Response.json({ success: false, message: 'tripId is required.' }, { status: 400, headers: corsHeaders });
        }

        const adminDb = getAdminDb();

        const tripDoc = await adminDb.collection('trips').doc(tripId).get();
        if (!tripDoc.exists) {
            return Response.json({ success: false, message: 'Trip not found.' }, { status: 404, headers: corsHeaders });
        }
        const trip = tripDoc.data();

        if (trip.status !== 'ACTIVE') {
            return Response.json(
                { success: false, message: 'This trip is no longer available.' },
                { status: 409, headers: corsHeaders }
            );
        }

        const busDoc = await adminDb.collection('buses').doc(trip.busId).get();
        if (!busDoc.exists) {
            return Response.json({ success: false, message: 'Bus not found for this trip.' }, { status: 404, headers: corsHeaders });
        }
        const bus = busDoc.data();

        if (bus.status !== 'ACTIVE') {
            return Response.json(
                { success: false, message: 'The bus for this trip is no longer available.' },
                { status: 409, headers: corsHeaders }
            );
        }

        const routeDoc = await adminDb.collection('routes').doc(trip.routeId).get();
        const route = routeDoc.exists ? routeDoc.data() : null;

        const url = new URL(request.url, 'http://localhost');
        const travelDate =
            url.searchParams.get('date') ||
            url.searchParams.get('travelDate') ||
            url.searchParams.get('journeyDate');

        const [bookingsSnapshot, evidence] = await Promise.all([
            adminDb.collection('bookings').where('tripId', '==', tripId).where('status', '==', 'CONFIRMED').get(),
            loadAccessibilityScoreEvidence(adminDb, trip.busId),
        ]);

        // Filter bookings strictly for the requested travelDate if provided
        const dateScopedDocs = travelDate
            ? bookingsSnapshot.docs.filter((d: any) => {
                const data = d.data();
                const bDate =
                    data.journeyDate ||
                    data.travelDate ||
                    data.journey?.departureDate ||
                    (typeof data.journey?.journeyDate === 'string' ? data.journey.journeyDate : null);
                return !bDate || bDate === travelDate;
            })
            : bookingsSnapshot.docs;

        const bookedMap = buildBookedSeatMap(dateScopedDocs);
        const layout = applyBookedSeats(buildSeatLayout(bus), bookedMap);
        const seats = flattenSeats(layout);

        return Response.json(
            {
                success: true,
                message: 'Seat availability retrieved successfully.',
                tripId,
                travelDate: travelDate || null,
                routeNumber: route?.routeNumber ?? null,
                numberPlate: bus.numberPlate,
                busModel: bus.busModel,
                departureTime: trip.departureTime,
                estimatedArrivalTime: trip.estimatedArrivalTime,
                accessibilityScore: computeAccessibilityScore(bus.accessibilityFacilities, evidence),
                totalSeats: seats.length,
                layout,
                seats,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Get Seat Availability Error:', error);
        return Response.json(
            { success: false, message: 'Internal server error while fetching seat availability.', error: error.message },
            { status: 500, headers: corsHeaders }
        );
    }
}