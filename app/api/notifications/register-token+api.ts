import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/notifications/register-token
 * Registers or updates an Expo Push Token for a user.
 * 
 * Body: {
 *   userId: string,
 *   pushToken: string, // "ExponentPushToken[...]"
 *   devicePlatform?: "ios" | "android" | "web",
 *   deviceModel?: string,
 *   appVersion?: string,
 *   notificationsEnabled?: boolean
 * }
 */
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const {
            userId,
            pushToken,
            devicePlatform = 'android',
            deviceModel = 'Unknown Device',
            appVersion = '1.0.0',
            notificationsEnabled = true,
        } = body;

        if (!userId || typeof userId !== 'string' || userId.trim() === '') {
            return Response.json(
                { success: false, message: 'Invalid or missing userId.' },
                { status: 400, headers: corsHeaders }
            );
        }

        if (!pushToken || typeof pushToken !== 'string' || pushToken.trim() === '') {
            return Response.json(
                { success: false, message: 'Invalid or missing pushToken.' },
                { status: 400, headers: corsHeaders }
            );
        }

        const now = new Date().toISOString();
        const adminDb = getAdminDb();

        const tokenRecord = {
            userId: userId.trim(),
            pushToken: pushToken.trim(),
            devicePlatform: devicePlatform.toLowerCase(),
            deviceModel,
            appVersion,
            notificationsEnabled: !!notificationsEnabled,
            registeredAt: now,
            lastActiveAt: now,
        };

        // 1. Store in dedicated device_tokens collection keyed by sanitized pushToken
        const tokenDocKey = encodeURIComponent(pushToken.trim()).replace(/%/g, '_');
        await adminDb.collection('device_tokens').doc(tokenDocKey).set(tokenRecord, { merge: true });

        // 2. Sync push token and metadata directly to user profile document
        let userDocFound = false;
        try {
            const userDocRef = adminDb.collection('users').doc(userId.trim());
            const userSnap = await userDocRef.get();
            if (userSnap.exists) {
                await userDocRef.update({
                    pushToken: pushToken.trim(),
                    devicePlatform: devicePlatform.toLowerCase(),
                    pushNotificationsEnabled: !!notificationsEnabled,
                    pushTokenUpdatedAt: now,
                });
                userDocFound = true;
            } else {
                // Check by passengerId query
                const qSnap = await adminDb
                    .collection('users')
                    .where('passengerId', '==', userId.trim())
                    .limit(1)
                    .get();

                if (!qSnap.empty) {
                    await qSnap.docs[0].ref.update({
                        pushToken: pushToken.trim(),
                        devicePlatform: devicePlatform.toLowerCase(),
                        pushNotificationsEnabled: !!notificationsEnabled,
                        pushTokenUpdatedAt: now,
                    });
                    userDocFound = true;
                }
            }
        } catch (uErr) {
            console.warn('Could not update user doc directly (may not exist yet):', uErr);
        }

        return Response.json(
            {
                success: true,
                message: 'Device push token registered successfully.',
                token: pushToken.trim(),
                userId: userId.trim(),
                userSynced: userDocFound,
                registeredAt: now,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Register Push Token API Error:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to register push token.',
                error: error?.message || 'Unknown error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}

/**
 * DELETE /api/notifications/register-token
 * Unregisters a push token on user logout or permission revocation.
 * 
 * Body: { userId: string, pushToken?: string }
 */
export async function DELETE(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const { userId, pushToken } = body;

        if (!userId && !pushToken) {
            return Response.json(
                { success: false, message: 'Must provide either userId or pushToken to unregister.' },
                { status: 400, headers: corsHeaders }
            );
        }

        const adminDb = getAdminDb();
        const now = new Date().toISOString();

        if (pushToken) {
            const tokenDocKey = encodeURIComponent(pushToken.trim()).replace(/%/g, '_');
            await adminDb.collection('device_tokens').doc(tokenDocKey).delete().catch(() => {});
        }

        if (userId) {
            // Remove push token from user profile
            try {
                const userRef = adminDb.collection('users').doc(userId.trim());
                const userSnap = await userRef.get();
                if (userSnap.exists) {
                    await userRef.update({
                        pushToken: null,
                        pushNotificationsEnabled: false,
                        pushTokenUpdatedAt: now,
                    });
                }
            } catch (err) {
                console.warn('Failed to clear push token from user profile:', err);
            }
        }

        return Response.json(
            {
                success: true,
                message: 'Push token unregistered successfully.',
                unregisteredAt: now,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Unregister Push Token API Error:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to unregister push token.',
                error: error?.message || 'Unknown error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}

/**
 * GET /api/notifications/register-token?userId=...
 * Checks registered push token status for a given user.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return Response.json(
                { success: false, message: 'userId query parameter is required.' },
                { status: 400, headers: corsHeaders }
            );
        }

        const adminDb = getAdminDb();
        const snapshot = await adminDb
            .collection('device_tokens')
            .where('userId', '==', userId.trim())
            .get();

        const tokens: any[] = [];
        snapshot.forEach((doc: any) => {
            tokens.push(doc.data());
        });

        return Response.json(
            {
                success: true,
                userId,
                isRegistered: tokens.length > 0,
                tokens,
            },
            { status: 200, headers: corsHeaders }
        );
    } catch (error: any) {
        console.error('Get Registered Token API Error:', error);
        return Response.json(
            {
                success: false,
                message: 'Failed to fetch registered push tokens.',
                error: error?.message || 'Unknown error',
            },
            { status: 500, headers: corsHeaders }
        );
    }
}
