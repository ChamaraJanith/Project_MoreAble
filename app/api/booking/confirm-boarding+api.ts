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
        const {
            bookingId,
            busId,
            conductorId,
            cashCollected,
            assistanceProgress,
        } = body;

        if (!bookingId) {
            return Response.json(
                { success: false, message: 'Missing bookingId in confirmation request.' },
                { status: 400, headers: corsHeaders }
            );
        }

        const adminDb = getAdminDb();
        const bookingsRef = adminDb.collection('bookings');
        const notificationsRef = adminDb.collection('notifications');
        const now = new Date().toISOString();

        const bookingDocRef = bookingsRef.doc(bookingId);
        const bookingDoc = await bookingDocRef.get();

        if (!bookingDoc.exists) {
            return Response.json(
                { success: false, message: `Booking ${bookingId} not found.` },
                { status: 404, headers: corsHeaders }
            );
        }

        const bookingData = bookingDoc.data() as any;

        if (bookingData.status === 'CANCELLED') {
            return Response.json(
                { success: false, message: 'Cannot board passenger. This booking has been cancelled.' },
                { status: 400, headers: corsHeaders }
            );
        }

        // Determine updated assistance status
        let newAssistanceStatus = bookingData.assistanceStatus || 'NOT_REQUIRED';
        const hasAssistance =
            bookingData.assistanceRequested?.wheelchairAssistance ||
            bookingData.assistanceRequested?.boardingAssistance ||
            bookingData.assistanceRequested?.walkingAssistance ||
            bookingData.assistanceRequested?.prioritySeatAssistance;

        if (hasAssistance) {
            if (assistanceProgress === 'COMPLETED') {
                newAssistanceStatus = 'COMPLETED';
            } else if (assistanceProgress === 'IN_PROGRESS' || newAssistanceStatus === 'PENDING') {
                newAssistanceStatus = 'IN_PROGRESS';
            }
        }

        const updatedPaymentStatus = cashCollected
            ? 'PAID'
            : (bookingData.paymentStatus || 'COLLECT_CASH');

        const updatePayload: any = {
            boardingStatus: 'BOARDED',
            boardedAt: now,
            boardedBusId: busId || bookingData.busId,
            conductorVerifiedBy: conductorId || 'CONDUCTOR_ONBOARD',
            paymentStatus: updatedPaymentStatus,
            assistanceStatus: newAssistanceStatus,
            assistanceUpdatedAt: now,
        };

        await bookingDocRef.update(updatePayload);

        // --- MOV-281: Trigger Passenger & Caregiver Boarding Alert ---
        let passengerNotified = false;
        let caregiverNotified = false;
        let caregiverName: string | undefined;

        const routeNumber = bookingData.journey?.routeNumber || '—';
        const routeName = bookingData.journey?.routeName || '';
        const numberPlate = bookingData.vehicle?.numberPlate || 'Bus';
        const seatNumber = bookingData.seatNumber || '—';
        const dropOffHalt = bookingData.journey?.endLocation || bookingData.destination || 'Destination Halt';
        const startHalt = bookingData.journey?.startLocation || bookingData.origin || 'Origin Halt';

        // 1. Passenger Notification
        if (bookingData.userId && bookingData.userId !== 'GUEST') {
            try {
                const passengerNotifId = `notif_board_${bookingId}_${Date.now()}`;
                const pNotifDoc = {
                    id: passengerNotifId,
                    notificationId: passengerNotifId,
                    userId: bookingData.userId,
                    bookingId,
                    type: 'PASSENGER_BOARDED',
                    title: `Boarding Confirmed • Route ${routeNumber} 🚌`,
                    message: `Welcome aboard! You have boarded bus ${numberPlate} (Seat ${seatNumber}). Destination: ${dropOffHalt}. Safe travels!`,
                    status: 'UNREAD',
                    createdAt: now,
                    readAt: null,
                    details: {
                        bookingId,
                        routeNumber,
                        routeName,
                        vehicleNumber: numberPlate,
                        seatNumber,
                        startLocation: startHalt,
                        endLocation: dropOffHalt,
                        boardedAt: now,
                    },
                };
                await notificationsRef.doc(passengerNotifId).set(pNotifDoc);
                passengerNotified = true;
            } catch (pErr) {
                console.warn('Failed creating passenger boarding notification:', pErr);
            }
        }

        // 2. Caregiver / Guardian Notification
        try {
            let guardianId: string | null = null;
            let passengerName = bookingData.userId;

            if (bookingData.userId && bookingData.userId !== 'GUEST') {
                let userDoc = await adminDb.collection('users').doc(bookingData.userId).get();
                if (!userDoc.exists) {
                    const qSnap = await adminDb.collection('users').where('passengerId', '==', bookingData.userId).limit(1).get();
                    if (!qSnap.empty) {
                        userDoc = qSnap.docs[0];
                    }
                }
                if (userDoc && userDoc.exists) {
                    const uData = userDoc.data() || {};
                    passengerName = uData.userName || uData.fullName || uData.name || bookingData.userId;
                    guardianId = uData.guardianId || null;
                }
            }

            // Also check guardians collection if guardianId found
            if (guardianId) {
                const guardianDoc = await adminDb.collection('guardians').doc(guardianId).get();
                if (guardianDoc.exists) {
                    caregiverName = guardianDoc.data()?.fullName || 'Caregiver';
                }

                const careNotifId = `notif_care_board_${bookingId}_${Date.now()}`;
                const careNotifDoc = {
                    id: careNotifId,
                    notificationId: careNotifId,
                    userId: guardianId,
                    passengerId: bookingData.userId,
                    bookingId,
                    type: 'CARE_PASSENGER_BOARDED',
                    title: `Care Alert: Passenger Boarded Bus 🛡️`,
                    message: `${passengerName} has safely boarded bus ${numberPlate} for Route ${routeNumber}. Drop-off destination: ${dropOffHalt}.`,
                    status: 'UNREAD',
                    createdAt: now,
                    readAt: null,
                    details: {
                        bookingId,
                        passengerName,
                        passengerId: bookingData.userId,
                        routeNumber,
                        vehicleNumber: numberPlate,
                        seatNumber,
                        startLocation: startHalt,
                        endLocation: dropOffHalt,
                        boardedAt: now,
                    },
                };
                await notificationsRef.doc(careNotifId).set(careNotifDoc);
                caregiverNotified = true;
            }
        } catch (cErr) {
            console.warn('Failed creating caregiver boarding notification:', cErr);
        }

        return Response.json(
            {
                success: true,
                message: 'Passenger boarding confirmed successfully.',
                bookingId,
                boardingStatus: 'BOARDED',
                boardedAt: now,
                assistanceStatus: newAssistanceStatus,
                paymentStatus: updatedPaymentStatus,
                passengerNotified,
                caregiverNotified,
                caregiverName,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('POST /api/booking/confirm-boarding Error:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to confirm passenger boarding.',
                error: error?.message || 'Unknown error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}
