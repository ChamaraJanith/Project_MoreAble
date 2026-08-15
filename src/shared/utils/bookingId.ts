export async function generateBookingId(adminDb: any): Promise<string> {
    const currentYear = new Date().getFullYear();
    const counterRef = adminDb.collection('counters').doc(`bookings_${currentYear}`);

    return adminDb.runTransaction(async (transaction: any) => {
        const counterDoc = await transaction.get(counterRef);
        let nextNumber = 1;

        if (counterDoc.exists) {
            nextNumber = Number(counterDoc.data()?.lastNumber || 0) + 1;
        }

        transaction.set(counterRef, { lastNumber: nextNumber, year: currentYear }, { merge: true });
        return `BKG-${currentYear}-${String(nextNumber).padStart(5, '0')}`;
    });
}