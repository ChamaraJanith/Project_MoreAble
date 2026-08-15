import { Seat, SeatLayout, SeatMapRow, SeatSlot, SeatStatus } from '../../entities/booking/model/types';
import { Bus } from '../../entities/bus/model/types';

const LEFT_SEATS = 2;
const RIGHT_SEATS = 2;
export const ELDERLY_SEAT_MIN_AGE = 60;

function emptySlot(): SeatSlot {
    return { kind: 'EMPTY', seat: null };
}
function seatSlot(seat: Seat): SeatSlot {
    return { kind: 'SEAT', seat };
}

function makeSeat(
    seatNumber: string,
    category: Seat['category'],
    opts?: { pairedSeatNumber?: string; minAge?: number }
): Seat {
    return {
        seatNumber,
        category,
        isPrioritySeat: category === 'PRIORITY',
        status: 'AVAILABLE',
        bookingId: null,
        pairedSeatNumber: opts?.pairedSeatNumber ?? null,
        minAge: opts?.minAge ?? null,
    };
}

/**
 * Builds a realistic bus seat layout from the bus's own facility data:
 *
 *  1. Wheelchair bay(s) — each is a bookable unit paired 1:1 with a
 *     guardian/companion seat right beside it. Booking the wheelchair
 *     space auto-reserves its paired guardian seat (handled server-side
 *     in the confirm API, using this same pairing).
 *  2. Any leftover guardian seats (more guardian seats than wheelchair
 *     bays) get their own ordinary rows, still near the front.
 *  3. Priority rows next.
 *  4. Elderly-reserved rows (60+ only) after priority.
 *  5. Standard rows fill the rest of the bus, 2 + aisle + 2 per row.
 *
 * seatCapacity counts every bookable seat (standard + priority + guardian
 * + elderly). Wheelchair space is a bookable accessibility unit layered
 * on top of seatCapacity, not counted inside it.
 */
export function buildSeatLayout(bus: Bus): SeatLayout {
    const facilities = bus.accessibilityFacilities;
    const totalSeats = Math.max(0, bus.seatCapacity || 0);

    const wheelchairSlots = facilities?.wheelchairSpace?.available
        ? Math.max(0, facilities.wheelchairSpace.count)
        : 0;

    let guardianRemaining = facilities?.guardianSeats?.available
        ? Math.max(0, facilities.guardianSeats.count)
        : 0;

    let priorityRemaining = facilities?.prioritySeats?.available
        ? Math.max(0, Math.min(facilities.prioritySeats.count, totalSeats))
        : 0;

    let elderlyRemaining = facilities?.elderlySeats?.available
        ? Math.max(0, facilities.elderlySeats.count)
        : 0;

    let standardRemaining = Math.max(
        0,
        totalSeats - guardianRemaining - priorityRemaining - elderlyRemaining
    );

    const rows: SeatMapRow[] = [];
    let rowNumber = 1;
    let wheelchairIndex = 1;
    let guardianIndex = 1;
    let priorityIndex = 1;
    let elderlyIndex = 1;

    // ---- 1. Wheelchair bay, paired with a guardian seat ----
    for (let i = 0; i < wheelchairSlots; i++) {
        const wheelchairSeatNumber = `W${wheelchairIndex}`;
        wheelchairIndex++;

        let pairedGuardianSeat: Seat | null = null;
        if (guardianRemaining > 0) {
            const guardianSeatNumber = `G${guardianIndex}`;
            guardianIndex++;
            guardianRemaining--;
            pairedGuardianSeat = makeSeat(guardianSeatNumber, 'GUARDIAN', {
                pairedSeatNumber: wheelchairSeatNumber,
            });
        }

        const wheelchairSeat = makeSeat(wheelchairSeatNumber, 'WHEELCHAIR', {
            pairedSeatNumber: pairedGuardianSeat?.seatNumber,
        });

        rows.push({
            rowNumber,
            isAccessibilityRow: true,
            kind: 'WHEELCHAIR_PAIR',
            left: [seatSlot(wheelchairSeat)],
            right: pairedGuardianSeat ? [seatSlot(pairedGuardianSeat)] : [emptySlot()],
        });
        rowNumber++;
    }

    // ---- 2. Leftover guardian seats without a wheelchair bay ----
    while (guardianRemaining > 0) {
        const left: SeatSlot[] = [];
        const right: SeatSlot[] = [];
        for (let s = 0; s < LEFT_SEATS; s++) {
            if (guardianRemaining > 0) {
                left.push(seatSlot(makeSeat(`G${guardianIndex}`, 'GUARDIAN')));
                guardianIndex++;
                guardianRemaining--;
            } else left.push(emptySlot());
        }
        for (let s = 0; s < RIGHT_SEATS; s++) {
            if (guardianRemaining > 0) {
                right.push(seatSlot(makeSeat(`G${guardianIndex}`, 'GUARDIAN')));
                guardianIndex++;
                guardianRemaining--;
            } else right.push(emptySlot());
        }
        rows.push({ rowNumber, isAccessibilityRow: true, kind: 'SEATS', left, right });
        rowNumber++;
    }

    // ---- 3. Priority rows ----
    while (priorityRemaining > 0) {
        const left: SeatSlot[] = [];
        const right: SeatSlot[] = [];
        for (let s = 0; s < LEFT_SEATS; s++) {
            if (priorityRemaining > 0) {
                left.push(seatSlot(makeSeat(`P${priorityIndex}`, 'PRIORITY')));
                priorityIndex++;
                priorityRemaining--;
            } else left.push(emptySlot());
        }
        for (let s = 0; s < RIGHT_SEATS; s++) {
            if (priorityRemaining > 0) {
                right.push(seatSlot(makeSeat(`P${priorityIndex}`, 'PRIORITY')));
                priorityIndex++;
                priorityRemaining--;
            } else right.push(emptySlot());
        }
        rows.push({ rowNumber, isAccessibilityRow: false, kind: 'SEATS', left, right });
        rowNumber++;
    }

    // ---- 4. Elderly-reserved rows (60+) ----
    while (elderlyRemaining > 0) {
        const left: SeatSlot[] = [];
        const right: SeatSlot[] = [];
        for (let s = 0; s < LEFT_SEATS; s++) {
            if (elderlyRemaining > 0) {
                left.push(seatSlot(makeSeat(`E${elderlyIndex}`, 'ELDERLY', { minAge: ELDERLY_SEAT_MIN_AGE })));
                elderlyIndex++;
                elderlyRemaining--;
            } else left.push(emptySlot());
        }
        for (let s = 0; s < RIGHT_SEATS; s++) {
            if (elderlyRemaining > 0) {
                right.push(seatSlot(makeSeat(`E${elderlyIndex}`, 'ELDERLY', { minAge: ELDERLY_SEAT_MIN_AGE })));
                elderlyIndex++;
                elderlyRemaining--;
            } else right.push(emptySlot());
        }
        rows.push({ rowNumber, isAccessibilityRow: false, kind: 'SEATS', left, right });
        rowNumber++;
    }

    // ---- 5. Standard rows fill the rest of the bus ----
    const cols = ['A', 'B', 'C', 'D'];
    while (standardRemaining > 0) {
        const left: SeatSlot[] = [];
        const right: SeatSlot[] = [];
        for (let c = 0; c < 4; c++) {
            const target = c < 2 ? left : right;
            if (standardRemaining > 0) {
                target.push(seatSlot(makeSeat(`${rowNumber}${cols[c]}`, 'STANDARD')));
                standardRemaining--;
            } else target.push(emptySlot());
        }
        rows.push({ rowNumber, isAccessibilityRow: false, kind: 'SEATS', left, right });
        rowNumber++;
    }

    return { rows };
}

/** Every real (bookable) seat in the layout, left-to-right, row by row. */
export function flattenSeats(layout: SeatLayout): Seat[] {
    const seats: Seat[] = [];
    for (const row of layout.rows) {
        for (const slot of [...row.left, ...row.right]) {
            if (slot.kind === 'SEAT' && slot.seat) seats.push(slot.seat);
        }
    }
    return seats;
}

export function findSeat(layout: SeatLayout, seatNumber: string): Seat | null {
    return flattenSeats(layout).find((s) => s.seatNumber === seatNumber) ?? null;
}

/** Overlays confirmed bookings (seatNumber -> bookingId) onto the layout. */
export function applyBookedSeats(layout: SeatLayout, bookedMap: Map<string, string>): SeatLayout {
    const apply = (slot: SeatSlot): SeatSlot => {
        if (slot.kind !== 'SEAT' || !slot.seat) return slot;
        const bookingId = bookedMap.get(slot.seat.seatNumber) ?? null;
        const status: SeatStatus = bookingId ? 'OCCUPIED' : 'AVAILABLE';
        return { ...slot, seat: { ...slot.seat, status, bookingId } };
    };
    return {
        rows: layout.rows.map((row) => ({
            ...row,
            left: row.left.map(apply),
            right: row.right.map(apply),
        })),
    };
}