// Ongoing journeys: the date and times shown, with real values (MOV-309 / MOV-317).
//
// ongoingJourneyCard and ongoingJourneyDetail pin where each value comes from
// by reading the sources; their fixtures carry no scheduled times. This works
// out what the passenger actually sees, from real persisted times:
//
//   Journey date         service date of activeJourney.scheduledDepartureAt
//   Scheduled departure  activeJourney.scheduledDepartureAt
//   Scheduled arrival    activeJourney.scheduledArrivalAt   (Live Journey screen)
//   Actual start         activeJourney.startedAt
//
// on the service clock, with "Not available" for anything missing. As in
// completedJourneyDateTime, each value is the component's own expression,
// evaluated — so ordinary, overnight and after-midnight runs are checked
// against the real code on both the Activities card and the Live Journey
// screen, and the two must agree.

import { readFileSync } from 'fs';
import { join } from 'path';
import { BookingActiveJourney, Booking, PassengerOngoingJourney } from '../../../src/entities/booking/model/types';
import { groupActivitiesWithOngoing } from '../../../src/features/activities/utils/activityStatus';
import { scheduledServiceFor } from '../../../src/shared/utils/journeyLifecycle';
import { formatServiceDate, formatServiceTime } from '../../../src/shared/utils/serviceTime';

const ROOT = join(__dirname, '..', '..', '..');
const card = readFileSync(join(ROOT, 'src/features/activities/ui/ActivityJourneyCard.tsx'), 'utf-8');
const screen = readFileSync(join(ROOT, 'src/features/activities/ui/OngoingJourneyScreen.tsx'), 'utf-8');

const NA = 'Not available';
const PASSENGER = 'PAS-2026-00001';
const MINUTE = 60_000;

// ------------------------------------------------------------------
// Evaluating the components' own expressions
// ------------------------------------------------------------------

/** The right-hand side of `const <name> = ...;`. */
function definition(source: string, name: string): string {
    const match = source.match(new RegExp(`const ${name} = ([^;]*);`));
    if (!match) throw new Error(`no const ${name}`);
    return match[1];
}

function evaluate(source: string, name: string, scope: Record<string, unknown>): unknown {
    // TypeScript's non-null assertion (`journey!.x`) is not JavaScript; it has no effect at run time.
    const expression = definition(source, name).replace(/!(?=\.)/g, '');
    return new Function(...Object.keys(scope), `return (${expression});`)(...Object.values(scope));
}

interface CardShows {
    date: unknown;
    scheduledDeparture: unknown;
    actualStart: unknown;
}

interface DetailShows extends CardShows {
    scheduledArrival: unknown;
}

/** The values the card also shows (it has no scheduled arrival for an ongoing journey). */
const cardPart = ({ date, scheduledDeparture, actualStart }: CardShows): CardShows => ({ date, scheduledDeparture, actualStart });

/** What an ongoing Activities card shows for a booking. */
function cardShows(booking: Booking): CardShows {
    const scope: Record<string, unknown> = { formatServiceDate, formatServiceTime, isOngoing: true, booking, notAvailable: NA };
    for (const name of ['run', 'serviceDate', 'scheduledDeparture', 'actualStart']) {
        scope[name] = evaluate(card, name, scope);
    }
    return { date: scope.serviceDate, scheduledDeparture: scope.scheduledDeparture, actualStart: scope.actualStart };
}

/** What the Live Journey screen shows for the journey it is tracking. */
function detailShows(journey: PassengerOngoingJourney): DetailShows {
    const scope: Record<string, unknown> = { formatServiceDate, formatServiceTime, journey, notAvailable: NA };
    for (const name of ['run', 'serviceDate', 'scheduledDeparture', 'scheduledArrival', 'actualStart']) {
        scope[name] = evaluate(screen, name, scope);
    }
    return {
        date: scope.serviceDate,
        scheduledDeparture: scope.scheduledDeparture,
        scheduledArrival: scope.scheduledArrival,
        actualStart: scope.actualStart,
    };
}

// ------------------------------------------------------------------
// Fixtures: runs as Start Journey persists them (journeyLifecycle), and the
// ongoing response that carries them.
// ------------------------------------------------------------------

/** A Sri Lanka wall-clock moment as a stored ISO instant. */
const lk = (dateTime: string) => new Date(`${dateTime}:00+05:30`).toISOString();

/** The running journey Start Journey records for a slot started at `startedAt`. */
function runFor(slot: { departureTime: string; estimatedArrivalTime: string }, startedAt: string): BookingActiveJourney {
    const service = scheduledServiceFor(slot, new Date(startedAt))!;
    return {
        tripId: 'TRIP-001',
        startedAt,
        expiresAt: service.expiresAt.toISOString(),
        scheduledDepartureAt: service.departureAt.toISOString(),
        scheduledArrivalAt: service.arrivalAt.toISOString(),
    };
}

const ORDINARY = runFor({ departureTime: '06:00', estimatedArrivalTime: '07:15' }, lk('2026-09-22T05:58'));
// 23:30 on Mon 21 Sep -> 00:50 on Tue 22 Sep; the bus started at 23:25.
const OVERNIGHT = runFor({ departureTime: '23:30', estimatedArrivalTime: '00:50' }, lk('2026-09-21T23:25'));
// The same service, started late: after midnight, at 00:05 on D+1.
const AFTER_MIDNIGHT = runFor({ departureTime: '23:30', estimatedArrivalTime: '00:50' }, lk('2026-09-22T00:05'));

function makeBooking(bookingId: string, overrides: Partial<Booking> = {}): Booking {
    return {
        bookingId,
        userId: PASSENGER,
        tripId: 'TRIP-001',
        routeId: 'ROUTE-177',
        busId: 'BUS-A',
        seatNumber: '05A',
        isPrioritySeat: false,
        pairedSeatNumber: null,
        status: 'CONFIRMED',
        // A booked date, a boarding scan and the booking's 'HH:MM' copy that
        // none of the ongoing values may use.
        journeyDate: '2026-09-25',
        travelDate: '2026-09-25',
        boardingStatus: 'BOARDED',
        boardedAt: lk('2026-09-22T00:20'),
        journey: {
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            startLocation: 'Kaduwela',
            endLocation: 'Rajagiriya',
            departureTime: '18:45',
            estimatedArrivalTime: '19:55',
            journeyDate: '2026-09-25',
            departureDate: '2026-09-25',
        },
        vehicle: { numberPlate: 'NB-8899', busModel: 'Viking', manufacturer: 'Ashok Leyland' },
        qrPayload: '',
        fare: { distanceKm: 10, baseFare: 30, distanceFare: 50, totalFare: 80, currency: 'LKR', isEstimate: false },
        assistanceRequested: { boardingAssistance: false, walkingAssistance: false, prioritySeatAssistance: false },
        specialRequests: '',
        createdAt: '2026-09-20T12:00:00.000Z',
        ...overrides,
    };
}

/** GET /api/journeys/ongoing's entry for a booking. */
function ongoingFor(booking: Booking, activeJourney: BookingActiveJourney): PassengerOngoingJourney {
    return {
        booking: { ...booking, fare: { totalFare: 80, currency: 'LKR', isEstimate: false } },
        activeJourney,
        busId: 'BUS-A',
        liveStatus: { available: false },
    };
}

/** A moment while the run is still running. */
const whileRunning = (run: BookingActiveJourney) => new Date(new Date(run.startedAt).getTime() + 10 * MINUTE);

/** The ongoing card's booking exactly as Activities builds it. */
function ongoingCardBooking(journey: PassengerOngoingJourney, history: Booking = makeBooking(journey.booking.bookingId)): Booking {
    const { ongoing } = groupActivitiesWithOngoing([history], [journey], PASSENGER, whileRunning(journey.activeJourney), []);
    expect(ongoing).toHaveLength(1);
    return ongoing[0];
}

// ------------------------------------------------------------------
describe('A. the running journey’s scheduled times reach the ongoing card unchanged', () => {
    it.each([
        ['an ordinary run', ORDINARY],
        ['an overnight run', OVERNIGHT],
        ['a run started after midnight', AFTER_MIDNIGHT],
    ])('%s: every field of activeJourney survives Activities exactly', (_, run) => {
        const booking = ongoingCardBooking(ongoingFor(makeBooking('BK-A'), run));

        expect(booking.activeJourney).toEqual(run);
        expect(booking.activeJourney?.scheduledDepartureAt).toBe(run.scheduledDepartureAt);
        expect(booking.activeJourney?.scheduledArrivalAt).toBe(run.scheduledArrivalAt);
        expect(booking.activeJourney?.startedAt).toBe(run.startedAt);
        expect(typeof run.scheduledDepartureAt).toBe('string');
    });

    it("takes the times from the ongoing response, never from the history's own activeJourney", () => {
        // The history's copy names a different service altogether.
        const stale: BookingActiveJourney = {
            ...OVERNIGHT,
            scheduledDepartureAt: lk('2026-09-20T06:00'),
            scheduledArrivalAt: lk('2026-09-20T07:15'),
        };
        const history = makeBooking('BK-A', { activeJourney: stale });

        const booking = ongoingCardBooking(ongoingFor(makeBooking('BK-A'), OVERNIGHT), history);

        expect(booking.activeJourney).toEqual(OVERNIGHT);
        expect(cardShows(booking).date).toBe('Mon, 21 Sep 2026');
    });

    it("never lists a booking as ongoing on the history's copy alone", () => {
        const history = makeBooking('BK-A', { activeJourney: OVERNIGHT });

        const { ongoing } = groupActivitiesWithOngoing([history], [], PASSENGER, whileRunning(OVERNIGHT), []);

        expect(ongoing).toEqual([]);
    });

    it("never gives one booking another booking's run", () => {
        const a = makeBooking('BK-A');
        const b = makeBooking('BK-B', { tripId: 'TRIP-002' });
        const runB = { ...ORDINARY, tripId: 'TRIP-002', startedAt: OVERNIGHT.startedAt, expiresAt: OVERNIGHT.expiresAt };

        const { ongoing } = groupActivitiesWithOngoing([a, b], [ongoingFor(a, OVERNIGHT), ongoingFor(b, runB)], PASSENGER, whileRunning(OVERNIGHT), []);

        expect(ongoing.find((booking) => booking.bookingId === 'BK-A')?.activeJourney).toEqual(OVERNIGHT);
        expect(ongoing.find((booking) => booking.bookingId === 'BK-B')?.activeJourney).toEqual(runB);
    });

    it('keeps null scheduled times null — a record that never stored them', () => {
        const legacy = { ...ORDINARY, scheduledDepartureAt: null, scheduledArrivalAt: null };

        expect(ongoingCardBooking(ongoingFor(makeBooking('BK-A'), legacy)).activeJourney).toEqual(legacy);
    });
});

// ------------------------------------------------------------------
describe('B/C. what the ongoing card and the Live Journey screen show', () => {
    const CASES: [string, BookingActiveJourney, DetailShows][] = [
        [
            '1. an ordinary 06:00 -> 07:15 run started at 05:58',
            ORDINARY,
            { date: 'Tue, 22 Sep 2026', scheduledDeparture: '6:00 AM', scheduledArrival: '7:15 AM', actualStart: '5:58 AM' },
        ],
        [
            '2. an overnight run: 23:30 on D -> 00:50 on D+1, started 23:25 on D',
            OVERNIGHT,
            { date: 'Mon, 21 Sep 2026', scheduledDeparture: '11:30 PM', scheduledArrival: '12:50 AM', actualStart: '11:25 PM' },
        ],
        [
            '3. the same service started after midnight, at 00:05 on D+1',
            AFTER_MIDNIGHT,
            { date: 'Mon, 21 Sep 2026', scheduledDeparture: '11:30 PM', scheduledArrival: '12:50 AM', actualStart: '12:05 AM' },
        ],
    ];

    it.each(CASES)('%s — Live Journey screen', (_, run, expected) => {
        expect(detailShows(ongoingFor(makeBooking('BK-A'), run))).toEqual(expected);
    });

    it.each(CASES)('%s — Activities card', (_, run, expected) => {
        expect(cardShows(ongoingCardBooking(ongoingFor(makeBooking('BK-A'), run)))).toEqual(cardPart(expected));
    });

    it('the overnight fixtures are the lifecycle’s own service, on D and D+1', () => {
        for (const run of [OVERNIGHT, AFTER_MIDNIGHT]) {
            expect(run.scheduledDepartureAt).toBe(lk('2026-09-21T23:30'));
            expect(run.scheduledArrivalAt).toBe(lk('2026-09-22T00:50'));
        }
        expect(AFTER_MIDNIGHT.startedAt).toBe(lk('2026-09-22T00:05'));
    });

    it('3. dates the journey by its scheduled departure, not by the day it actually started', () => {
        const shown = detailShows(ongoingFor(makeBooking('BK-A'), AFTER_MIDNIGHT));

        expect(shown.date).toBe('Mon, 21 Sep 2026');
        expect(shown.date).not.toBe(formatServiceDate(AFTER_MIDNIGHT.startedAt));
        expect(formatServiceDate(AFTER_MIDNIGHT.startedAt)).toBe('Tue, 22 Sep 2026');
    });

    it('uses none of the booking’s own dates, boarding scan or HH:MM times', () => {
        // The fixture booking says 25 Sep, boarded 00:20, 18:45 -> 19:55; none of it may appear.
        const journey = ongoingFor(makeBooking('BK-A'), OVERNIGHT);
        const shown = [...Object.values(detailShows(journey)), ...Object.values(cardShows(ongoingCardBooking(journey)))];
        for (const borrowed of ['Fri, 25 Sep 2026', 'Tue, 22 Sep 2026', '12:20 AM', '6:45 PM', '7:55 PM']) {
            expect(shown).not.toContain(borrowed);
        }
    });
});

// ------------------------------------------------------------------
describe('B4/C. a missing time reads "Not available"', () => {
    it('a record with no scheduled times: date and scheduled times are unavailable, the start is not', () => {
        const legacy = { ...OVERNIGHT, scheduledDepartureAt: null, scheduledArrivalAt: null };
        const journey = ongoingFor(makeBooking('BK-A'), legacy);

        expect(detailShows(journey)).toEqual({ date: NA, scheduledDeparture: NA, scheduledArrival: NA, actualStart: '11:25 PM' });
        expect(cardShows(ongoingCardBooking(journey))).toEqual({ date: NA, scheduledDeparture: NA, actualStart: '11:25 PM' });
    });

    it('only the scheduled arrival missing: only that value is unavailable', () => {
        const journey = ongoingFor(makeBooking('BK-A'), { ...OVERNIGHT, scheduledArrivalAt: null });

        expect(detailShows(journey)).toEqual({
            date: 'Mon, 21 Sep 2026',
            scheduledDeparture: '11:30 PM',
            scheduledArrival: NA,
            actualStart: '11:25 PM',
        });
    });

    it('an unreadable stored time is unavailable, never guessed', () => {
        const journey = ongoingFor(makeBooking('BK-A'), { ...OVERNIGHT, scheduledDepartureAt: 'not-a-date' });

        expect(detailShows(journey)).toMatchObject({ date: NA, scheduledDeparture: NA, scheduledArrival: '12:50 AM' });
    });

    it('a missing startedAt: the actual start is unavailable, the schedule unaffected', () => {
        // Such a journey is never listed as ongoing (running needs a startedAt)...
        const noStart = { ...OVERNIGHT, startedAt: undefined as unknown as string };
        const journey = ongoingFor(makeBooking('BK-A'), noStart);
        expect(groupActivitiesWithOngoing([makeBooking('BK-A')], [journey], PASSENGER, whileRunning(OVERNIGHT), []).ongoing).toEqual([]);

        // ...but if one ever reached either surface, it would say so rather than borrow a time.
        const expected = { date: 'Mon, 21 Sep 2026', scheduledDeparture: '11:30 PM', actualStart: NA };
        expect(detailShows(journey)).toEqual({ ...expected, scheduledArrival: '12:50 AM' });
        expect(cardShows(makeBooking('BK-A', { activeJourney: noStart }))).toEqual(expected);
    });

    it('an ongoing card with no running journey at all shows "Not available" throughout', () => {
        expect(cardShows(makeBooking('BK-A'))).toEqual({ date: NA, scheduledDeparture: NA, actualStart: NA });
    });
});

// ------------------------------------------------------------------
describe('B5. the ongoing card and the Live Journey screen agree', () => {
    it.each([
        ['an ordinary run', ORDINARY],
        ['an overnight run', OVERNIGHT],
        ['a run started after midnight', AFTER_MIDNIGHT],
        ['a record with no scheduled times', { ...OVERNIGHT, scheduledDepartureAt: null, scheduledArrivalAt: null }],
        ['a record with only a departure', { ...ORDINARY, scheduledArrivalAt: null }],
    ])('show the same date, scheduled departure and actual start for %s', (_, run) => {
        const journey = ongoingFor(makeBooking('BK-A'), run as BookingActiveJourney);

        expect(cardShows(ongoingCardBooking(journey))).toEqual(cardPart(detailShows(journey)));
    });
});
