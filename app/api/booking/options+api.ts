import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { computeAccessibilityScore } from '../../../src/shared/utils/accessibility';

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
            return Response.json(
                { success: false, message: 'routeId is required.' },
                { status: 400, headers: corsHeaders }
            );
        }

        const adminDb = getAdminDb();

        const routeDoc = await adminDb.collection('routes').doc(routeId).get();
        if (!routeDoc.exists) {
            return Response.json(
                { success: false, message: 'Route not found.' },
                { status: 404, headers: corsHeaders }
            );
        }
        const route = routeDoc.data();

        // Only ACTIVE trips are ever offered to a passenger.
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

            // Only active and available vehicles should be displayed.
            if (bus.status !== 'ACTIVE') continue;

            const bookingsSnapshot = await adminDb
                .collection('bookings')
                .where('tripId', '==', trip.tripId)
                .where('status', '==', 'CONFIRMED')
                .get();

            const bookedSeats = bookingsSnapshot.docs.map((doc: any) => doc.data());
            const bookedCount = bookedSeats.length;
            const bookedPriorityCount = bookedSeats.filter((b: any) => b.isPrioritySeat).length;

            const totalSeats = bus.seatCapacity || 0;
            const availableSeats = Math.max(0, totalSeats - bookedCount);

            const totalPrioritySeats = bus.accessibilityFacilities?.prioritySeats?.available
                ? bus.accessibilityFacilities.prioritySeats.count
                : 0;
            const availablePrioritySeats = Math.max(0, totalPrioritySeats - bookedPriorityCount);

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