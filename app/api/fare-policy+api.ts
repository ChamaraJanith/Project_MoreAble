import { getAdminDb } from '../../src/shared/config/firebaseAdmin';
import { getActiveFarePolicy } from '../../src/shared/server/farePolicyServer';
import { DEFAULT_FARE_POLICY } from '../../src/shared/utils/fare';
import { FarePolicy } from '../../src/entities/booking/model/types';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

// GET /api/fare-policy - Retrieve active fare policy
export async function GET() {
    try {
        const adminDb = getAdminDb();
        const policy = await getActiveFarePolicy(adminDb);
        return Response.json(
            { success: true, message: 'Active fare policy retrieved successfully.', policy },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Get Fare Policy API Error:', error);
        return Response.json(
            { success: false, message: 'Failed to retrieve fare policy.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}

// PUT /api/fare-policy - Update active fare policy (Admin only)
export async function PUT(request: Request) {
    try {
        const body = await request.json();
        const {
            baseFare,
            baseDistanceKm,
            ratePerKm,
            accessibilityDiscountPercent,
            elderlyDiscountPercent,
            assistanceSurchargeLkr,
            guardianCompanionRatePercent,
            updatedBy,
        } = body;

        // Strict numeric validation
        if (typeof baseFare !== 'number' || isNaN(baseFare) || baseFare < 0) {
            return Response.json(
                { success: false, message: 'Base fare must be a positive number.' },
                { status: 400, headers: corsHeaders }
            );
        }
        if (typeof baseDistanceKm !== 'number' || isNaN(baseDistanceKm) || baseDistanceKm < 0) {
            return Response.json(
                { success: false, message: 'Base distance (km) must be a positive number.' },
                { status: 400, headers: corsHeaders }
            );
        }
        if (typeof ratePerKm !== 'number' || isNaN(ratePerKm) || ratePerKm < 0) {
            return Response.json(
                { success: false, message: 'Rate per km must be a positive number.' },
                { status: 400, headers: corsHeaders }
            );
        }
        if (
            typeof accessibilityDiscountPercent !== 'number' ||
            isNaN(accessibilityDiscountPercent) ||
            accessibilityDiscountPercent < 0 ||
            accessibilityDiscountPercent > 100
        ) {
            return Response.json(
                { success: false, message: 'Accessibility discount must be between 0% and 100%.' },
                { status: 400, headers: corsHeaders }
            );
        }
        if (
            typeof elderlyDiscountPercent !== 'number' ||
            isNaN(elderlyDiscountPercent) ||
            elderlyDiscountPercent < 0 ||
            elderlyDiscountPercent > 100
        ) {
            return Response.json(
                { success: false, message: 'Elderly discount must be between 0% and 100%.' },
                { status: 400, headers: corsHeaders }
            );
        }
        if (
            typeof assistanceSurchargeLkr !== 'number' ||
            isNaN(assistanceSurchargeLkr) ||
            assistanceSurchargeLkr < 0
        ) {
            return Response.json(
                { success: false, message: 'Assistance surcharge must be a positive number.' },
                { status: 400, headers: corsHeaders }
            );
        }
        if (
            guardianCompanionRatePercent !== undefined &&
            (typeof guardianCompanionRatePercent !== 'number' ||
                isNaN(guardianCompanionRatePercent) ||
                guardianCompanionRatePercent < 0 ||
                guardianCompanionRatePercent > 100)
        ) {
            return Response.json(
                { success: false, message: 'Guardian companion seat rate must be between 0% and 100%.' },
                { status: 400, headers: corsHeaders }
            );
        }

        const now = new Date().toISOString();
        const updatedPolicy: FarePolicy = {
            id: 'default',
            currency: 'LKR',
            baseFare: Math.round(baseFare * 100) / 100,
            baseDistanceKm: Math.round(baseDistanceKm * 10) / 10,
            ratePerKm: Math.round(ratePerKm * 100) / 100,
            accessibilityDiscountPercent: Math.round(accessibilityDiscountPercent),
            elderlyDiscountPercent: Math.round(elderlyDiscountPercent),
            assistanceSurchargeLkr: Math.round(assistanceSurchargeLkr * 100) / 100,
            guardianCompanionRatePercent:
                typeof guardianCompanionRatePercent === 'number'
                    ? Math.round(guardianCompanionRatePercent)
                    : 100,
            updatedAt: now,
            updatedBy: typeof updatedBy === 'string' && updatedBy.trim() ? updatedBy.trim() : 'admin',
        };

        const adminDb = getAdminDb();
        await adminDb.collection('fare_policies').doc('default').set(updatedPolicy, { merge: true });

        return Response.json(
            { success: true, message: 'Fare policy updated successfully.', policy: updatedPolicy },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Update Fare Policy API Error:', error);
        return Response.json(
            { success: false, message: 'Failed to update fare policy.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}

// POST /api/fare-policy - Reset fare policy to baseline defaults
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const now = new Date().toISOString();
        const resetPolicy: FarePolicy = {
            ...DEFAULT_FARE_POLICY,
            updatedAt: now,
            updatedBy: body?.updatedBy || 'admin',
        };

        const adminDb = getAdminDb();
        await adminDb.collection('fare_policies').doc('default').set(resetPolicy);

        return Response.json(
            { success: true, message: 'Fare policy reset to baseline defaults successfully.', policy: resetPolicy },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Reset Fare Policy API Error:', error);
        return Response.json(
            { success: false, message: 'Failed to reset fare policy.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}
