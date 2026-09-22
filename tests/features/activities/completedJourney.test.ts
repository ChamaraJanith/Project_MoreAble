// Passenger journey completion on the client (MOV-297).
//
// End Journey asks first and sends once; Activities moves a completed journey
// from Ongoing to Completed; the Live Journey screen stops following the bus;
// and the Completed screen is history, not tracking.

import * as fs from 'fs';
import * as path from 'path';
import {
    Booking,
    PassengerCompletedJourney,
    PassengerJourneyCompletion,
    PassengerOngoingJourney,
} from '../../../src/entities/booking/model/types';
import {
    completedJourneyDetailsHref,
    completedJourneyHref,
    ongoingJourneyHref,
} from '../../../src/features/activities/utils/activityRoutes';
import { groupActivitiesWithOngoing } from '../../../src/features/activities/utils/activityStatus';
import {
    completionReasonLabel,
    completionTimeCaption,
    createEndJourneyAction,
    END_JOURNEY_DIALOG,
    findCompletedJourney,
    formatDistanceKm,
    timeOnBoardLabel,
} from '../../../src/features/activities/utils/completedJourney';
import { INITIAL_TRACKING_STATE, liveVehicleFor, reduceTracking } from '../../../src/features/activities/utils/ongoingJourneyTracking';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const PASSENGER = 'PAS-2026-00001';
const NOW = new Date('2026-09-21T10:30:00.000Z');
const STARTED = '2026-09-21T10:00:00.000Z';

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
        journey: {
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            startLocation: 'Kaduwela',
            endLocation: 'Rajagiriya',
            departureTime: '06:00',
            estimatedArrivalTime: '07:15',
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

const completion = (overrides: Partial<PassengerJourneyCompletion> = {}): PassengerJourneyCompletion => ({
    status: 'COMPLETED',
    tripId: 'TRIP-001',
    busId: 'BUS-A',
    journeyStartedAt: STARTED,
    completedAt: '2026-09-21T10:42:15.000Z',
    completionReason: 'PASSENGER',
    journeyStops: ['Kaduwela', 'Malabe', 'Rajagiriya'],
    plannedDistanceKm: 9.6,
    ...overrides,
});

function ongoingFor(booking: Booking): PassengerOngoingJourney {
    return {
        booking: { ...booking, fare: { totalFare: 80, currency: 'LKR', isEstimate: false } },
        activeJourney: { tripId: booking.tripId, startedAt: STARTED, expiresAt: '2026-09-22T09:00:00.000Z' },
        busId: 'BUS-A',
        liveStatus: { available: false },
    };
}

function completedFor(booking: Booking, record = completion()): PassengerCompletedJourney {
    return { booking: { ...booking, fare: { totalFare: 80, currency: 'LKR', isEstimate: false } }, completion: record };
}

// ------------------------------------------------------------------
describe('End Journey confirmation', () => {
    it('uses the agreed wording', () => {
        expect(END_JOURNEY_DIALOG).toEqual({
            title: 'End Journey?',
            message: 'Are you sure you have reached your destination? Your journey will move from Ongoing to Completed.',
            cancel: 'Cancel',
            confirm: 'End Journey',
        });
    });

    it('Cancel sends nothing', async () => {
        const end = jest.fn(async () => 'done');
        const action = createEndJourneyAction(async () => false, end);

        expect(await action.run()).toEqual({ status: 'CANCELLED' });
        expect(end).not.toHaveBeenCalled();
    });

    it('Confirm sends the request exactly once', async () => {
        const end = jest.fn(async () => 'done');
        const action = createEndJourneyAction(async () => true, end);

        expect(await action.run()).toEqual({ status: 'COMPLETED', result: 'done' });
        expect(end).toHaveBeenCalledTimes(1);
    });

    it('a second tap while the dialog or request is open joins the first', async () => {
        let answer: (value: boolean) => void = () => {};
        const confirm = jest.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
        const end = jest.fn(async () => 'done');
        const action = createEndJourneyAction(confirm, end);

        const first = action.run();
        const second = action.run();
        expect(action.isRunning()).toBe(true);
        answer(true);

        expect(await first).toEqual(await second);
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(end).toHaveBeenCalledTimes(1);
        expect(action.isRunning()).toBe(false);
    });

    it('reports a failed request and allows a retry', async () => {
        const end = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('done');
        const action = createEndJourneyAction<string>(async () => true, end);

        expect((await action.run()).status).toBe('FAILED');
        expect(await action.run()).toEqual({ status: 'COMPLETED', result: 'done' });
    });

    it('the Live Journey screen asks before ending, and offers both buttons', () => {
        const screen = read('src/features/activities/ui/OngoingJourneyScreen.tsx');

        expect(screen).toMatch(/createEndJourneyAction<EndJourneyResult[^(]*\(\s*confirmEndJourney,/);
        expect(screen).toContain("t('ongoingJourney.endJourney', 'End Journey')");
        expect(screen).toContain("t('ongoingJourney.backToOngoing', 'Back to Ongoing')");
        // After ending: stop following the bus here, then offer to rate the
        // bus (the journey is already completed by then).
        expect(screen).toMatch(/stopTracking\(\);\s*if \(bookingId\) router\.replace\(busRatingHref\(bookingId\)\)/);
    });

    it('the dialog resolves true only on the End Journey button', () => {
        const dialog = read('src/features/activities/ui/confirmEndJourney.ts');

        expect(dialog).toContain("style: 'cancel', onPress: () => resolve(false)");
        expect(dialog).toContain("style: 'destructive', onPress: () => resolve(true)");
        expect(dialog).toContain('onDismiss: () => resolve(false)');
    });
});

// ------------------------------------------------------------------
describe('Live Journey after the passenger ends', () => {
    it('stops showing the bus and never resumes', () => {
        const live = reduceTracking(INITIAL_TRACKING_STATE, {
            type: 'LOADED',
            journeys: [
                {
                    ...ongoingFor(makeBooking('BK-A')),
                    liveStatus: {
                        available: true,
                        location: { busId: 'BUS-A', latitude: 6.9, longitude: 79.9, recordedAt: NOW.toISOString() },
                    },
                },
            ],
            bookingId: 'BK-A',
            at: NOW,
        });
        expect(liveVehicleFor(live)).not.toBeNull();

        const ended = reduceTracking(live, { type: 'PASSENGER_ENDED' });
        expect(ended.phase).toBe('ENDED');
        expect(liveVehicleFor(ended)).toBeNull();

        const later = reduceTracking(ended, { type: 'LOADED', journeys: [ongoingFor(makeBooking('BK-A'))], bookingId: 'BK-A', at: NOW });
        expect(later.phase).toBe('ENDED');
    });
});

// ------------------------------------------------------------------
describe('Activities: Ongoing to Completed', () => {
    it('moves a completed journey to Completed while others stay Ongoing', () => {
        const a = makeBooking('BK-A');
        const b = makeBooking('BK-B');

        const groups = groupActivitiesWithOngoing([a, b], [ongoingFor(b)], PASSENGER, NOW, [completedFor(a)]);

        expect(groups.ongoing.map((booking) => booking.bookingId)).toEqual(['BK-B']);
        expect(groups.completed.map((booking) => booking.bookingId)).toEqual(['BK-A']);
        expect(groups.completed[0].passengerJourney?.completionReason).toBe('PASSENGER');
    });

    it('never lists a completed journey under Ongoing, even if both lists name it', () => {
        const a = makeBooking('BK-A');
        const groups = groupActivitiesWithOngoing([a], [ongoingFor(a)], PASSENGER, NOW, [completedFor(a)]);

        expect(groups.ongoing).toEqual([]);
        expect(groups.completed.map((booking) => booking.bookingId)).toEqual(['BK-A']);
    });

    it('lists a bus-ended journey under Completed with its reason', () => {
        const b = makeBooking('BK-B');
        const groups = groupActivitiesWithOngoing([b], [], PASSENGER, NOW, [
            completedFor(b, completion({ completionReason: 'BUS_JOURNEY_ENDED' })),
        ]);

        expect(groups.completed[0].passengerJourney?.completionReason).toBe('BUS_JOURNEY_ENDED');
    });

    it('trusts only the server list for completions, not a copy in the history', () => {
        const stray = makeBooking('BK-A', { passengerJourney: completion() });
        const groups = groupActivitiesWithOngoing([stray], [], PASSENGER, NOW, []);

        expect(groups.completed).toEqual([]);
    });

    it('lists the most recently finished first', () => {
        const early = makeBooking('BK-EARLY');
        const late = makeBooking('BK-LATE');
        const groups = groupActivitiesWithOngoing([early, late], [], PASSENGER, NOW, [
            completedFor(early, completion({ completedAt: '2026-09-21T08:00:00.000Z' })),
            completedFor(late, completion({ completedAt: '2026-09-21T10:00:00.000Z' })),
        ]);

        expect(groups.completed.map((booking) => booking.bookingId)).toEqual(['BK-LATE', 'BK-EARLY']);
    });

    it('still has exactly two tabs', () => {
        const screen = read('app/(tabs)/activities/index.tsx');
        expect(screen.match(/<TabButton\b/g)).toHaveLength(2);
    });
});

// ------------------------------------------------------------------
describe('navigation', () => {
    it('opens a recorded completion in its own summary, not the ticket', () => {
        expect(completedJourneyDetailsHref('BK-A')).toEqual({
            pathname: '/activities/completed/[bookingId]',
            params: { bookingId: 'BK-A' },
        });
        expect(fs.existsSync(path.join(ROOT, 'app/(tabs)/activities/completed/[bookingId].tsx'))).toBe(true);
        expect(read('app/(tabs)/activities/index.tsx')).toMatch(
            /booking\.passengerJourney\)\s*\{[\s\S]*completedJourneyDetailsHref/
        );
    });

    it('leaves Ongoing and Booking > View Ticket where they were', () => {
        expect(ongoingJourneyHref('BK-A').pathname).toBe('/activities/journey/[bookingId]');
        expect(completedJourneyHref('BK-A').pathname).toBe('/booking/ticket/[bookingId]');
        expect(read('app/(tabs)/booking/ticket/[bookingId].tsx')).not.toMatch(/Completed Journey|OngoingJourney/);
    });
});

// ------------------------------------------------------------------
describe('Completed Journey screen', () => {
    const screen = read('src/features/activities/ui/CompletedJourneyScreen.tsx');

    it('is history: no live bus, no polling, no live status, no End Journey', () => {
        expect(screen).toContain('<RouteMapCard');
        expect(screen).not.toMatch(/vehicle=/);
        expect(screen).not.toMatch(/setInterval|createJourneyPoller|useOngoingJourneyTracking/);
        expect(screen).not.toMatch(/liveStatus|LiveStatusCard/);
        expect(screen).not.toMatch(/endPassengerJourney|confirmEndJourney/);
    });

    it('reads only the authorised completed-journeys endpoint', () => {
        expect(screen).toContain('getCompletedJourneys(token, { includeRoute: true })');
        expect(screen).not.toMatch(/getBooking\(|getBookingHistory/);
    });

    it('says how it finished, in plain words', () => {
        expect(completionReasonLabel('PASSENGER')).toBe('Completed by you');
        expect(completionReasonLabel('BUS_JOURNEY_ENDED')).toBe('Completed when the bus journey ended');
        expect(completionTimeCaption('PASSENGER')).toBe('You completed it at');
        expect(completionTimeCaption('BUS_JOURNEY_ENDED')).toBe('Journey completed at');
    });

    it('selects only from the passenger\'s own list', () => {
        const journey = completedFor(makeBooking('BK-A'));
        expect(findCompletedJourney([journey], 'BK-A')).toBe(journey);
        expect(findCompletedJourney([journey], 'BK-SOMEONE-ELSE')).toBeNull();
    });

    it('shows the planned distance only when it was measured', () => {
        expect(formatDistanceKm(9.6)).toBe('9.6 km');
        expect(formatDistanceKm(null)).toBeNull();
    });

    it('shows time on board only from a boarding scan on the same run', () => {
        const record = completion({ completedAt: '2026-09-21T10:42:00.000Z' });

        expect(timeOnBoardLabel({ boardedAt: '2026-09-21T10:04:00.000Z' }, record)).toBe('38m');
        // Boarded on an earlier run, or never scanned: not this journey's start.
        expect(timeOnBoardLabel({ boardedAt: '2026-09-20T10:04:00.000Z' }, record)).toBeNull();
        expect(timeOnBoardLabel({ boardedAt: undefined }, record)).toBeNull();
    });
});
