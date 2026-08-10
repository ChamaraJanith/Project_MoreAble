// Initialize Firebase Admin SDK for Expo Router Server API Routes
import * as fs from 'fs';
import * as path from 'path';

let appInstance: any = null;

export function getFirebaseAdminApp() {
    if (!appInstance) {
        const { initializeApp, cert, getApps } = require('firebase-admin/app');
        if (getApps().length > 0) {
            appInstance = getApps()[0];
        } else {
            let serviceAccount: any;
            try {
                const envPath = path.resolve(process.cwd(), '.env');
                const envContent = fs.readFileSync(envPath, 'utf8');
                serviceAccount = JSON.parse(envContent);
            } catch (e) {
                console.error('Error reading .env service account file:', e);
            }

            const projectId = serviceAccount?.project_id || serviceAccount?.projectId || process.env.project_id;
            const clientEmail = serviceAccount?.client_email || serviceAccount?.clientEmail || process.env.client_email;
            let privateKey = serviceAccount?.private_key || serviceAccount?.privateKey || process.env.private_key;

            if (privateKey) {
                privateKey = privateKey.replace(/\\n/g, '\n');
            }

            appInstance = initializeApp({
                credential: cert({
                    projectId,
                    clientEmail,
                    privateKey,
                }),
            });
        }
    }
    return appInstance;
}

export function getAdminAuth() {
    const app = getFirebaseAdminApp();
    const { getAuth } = require('firebase-admin/auth');
    return getAuth(app);
}

export function getAdminDb() {
    const app = getFirebaseAdminApp();
    const { getFirestore } = require('firebase-admin/firestore');
    return getFirestore(app);
}