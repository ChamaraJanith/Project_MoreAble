// Initialize Firebase Admin SDK for Expo Router Server API Routes
import * as fs from 'fs';
import * as path from 'path';

/**
 * The Firebase Admin resources every API route shares.
 *
 * Kept on `globalThis` rather than in module-level variables because the Expo
 * development server re-evaluates an API route's bundle on every request, and
 * firebase-admin is bundled into each route: a module-level cache — and
 * firebase-admin's own `getApps()` registry — starts empty on each evaluation.
 * Without this, every request built a new app and Firestore client, and each
 * one that ran a query stayed in memory until the dev server ran out of heap.
 *
 * In production a route is evaluated once, so this holds the same single
 * instances the module-level cache always did.
 *
 * Typed structurally rather than with firebase-admin's own types: importing
 * those, even type-only, pulls the SDK's Node/undici globals into every program
 * that includes this file, which breaks the Request/Response types the API
 * route tests rely on.
 */
interface FirebaseAdminCache {
    /** The Firebase Admin app. */
    app?: object;
    /** The Firestore instance, configured once when it is created. */
    db?: FirestoreWithSettings;
    /** The Firebase Admin Auth instance. */
    auth?: object;
}

/** The one Firestore method this module calls itself. */
interface FirestoreWithSettings {
    settings(settings: { ignoreUndefinedProperties?: boolean }): void;
}

declare global {
    var __moreableFirebaseAdmin: FirebaseAdminCache | undefined;
}

function adminCache(): FirebaseAdminCache {
    globalThis.__moreableFirebaseAdmin ??= {};
    return globalThis.__moreableFirebaseAdmin;
}

// The three accessors keep the `any` they have always returned (their values
// come from `require`), so no caller's types change; only the cache is typed.
export function getFirebaseAdminApp(): any {
    const cache = adminCache();

    if (!cache.app) {
        const { initializeApp, cert, getApps } = require('firebase-admin/app');
        if (getApps().length > 0) {
            cache.app = getApps()[0];
        } else {
            let serviceAccount: any = null;

            // Try loading service account JSON from root .env or serviceAccountKey.json
            try {
                const envPath = path.resolve(process.cwd(), '.env');
                if (fs.existsSync(envPath)) {
                    const rawContent = fs.readFileSync(envPath, 'utf8');

                    // Extract valid JSON object bounds (from first { to last })
                    const startIdx = rawContent.indexOf('{');
                    const endIdx = rawContent.lastIndexOf('}');

                    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                        const jsonString = rawContent.substring(startIdx, endIdx + 1);
                        serviceAccount = JSON.parse(jsonString);
                    }
                }
            } catch (e) {
                console.error('Failed to parse service account JSON from .env:', e);
            }

            if (!serviceAccount || !serviceAccount.project_id || !serviceAccount.private_key) {
                throw new Error('Firebase Service Account JSON could not be parsed from .env file.');
            }

            // Ensure private key newlines are properly unescaped
            if (serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }

            cache.app = initializeApp({
                credential: cert(serviceAccount),
            });
        }
    }
    return cache.app;
}

export function getAdminAuth(): any {
    const cache = adminCache();

    if (!cache.auth) {
        const app = getFirebaseAdminApp();
        const { getAuth } = require('firebase-admin/auth');
        cache.auth = getAuth(app);
    }
    return cache.auth;
}

export function getAdminDb(): any {
    const cache = adminCache();

    if (!cache.db) {
        const app = getFirebaseAdminApp();
        const { getFirestore } = require('firebase-admin/firestore');
        const db: FirestoreWithSettings = getFirestore(app);
        try {
            db.settings({ ignoreUndefinedProperties: true });
        } catch (e) {
            // Settings can only be set once on initialized Firestore instance
        }
        cache.db = db;
    }
    return cache.db;
}
