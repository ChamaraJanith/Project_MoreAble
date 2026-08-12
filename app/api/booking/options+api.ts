// GET /api/booking/options?routeId=177_KADUWELA_KOLLUPITIYA
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const routeId = url.searchParams.get('routeId');

        if (!routeId) {
            return Response.json({ message: 'routeId is required.' }, { status: 400, headers: corsHeaders });
        }

        const adminDb = getAdminDb();

        // 1. Get all SCHEDULED trips for this route
        const tripsSnapshot = await adminDb
            .collection('trips')
            .where('routeId', '==', routeId)
            .where('status', '==', 'SCHEDULED')
            .get();

        if (tripsSnapshot.empty) {
            return Response.json({ options: [] }, { status: 200, headers: corsHeaders });
        }

        const options = [];

        for (const tripDoc of tripsSnapshot.docs) {
            const trip = tripDoc.data();
            const tripId = tripDoc.id;

            // 2. Get bus details for this trip
            const busDoc = await adminDb.collection('buses').doc(trip.busId).get();
            if (!busDoc.exists) continue;
            const bus = busDoc.data();

            if (bus.status !== 'ACTIVE') continue; // only active vehicles

            // 3. Get route details
            const routeDoc = await adminDb.collection('routes').doc(routeId).get();
            const route = routeDoc.exists ? routeDoc.data() : { routeNumber: 'N/A' };

            // 4. Count available seats from seats subcollection
            const seatsSnapshot = await adminDb
                .collection('trips').doc(tripId).collection('seats').get();

            let availableSeats = 0;
            let availablePrioritySeats = 0;

            seatsSnapshot.forEach((seatDoc: any) => {
                const seat = seatDoc.data();
                if (seat.status === 'AVAILABLE') {
                    availableSeats++;
                    if (seat.isPrioritySeat) availablePrioritySeats++;
                }
            });

            options.push({
                tripId,
                routeId,
                routeNumber: route.routeNumber,
                busId: trip.busId,
                vehicleNumber: bus.vehicleNumber,
                departureTime: trip.departureTime,
                estimatedArrivalTime: trip.estimatedArrivalTime,
                accessibilityScore: bus.accessibilityScore || 0,
                totalSeats: bus.totalSeats || 0,
                availableSeats,
                availablePrioritySeats,
                facilities: bus.facilities || {},
            });
        }

        return Response.json({ options }, { status: 200, headers: corsHeaders });

    } catch (error: any) {
        console.error('Get Transport Options Error:', error);
        return Response.json(
            { message: 'Internal server error while fetching transport options.', error: error.message },
            { status: 500, headers: corsHeaders }
        );
    }
}