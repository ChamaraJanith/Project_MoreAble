import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { getActiveFarePolicy } from '../../../src/shared/server/farePolicyServer';
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

// GET /api/booking/fare?routeId=X&origin=Y&destination=Z&passengerId=U&hasAssistance=true
export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const routeId = url.searchParams.get('routeId');
        const origin = url.searchParams.get('origin');
        const destination = url.searchParams.get('destination');
        const passengerId = url.searchParams.get('passengerId');
        const hasAssistanceParam = url.searchParams.get('hasAssistance');
        const isWheelchairParam = url.searchParams.get('isWheelchair');
        const isWheelchairPaired = isWheelchairParam === 'true' || isWheelchairParam === '1';

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

        // Fetch active policy from Firestore
        const policy = await getActiveFarePolicy(adminDb);

        // Concession eligibility lookup if passengerId is provided
        let isAccessibilityEligible = false;
        let isElderlyEligible = false;

        if (passengerId && passengerId !== 'GUEST') {
            try {
                let userDoc = await adminDb.collection('users').doc(passengerId).get();
                if (!userDoc.exists) {
                    const qSnap = await adminDb.collection('users').where('passengerId', '==', passengerId).limit(1).get();
                    if (!qSnap.empty) {
                        userDoc = qSnap.docs[0];
                    }
                }

                if (userDoc && userDoc.exists) {
                    const uData = userDoc.data();
                    if (
                        uData?.isLowVisionPerson ||
                        uData?.isHearingImpaired ||
                        uData?.isOtherAccessibilityPerson ||
                        uData?.isWheelchairUser ||
                        uData?.isWalkingDifficultyPerson
                    ) {
                        isAccessibilityEligible = true;
                    } else if (Array.isArray(uData?.accessibilityNeeds) && uData.accessibilityNeeds.length > 0) {
                        isAccessibilityEligible = true;
                    }

                    const age = typeof uData?.calculatedAge === 'number' ? uData.calculatedAge : null;
                    if (uData?.isElderPerson || (age != null && age >= 60)) {
                        isElderlyEligible = true;
                    }
                }
            } catch {
                // Non-blocking fallback
            }
        }

        const hasAssistanceRequested = hasAssistanceParam === 'true' || hasAssistanceParam === '1';

        const fare = calculateFare(distanceKm, isPrecise, {
            policy,
            isAccessibilityEligible,
            isElderlyEligible,
            hasAssistanceRequested,
            isWheelchairPaired,
        });

        return Response.json({ success: true, message: 'Fare calculated successfully.', fare }, { status: 200, headers: corsHeaders });
    } catch (error: any) {
        console.error('Calculate Fare API Error:', error);
        return Response.json(
            { success: false, message: 'Failed to calculate fare.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}