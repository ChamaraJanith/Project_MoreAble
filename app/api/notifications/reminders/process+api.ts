import { getAdminDb } from '../../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

export function parseDepartureDateTime(journeyDate?: string, timeStr?: string, referenceDate?: Date): Date | null {
    if (!timeStr) return null;

    // 1. If timeStr is already a full ISO timestamp
    if (timeStr.includes('T') && !isNaN(Date.parse(timeStr))) {
        return new Date(timeStr);
    }

    // 2. Extract HH:MM and optional AM/PM (handles strings like "20:55", "8:55 PM", "16:30 (16:30)")
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!timeMatch) return null;

    let hours = parseInt(timeMatch[1], 10);
    const minutes = parseInt(timeMatch[2], 10);
    const period = timeMatch[3] ? timeMatch[3].toUpperCase() : null;

    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    const base = referenceDate || new Date();
    const isIsoUtc = !!referenceDate;

    if (isIsoUtc && journeyDate && /^\d{4}-\d{2}-\d{2}$/.test(journeyDate)) {
        const parts = journeyDate.split('-').map(Number);
        const year = parts[0];
        const month = parts[1] - 1;
        const day = parts[2];
        return new Date(Date.UTC(year, month, day, hours, minutes, 0, 0));
    }

    let year = base.getFullYear();
    let month = base.getMonth();
    let day = base.getDate();

    if (journeyDate && /^\d{4}-\d{2}-\d{2}$/.test(journeyDate)) {
        const parts = journeyDate.split('-').map(Number);
        year = parts[0];
        month = parts[1] - 1;
        day = parts[2];
    }

    return new Date(year, month, day, hours, minutes, 0, 0);
}

export async function handleProcessReminders(request: Request) {
    try {
        let nowIso = new Date().toISOString();

        if (request.method === 'POST') {
            try {
                const body = await request.json();
                if (body && typeof body.nowIso === 'string') {
                    nowIso = body.nowIso;
                }
            } catch {
                // Request body might be empty, use current server time
            }
        } else if (request.method === 'GET') {
            const { searchParams } = new URL(request.url);
            const queryNowIso = searchParams.get('nowIso');
            if (queryNowIso) {
                nowIso = queryNowIso;
            }
        }

        const now = new Date(nowIso);
        const adminDb = getAdminDb();
        const bookingsRef = adminDb.collection('bookings');
        const notificationsRef = adminDb.collection('notifications');

        const snapshot = await bookingsRef.where('status', '==', 'CONFIRMED').get();
        const docs = snapshot.docs || [];

        let processedCount = 0;
        let sentCount = 0;
        const sentReminders: any[] = [];

        for (const doc of docs) {
            processedCount++;
            const data = typeof doc.data === 'function' ? doc.data() : doc;

            // Idempotency check: Skip if reminder has already been sent
            if (data.reminderSent === true) {
                continue;
            }

            const journey = data.journey || {};
            const vehicle = data.vehicle || {};
            const journeyDate = data.journeyDate || journey.journeyDate;
            const departureTime = journey.departureTime || data.departureTime;

            const departureDateTime = parseDepartureDateTime(journeyDate, departureTime, now);
            if (!departureDateTime) {
                continue;
            }

            const diffMs = departureDateTime.getTime() - now.getTime();
            const diffMinutes = diffMs / (1000 * 60);

            // Send reminder if departure is in the upcoming window: 0 < diffMinutes <= 15
            if (diffMinutes > 0 && diffMinutes <= 15) {
                const roundedMins = Math.max(1, Math.round(diffMinutes));
                const bookingId = data.bookingId || doc.id;
                const vehicleNumber = vehicle.numberPlate || data.vehicleNumber || 'Bus';
                const routeNumber = journey.routeNumber || '—';
                const routeName = journey.routeName || '—';
                const startLocation = journey.startLocation || data.startLocation || 'Boarding Point';
                const endLocation = journey.endLocation || data.endLocation || 'Destination';
                const seatNumber = data.seatNumber || '—';
                const formattedTime = departureTime || '—';

                const notificationId = `notif_rem_${bookingId}`;
                const title = 'Boarding Reminder 🚌';
                const message = `Bus ${vehicleNumber} for Route ${routeNumber} will depart in ${roundedMins} minute${roundedMins === 1 ? '' : 's'}. Please proceed to ${startLocation} (Seat ${seatNumber}).`;

                const newNotification = {
                    id: notificationId,
                    notificationId,
                    userId: data.userId || 'GUEST',
                    bookingId,
                    type: 'BOARDING_REMINDER',
                    title,
                    message,
                    status: 'UNREAD',
                    createdAt: nowIso,
                    readAt: null,
                    details: {
                        bookingId,
                        vehicleNumber,
                        routeNumber,
                        routeName,
                        seatNumber,
                        journeyDate: journeyDate || nowIso.split('T')[0],
                        journeyTime: formattedTime,
                        startLocation,
                        endLocation,
                    },
                };

                const bookingRef = bookingsRef.doc(bookingId);
                const notificationDocRef = notificationsRef.doc(notificationId);

                // Atomically update booking flag and insert notification
                if (typeof adminDb.runTransaction === 'function') {
                    await adminDb.runTransaction(async (transaction: any) => {
                        transaction.set(notificationDocRef, newNotification);
                        transaction.update(bookingRef, {
                            reminderSent: true,
                            reminderSentAt: nowIso,
                        });
                    });
                } else {
                    await notificationDocRef.set(newNotification);
                    await bookingRef.update({
                        reminderSent: true,
                        reminderSentAt: nowIso,
                    });
                }

                sentCount++;
                sentReminders.push({
                    bookingId,
                    notificationId,
                    vehicleNumber,
                    routeNumber,
                    startLocation,
                    seatNumber,
                    departureTime: formattedTime,
                    minutesUntilDeparture: roundedMins,
                });
            }
        }

        return Response.json(
            {
                success: true,
                message: `Processed ${processedCount} bookings. Sent ${sentCount} boarding reminder(s).`,
                processedCount,
                sentCount,
                reminders: sentReminders,
                evaluatedAt: nowIso,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Process Reminders API Error:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to process boarding reminders.',
                error: error?.message || 'Unknown error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}

export async function POST(request: Request) {
    return handleProcessReminders(request);
}

export async function GET(request: Request) {
    return handleProcessReminders(request);
}
