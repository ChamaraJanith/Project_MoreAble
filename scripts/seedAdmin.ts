import { getAdminAuth, getAdminDb } from '../src/shared/config/firebaseAdmin';
import { User } from '../src/entities/user/model/types';

async function seedAdmin() {
    console.log('Starting admin seed process...');
    try {
        const adminAuth = getAdminAuth();
        const adminDb = getAdminDb();

        const email = 'admin@gmail.com';
        const password = 'SecureAdmin123.me';
        let uid = '';

        // Check if user exists in auth
        try {
            const userRecord = await adminAuth.getUserByEmail(email);
            uid = userRecord.uid;
            console.log(`Admin already exists in Firebase Auth with UID: ${uid}`);
        } catch (error: any) {
            if (error.code === 'auth/user-not-found') {
                console.log('Creating Admin in Firebase Auth...');
                const newUser = await adminAuth.createUser({
                    email,
                    password,
                    displayName: 'System Admin',
                });
                uid = newUser.uid;
                console.log(`Admin created in Firebase Auth with UID: ${uid}`);
            } else {
                throw error;
            }
        }

        const currentYear = new Date().getFullYear();
        const counterRef = adminDb.collection('counters').doc(`admins_${currentYear}`);

        const nextCount = await adminDb.runTransaction(async (transaction: any) => {
            const counterDoc = await transaction.get(counterRef);
            let count = 1;
            if (counterDoc.exists) {
                const counterData = counterDoc.data();
                if (counterData && counterData.lastCount) {
                    count = counterData.lastCount + 1;
                }
            }
            transaction.set(counterRef, { lastCount: count, year: currentYear }, { merge: true });
            return count;
        });

        const formattedSequence = String(nextCount).padStart(5, '0');
        const adminId = `ADM-${currentYear}-${formattedSequence}`;

        // Add to Firestore
        const adminUserDoc: User = {
            uid,
            passengerId: adminId,
            userName: 'System Admin',
            email,
            nicNo: '000000000V', // Dummy NIC
            calculatedAge: 0,
            isElderPerson: false,
            role: 'ADMIN',
            phoneNumber: '+94700000000',
            isVerified: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        console.log('Cleaning up old UID-based document if it exists...');
        await adminDb.collection('users').doc(uid).delete();

        console.log(`Saving admin to Firestore with ID: ${adminId}...`);
        await adminDb.collection('users').doc(adminId).set(adminUserDoc, { merge: true });
        
        console.log('Admin user successfully seeded in the database!');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding admin:', error);
        process.exit(1);
    }
}

seedAdmin();
