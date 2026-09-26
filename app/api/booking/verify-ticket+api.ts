import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { qrPayload, bookingId: directBookingId, busId, tripId, date } = body;

        let bookingId = directBookingId;

        // Attempt parsing qrPayload if provided
        if (!bookingId && qrPayload) {
            try {
                if (typeof qrPayload === 'string') {
                    if (qrPayload.trim().startsWith('{')) {
                        const parsed = JSON.parse(qrPayload);
                        bookingId = parsed.bookingId || parsed.id;
                    } else {
                        // Raw booking ID or URI
                        bookingId = qrPayload.trim();
                    }
                } else if (typeof qrPayload === 'object' && qrPayload.bookingId) {
                    bookingId = qrPayload.bookingId;
                }
            } catch {
                bookingId = typeof qrPayload === 'string' ? qrPayload.trim() : null;
            }
        }

        if (!bookingId) {
            return Response.json(
                {
                    success: false,
                    valid: false,
                    message: 'Invalid QR code. No booking identifier found in ticket payload.',
                },
                { status: 400, headers: corsHeaders }
            );
        }

        const adminDb = getAdminDb();
        const bookingDoc = await adminDb.collection('bookings').doc(bookingId).get();

        if (!bookingDoc.exists) {
            return Response.json(
                {
                    success: false,
                    valid: false,
                    message: `Ticket Not Found. No active booking matches ID "${bookingId}".`,
                },
                { status: 404, headers: corsHeaders }
            );
        }

        const bookingData = bookingDoc.data() as any;

        // Check if ticket is cancelled
        if (bookingData.status === 'CANCELLED') {
            return Response.json(
                {
                    success: false,
                    valid: false,
                    message: `Invalid Ticket: This reservation (${bookingId}) was cancelled.`,
                    booking: bookingData,
                },
                { status: 400, headers: corsHeaders }
            );
        }

        // Check bus / trip mismatch warning if busId or tripId provided
        let busMismatchWarning = '';
        if (busId && bookingData.busId && bookingData.busId !== busId) {
            busMismatchWarning = `Bus Mismatch: Ticket is booked for bus ${bookingData.vehicle?.numberPlate || bookingData.busId}, not this vehicle.`;
        }

        // Check travel date mismatch warning if date is provided
        const ticketTravelDate =
            bookingData.travelDate ||
            bookingData.journeyDate ||
            bookingData.departureDate ||
            bookingData.journey?.departureDate ||
            bookingData.journey?.journeyDate;

        let dateMismatchWarning = '';
        if (date && ticketTravelDate && ticketTravelDate !== date) {
            dateMismatchWarning = `Travel Date Mismatch: Ticket is scheduled for ${ticketTravelDate}, not this operational date (${date}).`;
        }

        // Fetch passenger user profile if available
        let passengerName = bookingData.userId;
        let guardianInfo: any = null;

        if (bookingData.userId && bookingData.userId !== 'GUEST') {
            try {
                let userDoc = await adminDb.collection('users').doc(bookingData.userId).get();
                if (!userDoc.exists) {
                    const qSnap = await adminDb.collection('users').where('passengerId', '==', bookingData.userId).limit(1).get();
                    if (!qSnap.empty) {
                        userDoc = qSnap.docs[0];
                    }
                }
                if (userDoc && userDoc.exists) {
                    const userData = userDoc.data() || {};
                    passengerName = userData.userName || userData.fullName || userData.name || bookingData.userId;

                    const guardianId = userData.guardianId;
                    if (guardianId) {
                        const guardianDoc = await adminDb.collection('guardians').doc(guardianId).get();
                        if (guardianDoc.exists) {
                            const gData = guardianDoc.data() || {};
                            guardianInfo = {
                                guardianId,
                                fullName: gData.fullName || 'Registered Caregiver',
                                mobileNo: gData.mobileNo || '',
                                relationship: gData.relationship || 'Guardian',
                            };
                        }
                    }
                }
            } catch (err) {
                console.warn('Failed fetching user profile for ticket:', err);
            }
        }

        const isWheelchair =
            bookingData.seatNumber?.startsWith('W') ||
            !!bookingData.assistanceRequested?.wheelchairAssistance;

        const isPrioritySeat =
            !!bookingData.isPrioritySeat ||
            bookingData.seatCategory === 'PRIORITY' ||
            !!bookingData.assistanceRequested?.prioritySeatAssistance;

        const dropOffHalt =
            bookingData.journey?.endLocation ||
            bookingData.destination ||
            'Drop-off Destination Halt';

        const boardingHalt =
            bookingData.journey?.startLocation ||
            bookingData.origin ||
            'Pickup Halt';

        const totalFare = Number(bookingData.fare?.totalFare) || 0;
        const paymentStatus = bookingData.paymentStatus || 'COLLECT_CASH';
        const alreadyBoarded = bookingData.boardingStatus === 'BOARDED';

        let isValid = true;
        let isBoardingAllowed = true;
        let rejectionReason: 'DATE_MISMATCH' | 'BUS_MISMATCH' | 'ALREADY_BOARDED' | null = null;
        let statusMessage = 'Ticket verified successfully. Boarding permitted.';

        if (dateMismatchWarning) {
            isValid = false;
            isBoardingAllowed = false;
            rejectionReason = 'DATE_MISMATCH';
            statusMessage = dateMismatchWarning;
        } else if (busMismatchWarning) {
            isValid = false;
            isBoardingAllowed = false;
            rejectionReason = 'BUS_MISMATCH';
            statusMessage = busMismatchWarning;
        } else if (alreadyBoarded) {
            isValid = true;
            isBoardingAllowed = false;
            rejectionReason = null;
            statusMessage = `Passenger has already boarded at ${bookingData.boardedAt || 'earlier stop'}.`;
        }

        const responsePayload = {
            success: true,
            valid: isValid,
            isBoardingAllowed,
            rejectionReason,
            message: statusMessage,
            busMismatchWarning: busMismatchWarning || null,
            dateMismatchWarning: dateMismatchWarning || null,
            travelDate: ticketTravelDate || null,
            journeyDate: ticketTravelDate || null,
            booking: {
                ...bookingData,
                id: bookingDoc.id,
                bookingId,
                travelDate: ticketTravelDate || bookingData.travelDate,
            },
            passengerName,
            dropOffHalt,
            boardingHalt,
            seatNumber: bookingData.seatNumber || '—',
            pairedSeatNumber: bookingData.pairedSeatNumber || null,
            isPrioritySeat,
            isWheelchair,
            fareAmount: totalFare,
            fareCurrency: bookingData.fare?.currency || 'LKR',
            paymentStatus,
            assistanceRequested: bookingData.assistanceRequested || {
                wheelchairAssistance: false,
                boardingAssistance: false,
                walkingAssistance: false,
                prioritySeatAssistance: false,
            },
            specialRequests: bookingData.specialRequests || '',
            alreadyBoarded,
            boardedAt: bookingData.boardedAt || null,
            guardianInfo,
        };

        return Response.json(responsePayload, { status: 200, headers: corsHeaders });
    } catch (error: any) {
        console.error('POST /api/booking/verify-ticket Error:', error);
        return Response.json(
            {
                success: false,
                valid: false,
                message: 'Failed to verify ticket QR code.',
                error: error?.message || 'Internal error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}
