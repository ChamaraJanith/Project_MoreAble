import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
    createEmergency,
    emergencyCorsHeaders,
    emergencyErrorResponse,
    listEmergencies,
    EmergencyConflictError,
} from '../../../src/shared/server/emergencies';
import { authenticateRequest } from '../../../src/shared/api/authMiddleware';

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: emergencyCorsHeaders,
    });
}

// GET /api/emergencies
//
// Lists emergency requests, ordered by newest first.
// Supports ?status=PENDING|ASSIGNED|RESOLVED|ALL and ?search=
export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const statusParam = url.searchParams.get('status') || undefined;
        const searchParam = url.searchParams.get('search') || undefined;

        const db = getAdminDb();
        const emergencies = await listEmergencies(db, {
            status: statusParam === 'ALL' ? undefined : statusParam,
            search: searchParam,
        });

        return Response.json(
            {
                success: true,
                message: 'Emergency requests retrieved successfully.',
                count: emergencies.length,
                emergencies,
            },
            { status: 200, headers: emergencyCorsHeaders }
        );
    } catch (error: any) {
        console.error('Get Emergencies API Error:', error);
        return emergencyErrorResponse(500, error.message || 'Failed to retrieve emergency requests.');
    }
}

// POST /api/emergencies
//
// Triggered when an SOS emergency is initiated by a passenger or conductor.
// Initializes the request with status 'PENDING' and records initial status history.
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);
        if (!body) {
            return emergencyErrorResponse(400, 'Request body is required.');
        }

        const user = await authenticateRequest(request).catch(() => null);
        const creatorName = user?.email || (user as any)?.name || body.passenger?.name || 'Passenger SOS';

        const db = getAdminDb();

        // Dynamically cross-reference real database passenger & booking if available
        const enrichedBody = { ...body };
        if (db && typeof db.collection === 'function') {
            try {
                const targetPassengerId = user?.passengerId || user?.uid || (body.passenger?.id !== 'PAS-554' ? body.passenger?.id : null);
                let dbUser: any = null;

                if (targetPassengerId) {
                    const uDoc = await db.collection('users').doc(targetPassengerId).get().catch(() => null);
                    if (uDoc?.exists) {
                        dbUser = uDoc.data();
                    } else {
                        const snap = await db.collection('users').where('passengerId', '==', targetPassengerId).limit(1).get().catch(() => null);
                        if (snap && !snap.empty) dbUser = snap.docs[0].data();
                    }
                }

                if (!dbUser && (user?.email || body.passenger?.email)) {
                    const email = (user?.email || body.passenger?.email || '').trim().toLowerCase();
                    if (email) {
                        const snap = await db.collection('users').where('email', '==', email).limit(1).get().catch(() => null);
                        if (snap && !snap.empty) dbUser = snap.docs[0].data();
                    }
                }

                if (dbUser) {
                    enrichedBody.passenger = {
                        ...enrichedBody.passenger,
                        id: dbUser.passengerId || dbUser.uid || enrichedBody.passenger?.id,
                        name: dbUser.userName || enrichedBody.passenger?.name,
                        phone: dbUser.phoneNumber || dbUser.secondaryPhoneNumber || enrichedBody.passenger?.phone,
                        email: dbUser.email || enrichedBody.passenger?.email,
                    };

                    const needs: string[] = [];
                    if (dbUser.isWheelchairUser) needs.push('Wheelchair Assistance');
                    if (dbUser.isLowVisionPerson) needs.push('Low Vision Support');
                    if (dbUser.isHearingImpaired) needs.push('Hearing Support');
                    if (dbUser.isWalkingDifficultyPerson) needs.push('Walking Assistance');
                    if (Array.isArray(dbUser.accessibilityNeeds)) needs.push(...dbUser.accessibilityNeeds);
                    if (needs.length > 0 && !enrichedBody.passenger.specialAssistance) {
                        enrichedBody.passenger.specialAssistance = Array.from(new Set(needs)).join(', ');
                    }

                    if (dbUser.guardianDetails?.mobileNo && !enrichedBody.alertRecipients?.caregiver) {
                        enrichedBody.alertRecipients = {
                            ...enrichedBody.alertRecipients,
                            caregiver: dbUser.guardianDetails.mobileNo,
                        };
                    }
                }

                // Check for real bookings for this passenger
                const resolvedPid = dbUser?.passengerId || dbUser?.uid || enrichedBody.passenger?.id;
                let dbBooking: any = null;
                const bkgId = enrichedBody.bookingId && enrichedBody.bookingId !== 'BKG-998877' ? enrichedBody.bookingId : null;

                if (bkgId) {
                    const bDoc = await db.collection('bookings').doc(bkgId).get().catch(() => null);
                    if (bDoc?.exists) dbBooking = bDoc.data();
                }

                if (!dbBooking && resolvedPid && resolvedPid !== 'PAS-554') {
                    const bSnap = await db.collection('bookings').where('userId', '==', resolvedPid).get().catch(() => null);
                    if (bSnap && !bSnap.empty) {
                        const bookings = bSnap.docs.map((d: any) => ({ ...d.data(), id: d.id }));
                        bookings.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
                        dbBooking = bookings.find((b: any) => b.status === 'CONFIRMED') || bookings[0];
                    }
                }

                if (dbBooking) {
                    enrichedBody.bookingId = dbBooking.bookingId || dbBooking.id || enrichedBody.bookingId;
                    enrichedBody.vehicle = {
                        ...enrichedBody.vehicle,
                        plateNumber: dbBooking.vehicle?.numberPlate || dbBooking.numberPlate || (enrichedBody.vehicle?.plateNumber !== 'WP-CBA-1234' ? enrichedBody.vehicle?.plateNumber : 'WP-ND-4521'),
                        model: dbBooking.vehicle?.busModel || dbBooking.vehicle?.model || (enrichedBody.vehicle?.model !== 'Toyota Prius' ? enrichedBody.vehicle?.model : 'Transit Bus'),
                        routeNumber: dbBooking.journey?.routeNumber || dbBooking.routeNumber || enrichedBody.vehicle?.routeNumber,
                        driverId: dbBooking.driverId || dbBooking.busId || enrichedBody.vehicle?.driverId,
                        driverName: dbBooking.driverName || enrichedBody.vehicle?.driverName,
                    };
                }
            } catch (enrichErr) {
                console.warn('[EmergencyRoute] Data enrichment warning:', enrichErr);
            }
        }

        const emergency = await createEmergency(db, enrichedBody, creatorName);

        return Response.json(
            {
                success: true,
                message: 'Emergency request registered successfully. Dispatching support.',
                emergency,
            },
            { status: 201, headers: emergencyCorsHeaders }
        );
    } catch (error: any) {
        if (error instanceof EmergencyConflictError) {
            return emergencyErrorResponse(error.statusCode, error.message);
        }
        console.error('Create Emergency API Error:', error);
        return emergencyErrorResponse(500, error.message || 'Failed to create emergency request.');
    }
}

