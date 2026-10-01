import { Booking } from '../../../src/entities/booking/model/types';
import {
    getBookingScheduledEnd,
    getBookingStatusDisplay,
    isBookingHistory,
    isBookingUpcoming,
    parseBookingDate,
    parseBookingTime,
    sortBookings,
} from '../../../src/features/booking/utils/bookingFilter';

describe('Booking Filter & Lifecycle: Upcoming vs History', () => {
    const baseBooking: Booking = {
        bookingId: 'BKG-2026-00063',
        userId: 'PAS-001',
        tripId: 'TRIP-101',
        routeId: 'ROUTE-01',
        busId: 'BUS-01',
        seatNumber: 'E1',
        isPrioritySeat: false,
        pairedSeatNumber: null,
        status: 'CONFIRMED',
        journeyDate: '2026-09-25',
        fare: {
            distanceKm: 12,
            baseFare: 50,
            distanceFare: 50,
            totalFare: 100,
            currency: 'LKR',
            isEstimate: false,
        },
        assistanceRequested: {
            boardingAssistance: false,
            walkingAssistance: false,
            prioritySeatAssistance: false,
        },
        specialRequests: '',
        createdAt: '2026-09-20T10:00:00Z',
        vehicle: {
            numberPlate: 'ND-6263',
            busModel: 'Isuzu Journey',
            manufacturer: 'Isuzu',
        },
        journey: {
            routeNumber: '177',
            routeName: 'Kollupitiya - Battaramulla',
            startLocation: 'Kollupitiya',
            endLocation: 'Battaramulla',
            departureTime: '5:20 PM',
            estimatedArrivalTime: '6:00 PM',
        },
        qrPayload: 'qr-dummy',
    };

    describe('parseBookingTime', () => {
        it('parses 12-hour PM times', () => {
            expect(parseBookingTime('5:20 PM')).toEqual({ hours: 17, minutes: 20 });
            expect(parseBookingTime('12:30 PM')).toEqual({ hours: 12, minutes: 30 });
        });

        it('parses 12-hour AM times', () => {
            expect(parseBookingTime('08:15 AM')).toEqual({ hours: 8, minutes: 15 });
            expect(parseBookingTime('12:15 AM')).toEqual({ hours: 0, minutes: 15 });
        });

        it('parses 24-hour times', () => {
            expect(parseBookingTime('17:20')).toEqual({ hours: 17, minutes: 20 });
            expect(parseBookingTime('06:00')).toEqual({ hours: 6, minutes: 0 });
        });

        it('returns null on invalid times', () => {
            expect(parseBookingTime(null)).toBeNull();
            expect(parseBookingTime('')).toBeNull();
            expect(parseBookingTime('invalid')).toBeNull();
        });
    });

    describe('parseBookingDate', () => {
        it('parses YYYY-MM-DD date strings', () => {
            expect(parseBookingDate('2026-09-25')).toEqual({ year: 2026, month: 8, day: 25 });
            expect(parseBookingDate('2026-10-01')).toEqual({ year: 2026, month: 9, day: 1 });
        });

        it('parses ISO timestamps', () => {
            const parsed = parseBookingDate('2026-09-25T10:00:00Z');
            expect(parsed).not.toBeNull();
            expect(parsed?.year).toBe(2026);
        });

        it('returns null for empty or invalid dates', () => {
            expect(parseBookingDate('')).toBeNull();
            expect(parseBookingDate('not-a-date')).toBeNull();
        });
    });

    describe('isBookingUpcoming vs isBookingHistory', () => {
        const simulatedNow = new Date(2026, 9, 1, 9, 30, 0); // 2026-10-01 09:30 AM

        it('identifies past booking (e.g. Fri, 25 Sep 2026) as HISTORY, NOT Upcoming', () => {
            // This is the exact booking shown in the user screenshot!
            const pastBooking: Booking = {
                ...baseBooking,
                journeyDate: '2026-09-25',
                journey: {
                    ...baseBooking.journey,
                    departureTime: '5:20 PM',
                    estimatedArrivalTime: '6:00 PM',
                },
            };

            expect(isBookingUpcoming(pastBooking, simulatedNow)).toBe(false);
            expect(isBookingHistory(pastBooking, simulatedNow)).toBe(true);
        });

        it('identifies future booking (e.g. 2026-10-05) as UPCOMING', () => {
            const futureBooking: Booking = {
                ...baseBooking,
                bookingId: 'BKG-FUTURE-01',
                journeyDate: '2026-10-05',
                journey: {
                    ...baseBooking.journey,
                    departureTime: '5:20 PM',
                    estimatedArrivalTime: '6:00 PM',
                },
            };

            expect(isBookingUpcoming(futureBooking, simulatedNow)).toBe(true);
            expect(isBookingHistory(futureBooking, simulatedNow)).toBe(false);
        });

        it('identifies today future trip (2026-10-01 5:20 PM) as UPCOMING at 09:30 AM', () => {
            const todayUpcoming: Booking = {
                ...baseBooking,
                bookingId: 'BKG-TODAY-01',
                journeyDate: '2026-10-01',
                journey: {
                    ...baseBooking.journey,
                    departureTime: '5:20 PM',
                    estimatedArrivalTime: '6:00 PM',
                },
            };

            expect(isBookingUpcoming(todayUpcoming, simulatedNow)).toBe(true);
        });

        it('identifies today finished trip (2026-10-01 06:00 AM) as HISTORY at 09:30 AM', () => {
            const todayPast: Booking = {
                ...baseBooking,
                bookingId: 'BKG-TODAY-PAST',
                journeyDate: '2026-10-01',
                journey: {
                    ...baseBooking.journey,
                    departureTime: '06:00 AM',
                    estimatedArrivalTime: '07:00 AM',
                },
            };

            // 07:00 AM + 60 min grace = 08:00 AM cutoff. Current time is 09:30 AM -> past!
            expect(isBookingUpcoming(todayPast, simulatedNow)).toBe(false);
            expect(isBookingHistory(todayPast, simulatedNow)).toBe(true);
        });

        it('identifies CANCELLED booking as HISTORY regardless of date', () => {
            const cancelledBooking: Booking = {
                ...baseBooking,
                bookingId: 'BKG-CANCELLED-01',
                status: 'CANCELLED',
                journeyDate: '2026-10-10', // future date
            };

            expect(isBookingUpcoming(cancelledBooking, simulatedNow)).toBe(false);
            expect(isBookingHistory(cancelledBooking, simulatedNow)).toBe(true);
        });

        it('identifies completed passenger journey as HISTORY', () => {
            const completedBooking: Booking = {
                ...baseBooking,
                bookingId: 'BKG-COMPLETED-01',
                passengerJourney: {
                    status: 'COMPLETED',
                    tripId: 'TRIP-101',
                    busId: 'BUS-01',
                    journeyStartedAt: '2026-10-01T08:00:00Z',
                    completedAt: '2026-10-01T09:00:00Z',
                    completionReason: 'PASSENGER',
                    journeyStops: ['Kollupitiya', 'Battaramulla'],
                    plannedDistanceKm: 12,
                },
            };

            expect(isBookingUpcoming(completedBooking, simulatedNow)).toBe(false);
            expect(isBookingHistory(completedBooking, simulatedNow)).toBe(true);
        });
    });

    describe('getBookingStatusDisplay', () => {
        const simulatedNow = new Date(2026, 9, 1, 9, 30, 0);

        it('returns CONFIRMED for valid upcoming booking', () => {
            const upcoming: Booking = {
                ...baseBooking,
                journeyDate: '2026-10-02',
            };
            expect(getBookingStatusDisplay(upcoming, simulatedNow)).toEqual({
                label: 'CONFIRMED',
                variant: 'CONFIRMED',
            });
        });

        it('returns CANCELLED for cancelled booking', () => {
            const cancelled: Booking = {
                ...baseBooking,
                status: 'CANCELLED',
            };
            expect(getBookingStatusDisplay(cancelled, simulatedNow)).toEqual({
                label: 'CANCELLED',
                variant: 'CANCELLED',
            });
        });

        it('returns COMPLETED for boarded or finished trip', () => {
            const boarded: Booking = {
                ...baseBooking,
                journeyDate: '2026-09-25',
                boardingStatus: 'BOARDED',
                boardedAt: '2026-09-25T17:25:00Z',
            };
            expect(getBookingStatusDisplay(boarded, simulatedNow)).toEqual({
                label: 'COMPLETED',
                variant: 'COMPLETED',
            });
        });

        it('returns PAST for past unboarded booking', () => {
            const pastUnboarded: Booking = {
                ...baseBooking,
                journeyDate: '2026-09-25',
                boardingStatus: 'NOT_BOARDED',
            };
            expect(getBookingStatusDisplay(pastUnboarded, simulatedNow)).toEqual({
                label: 'PAST',
                variant: 'PAST',
            });
        });
    });

    describe('sortBookings', () => {
        it('sorts upcoming bookings chronologically (earliest first)', () => {
            const bookingEarly: Booking = {
                ...baseBooking,
                bookingId: 'BKG-EARLY',
                journeyDate: '2026-10-02',
            };
            const bookingLate: Booking = {
                ...baseBooking,
                bookingId: 'BKG-LATE',
                journeyDate: '2026-10-05',
            };

            const sorted = sortBookings([bookingLate, bookingEarly], 'UPCOMING');
            expect(sorted[0].bookingId).toBe('BKG-EARLY');
            expect(sorted[1].bookingId).toBe('BKG-LATE');
        });

        it('sorts history bookings reverse-chronologically (newest first)', () => {
            const bookingYesterday: Booking = {
                ...baseBooking,
                bookingId: 'BKG-YESTERDAY',
                journeyDate: '2026-09-30',
            };
            const bookingLastWeek: Booking = {
                ...baseBooking,
                bookingId: 'BKG-LAST-WEEK',
                journeyDate: '2026-09-25',
            };

            const sorted = sortBookings([bookingLastWeek, bookingYesterday], 'HISTORY');
            expect(sorted[0].bookingId).toBe('BKG-YESTERDAY');
            expect(sorted[1].bookingId).toBe('BKG-LAST-WEEK');
        });
    });
});
