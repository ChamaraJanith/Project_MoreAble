//This is For Backend for otp verification when User Registraion
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
        const { phoneNumber } = await request.json();

        if (!phoneNumber) {
            return Response.json({ message: 'Phone number is required' }, { status: 400, headers: corsHeaders });
        }

        const adminDb = getAdminDb();

        // 1. Generate 6-digit random OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // 2. Set Expiration time (5 minutes from now)
        const expiresAt = Date.now() + 5 * 60 * 1000;

        // 3. Save to Firestore 'otp_codes' collection
        await adminDb.collection('otp_codes').doc(phoneNumber).set({
            otp,
            expiresAt,
            verified: false
        });

        // 4. SMS Gateway Integration (Twilio, Notify.lk, etc.)
        // TODO: මෙතනට ඔයාගේ SMS API Call එක දාන්න
        console.log(`\n\n[MOCK SMS] 📱 To: ${phoneNumber} | Your MoreAble OTP is: ${otp}\n\n`);

        return Response.json({ message: 'OTP sent successfully!' }, { status: 200, headers: corsHeaders });

    } catch (error: any) {
        console.error('Send OTP Error:', error);
        return Response.json({ message: 'Failed to send OTP', error: error.message }, { status: 500, headers: corsHeaders });
    }
}