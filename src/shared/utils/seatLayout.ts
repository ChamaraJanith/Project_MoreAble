import { Seat, SeatLayout, SeatMapRow, SeatSlot, SeatStatus } from '../../entities/booking/model/types';
import { Bus } from '../../entities/bus/model/types';

// Every row on a real bus has 2 seats + aisle + 2 seats — the layout is
// built to that fixed grid so rows never shrink to fit however many real
// seats happen to be in them (that was the bug: a row with only 1-2 seats
// used to render as a lone floating box instead of staying aligned).
const LEFT_SEATS = 2;
const RIGHT_SEATS = 2;

function emptySlot(): SeatSlot {
    return { kind: 'EMPTY', seat: null };
}

function wheelchairSlot(): SeatSlot {
    return { kind: 'WHEELCHAIR_SPACE', seat: null };
}

function seatSlot(seat: Seat): SeatSlot {
    return { kind: 'SEAT', seat };
}

function makeSeat(seatNumber: string, category: Seat['category']): Seat {
    return {
        seatNumber,
        category,
        isPrioritySeat: category === 'PRIORITY',
        status: 'AVAILABLE',
        bookingId: null,
    };
}

/**
 * Builds a realistic bus seat layout from the bus's own facility data:
 *
 *  1. Accessibility row(s) right behind the entrance — a wide wheelchair
 *     space on the left (taking the width of 2 seats), with its guardian /
 *     companion seat(s) directly beside it on the right — exactly the
 *     "wheelchair space + guardian seat beside it" arrangement planned.
 *  2. Priority rows next — closest ordinary seats to the entrance.
 *  3. Standard rows fill the rest of the bus, 2 + aisle + 2 per row.
 *
 * Every row always has exactly 2 slots on each side; unused slots are
 * EMPTY rather than being omitted, so the grid never distorts.
 *
 * seatCapacity counts real seats only (standard + priority + guardian).
 * Wheelchair space is accessibility floor space — never a seat, never
 * bookable.
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

    // Guardian + priority seats are drawn from the real-seat pool; whatever
    // is left becomes ordinary numbered seats.
    let standardRemaining = Math.max(0, totalSeats - guardianRemaining - priorityRemaining);

    const rows: SeatMapRow[] = [];
    let rowNumber = 1;
    let guardianIndex = 1;
    let priorityIndex = 1;

    // ---- 1. Wheelchair space rows, guardian seat(s) beside each one ----
    for (let i = 0; i < wheelchairSlots; i++) {
        const left: SeatSlot[] = [wheelchairSlot()];
        const right: SeatSlot[] = [];

        for (let s = 0; s < RIGHT_SEATS; s++) {
            if (guardianRemaining > 0) {
                right.push(seatSlot(makeSeat(`G${guardianIndex}`, 'GUARDIAN')));
                guardianIndex++;
                guardianRemaining--;
            } else {
                right.push(emptySlot());
            }
        }

        rows.push({ rowNumber, isAccessibilityRow: true, left, right });
        rowNumber++;
    }

    // Any guardian seats left over (more than the wheelchair bays needed)
    // get their own rows immediately after, still close to the entrance.
    while (guardianRemaining > 0) {
        const left: SeatSlot[] = [];
        const right: SeatSlot[] = [];

        for (let s = 0; s < LEFT_SEATS; s++) {
            if (guardianRemaining > 0) {
                left.push(seatSlot(makeSeat(`G${guardianIndex}`, 'GUARDIAN')));
                guardianIndex++;
                guardianRemaining--;
            } else {
                left.push(emptySlot());
            }
        }
        for (let s = 0; s < RIGHT_SEATS; s++) {
            if (guardianRemaining > 0) {
                right.push(seatSlot(makeSeat(`G${guardianIndex}`, 'GUARDIAN')));
                guardianIndex++;
                guardianRemaining--;
            } else {
                right.push(emptySlot());
            }
        }

        rows.push({ rowNumber, isAccessibilityRow: true, left, right });
        rowNumber++;
    }

    // ---- 2. Priority rows — closest standard-shaped rows to the front ----
    while (priorityRemaining > 0) {
        const left: SeatSlot[] = [];
        const right: SeatSlot[] = [];

        for (let s = 0; s < LEFT_SEATS; s++) {
            if (priorityRemaining > 0) {
                left.push(seatSlot(makeSeat(`P${priorityIndex}`, 'PRIORITY')));
                priorityIndex++;
                priorityRemaining--;
            } else {
                left.push(emptySlot());
            }
        }
        for (let s = 0; s < RIGHT_SEATS; s++) {
            if (priorityRemaining > 0) {
                right.push(seatSlot(makeSeat(`P${priorityIndex}`, 'PRIORITY')));
                priorityIndex++;
                priorityRemaining--;
            } else {
                right.push(emptySlot());
            }
        }

        rows.push({ rowNumber, isAccessibilityRow: false, left, right });
        rowNumber++;
    }

    // ---- 3. Standard rows fill the rest of the bus ----
    const cols = ['A', 'B', 'C', 'D'];
    while (standardRemaining > 0) {
        const left: SeatSlot[] = [];
        const right: SeatSlot[] = [];

        for (let c = 0; c < 4; c++) {
            const target = c < 2 ? left : right;
            if (standardRemaining > 0) {
                target.push(seatSlot(makeSeat(`${rowNumber}${cols[c]}`, 'STANDARD')));
                standardRemaining--;
            } else {
                target.push(emptySlot());
            }
        }

        rows.push({ rowNumber, isAccessibilityRow: false, left, right });
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