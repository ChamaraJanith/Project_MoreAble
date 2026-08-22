import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { computeRouteSegmentDistance } from '../../../src/shared/server/routeDistance';
import { generateBookingId } from '../../../src/shared/utils/bookingId';
import { calculateFare } from '../../../src/shared/utils/fare';
import { normalizeLocation } from '../../../src/shared/utils/location';
import { buildSeatLayout, findSeat } from '../../../src/shared/utils/seatLayout';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

// POST /api/booking/confirm
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { tripId, seatNumber, isPrioritySeat, passengerId, origin, destination, assistanceRequested, specialRequests } = body;

        if (!tripId || !seatNumber) {
            return Response.json(
                { success: false, message: 'tripId and seatNumber are required.' },
                { status: 400, headers: corsHeaders }
            );
        }

        const adminDb = getAdminDb();

        const tripDoc = await adminDb.collection('trips').doc(tripId).get();
        if (!tripDoc.exists) {
            return Response.json({ success: false, message: 'Trip not found.' }, { status: 404, headers: corsHeaders });
        }
        const trip = tripDoc.data();

        if (trip.status !== 'ACTIVE') {
            return Response.json(
                { success: false, message: 'This trip is no longer available for booking.' },
                { status: 409, headers: corsHeaders }
            );
        }

        const busDoc = await adminDb.collection('buses').doc(trip.busId).get();
        if (!busDoc.exists || busDoc.data()?.status !== 'ACTIVE') {
            return Response.json(
                { success: false, message: 'The bus for this trip is no longer available.' },
                { status: 409, headers: corsHeaders }
            );
        }
        const bus = busDoc.data();

        // ---- Authoritative priority seat validation ----
        const layout = buildSeatLayout(bus);
        const targetSeat = findSeat(layout, seatNumber);
        const isPriorityRequest = !!isPrioritySeat || targetSeat?.category === 'PRIORITY';

        if (isPriorityRequest) {
            let isEligible = false;

            if (passengerId && passengerId !== 'GUEST') {
                const userDoc = await adminDb.collection('users').doc(passengerId).get();
                if (userDoc.exists) {
                    const uData = userDoc.data();
                    if (
                        uData?.isLowVisionPerson ||
                        uData?.isHearingImpaired ||
                        uData?.isOtherAccessibilityPerson
                    ) {
                        isEligible = true;
                    } else if (Array.isArray(uData?.accessibilityNeeds)) {
                        const QUALIFYING = ['low_vision', 'hearing_impairment', 'other'];
                        isEligible = uData.accessibilityNeeds.some((n: string) =>
                            typeof n === 'string' && QUALIFYING.includes(n.toLowerCase().trim())
                        );
                    }

                    if (!isEligible && uData?.accessibilityProfileId) {
                        const accDoc = await adminDb
                            .collection('accessibility_needs_persons')
                            .doc(uData.accessibilityProfileId)
                            .get();

                        if (accDoc.exists) {
                            const accData = accDoc.data();
                            const accNeeds = Array.isArray(accData?.accessibilityNeeds) ? accData.accessibilityNeeds : [];
                            const QUALIFYING = ['low_vision', 'hearing_impairment', 'other'];
                            isEligible = accNeeds.some((n: string) =>
                                typeof n === 'string' && QUALIFYING.includes(n.toLowerCase().trim())
                            );
                        }
                    }
                }
            }

            if (!isEligible) {
                return Response.json(
                    {
                        success: false,
                        message: 'Priority seats are strictly locked to normal commuters and reserved only for passengers with registered accessibility needs (Low Vision, Hearing Impairment, or Other).',
                    },
                    { status: 403, headers: corsHeaders }
                );
            }
        }

        // ---- Authoritative elderly seat validation (60+) ----
        const isElderlyRequest = targetSeat?.category === 'ELDERLY';

        if (isElderlyRequest) {
            let isElderlyEligible = false;

            if (passengerId && passengerId !== 'GUEST') {
                const userDoc = await adminDb.collection('users').doc(passengerId).get();
                if (userDoc.exists) {
                    const uData = userDoc.data();
                    const age = typeof uData?.calculatedAge === 'number' ? uData.calculatedAge : null;
                    const minAge = targetSeat?.minAge ?? 60;
                    if (uData?.isElderPerson || (age != null && age >= minAge)) {
                        isElderlyEligible = true;
                    }
                }
            }

            if (!isElderlyEligible) {
                return Response.json(
                    {
                        success: false,
                        message: 'Elderly seats are strictly reserved for passengers aged 60 and above.',
                    },
                    { status: 403, headers: corsHeaders }
                );
            }
        }

        const routeDoc = await adminDb.collection('routes').doc(trip.routeId).get();
        const route = routeDoc.exists ? routeDoc.data() : null;
        const stops: string[] = route && Array.isArray(route.stops) ? route.stops : [];

        // ---- Authoritative fare calculation ----
        // The actual searched origin/destination (mid-route stops like
        // Malabe) take priority over the route's own full endpoints, so a
        // shorter sub-journey is never charged the whole route's fare.
        const journeyOrigin = origin || route?.startLocation || null;
        const journeyDestination = destination || route?.endLocation || null;

        let fare = calculateFare(0, true);

        if (journeyOrigin && journeyDestination && stops.length > 0) {
            const normalizedStops = stops.map((s) => normalizeLocation(s));
            const originIndex = normalizedStops.indexOf(normalizeLocation(journeyOrigin));
            const destinationIndex = normalizedStops.indexOf(normalizeLocation(journeyDestination));

            if (originIndex !== -1 && destinationIndex !== -1 && originIndex < destinationIndex) {
                const { distanceKm, isPrecise } = await computeRouteSegmentDistance(
                    adminDb,
                    stops,
                    originIndex,
                    destinationIndex,
                    route?.distanceKm ?? null
                );
                fare = calculateFare(distanceKm, isPrecise);
            } else if (route?.distanceKm != null) {
                // Origin/destination weren't recognised on this route (e.g. an
                // older booking link) — fall back to the full route distance
                // rather than charging LKR 0.
                fare = calculateFare(route.distanceKm, true);
            }
        } else if (route?.distanceKm != null) {
            fare = calculateFare(route.distanceKm, true);
        }

        const bookingsRef = adminDb.collection('bookings');
        const notificationsRef = adminDb.collection('notifications');

        const booking = await adminDb.runTransaction(async (transaction: any) => {
            const existingSnapshot = await transaction.get(
                bookingsRef.where('tripId', '==', tripId).where('seatNumber', '==', seatNumber).where('status', '==', 'CONFIRMED')
            );

            if (!existingSnapshot.empty) {
                throw new Error('SEAT_TAKEN');
            }

            const bookingId = await generateBookingId(adminDb);
            const now = new Date().toISOString();

            const qrPayload = JSON.stringify({
                bookingId,
                tripId,
                seatNumber,
                numberPlate: bus.numberPlate,
                departureTime: trip.departureTime,
            });

            const newBooking = {
                bookingId,
                userId: passengerId || 'GUEST',
                tripId,
                routeId: trip.routeId,
                busId: trip.busId,
                seatNumber,
                isPrioritySeat: !!isPrioritySeat,
                status: 'CONFIRMED',
                journey: {
                    routeNumber: route?.routeNumber ?? '—',
                    routeName: route?.routeName ?? '—',
                    startLocation: journeyOrigin ?? '—',
                    endLocation: journeyDestination ?? '—',
                    departureTime: trip.departureTime,
                    estimatedArrivalTime: trip.estimatedArrivalTime,
                },
                vehicle: {
                    numberPlate: bus.numberPlate,
                    busModel: bus.busModel,
                    manufacturer: bus.manufacturer,
                },
                fare,
                assistanceRequested: {
                    boardingAssistance: !!assistanceRequested?.boardingAssistance,
                    walkingAssistance: !!assistanceRequested?.walkingAssistance,
                    prioritySeatAssistance: !!assistanceRequested?.prioritySeatAssistance,
                },
                specialRequests: typeof specialRequests === 'string' ? specialRequests.trim() : '',
                reminderSent: false,
                qrPayload,
                createdAt: now,
            };

            const notificationId = `notif_${bookingId}`;
            const newNotification = {
                id: notificationId,
                notificationId,
                userId: passengerId || 'GUEST',
                bookingId,
                type: 'BOOKING_CONFIRMATION',
                title: 'Booking Confirmed!',
                message: `Your reservation ${bookingId} for Route ${route?.routeNumber ?? '—'} (Seat ${seatNumber}) has been confirmed successfully.`,
                status: 'UNREAD',
                createdAt: now,
                readAt: null,
                details: {
                    bookingId,
                    vehicleNumber: bus.numberPlate || '—',
                    routeNumber: route?.routeNumber || '—',
                    routeName: route?.routeName || '—',
                    seatNumber,
                    journeyDate: trip.departureTime ? trip.departureTime.split('T')[0] : now.split('T')[0],
                    journeyTime: trip.departureTime || '—',
                    startLocation: journeyOrigin || '—',
                    endLocation: journeyDestination || '—',
                },
            };

            transaction.set(bookingsRef.doc(bookingId), newBooking);
            transaction.set(notificationsRef.doc(notificationId), newNotification);
            return newBooking;
        });

        return Response.json(
            { success: true, message: 'Booking confirmed successfully.', booking },
            { status: 201, headers: corsHeaders }
        );
    } catch (error: any) {
        if (error.message === 'SEAT_TAKEN') {
            return Response.json(
                { success: false, message: 'This seat was just taken by another passenger. Please choose another seat.' },
                { status: 409, headers: corsHeaders }
            );
        }
        console.error('Confirm Booking API Error:', error);
        return Response.json(
            { success: false, message: 'Failed to confirm booking.', error: error?.message || 'Unknown error' },
            { status: 500, headers: corsHeaders }
        );
    }
}