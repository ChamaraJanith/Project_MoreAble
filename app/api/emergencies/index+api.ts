import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
    createEmergency,
    emergencyCorsHeaders,
    emergencyErrorResponse,
    listEmergencies,
    EmergencyConflictError,
} from '../../../src/shared/server/emergencies';
import { CreateEmergencyInput, EMERGENCY_PRIORITIES, EmergencyPriority } from '../../../src/entities/emergency/model/types';
import { PassengerOngoingJourney } from '../../../src/entities/booking/model/types';
import { authenticateRequest } from '../../../src/shared/api/authMiddleware';
import { authenticateEmergencyAdmin } from '../../../src/shared/server/emergencyAdminAuthorization';
import { authoriseOngoingJourneyAccess } from '../../../src/shared/server/ongoingJourneyAuthorization';
import { loadPassengerOngoingJourneys } from '../../../src/shared/server/passengerOngoingJourney';

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
//
// ADMIN ONLY (authenticateEmergencyAdmin), checked before anything is read.
export async function GET(request: Request) {
    try {
        const auth = await authenticateEmergencyAdmin(request);
        if (!auth.ok) return auth.response;

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
// A passenger's SOS. Who and which journey are decided here, never by the
// request body:
//
//   who      the verified PASSENGER session (authoriseOngoingJourneyAccess, as
//            GET /api/journeys/ongoing uses) -> that passenger's own user
//            document. Nothing about the passenger is read from the body.
//   journey  attached only when the body's bookingId names one of this
//            passenger's ongoing journeys, as loadPassengerOngoingJourneys —
//            the canonical running-journey match — returns them. bookingId,
//            tripId, busId, vehicle, route and driver then come from that
//            verified journey; anything the client sent for them is ignored.
//
// An SOS with no verified ongoing journey is still an emergency: it is
// recorded without journey identity rather than refused, and never with a
// guessed booking. If reading the journey fails, the same.
//
// From the body only: location, priority, notes, and the bookingId used to
// pick among the passenger's own ongoing journeys.
//
// Access:
//   no session (missing, malformed, expired or badly signed token)  -> 401
//   a vehicle, scoped or non-PASSENGER session                      -> 403
export async function POST(request: Request) {
    try {
        const session = await authenticateRequest(request).catch(() => null);
        const authorization = authoriseOngoingJourneyAccess(session);

        if (!authorization.allowed) {
            return emergencyErrorResponse(
                authorization.status,
                authorization.status === 401 ? 'Authentication required.' : 'Only a signed-in passenger can send an SOS.'
            );
        }

        const body = await request.json().catch(() => null);
        if (!body) {
            return emergencyErrorResponse(400, 'Request body is required.');
        }

        const { passengerId } = authorization;
        const db = getAdminDb();

        const profile = await loadPassengerProfile(db, passengerId);
        const journey = await findVerifiedOngoingJourney(db, passengerId, body.bookingId);

        const passenger = {
            id: passengerId,
            name: nonEmpty(profile?.userName) ?? nonEmpty(session?.email) ?? passengerId,
            phone: nonEmpty(profile?.phoneNumber) ?? nonEmpty(profile?.secondaryPhoneNumber) ?? PHONE_NOT_ON_FILE,
            email: nonEmpty(profile?.email) ?? nonEmpty(session?.email) ?? undefined,
            specialAssistance: specialAssistanceOf(profile),
        };

        const busId = journey ? nonEmpty(journey.busId) ?? nonEmpty(journey.booking.busId) : null;

        const input: CreateEmergencyInput = {
            bookingId: journey?.booking.bookingId,
            tripId: journey?.activeJourney.tripId ?? null,
            busId,
            passenger,
            vehicle: journey
                ? {
                      plateNumber: nonEmpty(journey.booking.vehicle?.numberPlate) ?? busId ?? undefined,
                      model: nonEmpty(journey.booking.vehicle?.busModel) ?? undefined,
                      routeNumber: nonEmpty(journey.booking.journey?.routeNumber) ?? undefined,
                      driverId: busId ?? undefined,
                  }
                : undefined,
            location: body.location,
            priority: EMERGENCY_PRIORITIES.includes(body.priority) ? (body.priority as EmergencyPriority) : undefined,
            notes: typeof body.notes === 'string' ? body.notes : undefined,
            alertRecipients: {
                caregiver: nonEmpty(profile?.guardianDetails?.mobileNo) ?? nonEmpty(profile?.guardianId),
                driver: busId,
                admin: 'ADMIN_TOPIC',
            },
        };

        const emergency = await createEmergency(db, input, nonEmpty(session?.email) ?? passenger.name);

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

/** Shown to dispatch when the passenger's own record could not be read — never another number. */
const PHONE_NOT_ON_FILE = 'Not on file';

function nonEmpty(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The session passenger's own user document (users/{passengerId}), or null. */
async function loadPassengerProfile(db: any, passengerId: string): Promise<any | null> {
    try {
        const doc = await db.collection('users').doc(passengerId).get();
        return doc?.exists ? doc.data() ?? null : null;
    } catch {
        console.warn('[EmergencyRoute] Passenger profile unavailable; SOS recorded with session identity.');
        return null;
    }
}

/**
 * The passenger's ongoing journey named by `bookingId`, exactly as
 * loadPassengerOngoingJourneys returns it — or null: no bookingId, no such
 * ongoing journey (another passenger's, future, completed, cancelled), or the
 * journey could not be read. Never a guess.
 */
async function findVerifiedOngoingJourney(
    db: any,
    passengerId: string,
    bookingId: unknown
): Promise<PassengerOngoingJourney | null> {
    const requested = nonEmpty(bookingId);
    if (!requested) return null;

    try {
        const journeys = await loadPassengerOngoingJourneys(db, passengerId, new Date());
        return journeys.find((journey) => journey.booking.bookingId === requested) ?? null;
    } catch {
        console.warn('[EmergencyRoute] Ongoing journey unavailable; SOS recorded without journey identity.');
        return null;
    }
}

function specialAssistanceOf(profile: any): string | undefined {
    if (!profile) return undefined;

    const needs: string[] = [];
    if (profile.isWheelchairUser) needs.push('Wheelchair Assistance');
    if (profile.isLowVisionPerson) needs.push('Low Vision Support');
    if (profile.isHearingImpaired) needs.push('Hearing Support');
    if (profile.isWalkingDifficultyPerson) needs.push('Walking Assistance');
    if (Array.isArray(profile.accessibilityNeeds)) needs.push(...profile.accessibilityNeeds);

    return needs.length > 0 ? Array.from(new Set(needs)).join(', ') : undefined;
}
