import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

function extractNotificationId(request: Request, context: any): string {
    // 1. Try context.params.notificationId (Expo Router API route context)
    if (context?.params?.notificationId) {
        return String(context.params.notificationId).trim();
    }
    // 2. Try context.notificationId (direct params object from test runners)
    if (context?.notificationId) {
        return String(context.notificationId).trim();
    }
    // 3. Fallback: extract last pathname segment from request URL
    try {
        const url = new URL(request.url);
        const parts = url.pathname.split('/').filter(Boolean);
        const last = parts[parts.length - 1];
        if (last && last !== 'notifications') {
            return decodeURIComponent(last).trim();
        }
    } catch (e) {
        // ignore
    }
    return '';
}

// PATCH /api/notifications/[notificationId]
export async function PATCH(request: Request, context: any) {
    return handleUpdate(request, context);
}

// PUT /api/notifications/[notificationId]
export async function PUT(request: Request, context: any) {
    return handleUpdate(request, context);
}

async function handleUpdate(request: Request, context: any) {
    try {
        const notificationId = extractNotificationId(request, context);

        if (!notificationId) {
            return Response.json(
                { success: false, message: 'Notification ID is required.' },
                { status: 400, headers: corsHeaders }
            );
        }

        let status = 'READ';
        try {
            const body = await request.json();
            if (body && body.status) {
                status = body.status;
            }
        } catch (e) {
            // Default to READ if body parsing fails
        }

        const adminDb = getAdminDb();
        const notificationsRef = adminDb.collection('notifications');

        // 1. Try direct doc ID match first (e.g. notif_BK-1001)
        let docRef = notificationsRef.doc(notificationId);
        let docSnap = await docRef.get();

        // 2. Fallback query by notificationId field
        if (!docSnap.exists || (typeof docSnap.exists === 'function' && !docSnap.exists())) {
            const q1 = await notificationsRef.where('notificationId', '==', notificationId).get();
            const docs1 = q1.docs || [];
            if (docs1.length > 0) {
                docSnap = docs1[0];
                docRef = notificationsRef.doc(docSnap.id);
            } else {
                // 3. Fallback query by bookingId field
                const q2 = await notificationsRef.where('bookingId', '==', notificationId).get();
                const docs2 = q2.docs || [];
                if (docs2.length > 0) {
                    docSnap = docs2[0];
                    docRef = notificationsRef.doc(docSnap.id);
                }
            }
        }

        const exists = typeof docSnap.exists === 'function' ? docSnap.exists() : docSnap.exists;
        if (!exists) {
            return Response.json(
                { success: false, message: 'Notification document not found.' },
                { status: 404, headers: corsHeaders }
            );
        }

        const now = new Date().toISOString();
        const updateData: any = {
            status,
            updatedAt: now,
        };

        if (status === 'READ') {
            updateData.readAt = now;
        }

        await docRef.update(updateData);

        const updatedSnap = await docRef.get();
        const updatedData = typeof updatedSnap.data === 'function' ? updatedSnap.data() : updatedSnap;

        return Response.json(
            {
                success: true,
                message: 'Notification status updated successfully.',
                notification: {
                    id: docRef.id,
                    ...updatedData,
                    status,
                },
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Update Notification API Error:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to update notification status.',
                error: error?.message || 'Unknown error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}
