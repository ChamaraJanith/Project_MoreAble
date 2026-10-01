import { Booking } from '../../../entities/booking/model/types';

export interface ParsedTime {
    hours: number;
    minutes: number;
}

export interface ParsedDate {
    year: number;
    month: number;
    day: number;
}

/**
 * Robustly parses a time string into 24-hour hours and minutes.
 * Supports:
 * - 12-hour clock: "5:20 PM", "05:20 PM", "5:20pm", "12:00 AM"
 * - 24-hour clock: "17:20", "05:20", "5:20"
 */
export function parseBookingTime(timeStr?: string | null): ParsedTime | null {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const trimmed = timeStr.trim();

    // 12-hour format e.g. "5:20 PM", "05:20 PM", "5:20pm"
    const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (match12) {
        let hours = parseInt(match12[1], 10);
        const minutes = parseInt(match12[2], 10);
        const meridiem = match12[3].toUpperCase();

        if (hours >= 1 && hours <= 12 && minutes >= 0 && minutes < 60) {
            if (meridiem === 'PM' && hours < 12) hours += 12;
            if (meridiem === 'AM' && hours === 12) hours = 0;
            return { hours, minutes };
        }
    }

    // 24-hour format e.g. "17:20", "05:20", "5:20"
    const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
        const hours = parseInt(match24[1], 10);
        const minutes = parseInt(match24[2], 10);
        if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
            return { hours, minutes };
        }
    }

    return null;
}

/**
 * Robustly parses a date string into year, month (0-indexed), and day.
 * Supports:
 * - YYYY-MM-DD
 * - ISO string: "2026-09-25T10:00:00Z"
 * - Standard Date string
 */
export function parseBookingDate(rawDate?: string | null): ParsedDate | null {
    if (!rawDate || typeof rawDate !== 'string') return null;
    const trimmed = rawDate.trim();

    // Check YYYY-MM-DD pattern
    const matchYMD = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (matchYMD) {
        const year = parseInt(matchYMD[1], 10);
        const month = parseInt(matchYMD[2], 10) - 1; // 0-indexed
        const day = parseInt(matchYMD[3], 10);
        if (year > 1970 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
            return { year, month, day };
        }
    }

    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
        return {
            year: d.getFullYear(),
            month: d.getMonth(),
            day: d.getDate(),
        };
    }

    return null;
}

/**
 * Calculates the exact cutoff timestamp when a booking is considered finished/expired.
 *
 * Buffer rules:
 * 1. If estimatedArrivalTime is available: arrival time + 60 minutes grace window.
 * 2. If only departureTime is available: departure time + 120 minutes buffer.
 * 3. If no time is available: 23:59:59 at the end of the scheduled travel date.
 */
export function getBookingScheduledEnd(booking: Booking): Date | null {
    const rawDate =
        booking.journeyDate ||
        booking.travelDate ||
        booking.departureDate ||
        booking.journey?.journeyDate ||
        booking.journey?.departureDate;

    let parsedDate = parseBookingDate(rawDate);

    // Fallback to createdAt if no scheduled journey date exists
    if (!parsedDate && booking.createdAt) {
        parsedDate = parseBookingDate(booking.createdAt);
    }

    if (!parsedDate) return null;

    const { year, month, day } = parsedDate;

    const departureTime = parseBookingTime(booking.journey?.departureTime);
    const arrivalTime = parseBookingTime(booking.journey?.estimatedArrivalTime);

    // If arrival time is known
    if (arrivalTime) {
        let arrivalDay = day;
        // Overnight trip: arrival time earlier than departure time means it crosses midnight
        if (departureTime) {
            const depMins = departureTime.hours * 60 + departureTime.minutes;
            const arrMins = arrivalTime.hours * 60 + arrivalTime.minutes;
            if (arrMins < depMins) {
                arrivalDay += 1;
            }
        }

        const scheduledArrival = new Date(year, month, arrivalDay, arrivalTime.hours, arrivalTime.minutes, 0, 0);
        // Add 60 minutes post-arrival grace window
        return new Date(scheduledArrival.getTime() + 60 * 60 * 1000);
    }

    // If only departure time is known
    if (departureTime) {
        const scheduledDeparture = new Date(year, month, day, departureTime.hours, departureTime.minutes, 0, 0);
        // Add 120 minutes buffer for transit duration
        return new Date(scheduledDeparture.getTime() + 120 * 60 * 1000);
    }

    // End of scheduled date if no clock time is recorded
    return new Date(year, month, day, 23, 59, 59, 999);
}

/**
 * Returns the effective start timestamp for chronological sorting.
 */
export function getBookingEffectiveStartTime(booking: Booking): number {
    const rawDate =
        booking.journeyDate ||
        booking.travelDate ||
        booking.departureDate ||
        booking.journey?.journeyDate ||
        booking.journey?.departureDate;

    const d = parseBookingDate(rawDate) || parseBookingDate(booking.createdAt);
    if (!d) return 0;

    const t = parseBookingTime(booking.journey?.departureTime);
    const hours = t ? t.hours : 0;
    const minutes = t ? t.minutes : 0;

    return new Date(d.year, d.month, d.day, hours, minutes).getTime();
}

/**
 * True ONLY if:
 * 1. Booking is CONFIRMED (not CANCELLED)
 * 2. Passenger journey has not been recorded as COMPLETED
 * 3. Scheduled departure/arrival has not passed the current time (now)
 */
export function isBookingUpcoming(booking: Booking, now: Date = new Date()): boolean {
    if (booking.status === 'CANCELLED') return false;
    if (booking.passengerJourney?.status === 'COMPLETED') return false;
    if (booking.status !== 'CONFIRMED') return false;

    const scheduledEnd = getBookingScheduledEnd(booking);
    if (!scheduledEnd) {
        return booking.status === 'CONFIRMED';
    }

    return now.getTime() <= scheduledEnd.getTime();
}

/**
 * True if booking is cancelled, completed, or in the past.
 */
export function isBookingHistory(booking: Booking, now: Date = new Date()): boolean {
    return !isBookingUpcoming(booking, now);
}

export type BookingStatusVariant = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'PAST';

export interface BookingStatusDisplay {
    label: string;
    variant: BookingStatusVariant;
}

/**
 * Resolves the accurate status label and color variant for display.
 */
export function getBookingStatusDisplay(booking: Booking, now: Date = new Date()): BookingStatusDisplay {
    if (booking.status === 'CANCELLED') {
        return { label: 'CANCELLED', variant: 'CANCELLED' };
    }

    if (isBookingUpcoming(booking, now)) {
        return { label: 'CONFIRMED', variant: 'CONFIRMED' };
    }

    // In History tab:
    if (booking.passengerJourney?.status === 'COMPLETED' || booking.boardingStatus === 'BOARDED') {
        return { label: 'COMPLETED', variant: 'COMPLETED' };
    }

    return { label: 'PAST', variant: 'PAST' };
}

/**
 * Sorts upcoming bookings soonest-first (ascending)
 * and history bookings newest-first (descending).
 */
export function sortBookings(bookings: Booking[], tab: 'UPCOMING' | 'HISTORY'): Booking[] {
    const list = [...bookings];
    if (tab === 'UPCOMING') {
        return list.sort((a, b) => getBookingEffectiveStartTime(a) - getBookingEffectiveStartTime(b));
    } else {
        return list.sort((a, b) => {
            const timeA = a.passengerJourney?.completedAt
                ? new Date(a.passengerJourney.completedAt).getTime()
                : a.boardedAt
                ? new Date(a.boardedAt).getTime()
                : getBookingEffectiveStartTime(a);
            const timeB = b.passengerJourney?.completedAt
                ? new Date(b.passengerJourney.completedAt).getTime()
                : b.boardedAt
                ? new Date(b.boardedAt).getTime()
                : getBookingEffectiveStartTime(b);
            return timeB - timeA;
        });
    }
}
