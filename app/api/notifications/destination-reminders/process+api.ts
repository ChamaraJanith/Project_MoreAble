import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';
import { dispatchDestinationReminder } from '../../../../src/shared/services/pushNotificationDispatcher';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

function calculateHaversineDistanceMeters(
    loc1: { latitude: number; longitude: number },
    loc2: { latitude: number; longitude: number }
): number {
    const toRad = (value: number) => (value * Math.PI) / 180;
    const R = 6371e3; // Earth radius in meters
    const dLat = toRad(loc2.latitude - loc1.latitude);
    const dLon = toRad(loc2.longitude - loc1.longitude);
    const lat1 = toRad(loc1.latitude);
    const lat2 = toRad(loc2.latitude);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export async function handleProcessDestinationReminders(request: Request) {
    try {
        const nowIso = new Date().toISOString();
        const adminDb = getAdminDb();
        const bookingsRef = adminDb.collection('bookings');
        const vehicleLocationsRef = adminDb.collection('vehicleLocations');
        const routesRef = adminDb.collection('routes');
        const notificationsRef = adminDb.collection('notifications');

        // Fetch boarded bookings where destination reminder hasn't been sent
        const snapshot = await bookingsRef
            .where('status', '==', 'CONFIRMED')
            .where('boardingStatus', '==', 'BOARDED')
            .get();

        const docs = snapshot.docs || [];
        let processedCount = 0;
        let sentCount = 0;
        const sentReminders: any[] = [];

        // Cache routes and vehicle locations to minimize DB calls in loop
        const routesCache = new Map<string, any>();
        const locationsCache = new Map<string, any>();

        for (const doc of docs) {
            const data = doc.data();

            // We filter in memory because Firestore doesn't allow '!=' combined with multiple conditions easily
            if (data.destinationReminderSent === true) {
                continue;
            }

            processedCount++;

            const journey = data.journey || {};
            const routeId = data.routeId;
            const busId = data.busId;
            const endLocationName = journey.endLocation || data.endLocation;

            if (!routeId || !busId || !endLocationName) continue;

            // 1. Fetch Vehicle Location
            let vehicleLoc = locationsCache.get(busId);
            if (vehicleLoc === undefined) {
                const locDoc = await vehicleLocationsRef.doc(busId).get();
                vehicleLoc = locDoc.exists ? locDoc.data() : null;
                locationsCache.set(busId, vehicleLoc);
            }

            if (!vehicleLoc || !vehicleLoc.latitude || !vehicleLoc.longitude) continue;

            // 2. Fetch Route to get endLocation coordinates
            let routeData = routesCache.get(routeId);
            if (routeData === undefined) {
                const routeDoc = await routesRef.doc(routeId).get();
                routeData = routeDoc.exists ? routeDoc.data() : null;
                routesCache.set(routeId, routeData);
            }

            if (!routeData || !routeData.stops) continue;

            // Find the stop matching the endLocation name
            const destinationStop = routeData.stops.find(
                (s: any) => s.stopName === endLocationName || s.name === endLocationName
            );

            if (!destinationStop || !destinationStop.coordinate) continue;

            // 3. Calculate Distance
            const distanceMeters = calculateHaversineDistanceMeters(
                { latitude: vehicleLoc.latitude, longitude: vehicleLoc.longitude },
                { latitude: destinationStop.coordinate.latitude, longitude: destinationStop.coordinate.longitude }
            );

            // 4. Trigger Reminder if within 2000 meters
            if (distanceMeters <= 2000) {
                const bookingId = data.bookingId || doc.id;
                
                await dispatchDestinationReminder(data.userId, {
                    bookingId,
                    destination: endLocationName,
                    estimatedArrivalTime: journey.estimatedArrivalTime || undefined
                });

                // Update booking
                await bookingsRef.doc(bookingId).update({
                    destinationReminderSent: true,
                    destinationReminderSentAt: nowIso,
                });

                sentCount++;
                sentReminders.push({
                    bookingId,
                    userId: data.userId,
                    destination: endLocationName,
                    distanceMeters: Math.round(distanceMeters),
                });
            }
        }

        return Response.json(
            {
                success: true,
                message: `Processed ${processedCount} bookings. Sent ${sentCount} destination reminder(s).`,
                processedCount,
                sentCount,
                reminders: sentReminders,
                evaluatedAt: nowIso,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Process Destination Reminders API Error:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to process destination reminders.',
                error: error?.message || 'Internal error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}

export const GET = handleProcessDestinationReminders;
export const POST = handleProcessDestinationReminders;
