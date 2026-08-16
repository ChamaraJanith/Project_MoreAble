import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { computeRouteSegmentDistance } from '../../../src/shared/server/routeDistance';
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

// GET /api/booking/fare?routeId=X&origin=Y&destination=Z
export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const routeId = url.searchParams.get('routeId');
        const origin = url.searchParams.get('origin');
        const destination = url.searchParams.get('destination');

        if (!routeId || !origin || !destination) {
            return Response.json(
                { success: false, message: 'routeId, origin and destination are required.' },
                { status: 400, headers: corsHeaders }
            );
        }

        const adminDb = getAdminDb();
        const routeDoc = await adminDb.collection('routes').doc(routeId).get();

        if (!routeDoc.exists) {
            return Response.json({ success: false, message: 'Route not found.' }, { status: 404, headers: corsHeaders });
        }

        const route = routeDoc.data();
        const stops: string[] = Array.isArray(route.stops) ? route.stops : [];
        const normalizedStops = stops.map((s) => normalizeLocation(s));

        const originIndex = normalizedStops.indexOf(normalizeLocation(origin));
        const destinationIndex = normalizedStops.indexOf(normalizeLocation(destination));

        if (originIndex === -1 || destinationIndex === -1 || originIndex >= destinationIndex) {
            return Response.json(
                { success: false, message: 'The selected origin and destination do not form a valid journey on this route.' },
                { status: 400, headers: corsHeaders }
            );
        }

        const { distanceKm, isPrecise } = await computeRouteSegmentDistance(
            adminDb,
            stops,
            originIndex,
            destinationIndex,
            route.distanceKm ?? null
        );

        const fare = calculateFare(distanceKm, isPrecise);

        return Response.json({ success: true, message: 'Fare calculated successfully.', fare }, { status: 200, headers: corsHeaders });
    } catch (error: any) {
        console.error('Calculate Fare API Error:', error);
        return Response.json(
            { success: false, message: 'Failed to calculate fare.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}