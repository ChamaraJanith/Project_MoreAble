// Live updates, end to end (MOV-122).
//
// The two live-data suites either side of this one each test half a pipeline.
// MOV-121 drives the GPS endpoint and reads the result back through the fake
// database's own API. MOV-120 seeds `vehicleLocations` by hand and reads it
// through journey search. Neither proves the two halves meet: if the ingestion
// endpoint and the retrieval module disagreed about the collection name or the
// document key, both suites would still pass and no passenger would ever see a
// bus.
//
// So this drives the REAL ingestion endpoint and the REAL journey search
// against a SINGLE database, and covers what only that arrangement can show —
// a position published, retrieved, published again, and retrieved again.
//
// It deliberately re-tests none of the coordinate validation, authentication,
// storage or age arithmetic already covered next door.

import { PUT as reportLocation } from '../../../app/api/buses/[busId]/location+api';
import { POST as searchJourneys } from '../../../app/api/journeys/search+api';
import {
    formatLocationAge,
    resolveVehiclePosition,
} from '../../../src/features/journey/utils/liveStatus';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// The ingestion endpoint is exercised for real; only the signature check on the
// token is stubbed, exactly as the MOV-121 suite does it.
jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// The map providers play no part in live vehicle data.
jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(async () => null),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(async () => null),
    getRouteThroughCoordinates: jest.fn(async () => null),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const BUS_A = 'BUS-00001';
const BUS_B = 'BUS-00002';
const TRIP_A = 'TRIP-00001';
const TRIP_B = 'TRIP-00002';

const OPERATOR = {
    uid: 'firebase-uid-admin',
    passengerId: 'ADM-2026-00001',
    role: 'ADMIN',
    email: 'admin@moreable.lk',
};

/** Two points on the Kaduwela - Kollupitiya corridor, ten minutes apart. */
const POSITION_A = {
    latitude: 6.9333,
    longitude: 79.9833,
    recordedAt: '2026-08-20T09:00:00.000Z',
};

const POSITION_B = {
    latitude: 6.9061,
    longitude: 79.9558,
    recordedAt: '2026-08-20T09:10:00.000Z',
};

const route = {
    id: '177_KADUWELA_KOLLUPITIYA',
    routeId: '177_KADUWELA_KOLLUPITIYA',
    routeNumber: '177',
    routeName: 'Kaduwela - Kollupitiya',
    startLocation: 'Kaduwela',
    endLocation: 'Kollupitiya',
    stops: ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella', 'Kollupitiya'],
    distanceKm: 22.5,
    estimatedDuration: '1h 15m',
    status: 'ACTIVE',
};

function bus(busId: string, numberPlate: string) {
    return {
        id: busId,
        busId,
        numberPlate,
        chassisNumber: `CHS-${busId}`,
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities: {
            wheelchairRamp: true,
            audioAnnouncement: true,
            lowFloorVehicle: true,
            walkingAssistance: false,
            wheelchairSpace: { available: true, count: 2 },
            guardianSeats: { available: true, count: 2 },
            prioritySeats: { available: true, count: 4 },
            elderlySeats: { available: true, count: 4 },
        },
        status: 'ACTIVE',
    };
}

function trip(tripId: string, busId: string, departureTime: string, arrivalTime: string) {
    return {
        id: tripId,
        tripId,
        routeId: route.routeId,
        busId,
        departureTime,
        estimatedArrivalTime: arrivalTime,
        turnNumber: 1,
        status: 'ACTIVE',
    };
}

/** One route, two departures, on two different vehicles. Nothing reporting yet. */
function fleetDb() {
    return createFakeFirestore({
        routes: [route],
        buses: [bus(BUS_A, 'NB-1234'), bus(BUS_B, 'NB-5678')],
        trips: [
            trip(TRIP_A, BUS_A, '09:00', '10:10'),
            trip(TRIP_B, BUS_B, '09:30', '10:40'),
        ],
    });
}

// ------------------------------------------------------------------
// The two real entry points
// ------------------------------------------------------------------

/** Publishes a position the way a bus actually does: through the GPS endpoint. */
async function publishLocation(
    db: ReturnType<typeof createFakeFirestore>,
    busId: string,
    position: { latitude: number; longitude: number; recordedAt: string }
) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await reportLocation(
        new Request(`http://localhost/api/buses/${busId}/location`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer test-token',
            },
            body: JSON.stringify(position),
        }),
        { params: { busId } }
    );

    // Every publish in this file is expected to succeed; a rejected one would
    // otherwise show up much later as a confusing retrieval failure.
    expect(response.status).toBe(200);
}

/**
 * What the passenger's screen does: runs the journey search again.
 *
 * This is the exact call the Route Details "Refresh" button makes — it re-runs
 * the search rather than fetching a vehicle position directly — so repeating it
 * here is the testable half of that button.
 */
async function retrieveJourney(db: ReturnType<typeof createFakeFirestore>) {
    mockGetAdminDb.mockReturnValue(db);

    const response = await searchJourneys(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origin: 'Kaduwela',
                destination: 'Borella',
                travelDate: '2026-08-20',
                travelTime: '08:30',
            }),
        })
    );

    return response.json();
}

/** The departure a passenger selected, out of the single matched route. */
function departure(json: any, tripId: string) {
    return json.routes[0].trips.find((option: any) => option.trip.tripId === tripId);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockResolvedValue(OPERATOR);
});

// ==================================================================
// THE PIPELINE JOINS UP
//
// The gap neither neighbouring suite can close: that what the GPS endpoint
// writes is what journey search reads.
// ==================================================================
describe('a position published by a bus reaches the passenger', () => {
    it('travels from the GPS endpoint to the selected departure', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_A);
        const { liveStatus } = departure(await retrieveJourney(db), TRIP_A);

        // Written by one module, read by another, matched only by convention:
        // the collection name and the document key. This is what pins them
        // together.
        expect(liveStatus.available).toBe(true);
        expect(liveStatus.location).toEqual({
            busId: BUS_A,
            latitude: POSITION_A.latitude,
            longitude: POSITION_A.longitude,
            recordedAt: POSITION_A.recordedAt,
        });
    });

    it('leaves a bus that has not published in the unavailable state', async () => {
        const db = fleetDb();

        // Only BUS_A publishes. The other departure is on BUS_B.
        await publishLocation(db, BUS_A, POSITION_A);
        const json = await retrieveJourney(db);

        expect(departure(json, TRIP_A).liveStatus.available).toBe(true);
        expect(departure(json, TRIP_B).liveStatus.available).toBe(false);
    });
});

// ==================================================================
// THE LIVE UPDATE
//
// The scenario the story is named after: publish, retrieve, publish again,
// retrieve again — and get the second position, not the first.
// ==================================================================
describe('a newer report replaces what the passenger saw before', () => {
    it('returns the second position on the second retrieval', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_A);
        const first = departure(await retrieveJourney(db), TRIP_A);
        expect(first.liveStatus.location.latitude).toBe(POSITION_A.latitude);

        // The bus moves and reports again.
        await publishLocation(db, BUS_A, POSITION_B);
        const second = departure(await retrieveJourney(db), TRIP_A);

        expect(second.liveStatus.location).toEqual({
            busId: BUS_A,
            latitude: POSITION_B.latitude,
            longitude: POSITION_B.longitude,
            recordedAt: POSITION_B.recordedAt,
        });

        // Not a trace of where it used to be.
        expect(second.liveStatus.location.latitude).not.toBe(POSITION_A.latitude);
        expect(second.liveStatus.location.recordedAt).not.toBe(POSITION_A.recordedAt);
    });

    it('reports the newer fix as more recent than the one it replaced', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_A);
        const oldAge = departure(await retrieveJourney(db), TRIP_A).liveStatus
            .locationAgeSeconds;

        await publishLocation(db, BUS_A, POSITION_B);
        const newAge = departure(await retrieveJourney(db), TRIP_A).liveStatus
            .locationAgeSeconds;

        // The two fixes are ten minutes apart, so the age must drop by about
        // that much. A tolerance covers the real clock ticking between the two
        // searches; asserting an exact figure would make this flaky, and
        // asserting nothing would let a frozen age through.
        expect(newAge).toBeLessThan(oldAge);
        expect(oldAge - newAge).toBeGreaterThanOrEqual(599);
        expect(oldAge - newAge).toBeLessThanOrEqual(601);
    });

    it('keeps one document per bus however many reports arrive', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_A);
        await publishLocation(db, BUS_A, POSITION_B);
        await publishLocation(db, BUS_A, {
            latitude: 6.9147,
            longitude: 79.8778,
            recordedAt: '2026-08-20T09:20:00.000Z',
        });

        // Latest state, not a trail. Three reports, one record, newest wins.
        const stored = await db.collection('vehicleLocations').get();
        expect(stored.docs).toHaveLength(1);

        const { liveStatus } = departure(await retrieveJourney(db), TRIP_A);
        expect(liveStatus.location.recordedAt).toBe('2026-08-20T09:20:00.000Z');
    });

    it('lets a bus that starts reporting mid-journey appear on the next retrieval', async () => {
        const db = fleetDb();

        // The passenger opens the journey before the bus has reported at all.
        const before = departure(await retrieveJourney(db), TRIP_A);
        expect(before.liveStatus.available).toBe(false);
        expect(before.liveStatus.location).toBeUndefined();

        await publishLocation(db, BUS_A, POSITION_A);

        const after = departure(await retrieveJourney(db), TRIP_A);
        expect(after.liveStatus.available).toBe(true);
        expect(after.liveStatus.location.latitude).toBe(POSITION_A.latitude);
    });

    it('records a late-arriving older fix, because the store keeps the last write', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_B); // 09:10
        await publishLocation(db, BUS_A, POSITION_A); // 09:00, arriving second

        const { liveStatus } = departure(await retrieveJourney(db), TRIP_A);

        // Pinning the contract as it actually stands: the endpoint replaces the
        // document unconditionally, so the last report received wins even if an
        // earlier fix time overtook a later one in transit. There is no
        // "newest timestamp wins" rule anywhere in the implementation, and this
        // test does not assert one — it exists so that adding such a rule later
        // is a deliberate change rather than a silent one. See the MOV-122
        // report.
        expect(liveStatus.location.recordedAt).toBe(POSITION_A.recordedAt);
    });
});

// ==================================================================
// REFRESH
//
// The Route Details Refresh button re-runs this same search. Its tap cannot be
// tested without a renderer the project does not have, but the boundary it
// drives can be.
// ==================================================================
describe('repeating the search is what surfaces a new position', () => {
    it('gives two identical requests different live data when the bus has moved', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_A);
        const first = await retrieveJourney(db);

        await publishLocation(db, BUS_A, POSITION_B);
        const second = await retrieveJourney(db);

        // Same request, same criteria, same trip — only the live block differs.
        expect(second.searchCriteria).toEqual(first.searchCriteria);
        expect(departure(second, TRIP_A).trip).toEqual(departure(first, TRIP_A).trip);
        expect(departure(second, TRIP_A).liveStatus.location).not.toEqual(
            departure(first, TRIP_A).liveStatus.location
        );
    });

    it('moves the coordinate the map would draw, and the words above it', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_A);
        const before = departure(await retrieveJourney(db), TRIP_A).liveStatus;

        await publishLocation(db, BUS_A, POSITION_B);
        const after = departure(await retrieveJourney(db), TRIP_A).liveStatus;

        // The screen's own helpers, applied to real responses rather than to a
        // hand-written fixture — so this covers the join between the retrieval
        // contract and the UI, which the helper unit tests cannot.
        expect(resolveVehiclePosition(before)).toEqual({
            latitude: POSITION_A.latitude,
            longitude: POSITION_A.longitude,
        });
        expect(resolveVehiclePosition(after)).toEqual({
            latitude: POSITION_B.latitude,
            longitude: POSITION_B.longitude,
        });

        expect(formatLocationAge(after.locationAgeSeconds)).toMatch(/^Updated /);
    });

    it('returns to the unavailable state if the position record goes away', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_A);
        expect(departure(await retrieveJourney(db), TRIP_A).liveStatus.available).toBe(true);

        // No production path deletes a position — the GPS endpoint only ever
        // writes. This stands in for the record being removed outside the app
        // (a console edit, a retention policy), and checks the screen falls back
        // to the calm unavailable state rather than to a stale or broken one.
        await db.collection('vehicleLocations').doc(BUS_A).delete();

        const { liveStatus } = departure(await retrieveJourney(db), TRIP_A);
        expect(liveStatus.available).toBe(false);
        expect(liveStatus.location).toBeUndefined();
        expect(liveStatus.message).toMatch(/not available/i);

        // And the map is told to draw nothing rather than a last known point.
        expect(resolveVehiclePosition(liveStatus)).toBeNull();
    });
});

// ==================================================================
// ISOLATION WHILE POSITIONS CHANGE
//
// The neighbouring suites prove isolation over static data. This proves it
// holds while positions are actually being written.
// ==================================================================
describe('one bus moving does not disturb another', () => {
    it('keeps each departure on its own vehicle through repeated updates', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_A);
        await publishLocation(db, BUS_B, POSITION_B);
        // BUS_A moves again; BUS_B has not reported since.
        await publishLocation(db, BUS_A, {
            latitude: 6.9147,
            longitude: 79.8778,
            recordedAt: '2026-08-20T09:20:00.000Z',
        });

        const json = await retrieveJourney(db);
        const first = departure(json, TRIP_A);
        const second = departure(json, TRIP_B);

        expect(first.bus.busId).toBe(BUS_A);
        expect(first.liveStatus.location.busId).toBe(BUS_A);
        expect(first.liveStatus.location.latitude).toBe(6.9147);

        expect(second.bus.busId).toBe(BUS_B);
        expect(second.liveStatus.location.busId).toBe(BUS_B);
        expect(second.liveStatus.location.latitude).toBe(POSITION_B.latitude);
    });

    it('leaves a reporting bus alone when a silent one starts reporting', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_A);
        const before = departure(await retrieveJourney(db), TRIP_A).liveStatus.location;

        await publishLocation(db, BUS_B, POSITION_B);
        const after = departure(await retrieveJourney(db), TRIP_A).liveStatus.location;

        expect(after).toEqual(before);
    });
});

// ==================================================================
// WHAT A POSITION UPDATE MUST NOT TOUCH
//
// A GPS report is the most frequent write in the system. Nothing about the
// timetable or the fleet may drift because of one.
// ==================================================================
describe('scheduled information survives a moving bus', () => {
    it('leaves the departure and arrival times exactly as scheduled', async () => {
        const db = fleetDb();

        const before = departure(await retrieveJourney(db), TRIP_A).trip;

        await publishLocation(db, BUS_A, POSITION_A);
        await publishLocation(db, BUS_A, POSITION_B);

        const after = departure(await retrieveJourney(db), TRIP_A).trip;

        expect(after).toEqual(before);
        // Stated outright: these are the timetable, and no amount of live
        // movement revises them into an estimate.
        expect(after.departureTime).toBe('09:00');
        expect(after.estimatedArrivalTime).toBe('10:10');
    });

    it('leaves the vehicle record and its accessibility facilities untouched', async () => {
        const db = fleetDb();

        const before = departure(await retrieveJourney(db), TRIP_A).bus;

        await publishLocation(db, BUS_A, POSITION_A);
        await publishLocation(db, BUS_A, POSITION_B);

        const after = departure(await retrieveJourney(db), TRIP_A).bus;

        expect(after).toEqual(before);
        expect(after.numberPlate).toBe('NB-1234');
        expect(after.accessibilityFacilities.wheelchairRamp).toBe(true);
    });

    it('keeps the departure on its own route and its own bus', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_B);

        const json = await retrieveJourney(db);
        const match = json.routes[0];

        expect(match.routeId).toBe(route.routeId);
        expect(match.routeNumber).toBe('177');
        // The travelled segment is still the partial journey that was searched
        // for, not the whole route.
        expect(match.journeyStops).toEqual([
            'Kaduwela',
            'Malabe',
            'Battaramulla',
            'Rajagiriya',
            'Borella',
        ]);
        expect(departure(json, TRIP_A).bus.busId).toBe(BUS_A);
    });

    it('does not write the position onto the bus or the trip record', async () => {
        const db = fleetDb();

        await publishLocation(db, BUS_A, POSITION_B);

        const storedBus = (await db.collection('buses').doc(BUS_A).get()).data() ?? {};
        const storedTrip = (await db.collection('trips').doc(TRIP_A).get()).data() ?? {};

        // The position lives in one place. Copying it onto the fleet or
        // schedule records would give every consumer a second, staler source.
        expect(storedBus.latitude).toBeUndefined();
        expect(storedBus.recordedAt).toBeUndefined();
        expect(storedBus.status).toBe('ACTIVE');
        expect(storedTrip.latitude).toBeUndefined();
        expect(storedTrip.departureTime).toBe('09:00');
    });
});
