// Activities: which journeys are Ongoing and which are Completed (MOV-294).
//
// Ongoing must never mean "has a CONFIRMED booking". It means the bus pressed
// Start Journey on the passenger's EXACT booked trip, and that journey is still
// running: not ended, and before its scheduled service's arrival + 30 minutes.
// The actual start never moves that end, and nothing about the device session
// or the route decides it.
//
// Letters refer to the lifecycle test plan (A–J).

import { Booking, BookingActiveJourney } from '../../../src/entities/booking/model/types';
import {
    deriveActivityState,
    groupActivities,
    isBookedTripRunning,
    isJourneyCompleted,
} from '../../../src/features/activities/utils/activityStatus';
import { completedJourneyHref, ongoingJourneyHref } from '../../../src/features/activities/utils/activityRoutes';
import {
    JOURNEY_END_GRACE_MINUTES,
    isJourneyActive,
    journeyExpiresAt,
    scheduledServiceFor,
} from '../../../src/shared/utils/journeyLifecycle';

// ------------------------------------------------------------------
// Helpers — schedule times are local, the way the app reads 'HH:MM'.
// ------------------------------------------------------------------
const PASSENGER = 'PAS-2026-00001';
const OTHER_PASSENGER = 'PAS-2026-00002';

/** 21 Sep 2026 at the given local time. */
function at(hours: number, minutes: number, dayOffset = 0): Date {
    return new Date(2026, 8, 21 + dayOffset, hours, minutes, 0, 0);
}

const plus = (date: Date, ms: number) => new Date(date.getTime() + ms);

/** Route 177, Kaduwela -> Rajagiriya, scheduled 06:00 -> 06:40 on TRIP-A. */
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
            departureTime: '06:00',
            estimatedArrivalTime: '06:40',
        },
        vehicle: { numberPlate: 'NB-8899', busModel: 'Lanka Ashok Leyland', manufacturer: 'Ashok Leyland' },
        qrPayload: '{}',
        fare: { distanceKm: 12, baseFare: 30, distanceFare: 60, totalFare: 90, currency: 'LKR', isEstimate: false },
        assistanceRequested: { boardingAssistance: false, walkingAssistance: false, prioritySeatAssistance: false },
        specialRequests: '',
        createdAt: at(5, 0).toISOString(),
        ...overrides,
    };
}

/** TRIP-A's timetable slot, as stored on the trip. */
const TRIP_A_SCHEDULE = { departureTime: '06:00', estimatedArrivalTime: '06:40' };

/** The persisted Start Journey of TRIP-A, as the history endpoint reports it. */
function started(startedAt: Date, tripId = 'TRIP-A'): BookingActiveJourney {
    return {
        tripId,
        startedAt: startedAt.toISOString(),
        expiresAt: scheduledServiceFor(TRIP_A_SCHEDULE, startedAt)!.expiresAt.toISOString(),
    };
}

/** The example from the requirement: a 06:00 trip started at 20:35. */
const START_8_35_PM = at(20, 35);

// ------------------------------------------------------------------
// The lifecycle end: the scheduled service's arrival + grace
// ------------------------------------------------------------------
describe('journeyLifecycle — a journey runs until its scheduled arrival + 30 minutes', () => {
    /** A record as Start Journey persists it for a 06:00 -> 07:10 trip. */
    const record = (startedAt: Date, overrides = {}) => {
        const service = scheduledServiceFor({ departureTime: '06:00', estimatedArrivalTime: '07:10' }, startedAt)!;
        return {
            status: 'STARTED' as const,
            startedAt: startedAt.toISOString(),
            endedAt: null,
            busId: 'BUS-A',
            scheduledDepartureAt: service.departureAt.toISOString(),
            scheduledArrivalAt: service.arrivalAt.toISOString(),
            expiresAt: service.expiresAt.toISOString(),
            ...overrides,
        };
    };

    it('uses a 30-minute grace period', () => {
        expect(JOURNEY_END_GRACE_MINUTES).toBe(30);
    });

    it('an early start (02:52 for a 06:00 -> 07:10 trip) stays the 06:00 service and ends at 07:40', () => {
        const early = record(at(2, 52));

        expect(early.scheduledDepartureAt).toBe(at(6, 0).toISOString());
        expect(early.scheduledArrivalAt).toBe(at(7, 10).toISOString());
        expect(journeyExpiresAt(early)).toEqual(at(7, 40));
        expect(isJourneyActive(early, at(2, 52))).toBe(true);
        expect(isJourneyActive(early, at(7, 39))).toBe(true);
        expect(isJourneyActive(early, at(7, 40))).toBe(false);
    });

    it('the actual start never shifts the end: any start before 07:40 ends at 07:40', () => {
        for (const start of [at(0, 1), at(2, 52), at(6, 0), at(6, 45), at(7, 39)]) {
            expect(journeyExpiresAt(record(start))).toEqual(at(7, 40));
        }
    });

    it("a start after the day's service has finished belongs to the next day's", () => {
        expect(journeyExpiresAt(record(START_8_35_PM))).toEqual(at(7, 40, 1));
        expect(journeyExpiresAt(record(at(7, 40)))).toEqual(at(7, 40, 1));
    });

    it('an overnight trip arrives the next day, and a start after midnight still joins it', () => {
        const overnight = { departureTime: '23:30', estimatedArrivalTime: '00:50' };

        expect(scheduledServiceFor(overnight, at(22, 0))!.expiresAt).toEqual(at(1, 20, 1));
        expect(scheduledServiceFor(overnight, at(0, 30, 1))!.departureAt).toEqual(at(23, 30));
        expect(scheduledServiceFor(overnight, at(0, 30, 1))!.expiresAt).toEqual(at(1, 20, 1));
    });

    it('never resolves to a service that already ran: it goes to the next occurrence', () => {
        const trip = { departureTime: '06:00', estimatedArrivalTime: '07:10' };

        // Today's 06:00 ran (ended by hand at 07:05); a start at 07:10 is tomorrow's.
        const next = scheduledServiceFor(trip, at(7, 10), at(6, 0))!;
        expect(next.departureAt).toEqual(at(6, 0, 1));
        expect(next.expiresAt).toEqual(at(7, 40, 1));

        // Without a previous run, the same start would still be today's.
        expect(scheduledServiceFor(trip, at(7, 10))!.departureAt).toEqual(at(6, 0));
        // A run of an earlier day does not hold back today's upcoming service.
        expect(scheduledServiceFor(trip, at(2, 52), at(6, 0, -1))!.departureAt).toEqual(at(6, 0));
    });

    it('an overnight 23:30 -> 00:45 trip expires at 01:15 the next day', () => {
        const service = scheduledServiceFor({ departureTime: '23:30', estimatedArrivalTime: '00:45' }, at(22, 0))!;

        expect(service.arrivalAt).toEqual(at(0, 45, 1));
        expect(service.expiresAt).toEqual(at(1, 15, 1));
    });

    it('has no service for a trip whose times cannot be read', () => {
        expect(scheduledServiceFor({ departureTime: '06:00', estimatedArrivalTime: '' }, at(2, 52))).toBeNull();
        expect(scheduledServiceFor({ departureTime: '25:00', estimatedArrivalTime: '07:10' }, at(2, 52))).toBeNull();
        expect(scheduledServiceFor(null, at(2, 52))).toBeNull();
    });

    it('stops the moment it is ended, without waiting for the scheduled end', () => {
        const ended = record(at(2, 52), { status: 'ENDED', endedAt: at(3, 0).toISOString() });

        expect(isJourneyActive(ended, at(3, 1))).toBe(false);
    });

    it('never treats an unreadable record as running', () => {
        expect(isJourneyActive(null)).toBe(false);
        expect(isJourneyActive(record(at(2, 52), { startedAt: 'not-a-date' }), at(3, 0))).toBe(false);
        expect(isJourneyActive(record(at(2, 52), { expiresAt: 'not-a-date' }), at(3, 0))).toBe(false);
        expect(isJourneyActive({ status: 'STARTED', startedAt: at(2, 52).toISOString(), endedAt: null }, at(3, 0))).toBe(false);
        expect(isJourneyActive({ status: 'STARTED' }, at(3, 0))).toBe(false);
    });

    it('still counts a start stamped slightly ahead of this phone’s clock', () => {
        expect(isJourneyActive(record(at(2, 52)), plus(at(2, 52), -2 * 60 * 1000))).toBe(true);
    });
});

// ------------------------------------------------------------------
// Ongoing
// ------------------------------------------------------------------
describe('Ongoing — the exact booked trip has a running journey', () => {
    it('D. shows a 06:00 trip started at 8:35 PM immediately, not the next morning', () => {
        const booking = makeBooking({ activeJourney: started(START_8_35_PM) });
        const rightAfter = plus(START_8_35_PM, 60 * 1000);

        expect(deriveActivityState(booking, rightAfter)).toBe('ONGOING');
    });

    it('E. shows the journey to the passenger who booked that exact trip', () => {
        const booking = makeBooking({ activeJourney: started(START_8_35_PM) });

        expect(groupActivities([booking], PASSENGER, at(21, 0)).ongoing).toEqual([booking]);
    });

    it('A. stays ongoing however long the device is signed out, until the scheduled end', () => {
        const booking = makeBooking({ activeJourney: started(START_8_35_PM) });

        // Nothing in the booking or the rule refers to the device session.
        expect(deriveActivityState(booking, at(3, 0, 1))).toBe('ONGOING');
        expect(deriveActivityState(booking, at(7, 0, 1))).toBe('ONGOING');
    });

    it('H. stops being ongoing 30 minutes after the scheduled arrival if nobody ends it', () => {
        // Started 8:35 PM, so it is the next morning's 06:00 -> 06:40 service.
        const booking = makeBooking({ activeJourney: started(START_8_35_PM) });

        expect(deriveActivityState(booking, at(7, 9, 1))).toBe('ONGOING');
        expect(deriveActivityState(booking, at(7, 10, 1))).toBe('NOT_ACTIVE');
    });

    it('H. an early start does not extend it: started 02:52, it still ends at 07:10', () => {
        const booking = makeBooking({ activeJourney: started(at(2, 52)) });

        expect(deriveActivityState(booking, at(2, 53))).toBe('ONGOING');
        expect(deriveActivityState(booking, at(7, 9))).toBe('ONGOING');
        expect(deriveActivityState(booking, at(7, 10))).toBe('NOT_ACTIVE');
    });

    it('C. is not ongoing once the journey is ended (no running journey is reported)', () => {
        expect(deriveActivityState(makeBooking(), at(21, 0))).toBe('NOT_ACTIVE');
    });

    it('F. ignores a running journey reported for another trip, even on the same route', () => {
        // Passenger booked TRIP-A; the only running journey is TRIP-B's.
        const booking = makeBooking({ activeJourney: started(START_8_35_PM, 'TRIP-B') });

        expect(isBookedTripRunning(booking, at(21, 0))).toBe(false);
        expect(deriveActivityState(booking, at(21, 0))).toBe('NOT_ACTIVE');
    });

    it("F. never shows another passenger's journey", () => {
        const theirs = makeBooking({ userId: OTHER_PASSENGER, activeJourney: started(START_8_35_PM) });

        expect(groupActivities([theirs], PASSENGER, at(21, 0))).toEqual({ ongoing: [], completed: [] });
    });

    it('G. has nothing to show a passenger with no bookings, or no signed-in passenger', () => {
        const booking = makeBooking({ activeJourney: started(START_8_35_PM) });

        expect(groupActivities([], PASSENGER, at(21, 0))).toEqual({ ongoing: [], completed: [] });
        expect(groupActivities([booking], '', at(21, 0))).toEqual({ ongoing: [], completed: [] });
    });

    it('I. does not show a trip that has not been started, even at its scheduled time', () => {
        expect(deriveActivityState(makeBooking(), at(6, 10))).toBe('NOT_ACTIVE');
    });

    it('never shows a cancelled booking as ongoing, even while its trip is running', () => {
        const cancelled = makeBooking({ status: 'CANCELLED', activeJourney: started(START_8_35_PM) });

        expect(deriveActivityState(cancelled, at(21, 0))).toBe('CANCELLED');
        expect(groupActivities([cancelled], PASSENGER, at(21, 0))).toEqual({ ongoing: [], completed: [] });
    });

    it('keeps a boarded passenger ongoing while the trip runs, whatever the timetable says', () => {
        // Boarded at 8:40 PM on a 06:00–06:40 trip: by the timetable alone it
        // would read as finished.
        const booking = makeBooking({
            boardingStatus: 'BOARDED',
            boardedAt: at(20, 40).toISOString(),
            activeJourney: started(START_8_35_PM),
        });

        expect(deriveActivityState(booking, at(21, 0))).toBe('ONGOING');
    });
});

// ------------------------------------------------------------------
// Completed — unchanged: boarding plus the scheduled arrival
// ------------------------------------------------------------------
describe('Completed — the passenger was boarded and the trip has finished', () => {
    const boarded = (overrides: Partial<Booking> = {}) =>
        makeBooking({ boardingStatus: 'BOARDED', boardedAt: at(5, 58).toISOString(), ...overrides });

    it('lists a boarded journey once its scheduled arrival has passed', () => {
        const booking = boarded();

        expect(isJourneyCompleted(booking, at(8, 0))).toBe(true);
        expect(groupActivities([booking], PASSENGER, at(8, 0)).completed).toEqual([booking]);
    });

    it('does not complete a journey inside its arrival grace period', () => {
        expect(isJourneyCompleted(boarded(), at(7, 30))).toBe(false);
    });

    it('does not turn an ended or expired journey into a completed one for an unboarded passenger', () => {
        // The journey ended; this passenger was never boarded. Not completed.
        expect(deriveActivityState(makeBooking(), at(22, 0))).toBe('NOT_ACTIVE');
        // Expired journey reported stale: still not completed.
        const stale = makeBooking({ activeJourney: started(at(20, 35, -2)) });
        expect(deriveActivityState(stale, at(22, 0))).toBe('NOT_ACTIVE');
    });

    it('never labels a cancelled booking as completed', () => {
        const cancelled = boarded({ status: 'CANCELLED' });

        expect(deriveActivityState(cancelled, at(9, 0))).toBe('CANCELLED');
    });

    it('ignores an unreadable boarding time', () => {
        expect(isJourneyCompleted(boarded({ boardedAt: 'not-a-date' }), at(9, 0))).toBe(false);
    });
});

// ------------------------------------------------------------------
// Grouping and navigation
// ------------------------------------------------------------------
describe('Grouping a passenger history', () => {
    it('sorts each booking into at most one tab and leaves the rest to the Booking tab', () => {
        const now = at(21, 0);
        const ongoing = makeBooking({ bookingId: 'BK-ONGOING', activeJourney: started(START_8_35_PM) });
        const completed = makeBooking({
            bookingId: 'BK-DONE',
            tripId: 'TRIP-C',
            boardingStatus: 'BOARDED',
            boardedAt: at(5, 58).toISOString(),
        });
        const unstarted = makeBooking({ bookingId: 'BK-LATER', tripId: 'TRIP-D' });
        const cancelled = makeBooking({ bookingId: 'BK-CANCELLED', status: 'CANCELLED' });

        const groups = groupActivities([unstarted, cancelled, completed, ongoing], PASSENGER, now);

        expect(groups.ongoing.map((b) => b.bookingId)).toEqual(['BK-ONGOING']);
        expect(groups.completed.map((b) => b.bookingId)).toEqual(['BK-DONE']);
    });

    it('lists completed journeys most recent first', () => {
        const older = makeBooking({ bookingId: 'BK-OLD', boardingStatus: 'BOARDED', boardedAt: at(5, 58, -2).toISOString() });
        const newer = makeBooking({ bookingId: 'BK-NEW', boardingStatus: 'BOARDED', boardedAt: at(5, 58, -1).toISOString() });

        expect(groupActivities([older, newer], PASSENGER, at(9, 0)).completed.map((b) => b.bookingId)).toEqual([
            'BK-NEW',
            'BK-OLD',
        ]);
    });

    it('opens the booking the card was built from', () => {
        // Ongoing opens the live journey screen (MOV-297), not the ticket.
        expect(ongoingJourneyHref('BK-2026-00001')).toEqual({
            pathname: '/activities/journey/[bookingId]',
            params: { bookingId: 'BK-2026-00001' },
        });
        expect(completedJourneyHref('BK-2026-00002')).toEqual({
            pathname: '/booking/ticket/[bookingId]',
            params: { bookingId: 'BK-2026-00002' },
        });
    });
});
