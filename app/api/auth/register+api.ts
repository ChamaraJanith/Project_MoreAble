//We Use register+api.ts because this is a backend file.
import bcrypt from 'bcryptjs';
import { AccessibilityProfile, Guardian, User, UserRegistrationDTO } from '../../../src/entities/user/model/types';
import { getAdminAuth, getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { parseSriLankanNic } from '../../../src/shared/utils/nicUtils';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: corsHeaders,
    });
}

//POST Method for User Registration
export async function POST(request: Request) {
    try {
        const data: UserRegistrationDTO = await request.json();

        //Check NIC Number
        const nicInfo = parseSriLankanNic(data.nicNo);
        if (!nicInfo.isValid) {
            return Response.json({ message: 'Invalid NIC Number provided.' }, { status: 400, headers: corsHeaders });
        }

        const adminAuth = getAdminAuth();
        const adminDb = getAdminDb();

        let userRecord;
        try {
            //Create User inside of Firebase Auth using adminAuth
            userRecord = await adminAuth.createUser({
                email: data.email,
                password: data.password,
                displayName: data.userName,
            });
        } catch (authError: any) {
            return Response.json({ message: authError.message }, { status: 400, headers: corsHeaders });
        }

        // Hash password with bcrypt for Firestore storage (used for JWT-based login verification)
        let passwordHash = '';
        if (data.password) {
            const SALT_ROUNDS = 10;
            passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);
        }

        const uid = userRecord.uid;
        const now = new Date().toISOString();

        // 1. Auto-increment counter using Firestore Transaction (adminDb)
        const currentYear = new Date().getFullYear();
        const counterRef = adminDb.collection('counters').doc(`passengers_${currentYear}`);

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

        // 5-digit zero padded count (e.g. 00001, 00002)
        const formattedSequence = String(nextCount).padStart(5, '0');

        // Formatted Passenger ID: PAS-2026-00001
        const passengerId = `PAS-${currentYear}-${formattedSequence}`;

        // 2. If User has a Guardian, generate matching Guardian ID: GUD-2026-00001
        let guardianId: string | null = null;
        let guardianRecord: Guardian | undefined = undefined;

        if (data.guardianDetails) {
            guardianId = `GUD-${currentYear}-${formattedSequence}`;
            const guardianRef = adminDb.collection('guardians').doc(guardianId);

            guardianRecord = {
                guardianId: guardianId,
                userId: uid,
                fullName: data.guardianDetails.fullName,
                email: data.guardianDetails.email,
                mobileNo: data.guardianDetails.mobileNo,
                nicNo: data.guardianDetails.nicNo,
                relationship: data.guardianDetails.relationship,
                createdAt: now,
            };

            await guardianRef.set(guardianRecord);
        }

        // 3. If User has accessibility needs, generate matching Accessibility Profile ID: ACC-2026-00001
        let accessibilityProfileId: string | null = null;
        let accessibilityProfileRecord: AccessibilityProfile | undefined = undefined;

        const selectedNeeds = Array.isArray(data.accessibilityNeeds) ? data.accessibilityNeeds : [];
        const hasNeeds = !!data.hasAccessibilityNeeds || selectedNeeds.length > 0;
        const otherDesc = data.otherDescription ? data.otherDescription.trim() : null;

        if (hasNeeds) {
            accessibilityProfileId = `ACC-${currentYear}-${formattedSequence}`;

            accessibilityProfileRecord = {
                accessibilityProfileId: accessibilityProfileId,
                userId: uid,
                passengerId: passengerId,
                hasAccessibilityNeeds: true,
                accessibilityNeeds: selectedNeeds,
                otherDescription: otherDesc,
                createdAt: now,
                updatedAt: now,
            };

            // Save in 'accessibility_needs_persons' Firestore collection
            await adminDb.collection('accessibility_needs_persons').doc(accessibilityProfileId).set(accessibilityProfileRecord);
        }

        const isWheelchairUser = selectedNeeds.includes('wheelchair');
        const isLowVisionPerson = selectedNeeds.includes('low_vision');
        const isHearingImpaired = selectedNeeds.includes('hearing_impairment');
        const isWalkingDifficultyPerson = selectedNeeds.includes('walking_difficulty');
        const isOtherAccessibilityPerson = selectedNeeds.includes('other');

        // 4. Save User in Firestore 'users' collection (with passwordHash for JWT auth)
        const newUser: User = {
            uid: uid,
            passengerId: passengerId,
            userName: data.userName,
            email: data.email,
            nicNo: data.nicNo,
            calculatedAge: nicInfo.age || 0,
            isElderPerson: data.isElderPerson !== undefined ? data.isElderPerson : (nicInfo.isElderly || false),
            role: 'PASSENGER',
            phoneNumber: data.phoneNumber,
            secondaryPhoneNumber: data.secondaryPhoneNumber || null,
            isVerified: false,
            accountStatus: 'ACTIVE',
            guardianId: guardianId,
            accessibilityProfileId: accessibilityProfileId,
            hasAccessibilityNeeds: hasNeeds,
            isWheelchairUser: isWheelchairUser,
            isLowVisionPerson: isLowVisionPerson,
            isHearingImpaired: isHearingImpaired,
            isWalkingDifficultyPerson: isWalkingDifficultyPerson,
            isOtherAccessibilityPerson: isOtherAccessibilityPerson,
            otherDescription: otherDesc,
            createdAt: now,
            updatedAt: now,
        };

        // Save user document with passwordHash (not included in User type to keep it out of API responses)
        await adminDb.collection('users').doc(passengerId).set({
            ...newUser,
            passwordHash,
        });
        try {
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            await adminDb.collection('otp_codes').doc(data.phoneNumber).set({
                otp,
                expiresAt: Date.now() + 5 * 60 * 1000,
                verified: false
            });
            console.log(`\n\n[MOCK SMS] 📱 To: ${data.phoneNumber} | Your MoreAble OTP is: ${otp}\n\n`);
        } catch (otpErr) {
            console.error('Error Sending OTP:', otpErr);
            console.log('Registration might still be valid, but OTP could not be sent.');
        }

        // 5. Success Response
        const userWithGuardian = {
            ...newUser,
            guardianDetails: data.guardianDetails || null,
        };

        return Response.json({
            message: 'User registered successfully!',
            user: userWithGuardian,
            guardian: guardianRecord,
            accessibilityProfile: accessibilityProfileRecord,
        }, { status: 201, headers: corsHeaders });

    } catch (error: any) {
        console.error('Registration Error:', error);
        return Response.json({
            message: 'Internal server error during registration.',
            error: error.message
        }, { status: 500, headers: corsHeaders });
    }
}