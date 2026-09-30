// Journey date and times end to end (MOV-309 / MOV-317): Start Journey ->
// GET /api/journeys/ongoing, and on to End Journey -> GET /api/journeys/completed.
//
// Drives the real endpoints over an in-memory Firestore, as the completion
// tests do:
//
//   bus device -> POST /api/trips/:tripId/journey   { action: 'START' | 'END' }  (MOV-294)
//   passenger  -> GET  /api/journeys/ongoing                                     (MOV-295 / MOV-314)
//   passenger  -> POST /api/journeys/ongoing/end                                 (MOV-297)
//   passenger  -> GET  /api/journeys/completed                                   (MOV-297 / MOV-314)
//
// The case that matters is a run that crosses midnight and is started after
// it. TRIP-001 is the 23:30 -> 00:50 slot. The bus presses Start Journey at
// 00:10 on Tue 22 Sep (Sri Lanka time): that is still Monday 21 Sep's 23:30
// service, so the run's scheduled departure stays on D even though it
// actually started on D+1. The passenger must be handed exactly the times
// Start Journey persisted — never ones rebuilt from the booking's date, the
// booking's 'HH:MM' copy or the clock.

import { GET as getCompleted } from '../../../app/api/journeys/completed+api';
import { GET as getOngoing } from '../../../app/api/journeys/ongoing+api';
import { POST as endOwnJourney } from '../../../app/api/journeys/ongoing/end+api';
import { POST as tripJourney } from '../../../app/api/trips/[tripId]/journey+api';
import { formatServiceDate, formatServiceTime } from '../../../src/shared/utils/serviceTime';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    JOURNEY_SHARING_SCOPE: 'JOURNEY_LOCATION',
    generateJourneySharingToken: async (busId: string, tripId: string) => `sharing:${busId}:${tripId}`,
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const PASSENGER = 'PAS-2026-00001';
const OTHER_PASSENGER = 'PAS-2026-00002';

const TOKENS: Record<string, unknown> = {
    'token-passenger': { uid: 'uid-a', passengerId: PASSENGER, role: 'PASSENGER', email: 'a@moreable.lk' },
    'token-other': { uid: 'uid-b', passengerId: OTHER_PASSENGER, role: 'PASSENGER', email: 'b@moreable.lk' },
    'token-bus': { uid: 'BUS-A', passengerId: 'BUS-A', role: 'BUS', email: '', busId: 'BUS-A' },
};

/** A Sri Lanka wall-clock moment as a Date. */
const lk = (localIso: string) => new Date(`${localIso}:00+05:30`);

// The run, as the timetable and the clock define it — the expected values are
// these fixture inputs, not a re-run of the lifecycle's own calculation.
const STARTED_AT = lk('2026-09-22T00:10'); //       Start Journey pressed: 00:10 on D+1
const SCHEDULED_DEPARTURE = lk('2026-09-21T23:30'); // the 23:30 service of D
const SCHEDULED_ARRIVAL = lk('2026-09-22T00:50'); //   arriving 00:50 on D+1
const EXPIRES = lk('2026-09-22T01:20'); //             arrival + 30 min grace

function seed() {
    const db = createFakeFirestore({
        trips: [
            {
                id: 'TRIP-001',
                tripId: 'TRIP-001',
                routeId: '177_KADUWELA_KOLLUPITIYA',
                busId: 'BUS-A',
                status: 'ACTIVE',
                departureTime: '23:30',
                estimatedArrivalTime: '00:50',
            },
        ],
        bookings: [
            {
                bookingId: 'BK-A',
                userId: PASSENGER,
                tripId: 'TRIP-001',
                routeId: '177_KADUWELA_KOLLUPITIYA',
                busId: 'BUS-A',
                seatNumber: '05A',
                pairedSeatNumber: null,
                status: 'CONFIRMED',
                boardingStatus: 'NOT_BOARDED',
                // What the passenger booked — a different day and different
                // 'HH:MM' times. None of it may become the run's schedule.
                journeyDate: '2026-09-25',
                travelDate: '2026-09-25',
                journey: {
                    routeNumber: '177',
                    routeName: 'Kaduwela - Kollupitiya',
                    startLocation: 'Kaduwela',
                    endLocation: 'Kollupitiya',
                    departureTime: '06:00',
                    estimatedArrivalTime: '07:15',
                    journeyDate: '2026-09-25',
                    departureDate: '2026-09-25',
                },
                vehicle: { numberPlate: 'NB-8899', busModel: 'Viking', manufacturer: 'Ashok Leyland' },
                fare: { distanceKm: 20, baseFare: 30, distanceFare: 60, totalFare: 90, currency: 'LKR', isEstimate: false },
                createdAt: '2026-09-20T12:00:00.000Z',
            },
        ],
        buses: [{ busId: 'BUS-A' }],
        vehicleLocations: [],
    });
    mockGetAdminDb.mockReturnValue(db);
    return db;
}

function headers(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function busAction(tripId: string, action: 'START' | 'END') {
    const response = await tripJourney(
        new Request(`http://localhost/api/trips/${tripId}/journey`, {
            method: 'POST',
            headers: headers('token-bus'),
            body: JSON.stringify({ action }),
        }),
        { params: { tripId } }
    );
    return { status: response.status, body: await response.json() };
}

const startJourney = (tripId: string) => busAction(tripId, 'START');

async function ongoing(token: string) {
    const response = await getOngoing(new Request('http://localhost/api/journeys/ongoing', { headers: headers(token) }));
    return { status: response.status, body: await response.json() };
}

async function endJourney(token: string, bookingId: string) {
    const response = await endOwnJourney(
        new Request('http://localhost/api/journeys/ongoing/end', {
            method: 'POST',
            headers: headers(token),
            body: JSON.stringify({ bookingId }),
        })
    );
    return { status: response.status, body: await response.json() };
}

async function completed(token: string) {
    const response = await getCompleted(new Request('http://localhost/api/journeys/completed', { headers: headers(token) }));
    return { status: response.status, body: await response.json() };
}

let db: ReturnType<typeof createFakeFirestore>;

beforeEach(() => {
    mockGetAdminDb.mockReset();
    mockVerifyToken.mockReset();
    mockVerifyToken.mockImplementation(async (token: string) => TOKENS[token] ?? null);
    // Server time is the clock Start Journey stamps; fixed at 00:10 on D+1.
    jest.useFakeTimers({ now: STARTED_AT, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    db = seed();
});

afterEach(() => {
    jest.useRealTimers();
});

// ------------------------------------------------------------------
describe('an overnight run started after midnight: Start Journey -> GET /api/journeys/ongoing', () => {
    it("1-2. Start Journey persists D's 23:30 service, started at 00:10 on D+1", async () => {
        const started = await startJourney('TRIP-001');

        expect(started.status).toBe(200);
        expect(started.body.active).toBe(true);

        const persisted = (await db.collection('trips').doc('TRIP-001').get()).data()?.journey;
        expect(persisted).toEqual({
            status: 'STARTED',
            startedAt: STARTED_AT.toISOString(),
            endedAt: null,
            busId: 'BUS-A',
            scheduledDepartureAt: SCHEDULED_DEPARTURE.toISOString(),
            scheduledArrivalAt: SCHEDULED_ARRIVAL.toISOString(),
            expiresAt: EXPIRES.toISOString(),
        });
        // The endpoint reports exactly what it stored.
        expect(started.body.journey).toEqual(persisted);
    });

    it('3-4. the passenger is handed exactly the persisted times, and the run they identify', async () => {
        await startJourney('TRIP-001');
        const persisted = (await db.collection('trips').doc('TRIP-001').get()).data()?.journey;

        const { status, body } = await ongoing('token-passenger');

        expect(status).toBe(200);
        expect(body.ongoing).toBe(true);
        expect(body.journeys).toHaveLength(1);

        const [journey] = body.journeys;
        expect(journey.booking.bookingId).toBe('BK-A');
        expect(journey.booking.tripId).toBe('TRIP-001');
        expect(journey.busId).toBe('BUS-A');
        expect(journey.activeJourney).toEqual({
            tripId: 'TRIP-001',
            startedAt: persisted.startedAt,
            expiresAt: persisted.expiresAt,
            scheduledDepartureAt: persisted.scheduledDepartureAt,
            scheduledArrivalAt: persisted.scheduledArrivalAt,
        });
        expect(journey.activeJourney).toEqual({
            tripId: 'TRIP-001',
            startedAt: '2026-09-21T18:40:00.000Z',
            expiresAt: '2026-09-21T19:50:00.000Z',
            scheduledDepartureAt: '2026-09-21T18:00:00.000Z',
            scheduledArrivalAt: '2026-09-21T19:20:00.000Z',
        });
    });

    it("5. never rebuilds the run's times from what the passenger booked", async () => {
        await startJourney('TRIP-001');

        const [journey] = (await ongoing('token-passenger')).body.journeys;
        const { scheduledDepartureAt, scheduledArrivalAt } = journey.activeJourney;

        // The booking still says 25 Sep, 06:00 -> 07:15; the run is the 23:30 service of 21 Sep.
        expect(journey.booking.journey).toMatchObject({ departureTime: '06:00', estimatedArrivalTime: '07:15' });
        for (const booked of [lk('2026-09-25T06:00'), lk('2026-09-25T07:15'), lk('2026-09-22T06:00'), lk('2026-09-21T06:00')]) {
            expect([scheduledDepartureAt, scheduledArrivalAt]).not.toContain(booked.toISOString());
        }
        // Nor from the clock: the start time is not the scheduled departure.
        expect(scheduledDepartureAt).not.toBe(journey.activeJourney.startedAt);
    });

    it('6. keeps the scheduled departure on D although the run actually started on D+1', async () => {
        await startJourney('TRIP-001');

        const { activeJourney } = (await ongoing('token-passenger')).body.journeys[0];

        // Asserted on the instants themselves: 18:00Z is 23:30 on 21 Sep at +05:30.
        expect(new Date(activeJourney.scheduledDepartureAt).getTime()).toBe(SCHEDULED_DEPARTURE.getTime());
        expect(new Date(activeJourney.startedAt).getTime()).toBeGreaterThan(lk('2026-09-22T00:00').getTime());
        expect(new Date(activeJourney.scheduledDepartureAt).getTime()).toBeLessThan(lk('2026-09-22T00:00').getTime());
        expect(new Date(activeJourney.scheduledArrivalAt).getTime()).toBe(SCHEDULED_ARRIVAL.getTime());
    });

    it('reads, on the service clock: Mon 21 Sep 2026, 11:30 PM -> 12:50 AM, started 12:10 AM', async () => {
        await startJourney('TRIP-001');

        const { activeJourney } = (await ongoing('token-passenger')).body.journeys[0];

        expect(formatServiceDate(activeJourney.scheduledDepartureAt)).toBe('Mon, 21 Sep 2026');
        expect(formatServiceTime(activeJourney.scheduledDepartureAt)).toBe('11:30 PM');
        expect(formatServiceTime(activeJourney.scheduledArrivalAt)).toBe('12:50 AM');
        expect(formatServiceTime(activeJourney.startedAt)).toBe('12:10 AM');
    });

    it('hands the run only to the passenger who booked it', async () => {
        await startJourney('TRIP-001');

        expect((await ongoing('token-other')).body).toEqual({
            success: true,
            message: 'No ongoing journey.',
            ongoing: false,
            journeys: [],
        });
    });
});

// ------------------------------------------------------------------
// Completed: the same run, finished by the passenger at 00:40 on D+1.
//
// A completed journey keeps its own start and end on the booking. Its
// scheduled times come from the trip's journey record, which holds only the
// latest run — so they are known while that record is still this run
// (trip.journey.startedAt === completion.journeyStartedAt), and null once a
// later run has replaced it. That is the intended design: nothing is
// snapshotted onto the completion, and nothing is rebuilt.
// ------------------------------------------------------------------
const COMPLETED_AT = lk('2026-09-22T00:40'); //   the passenger ends it: 00:40 on D+1
const BUS_ENDED_AT = lk('2026-09-22T00:55'); //   the bus ends the same run
const NEXT_STARTED_AT = lk('2026-09-22T23:20'); // the next run of TRIP-001: D+1's 23:30 service
const NEXT_DEPARTURE = lk('2026-09-22T23:30');
const NEXT_ARRIVAL = lk('2026-09-23T00:50');

const NO_SCHEDULE = { scheduledDepartureAt: null, scheduledArrivalAt: null };

/** The overnight run: started by the bus at 00:10, ended by the passenger at 00:40. */
async function runAndComplete() {
    const started = await startJourney('TRIP-001');
    expect(started.status).toBe(200);

    jest.setSystemTime(COMPLETED_AT);
    const ended = await endJourney('token-passenger', 'BK-A');
    expect(ended.status).toBe(200);
    return ended;
}

const storedCompletion = async () => (await db.collection('bookings').doc('BK-A').get()).data()?.passengerJourney;
const storedRun = async () => (await db.collection('trips').doc('TRIP-001').get()).data()?.journey;

describe('an overnight run completed after midnight: End Journey -> GET /api/journeys/completed', () => {
    it("1-2. End Journey records the passenger's end at 00:40 on the run that started at 00:10", async () => {
        const ended = await runAndComplete();

        expect(ended.body).toMatchObject({
            success: true,
            alreadyCompleted: false,
            bookingIds: ['BK-A'],
            completion: { completedAt: COMPLETED_AT.toISOString(), completionReason: 'PASSENGER' },
        });
        expect(await storedCompletion()).toMatchObject({
            status: 'COMPLETED',
            tripId: 'TRIP-001',
            busId: 'BUS-A',
            journeyStartedAt: STARTED_AT.toISOString(),
            completedAt: COMPLETED_AT.toISOString(),
            completionReason: 'PASSENGER',
        });
        // The passenger's end is not the bus's: the run itself is untouched and still running.
        expect(await storedRun()).toEqual({
            status: 'STARTED',
            startedAt: STARTED_AT.toISOString(),
            endedAt: null,
            busId: 'BUS-A',
            scheduledDepartureAt: SCHEDULED_DEPARTURE.toISOString(),
            scheduledArrivalAt: SCHEDULED_ARRIVAL.toISOString(),
            expiresAt: EXPIRES.toISOString(),
        });
    });

    it('3-4. the completed journey carries the persisted schedule, start and end exactly', async () => {
        await runAndComplete();
        const run = await storedRun();
        const record = await storedCompletion();

        const { status, body } = await completed('token-passenger');

        expect(status).toBe(200);
        expect(body.journeys).toHaveLength(1);
        const [journey] = body.journeys;

        expect(journey.booking.bookingId).toBe('BK-A');
        expect(journey.completion).toMatchObject({ tripId: 'TRIP-001', busId: 'BUS-A', completionReason: 'PASSENGER' });
        // Exactly what was stored, on the trip and on the booking...
        expect(journey.schedule).toEqual({ scheduledDepartureAt: run.scheduledDepartureAt, scheduledArrivalAt: run.scheduledArrivalAt });
        expect(journey.completion.journeyStartedAt).toBe(record.journeyStartedAt);
        expect(journey.completion.completedAt).toBe(record.completedAt);
        // ...which is the scenario's own times.
        expect(journey.schedule).toEqual({
            scheduledDepartureAt: '2026-09-21T18:00:00.000Z',
            scheduledArrivalAt: '2026-09-21T19:20:00.000Z',
        });
        expect(journey.completion.journeyStartedAt).toBe('2026-09-21T18:40:00.000Z');
        expect(journey.completion.completedAt).toBe('2026-09-21T19:10:00.000Z');
    });

    it("5. never rebuilds the run's times from what the passenger booked", async () => {
        await runAndComplete();

        const [journey] = (await completed('token-passenger')).body.journeys;
        const times = [
            journey.schedule.scheduledDepartureAt,
            journey.schedule.scheduledArrivalAt,
            journey.completion.journeyStartedAt,
            journey.completion.completedAt,
        ];

        expect(journey.booking.journey).toMatchObject({ departureTime: '06:00', estimatedArrivalTime: '07:15' });
        for (const booked of [lk('2026-09-25T06:00'), lk('2026-09-25T07:15'), lk('2026-09-22T06:00'), lk('2026-09-22T07:15'), lk('2026-09-21T06:00')]) {
            expect(times).not.toContain(booked.toISOString());
        }
        // Four different moments: the end is not the start, the schedule is neither.
        expect(new Set(times).size).toBe(4);
    });

    it('reads, on the service clock: Mon 21 Sep 2026, 11:30 PM -> 12:50 AM, started 12:10 AM, ended 12:40 AM', async () => {
        await runAndComplete();

        const [{ schedule, completion }] = (await completed('token-passenger')).body.journeys;

        expect(formatServiceDate(schedule.scheduledDepartureAt)).toBe('Mon, 21 Sep 2026');
        expect(formatServiceTime(schedule.scheduledDepartureAt)).toBe('11:30 PM');
        expect(formatServiceTime(schedule.scheduledArrivalAt)).toBe('12:50 AM');
        expect(formatServiceTime(completion.journeyStartedAt)).toBe('12:10 AM');
        expect(formatServiceTime(completion.completedAt)).toBe('12:40 AM');
    });
});

describe('the same trip run again: the old completion keeps its start and end, and loses its schedule', () => {
    it('A-E. after a later run replaces the record: start and end kept, schedule null, the new run never borrowed', async () => {
        // A. The overnight run, completed by the passenger at 00:40.
        await runAndComplete();
        const record = await storedCompletion();

        // The bus ends that run: the record is still that run, so the schedule is still known.
        jest.setSystemTime(BUS_ENDED_AT);
        expect((await busAction('TRIP-001', 'END')).status).toBe(200);
        const [whileSameRun] = (await completed('token-passenger')).body.journeys;
        expect(whileSameRun.schedule).toEqual({
            scheduledDepartureAt: SCHEDULED_DEPARTURE.toISOString(),
            scheduledArrivalAt: SCHEDULED_ARRIVAL.toISOString(),
        });

        // B. The next run of the same trip: D+1's 23:30 service, started 23:20.
        jest.setSystemTime(NEXT_STARTED_AT);
        expect((await startJourney('TRIP-001')).status).toBe(200);
        const next = await storedRun();
        expect(next).toMatchObject({
            status: 'STARTED',
            startedAt: NEXT_STARTED_AT.toISOString(),
            scheduledDepartureAt: NEXT_DEPARTURE.toISOString(),
            scheduledArrivalAt: NEXT_ARRIVAL.toISOString(),
        });
        expect(next.startedAt).not.toBe(record.journeyStartedAt);

        // C. The old completion, fetched again.
        const { body } = await completed('token-passenger');
        expect(body.journeys).toHaveLength(1);
        const [old] = body.journeys;

        // D. Its own start and end, and its identity, are exactly as recorded...
        expect(old.booking.bookingId).toBe('BK-A');
        expect(old.completion).toEqual(record);
        expect(old.completion).toMatchObject({
            tripId: 'TRIP-001',
            journeyStartedAt: STARTED_AT.toISOString(),
            completedAt: COMPLETED_AT.toISOString(),
            completionReason: 'PASSENGER',
        });
        expect(await storedCompletion()).toEqual(record);

        // E. ...but its scheduled times are gone with the record — null, not the new run's.
        expect(old.schedule).toEqual(NO_SCHEDULE);
        expect(old.schedule.scheduledDepartureAt).not.toBe(next.scheduledDepartureAt);
        // No snapshot: the completion itself never carried a schedule.
        expect(old.completion).not.toHaveProperty('scheduledDepartureAt');
        expect(old.completion).not.toHaveProperty('scheduledArrivalAt');
        expect(record).not.toHaveProperty('scheduledDepartureAt');
    });

    it('after the overwrite, the actual start and end still read 12:10 AM and 12:40 AM; the schedule reads as unavailable', async () => {
        await runAndComplete();
        jest.setSystemTime(BUS_ENDED_AT);
        await busAction('TRIP-001', 'END');
        jest.setSystemTime(NEXT_STARTED_AT);
        await startJourney('TRIP-001');

        const [{ schedule, completion }] = (await completed('token-passenger')).body.journeys;

        expect(formatServiceTime(completion.journeyStartedAt)).toBe('12:10 AM');
        expect(formatServiceTime(completion.completedAt)).toBe('12:40 AM');
        // The formatter gives nothing, so both surfaces show "Not available" (MOV-316).
        expect(formatServiceDate(schedule.scheduledDepartureAt)).toBeNull();
        expect(formatServiceTime(schedule.scheduledDepartureAt)).toBeNull();
        expect(formatServiceTime(schedule.scheduledArrivalAt)).toBeNull();
    });
});
