//This is for verify generated OTP when user registration
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
    try {
        const { phoneNumber, otp, passengerId } = await request.json();
        const adminDb = getAdminDb();

        // 1. Get the OTP document from Firestore
        const otpDocRef = adminDb.collection('otp_codes').doc(phoneNumber);
        const otpDoc = await otpDocRef.get();

        if (!otpDoc.exists) {
            return Response.json({ message: 'OTP not found. Please request a new one.' }, { status: 400, headers: corsHeaders });
        }

        const otpData = otpDoc.data();

        // 2. Validate OTP
        if (otpData?.otp !== otp) {
            return Response.json({ message: 'Invalid OTP code.' }, { status: 400, headers: corsHeaders });
        }

        // 3. Check Expiration
        if (Date.now() > otpData?.expiresAt) {
            return Response.json({ message: 'OTP has expired. Please resend.' }, { status: 400, headers: corsHeaders });
        }

        // 4. OTP is correct! Update the user's isVerified status
        await adminDb.collection('users').doc(passengerId).update({
            isVerified: true
        });

        // 5. Clean up (Delete the used OTP)
        await otpDocRef.delete();

        return Response.json({ message: 'Phone number verified successfully!' }, { status: 200, headers: corsHeaders });

    } catch (error: any) {
        console.error('Verify OTP Error:', error);
        return Response.json({ message: 'Failed to verify OTP', error: error.message }, { status: 500, headers: corsHeaders });
    }
}