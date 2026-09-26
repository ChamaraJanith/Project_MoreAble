import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import {
    DEFAULT_NOTIFICATION_PREFERENCES,
    NotificationPreferences,
    normalizeNotificationPreferences,
} from '../../../src/entities/notification/model/types';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/notifications/preferences?userId=...
 * Retrieves current notification preferences for the specified passenger.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId') || searchParams.get('passengerId');

        if (!userId || !userId.trim()) {
            return Response.json(
                {
                    success: false,
                    message: 'userId is required to fetch notification preferences.',
                    preferences: DEFAULT_NOTIFICATION_PREFERENCES,
                },
                { status: 400, headers: corsHeaders }
            );
        }

        const trimmedId = userId.trim();
        const adminDb = getAdminDb();

        // 1. Try dedicated notification_preferences collection
        const prefDoc = await adminDb.collection('notification_preferences').doc(trimmedId).get();
        if (prefDoc.exists) {
            const data = prefDoc.data();
            const normalized = normalizeNotificationPreferences(data);
            return Response.json(
                {
                    success: true,
                    userId: trimmedId,
                    preferences: normalized,
                    isDefault: false,
                },
                { status: 200, headers: corsHeaders }
            );
        }

        // 2. Try users collection by document ID
        const userDoc = await adminDb.collection('users').doc(trimmedId).get();
        if (userDoc.exists && userDoc.data()?.notificationPreferences) {
            const normalized = normalizeNotificationPreferences(userDoc.data()?.notificationPreferences);
            return Response.json(
                {
                    success: true,
                    userId: trimmedId,
                    preferences: normalized,
                    isDefault: false,
                },
                { status: 200, headers: corsHeaders }
            );
        }

        // 3. Try users collection by passengerId field
        const querySnap = await adminDb.collection('users').where('passengerId', '==', trimmedId).limit(1).get();
        if (!querySnap.empty && querySnap.docs[0].data()?.notificationPreferences) {
            const normalized = normalizeNotificationPreferences(querySnap.docs[0].data()?.notificationPreferences);
            return Response.json(
                {
                    success: true,
                    userId: trimmedId,
                    preferences: normalized,
                    isDefault: false,
                },
                { status: 200, headers: corsHeaders }
            );
        }

        // Fallback to default enterprise preferences
        return Response.json(
            {
                success: true,
                userId: trimmedId,
                preferences: DEFAULT_NOTIFICATION_PREFERENCES,
                isDefault: true,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('[NotificationPreferences API] Error in GET:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to retrieve notification preferences.',
                error: error?.message || 'Unknown error',
                preferences: DEFAULT_NOTIFICATION_PREFERENCES,
            },
            { status: 500, headers: corsHeaders }
        );
    }
}

/**
 * PUT /api/notifications/preferences
 * POST /api/notifications/preferences
 * Saves or updates passenger notification preferences.
 * 
 * STRICT ENTERPRISE RULE (MOV-240 Acceptance Criteria):
 * `emergencyAlerts` can NEVER be disabled. If payload attempts to set it to false,
 * it is strictly normalized and locked to `true`.
 */
export async function PUT(request: Request) {
    return handleSavePreferences(request);
}

export async function POST(request: Request) {
    return handleSavePreferences(request);
}

async function handleSavePreferences(request: Request) {
    try {
        const body = await request.json();
        const { searchParams } = new URL(request.url);
        const userId = body?.userId || body?.passengerId || searchParams.get('userId');
        const rawPreferences = body?.preferences || body;

        if (!userId || typeof userId !== 'string' || !userId.trim()) {
            return Response.json(
                {
                    success: false,
                    message: 'userId is required to update notification preferences.',
                },
                { status: 400, headers: corsHeaders }
            );
        }

        const trimmedId = userId.trim();
        const now = new Date().toISOString();

        // Normalize preferences and enforce immutable emergency alert rule
        const normalizedPreferences: NotificationPreferences = normalizeNotificationPreferences({
            ...rawPreferences,
            updatedAt: now,
        });

        const adminDb = getAdminDb();

        // 1. Persist to notification_preferences collection
        await adminDb.collection('notification_preferences').doc(trimmedId).set(
            {
                userId: trimmedId,
                ...normalizedPreferences,
                updatedAt: now,
            },
            { merge: true }
        );

        // 2. Sync to user profile in users collection if document exists
        try {
            const userDocRef = adminDb.collection('users').doc(trimmedId);
            const userDoc = await userDocRef.get();
            if (userDoc.exists) {
                await userDocRef.update({
                    notificationPreferences: normalizedPreferences,
                    updatedAt: now,
                });
            } else {
                const querySnap = await adminDb.collection('users').where('passengerId', '==', trimmedId).limit(1).get();
                if (!querySnap.empty) {
                    await querySnap.docs[0].ref.update({
                        notificationPreferences: normalizedPreferences,
                        updatedAt: now,
                    });
                }
            }
        } catch (syncErr) {
            console.warn('[NotificationPreferences API] User document sync warning:', syncErr);
        }

        return Response.json(
            {
                success: true,
                message: 'Notification preferences saved successfully.',
                userId: trimmedId,
                preferences: normalizedPreferences,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('[NotificationPreferences API] Error in save:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to save notification preferences.',
                error: error?.message || 'Unknown error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}
