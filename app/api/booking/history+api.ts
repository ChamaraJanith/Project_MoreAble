import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
    createLiveSharingCaches,
    loadBookingActiveJourney,
    loadBookingLiveSharing,
} from '../../../src/shared/server/bookingLiveSharing';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

// GET /api/booking/history?passengerId=PAS-2026-00001 OR ?busId=BUS-100 OR ?tripId=TRIP-100
export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const passengerId = url.searchParams.get('passengerId');
        const busId = url.searchParams.get('busId');
        const tripId = url.searchParams.get('tripId');
        const date = url.searchParams.get('date');

        if (!passengerId && !busId && !tripId) {
            return Response.json({ success: false, message: 'passengerId, busId, or tripId is required.' }, { status: 400, headers: corsHeaders });
        }

        const adminDb = getAdminDb();
        let query: any = adminDb.collection('bookings');

        if (passengerId) {
            query = query.where('userId', '==', passengerId);
        } else if (busId) {
            query = query.where('busId', '==', busId);
        } else if (tripId) {
            query = query.where('tripId', '==', tripId);
        }

        const snapshot = await query.get();
        let bookings = snapshot.docs.map((doc: any) => ({
            id: doc.id,
            ...doc.data(),
        }));

        if (date) {
            bookings = bookings.filter((b: any) => {
                const bDate =
                    b.travelDate ||
                    b.journeyDate ||
                    b.departureDate ||
                    b.journey?.departureDate ||
                    b.journey?.journeyDate;
                return bDate === date;
            });
        }

        // Fetch user profiles to enrich passenger names if missing
        const userIdsToFetch = Array.from(
            new Set(
                bookings
                    .map((b: any) => b.userId)
                    .filter((uid: any) => uid && uid !== 'GUEST')
            )
        );

        if (userIdsToFetch.length > 0) {
            const userMap: Record<string, string> = {};
            await Promise.all(
                userIdsToFetch.map(async (uid: any) => {
                    try {
                        let uDoc = await adminDb.collection('users').doc(uid).get();
                        if (!uDoc.exists) {
                            const qSnap = await adminDb.collection('users').where('passengerId', '==', uid).limit(1).get();
                            if (!qSnap.empty) {
                                uDoc = qSnap.docs[0];
                            }
                        }
                        if (uDoc && uDoc.exists) {
                            const uData = uDoc.data();
                            userMap[uid] = uData?.userName || uData?.fullName || uData?.name || uid;
                        }
                    } catch {}
                })
            );

            bookings.forEach((b: any) => {
                if (b.userId && userMap[b.userId]) {
                    b.passengerName = userMap[b.userId];
                } else if (!b.passengerName) {
                    b.passengerName = b.userId || 'Guest Passenger';
                }
            });
        } else {
            bookings.forEach((b: any) => {
                if (!b.passengerName) {
                    b.passengerName = b.userId || 'Guest Passenger';
                }
            });
        }

        bookings.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

        // MOV-294: opt-in, and only for a passenger's own history. Each booking is
        // resolved through its own trip to the bus operating it, so the result can
        // only describe a vehicle this passenger booked. Callers that do not ask
        // (the Booking tab, the driver manifest) get exactly the response they did.
        if (passengerId && url.searchParams.get('include') === 'liveSharing') {
            const caches = createLiveSharingCaches();
            const now = new Date();

            await Promise.all(
                bookings.map(async (b: any) => {
                    const [liveSharing, activeJourney] = await Promise.all([
                        loadBookingLiveSharing(adminDb, b, caches, now),
                        loadBookingActiveJourney(adminDb, b, caches, now),
                    ]);
                    if (liveSharing) {
                        b.liveSharing = liveSharing;
                    }
                    // The persisted Start Journey of this booking's own trip —
                    // what Activities > Ongoing is decided by.
                    if (activeJourney) {
                        b.activeJourney = activeJourney;
                    }
                })
            );
        }

        return Response.json(
            { success: true, message: 'Booking history retrieved successfully.', bookings },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Get Booking History Error:', error);
        return Response.json(
            { success: false, message: 'Failed to retrieve booking history.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}