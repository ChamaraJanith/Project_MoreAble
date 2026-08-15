import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { computeAccessibilityScore } from '../../../src/shared/utils/accessibility';
import { buildBookedSeatMap } from '../../../src/shared/utils/bookedSeats';
import { applyBookedSeats, buildSeatLayout, flattenSeats } from '../../../src/shared/utils/seatLayout';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

// GET /api/booking/options?routeId=177_KADUWELA_KOLLUPITIYA
export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const routeId = url.searchParams.get('routeId');

        if (!routeId) {
            return Response.json({ success: false, message: 'routeId is required.' }, { status: 400, headers: corsHeaders });
        }

        const adminDb = getAdminDb();

        const routeDoc = await adminDb.collection('routes').doc(routeId).get();
        if (!routeDoc.exists) {
            return Response.json({ success: false, message: 'Route not found.' }, { status: 404, headers: corsHeaders });
        }
        const route = routeDoc.data();

        const tripsSnapshot = await adminDb
            .collection('trips')
            .where('routeId', '==', routeId)
            .where('status', '==', 'ACTIVE')
            .get();

        if (tripsSnapshot.empty) {
            return Response.json(
                { success: true, message: 'No transport options found.', options: [] },
                { status: 200, headers: corsHeaders }
            );
        }

        const options = [];

        for (const tripDoc of tripsSnapshot.docs) {
            const trip = tripDoc.data();

            const busDoc = await adminDb.collection('buses').doc(trip.busId).get();
            if (!busDoc.exists) continue;
            const bus = busDoc.data();

            if (bus.status !== 'ACTIVE') continue;

            const bookingsSnapshot = await adminDb
                .collection('bookings')
                .where('tripId', '==', trip.tripId)
                .where('status', '==', 'CONFIRMED')
                .get();

            const bookedMap = buildBookedSeatMap(bookingsSnapshot.docs);
            const layout = applyBookedSeats(buildSeatLayout(bus), bookedMap);
            const seats = flattenSeats(layout);

            const totalSeats = seats.length;
            const availableSeats = seats.filter((s) => s.status === 'AVAILABLE').length;
            const availablePrioritySeats = seats.filter((s) => s.category === 'PRIORITY' && s.status === 'AVAILABLE').length;

            options.push({
                tripId: trip.tripId,
                routeId,
                routeNumber: route.routeNumber,
                routeName: route.routeName,
                busId: bus.busId,
                numberPlate: bus.numberPlate,
                busModel: bus.busModel,
                manufacturer: bus.manufacturer,
                departureTime: trip.departureTime,
                estimatedArrivalTime: trip.estimatedArrivalTime,
                accessibilityScore: computeAccessibilityScore(bus.accessibilityFacilities),
                totalSeats,
                availableSeats,
                availablePrioritySeats,
                facilities: {
                    wheelchairRamp: !!bus.accessibilityFacilities?.wheelchairRamp,
                    audioAnnouncement: !!bus.accessibilityFacilities?.audioAnnouncement,
                    lowFloorVehicle: !!bus.accessibilityFacilities?.lowFloorVehicle,
                    walkingAssistance: !!bus.accessibilityFacilities?.walkingAssistance,
                },
            });
        }

        options.sort((a, b) => a.departureTime.localeCompare(b.departureTime));

        return Response.json(
            { success: true, message: `${options.length} transport option(s) found.`, options },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Get Transport Options Error:', error);
        return Response.json(
            { success: false, message: 'Internal server error while fetching transport options.', error: error.message },
            { status: 500, headers: corsHeaders }
        );
    }
}