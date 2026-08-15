/** Maps every occupied seat number (including a wheelchair booking's paired guardian seat) to its bookingId. */
export function buildBookedSeatMap(bookingDocs: any[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const doc of bookingDocs) {
        const booking = doc.data();
        map.set(booking.seatNumber, booking.bookingId);
        if (booking.pairedSeatNumber) {
            map.set(booking.pairedSeatNumber, booking.bookingId);
        }
    }
    return map;
}