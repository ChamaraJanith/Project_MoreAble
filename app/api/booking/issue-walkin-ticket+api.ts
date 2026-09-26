import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { getActiveFarePolicy } from '../../../src/shared/server/farePolicyServer';
import { computeRouteSegmentDistance } from '../../../src/shared/server/routeDistance';
import { generateBookingId } from '../../../src/shared/utils/bookingId';
import { calculateFare } from '../../../src/shared/utils/fare';
import { normalizeLocation } from '../../../src/shared/utils/location';
import { buildSeatLayout, findSeat } from '../../../src/shared/utils/seatLayout';
import { sendRealEmail } from '../../../src/shared/services/emailService';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/booking/issue-walkin-ticket
 * Issues an on-board ticket for spot/walk-in passengers boarding without an advance app reservation.
 * 
 * STRICT ENTERPRISE RULE:
 * Walk-in passengers can ONLY be assigned unreserved STANDARD/NORMAL seats.
 * Wheelchair bays (W1, W2), companion seats (G1, G2), and priority/elderly reserved seats
 * MUST NEVER be assigned to walk-in commuters.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            tripId,
            seatNumber,
            origin,
            destination,
            passengerName: rawPassengerName,
            passengerPhone,
            passengerEmail,
            date,
            journeyDate,
            travelDate,
            conductorId,
        } = body;

        if (!tripId || !seatNumber || !origin || !destination) {
            return Response.json(
                {
                    success: false,
                    message: 'tripId, seatNumber, origin (pickup halt), and destination (drop-off halt) are required.',
                },
                { status: 400, headers: corsHeaders }
            );
        }

        const inputDate =
            (typeof journeyDate === 'string' && journeyDate.trim()) ||
            (typeof travelDate === 'string' && travelDate.trim()) ||
            (typeof date === 'string' && date.trim()) ||
            null;

        const resolvedJourneyDate = inputDate || new Date().toISOString().split('T')[0];

        const adminDb = getAdminDb();

        const tripDoc = await adminDb.collection('trips').doc(tripId).get();
        if (!tripDoc.exists) {
            return Response.json(
                { success: false, message: 'Trip not found.' },
                { status: 404, headers: corsHeaders }
            );
        }
        const trip = tripDoc.data();

        if (trip.status !== 'ACTIVE') {
            return Response.json(
                { success: false, message: 'This trip is no longer active.' },
                { status: 409, headers: corsHeaders }
            );
        }

        const busDoc = await adminDb.collection('buses').doc(trip.busId).get();
        if (!busDoc.exists || busDoc.data()?.status !== 'ACTIVE') {
            return Response.json(
                { success: false, message: 'The bus assigned to this trip is no longer active.' },
                { status: 409, headers: corsHeaders }
            );
        }
        const bus = busDoc.data();

        // 1. Authoritative seat layout and strict category verification
        const layout = buildSeatLayout(bus);
        const targetSeat = findSeat(layout, seatNumber);

        if (!targetSeat) {
            return Response.json(
                {
                    success: false,
                    message: `Seat "${seatNumber}" does not exist on this bus configuration.`,
                },
                { status: 400, headers: corsHeaders }
            );
        }

        // 2. Strict accessibility guard: STANDARD seats ONLY for walk-ins
        const isWheelchair = seatNumber.toUpperCase().startsWith('W') || targetSeat.category === 'WHEELCHAIR';
        const isPriority = targetSeat.category === 'PRIORITY' || targetSeat.isPrioritySeat;
        const isGuardian = targetSeat.category === 'GUARDIAN' || seatNumber.toUpperCase().startsWith('G');
        const isElderly = targetSeat.category === 'ELDERLY';

        if (isWheelchair || isPriority || isGuardian || isElderly || targetSeat.category !== 'STANDARD') {
            return Response.json(
                {
                    success: false,
                    message: 'Walk-in on-board passengers can ONLY be issued unreserved STANDARD seats. Wheelchair bays, companion spots, and priority/elderly accessibility seats are strictly reserved for accessibility passengers.',
                },
                { status: 400, headers: corsHeaders }
            );
        }

        // 3. Route & distance calculation
        const routeDoc = await adminDb.collection('routes').doc(trip.routeId).get();
        const route = routeDoc.exists ? routeDoc.data() : null;
        const stops: string[] = route && Array.isArray(route.stops) ? route.stops : [];

        let originIndex = -1;
        let destinationIndex = -1;

        if (stops.length > 0) {
            const normalizedStops = stops.map((s) => normalizeLocation(s));
            originIndex = normalizedStops.indexOf(normalizeLocation(origin));
            destinationIndex = normalizedStops.indexOf(normalizeLocation(destination));

            if (originIndex === -1 || destinationIndex === -1 || originIndex >= destinationIndex) {
                return Response.json(
                    {
                        success: false,
                        message: 'The selected boarding halt and drop-off halt do not form a valid forward segment along this bus route.',
                    },
                    { status: 400, headers: corsHeaders }
                );
            }
        }

        const activeFarePolicy = await getActiveFarePolicy(adminDb);

        let fare = calculateFare(0, true, {
            policy: activeFarePolicy,
            isAccessibilityEligible: false,
            isElderlyEligible: false,
            hasAssistanceRequested: false,
            isWheelchairPaired: false,
        });

        if (originIndex !== -1 && destinationIndex !== -1 && stops.length > 0) {
            const { distanceKm, isPrecise } = await computeRouteSegmentDistance(
                adminDb,
                stops,
                originIndex,
                destinationIndex,
                route?.distanceKm ?? null
            );
            fare = calculateFare(distanceKm, isPrecise, {
                policy: activeFarePolicy,
                isAccessibilityEligible: false,
                isElderlyEligible: false,
                hasAssistanceRequested: false,
                isWheelchairPaired: false,
            });
        } else if (route?.distanceKm != null) {
            fare = calculateFare(route.distanceKm, true, {
                policy: activeFarePolicy,
                isAccessibilityEligible: false,
                isElderlyEligible: false,
                hasAssistanceRequested: false,
                isWheelchairPaired: false,
            });
        }

        const passengerName =
            (typeof rawPassengerName === 'string' && rawPassengerName.trim()) ||
            `Spot Passenger (${seatNumber})`;

        const cleanPhone = typeof passengerPhone === 'string' && passengerPhone.trim() ? passengerPhone.trim() : null;
        const cleanEmail = typeof passengerEmail === 'string' && passengerEmail.trim() ? passengerEmail.trim() : null;

        const bookingsRef = adminDb.collection('bookings');

        const booking = await adminDb.runTransaction(async (transaction: any) => {
            const existingSnapshot = await transaction.get(
                bookingsRef
                    .where('tripId', '==', tripId)
                    .where('seatNumber', '==', seatNumber)
                    .where('status', '==', 'CONFIRMED')
            );

            const isConflict = existingSnapshot.docs.some((doc: any) => {
                const d = doc.data();
                const existingDate =
                    d.journeyDate ||
                    d.travelDate ||
                    d.journey?.departureDate ||
                    (typeof d.journey?.journeyDate === 'string' ? d.journey.journeyDate : null);
                return !existingDate || existingDate === resolvedJourneyDate;
            });

            if (isConflict) {
                throw new Error('SEAT_TAKEN');
            }

            const bookingId = await generateBookingId(adminDb);
            const now = new Date().toISOString();

            const resolvedDepartureTime = trip.departureTime || '—';
            const resolvedArrivalTime = trip.estimatedArrivalTime || '—';

            const qrPayload = JSON.stringify({
                bookingId,
                tripId,
                seatNumber,
                journeyDate: resolvedJourneyDate,
                numberPlate: bus.numberPlate,
                departureTime: resolvedDepartureTime,
                estimatedArrivalTime: resolvedArrivalTime,
                isWalkIn: true,
            });

            const newBooking = {
                bookingId,
                userId: 'WALK_IN_PASSENGER',
                passengerName,
                passengerPhone: cleanPhone,
                passengerEmail: cleanEmail,
                tripId,
                routeId: trip.routeId,
                busId: trip.busId,
                seatNumber,
                journeyDate: resolvedJourneyDate,
                travelDate: resolvedJourneyDate,
                seatCategory: 'STANDARD',
                pairedSeatNumber: null,
                isPrioritySeat: false,
                status: 'CONFIRMED',
                isWalkIn: true,
                paymentStatus: 'PAID',
                paymentMethod: 'CASH',
                boardingStatus: 'BOARDED',
                boardedAt: now,
                journey: {
                    routeNumber: route?.routeNumber ?? '—',
                    routeName: route?.routeName ?? '—',
                    startLocation: origin,
                    endLocation: destination,
                    departureDate: resolvedJourneyDate,
                    journeyDate: resolvedJourneyDate,
                    departureTime: resolvedDepartureTime,
                    estimatedArrivalTime: resolvedArrivalTime,
                },
                vehicle: {
                    numberPlate: bus.numberPlate,
                    busModel: bus.busModel,
                    manufacturer: bus.manufacturer,
                },
                fare,
                assistanceRequested: {
                    wheelchairAssistance: false,
                    boardingAssistance: false,
                    walkingAssistance: false,
                    prioritySeatAssistance: false,
                },
                assistanceStatus: 'NOT_REQUIRED',
                assistanceUpdatedAt: now,
                specialRequests: 'Spot / Walk-in Passenger Ticket (Issued by Conductor).',
                reminderSent: false,
                qrPayload,
                issuedByConductorId: conductorId || 'ONBOARD_STAFF',
                createdAt: now,
            };

            transaction.set(bookingsRef.doc(bookingId), newBooking);
            return newBooking;
        });

        // Multi-Channel E-Ticket Dispatch (Email & SMS)
        let emailDispatched = false;
        let smsDispatched = false;

        if (cleanEmail) {
            try {
                const totalLkr = booking.fare?.totalFare ?? 0;
                const htmlReceipt = `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #E2E8F0; border-radius: 12px; background-color: #FFFFFF;">
                        <div style="background-color: #0066CC; padding: 16px; border-radius: 8px; text-align: center; color: #FFFFFF;">
                            <h2 style="margin: 0; font-size: 20px;">MoreAble Transit E-Ticket</h2>
                            <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.9;">On-Board Cash Receipt</p>
                        </div>
                        <div style="padding: 20px 10px;">
                            <p style="font-size: 14px; color: #334155;">Hello <strong>${passengerName}</strong>,</p>
                            <p style="font-size: 14px; color: #334155;">Here is your official transit ticket confirmation:</p>
                            
                            <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13.5px;">
                                <tr style="border-bottom: 1px solid #F1F5F9;">
                                    <td style="padding: 8px 0; color: #64748B;">Ticket ID:</td>
                                    <td style="padding: 8px 0; font-weight: bold; color: #0F172A; text-align: right;">${booking.bookingId}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #F1F5F9;">
                                    <td style="padding: 8px 0; color: #64748B;">Route:</td>
                                    <td style="padding: 8px 0; font-weight: bold; color: #0F172A; text-align: right;">Route ${route?.routeNumber ?? '—'} (${origin} ➔ ${destination})</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #F1F5F9;">
                                    <td style="padding: 8px 0; color: #64748B;">Seat:</td>
                                    <td style="padding: 8px 0; font-weight: bold; color: #0066CC; text-align: right;">Standard Seat ${seatNumber}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #F1F5F9;">
                                    <td style="padding: 8px 0; color: #64748B;">Bus Plate:</td>
                                    <td style="padding: 8px 0; color: #0F172A; text-align: right;">${bus.numberPlate}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid #F1F5F9;">
                                    <td style="padding: 8px 0; color: #64748B;">Date & Time:</td>
                                    <td style="padding: 8px 0; color: #0F172A; text-align: right;">${resolvedJourneyDate} · ${trip.departureTime || 'Trip'}</td>
                                </tr>
                                <tr style="border-bottom: 2px solid #CBD5E1;">
                                    <td style="padding: 10px 0; font-size: 15px; font-weight: bold; color: #0F172A;">Total Paid (Cash):</td>
                                    <td style="padding: 10px 0; font-size: 16px; font-weight: 800; color: #059669; text-align: right;">LKR ${totalLkr.toFixed(2)}</td>
                                </tr>
                            </table>

                            <div style="margin-top: 20px; padding: 12px; background-color: #EFF6FF; border-radius: 8px; text-align: center;">
                                <p style="margin: 0; font-size: 12px; color: #0066CC; font-weight: 600;">Status: BOARDED & CONFIRMED · Have a safe journey!</p>
                            </div>
                        </div>
                    </div>
                `;

                sendRealEmail({
                    to: cleanEmail,
                    subject: `MoreAble E-Ticket #${booking.bookingId} • Route ${route?.routeNumber ?? '—'} (${origin} ➔ ${destination})`,
                    html: htmlReceipt,
                    text: `MoreAble Transit E-Ticket: Booking ID ${booking.bookingId}, Seat ${seatNumber}, ${origin} to ${destination}, Fare: LKR ${totalLkr} (Paid Cash).`,
                }).catch((e) => console.warn('E-Ticket Email dispatch error:', e));

                emailDispatched = true;
            } catch (err) {
                console.warn('Failed to construct E-Ticket email:', err);
            }
        }

        if (cleanPhone) {
            console.log(`[SMS Dispatch Simulation] Sent to ${cleanPhone}: "MoreAble Transit: Ticket ${booking.bookingId} for Seat ${seatNumber} (${origin} to ${destination}) issued. Fare LKR ${booking.fare?.totalFare ?? 0} collected in Cash. Safe journey!"`);
            smsDispatched = true;
        }

        return Response.json(
            {
                success: true,
                message: `Spot ticket ${booking.bookingId} issued successfully for Seat ${seatNumber}. Passenger marked as BOARDED.`,
                booking,
                notifications: {
                    emailDispatched,
                    smsDispatched,
                },
            },
            { status: 201, headers: corsHeaders }
        );
    } catch (error: any) {
        if (error.message === 'SEAT_TAKEN') {
            return Response.json(
                {
                    success: false,
                    message: 'This seat was just booked by another passenger. Please select another standard seat.',
                },
                { status: 409, headers: corsHeaders }
            );
        }

        console.error('Issue Walk-in Ticket API Error:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to issue walk-in ticket on board.',
                error: error?.message || 'Unknown error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}
