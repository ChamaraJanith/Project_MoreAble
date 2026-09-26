import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
    dispatchBoardingAlert,
    dispatchCaregiverJourneyAlert,
} from '../../../src/shared/services/pushNotificationDispatcher';
import { dispatchCaregiverSafetyAlert } from '../../../src/features/caregiver/services/caregiverAlertService';

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
            date,
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

        if (bookingData.boardingStatus === 'BOARDED') {
            return Response.json(
                { success: false, message: `Cannot board: Passenger has already boarded at ${bookingData.boardedAt || 'earlier stop'}.` },
                { status: 400, headers: corsHeaders }
            );
        }

        // Strict Date Mismatch Guard
        const ticketTravelDate =
            bookingData.travelDate ||
            bookingData.journeyDate ||
            bookingData.departureDate ||
            bookingData.journey?.departureDate ||
            bookingData.journey?.journeyDate;

        if (date && ticketTravelDate && ticketTravelDate !== date) {
            return Response.json(
                {
                    success: false,
                    message: `Boarding Rejected: Travel date mismatch. Ticket is scheduled for ${ticketTravelDate}, not this operational date (${date}).`,
                },
                { status: 400, headers: corsHeaders }
            );
        }

        // Strict Bus Mismatch Guard
        if (busId && bookingData.busId && bookingData.busId !== busId) {
            return Response.json(
                {
                    success: false,
                    message: `Boarding Rejected: Vehicle mismatch. Ticket is booked for bus ${bookingData.vehicle?.numberPlate || bookingData.busId}, not this vehicle.`,
                },
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

        const updatedPaymentMethod = cashCollected
            ? 'CASH'
            : (bookingData.paymentMethod || (bookingData.paymentStatus === 'PAID' ? 'ONLINE' : 'CASH'));

        const updatePayload: any = {
            boardingStatus: 'BOARDED',
            boardedAt: now,
            boardedBusId: busId || bookingData.busId,
            conductorVerifiedBy: conductorId || 'CONDUCTOR_ONBOARD',
            paymentStatus: updatedPaymentStatus,
            paymentMethod: updatedPaymentMethod,
            assistanceStatus: newAssistanceStatus,
            assistanceUpdatedAt: now,
        };

        await bookingDocRef.update(updatePayload);

        // --- MOV-281: Trigger Passenger & Caregiver Boarding Alert ---
        let passengerNotified = false;
        let caregiverNotified = false;
        let caregiverName: string | undefined;
        let guardianId: string | null = null;
        let passengerName = bookingData.userId || 'Passenger';

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
                    const uData = userDoc.data() || {};
                    passengerName = uData.userName || uData.fullName || uData.name || bookingData.userId;
                    guardianId = uData.guardianId || null;
                }
            } catch (err) {
                console.warn('Could not resolve passenger user doc:', err);
            }
        }

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

                // Dispatch real-time Push Notification to Passenger device
                dispatchBoardingAlert(bookingData.userId, {
                    bookingId,
                    vehicleNumber: numberPlate,
                    routeNumber,
                    seatNumber,
                    dropOffHalt,
                    passengerName,
                }).catch((pErr) => console.warn('Push dispatch error for passenger:', pErr));
            } catch (pErr) {
                console.warn('Failed creating passenger boarding notification:', pErr);
            }
        }

        // 2. Caregiver / Guardian Notification
        try {
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

                // Dispatch real-time Push Notification to Caregiver / Guardian device
                dispatchCaregiverJourneyAlert(guardianId, {
                    passengerName,
                    eventType: 'BOARDED',
                    vehicleNumber: numberPlate,
                    locationName: startHalt,
                    bookingId,
                }).catch((cErr) => console.warn('Push dispatch error for caregiver:', cErr));
            }

            // Multi-channel Caregiver Safety Alert (SMS, Email, Live GPS Tracking Link) - MOV-227 / MOV-230
            if (bookingData.userId && bookingData.userId !== 'GUEST') {
                dispatchCaregiverSafetyAlert('BOARDING_CONFIRMED', {
                    bookingId,
                    passengerId: bookingData.userId,
                    passengerName,
                    tripId: bookingData.tripId || bookingData.journey?.tripId || '',
                    busId: busId || bookingData.busId || '',
                    busRegistrationNumber: numberPlate,
                    routeNumber,
                    routeName,
                    boardingStopName: startHalt,
                    destinationStopName: dropOffHalt,
                    trackingToken: bookingData.trackingToken,
                }, adminDb).catch((err) => console.warn('Caregiver multi-channel boarding dispatch error:', err));
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
