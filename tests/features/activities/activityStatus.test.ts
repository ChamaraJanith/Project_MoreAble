// Activities: which journeys are Ongoing and which are Completed (MOV-294).
//
// Ongoing must never mean "has a CONFIRMED booking". It means the bus operating
// the passenger's own booked trip is sharing its live location, at that trip's
// time. These pin that rule, and that nothing on the same route — or the same
// bus on a different turn — can stand in for it.

import { Booking, BookingLiveSharing } from '../../../src/entities/booking/model/types';
import {
    LIVE_SHARING_FRESH_SECONDS,
    PRE_DEPARTURE_WINDOW_MINUTES,
    deriveActivityState,
    groupActivities,
    isBookedBusSharingLive,
    isJourneyCompleted,
    isWithinScheduledWindow,
} from '../../../src/features/activities/utils/activityStatus';
import { completedJourneyHref, ongoingJourneyHref } from '../../../src/features/activities/utils/activityRoutes';

// ------------------------------------------------------------------
// Helpers
//
// Every time is built in local time, the same way the app reads a trip's
// 'HH:MM' schedule, so the suite gives the same answer in any timezone.
// ------------------------------------------------------------------
const PASSENGER = 'PAS-2026-00001';
const OTHER_PASSENGER = 'PAS-2026-00002';

/** 21 Sep 2026 at the given local time. */
function at(hours: number, minutes: number, dayOffset = 0): Date {
    return new Date(2026, 8, 21 + dayOffset, hours, minutes, 0, 0);
}

function secondsBefore(date: Date, seconds: number): string {
    return new Date(date.getTime() - seconds * 1000).toISOString();
}

/** Route 177, Kaduwela -> Rajagiriya, 06:30 -> 07:10 on TRIP-A / BUS-A. */
function makeBooking(overrides: Partial<Booking> = {}): Booking {
    return {
        bookingId: 'BK-2026-00001',
        userId: PASSENGER,
        tripId: 'TRIP-A',
        routeId: 'ROUTE-177',
        busId: 'BUS-A',
        seatNumber: '05A',
        isPrioritySeat: false,
        pairedSeatNumber: null,
        status: 'CONFIRMED',
        boardingStatus: 'NOT_BOARDED',
        journey: {
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            startLocation: 'Kaduwela',
            endLocation: 'Rajagiriya',
            departureTime: '06:30',
            estimatedArrivalTime: '07:10',
        },
        vehicle: { numberPlate: 'NB-1234', busModel: 'Lanka Ashok Leyland', manufacturer: 'Ashok Leyland' },
        qrPayload: '{}',
        fare: { distanceKm: 12, baseFare: 30, distanceFare: 60, totalFare: 90, currency: 'LKR', isEstimate: false },
        assistanceRequested: { boardingAssistance: false, walkingAssistance: false, prioritySeatAssistance: false },
        specialRequests: '',
        createdAt: at(5, 0).toISOString(),
        ...overrides,
    };
}

/** The bus running TRIP-A reported `ageSeconds` before `now`. */
function sharing(now: Date, ageSeconds = 20, overrides: Partial<BookingLiveSharing> = {}): BookingLiveSharing {
    return {
        tripId: 'TRIP-A',
        busId: 'BUS-A',
        available: true,
        recordedAt: secondsBefore(now, ageSeconds),
        locationAgeSeconds: ageSeconds,
        ...overrides,
    };
}

const DURING_TRIP = at(6, 45);

// ------------------------------------------------------------------
// Ongoing
// ------------------------------------------------------------------
describe('Ongoing — the booked bus is sharing its live location', () => {
    it('1. shows the journey when the passenger booked the trip whose bus is sharing', () => {
        const booking = makeBooking({ liveSharing: sharing(DURING_TRIP) });

        expect(deriveActivityState(booking, DURING_TRIP)).toBe('ONGOING');
        expect(groupActivities([booking], PASSENGER, DURING_TRIP).ongoing).toEqual([booking]);
    });

    it('2. ignores a live block resolved for another trip, even one handed to this booking', () => {
        // The passenger booked TRIP-A; the only sharing signal describes TRIP-B.
        const booking = makeBooking({ liveSharing: sharing(DURING_TRIP, 20, { tripId: 'TRIP-B', busId: 'BUS-B' }) });

        expect(isBookedBusSharingLive(booking, DURING_TRIP)).toBe(false);
        expect(deriveActivityState(booking, DURING_TRIP)).toBe('NOT_ACTIVE');
    });

    it("2. never shows another passenger's journey, even when their bus is sharing", () => {
        const theirs = makeBooking({ userId: OTHER_PASSENGER, liveSharing: sharing(DURING_TRIP) });

        expect(groupActivities([theirs], PASSENGER, DURING_TRIP)).toEqual({ ongoing: [], completed: [] });
    });

    it('3. has nothing to show a passenger with no bookings', () => {
        expect(groupActivities([], PASSENGER, DURING_TRIP)).toEqual({ ongoing: [], completed: [] });
    });

    it('3. shows nothing when there is no signed-in passenger id', () => {
        const booking = makeBooking({ liveSharing: sharing(DURING_TRIP) });

        expect(groupActivities([booking], '', DURING_TRIP)).toEqual({ ongoing: [], completed: [] });
    });

    it('4. does not treat a booking on the same route but a different trip as ongoing', () => {
        // Passenger booked TRIP-B on route 177. BUS-A (TRIP-A, also route 177)
        // is sharing; BUS-B, which runs TRIP-B, is not.
        const tripB = makeBooking({
            tripId: 'TRIP-B',
            busId: 'BUS-B',
            liveSharing: { tripId: 'TRIP-B', busId: 'BUS-B', available: false },
        });

        expect(tripB.routeId).toBe('ROUTE-177');
        expect(deriveActivityState(tripB, DURING_TRIP)).toBe('NOT_ACTIVE');
    });

    it('5. is not ongoing when the bus has never shared its location', () => {
        const noReport = makeBooking({ liveSharing: { tripId: 'TRIP-A', busId: 'BUS-A', available: false } });
        const noBlock = makeBooking();

        expect(deriveActivityState(noReport, DURING_TRIP)).toBe('NOT_ACTIVE');
        expect(deriveActivityState(noBlock, DURING_TRIP)).toBe('NOT_ACTIVE');
    });

    it('5. is not ongoing once the bus stops sharing and its last report goes stale', () => {
        const stale = makeBooking({ liveSharing: sharing(DURING_TRIP, LIVE_SHARING_FRESH_SECONDS + 1) });
        const justFresh = makeBooking({ liveSharing: sharing(DURING_TRIP, LIVE_SHARING_FRESH_SECONDS) });

        expect(deriveActivityState(stale, DURING_TRIP)).toBe('NOT_ACTIVE');
        expect(deriveActivityState(justFresh, DURING_TRIP)).toBe('ONGOING');
    });

    it('6. becomes ongoing as soon as the matching bus starts sharing', () => {
        const before = makeBooking({ liveSharing: { tripId: 'TRIP-A', busId: 'BUS-A', available: false } });
        const after = makeBooking({ liveSharing: sharing(DURING_TRIP, 0) });

        expect(deriveActivityState(before, DURING_TRIP)).toBe('NOT_ACTIVE');
        expect(deriveActivityState(after, DURING_TRIP)).toBe('ONGOING');
    });

    it('7. never shows a cancelled booking as ongoing, even while its bus is sharing', () => {
        const cancelled = makeBooking({ status: 'CANCELLED', liveSharing: sharing(DURING_TRIP) });

        expect(deriveActivityState(cancelled, DURING_TRIP)).toBe('CANCELLED');
        expect(groupActivities([cancelled], PASSENGER, DURING_TRIP)).toEqual({ ongoing: [], completed: [] });
    });

    it("9. does not show a later booking as ongoing while the same bus runs an earlier turn", () => {
        // BUS-A is sharing at 06:45 for its morning turn; this booking is its 18:00 turn.
        const evening = makeBooking({
            tripId: 'TRIP-A-PM',
            journey: { ...makeBooking().journey, departureTime: '18:00', estimatedArrivalTime: '18:40' },
            liveSharing: sharing(DURING_TRIP, 20, { tripId: 'TRIP-A-PM' }),
        });

        expect(deriveActivityState(evening, DURING_TRIP)).toBe('NOT_ACTIVE');
    });

    it('9. does not show a future booking whose bus is not sharing', () => {
        const future = makeBooking({ liveSharing: { tripId: 'TRIP-A', busId: 'BUS-A', available: false } });

        expect(deriveActivityState(future, at(5, 0))).toBe('NOT_ACTIVE');
    });

    it('accepts a bus that starts sharing shortly before departure, but not long before', () => {
        const opens = new Date(at(6, 30).getTime() - PRE_DEPARTURE_WINDOW_MINUTES * 60_000);
        const tooEarly = new Date(opens.getTime() - 60_000);

        expect(deriveActivityState(makeBooking({ liveSharing: sharing(opens) }), opens)).toBe('ONGOING');
        expect(deriveActivityState(makeBooking({ liveSharing: sharing(tooEarly) }), tooEarly)).toBe('NOT_ACTIVE');
    });

    it('recognises a trip that runs past midnight', () => {
        const lateNight = makeBooking({
            journey: { ...makeBooking().journey, departureTime: '23:30', estimatedArrivalTime: '00:20' },
        });
        const afterMidnight = at(0, 5, 1);

        expect(isWithinScheduledWindow(lateNight, afterMidnight)).toBe(true);
        expect(deriveActivityState({ ...lateNight, liveSharing: sharing(afterMidnight) }, afterMidnight)).toBe('ONGOING');
    });

    it("treats a report timed slightly ahead of now (bus phone clock skew) as fresh", () => {
        const booking = makeBooking({ liveSharing: sharing(DURING_TRIP, -45) });

        expect(isBookedBusSharingLive(booking, DURING_TRIP)).toBe(true);
    });

    it('falls back to the server-measured age when the fix time is missing', () => {
        const fresh = makeBooking({ liveSharing: sharing(DURING_TRIP, 30, { recordedAt: undefined }) });
        const stale = makeBooking({ liveSharing: sharing(DURING_TRIP, 900, { recordedAt: undefined }) });

        expect(isBookedBusSharingLive(fresh, DURING_TRIP)).toBe(true);
        expect(isBookedBusSharingLive(stale, DURING_TRIP)).toBe(false);
    });

    it('is not ongoing when the booking has no readable schedule', () => {
        const booking = makeBooking({
            journey: { ...makeBooking().journey, departureTime: '—' },
            liveSharing: sharing(DURING_TRIP),
        });

        expect(deriveActivityState(booking, DURING_TRIP)).toBe('NOT_ACTIVE');
    });
});

// ------------------------------------------------------------------
// Completed
// ------------------------------------------------------------------
describe('Completed — the passenger was boarded and the trip has finished', () => {
    const boarded = (overrides: Partial<Booking> = {}) =>
        makeBooking({ boardingStatus: 'BOARDED', boardedAt: at(6, 28).toISOString(), ...overrides });

    it('8. lists a boarded journey once its scheduled arrival has passed', () => {
        const booking = boarded();
        const later = at(8, 30);

        expect(isJourneyCompleted(booking, later)).toBe(true);
        expect(deriveActivityState(booking, later)).toBe('COMPLETED');
        expect(groupActivities([booking], PASSENGER, later).completed).toEqual([booking]);
    });

    it('8. is still completed on a later day', () => {
        expect(deriveActivityState(boarded(), at(9, 0, 3))).toBe('COMPLETED');
    });

    it('keeps a boarded journey ongoing, not completed, while it is still under way', () => {
        const booking = boarded({ liveSharing: sharing(DURING_TRIP) });

        expect(deriveActivityState(booking, DURING_TRIP)).toBe('ONGOING');
    });

    it('does not complete a journey that is still inside its arrival grace period', () => {
        expect(isJourneyCompleted(boarded(), at(7, 30))).toBe(false);
    });

    it('7. never labels a cancelled booking as completed', () => {
        const cancelled = makeBooking({ status: 'CANCELLED', boardingStatus: 'BOARDED', boardedAt: at(6, 28).toISOString() });

        expect(deriveActivityState(cancelled, at(9, 0))).toBe('CANCELLED');
        expect(groupActivities([cancelled], PASSENGER, at(9, 0)).completed).toEqual([]);
    });

    it('does not treat a booking that was never boarded as a completed journey', () => {
        expect(deriveActivityState(makeBooking(), at(9, 0))).toBe('NOT_ACTIVE');
    });

    it('ignores an unreadable boarding time', () => {
        expect(isJourneyCompleted(boarded({ boardedAt: 'not-a-date' }), at(9, 0))).toBe(false);
    });

    it('anchors an overnight trip to its boarding day', () => {
        const lateNight = boarded({
            boardedAt: at(23, 28).toISOString(),
            journey: { ...makeBooking().journey, departureTime: '23:30', estimatedArrivalTime: '00:20' },
        });

        expect(isJourneyCompleted(lateNight, at(0, 30, 1))).toBe(false);
        expect(isJourneyCompleted(lateNight, at(1, 30, 1))).toBe(true);
    });
});

// ------------------------------------------------------------------
// Grouping and navigation
// ------------------------------------------------------------------
describe('Grouping a passenger history', () => {
    it('sorts each booking into at most one tab and leaves the rest to the Booking tab', () => {
        const now = at(9, 30);
        const ongoing = makeBooking({
            bookingId: 'BK-ONGOING',
            tripId: 'TRIP-C',
            journey: { ...makeBooking().journey, departureTime: '09:15', estimatedArrivalTime: '10:00' },
            liveSharing: sharing(now, 20, { tripId: 'TRIP-C', busId: 'BUS-C' }),
        });
        const completed = makeBooking({
            bookingId: 'BK-DONE',
            boardingStatus: 'BOARDED',
            boardedAt: at(6, 28).toISOString(),
        });
        const upcoming = makeBooking({
            bookingId: 'BK-LATER',
            journey: { ...makeBooking().journey, departureTime: '17:00', estimatedArrivalTime: '17:40' },
        });
        const cancelled = makeBooking({ bookingId: 'BK-CANCELLED', status: 'CANCELLED' });

        const groups = groupActivities([upcoming, cancelled, completed, ongoing], PASSENGER, now);

        expect(groups.ongoing.map((b) => b.bookingId)).toEqual(['BK-ONGOING']);
        expect(groups.completed.map((b) => b.bookingId)).toEqual(['BK-DONE']);
    });

    it('lists completed journeys most recent first', () => {
        const older = makeBooking({ bookingId: 'BK-OLD', boardingStatus: 'BOARDED', boardedAt: at(6, 28, -2).toISOString() });
        const newer = makeBooking({ bookingId: 'BK-NEW', boardingStatus: 'BOARDED', boardedAt: at(6, 28, -1).toISOString() });

        const groups = groupActivities([older, newer], PASSENGER, at(9, 0));

        expect(groups.completed.map((b) => b.bookingId)).toEqual(['BK-NEW', 'BK-OLD']);
    });

    it('opens the booking the card was built from', () => {
        expect(ongoingJourneyHref('BK-2026-00001')).toEqual({
            pathname: '/booking/ticket/[bookingId]',
            params: { bookingId: 'BK-2026-00001' },
        });
        expect(completedJourneyHref('BK-2026-00002').params.bookingId).toBe('BK-2026-00002');
    });
});
