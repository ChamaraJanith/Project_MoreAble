import { getAdminDb } from '../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

// GET /api/notifications?userId=...
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId') || 'GUEST';

        const adminDb = getAdminDb();
        const notificationsRef = adminDb.collection('notifications');

        const snapshot = await notificationsRef
            .where('userId', '==', userId)
            .get();

        const notifications: any[] = [];
        let unreadCount = 0;

        const docs = snapshot.docs || [];
        docs.forEach((doc: any) => {
            const data = typeof doc.data === 'function' ? doc.data() : doc;
            const notification = {
                id: doc.id,
                ...data,
            };
            notifications.push(notification);
            if (data.status === 'UNREAD') {
                unreadCount++;
            }
        });

        // Sort descending by createdAt
        notifications.sort((a, b) => {
            const dateA = new Date(a.createdAt || 0).getTime();
            const dateB = new Date(b.createdAt || 0).getTime();
            return dateB - dateA;
        });

        return Response.json(
            {
                success: true,
                notifications,
                unreadCount,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Get Notifications API Error:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to retrieve notifications.',
                error: error?.message || 'Unknown error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}
