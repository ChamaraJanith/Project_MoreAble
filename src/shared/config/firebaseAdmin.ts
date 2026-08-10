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

            appInstance = initializeApp({
                credential: cert(serviceAccount),
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