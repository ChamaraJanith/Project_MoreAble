// The transport database connection (MOV-105).
//
// Every other suite exercises one side in isolation: the admin CRUD tests write
// into their own fake Firestore, and the journey search tests read from a
// pre-seeded one. Nothing checked that the records admin writes are the records
// the passenger search reads back.
//
// This drives both halves against a SINGLE database, so the contract between
// them is covered: the collections they agree on, and the fact that a trip
// stores only references to its route and bus rather than a copy of them.

import { POST as createBus } from '../../../app/api/buses/index+api';
import { POST as searchJourneys } from '../../../app/api/journeys/search+api';
import { POST as createRoute } from '../../../app/api/routes/index+api';
import { POST as createTrip } from '../../../app/api/trips/index+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { buildTestPassword } from '../../testUtils/testPassword';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// The external map providers are not part of the database connection.
jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(async () => ({ latitude: 6.9333, longitude: 79.9833 })),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(async () => null),
    getRouteThroughCoordinates: jest.fn(async () => null),
}));

function post(path: string, body: unknown): Request {
    return new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const busPayload = {
    // Required by the create endpoint since bus login credentials were added.
    // Generated at run time; never a literal.
    password: buildTestPassword('fleet'),
    numberPlate: 'NB-1234',
    chassisNumber: 'CHS-2026-00001',
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
        elderlySeats: { available: true, count: 2 },
    },
};

const routePayload = {
    routeId: '177_KADUWELA_KOLLUPITIYA',
    routeNumber: '177',
    routeName: 'Kaduwela - Kollupitiya',
    direction: 'OUTBOUND',
    startLocation: 'Kaduwela',
    endLocation: 'Kollupitiya',
    startStopId: 'kaduwela',
    endStopId: 'kollupitiya',
    stops: ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella', 'Kollupitiya'],
    distanceKm: 20,
    estimatedDuration: '1 hr 9 min',
    status: 'ACTIVE',
};

const searchBody = {
    origin: 'Kaduwela',
    destination: 'Kollupitiya',
    travelDate: '2026-08-20',
    travelTime: '08:30',
};

/** Runs the admin create endpoints against `db`, returning the generated ids. */
async function seedThroughAdminApi(db: ReturnType<typeof createFakeFirestore>) {
    mockGetAdminDb.mockReturnValue(db);

    const busJson = await (await createBus(post('/api/buses', busPayload))).json();
    expect(busJson.success).toBe(true);

    const routeJson = await (await createRoute(post('/api/routes', routePayload))).json();
    expect(routeJson.success).toBe(true);

    const busId = busJson.bus.busId;

    const tripJson = await (
        await createTrip(
            post('/api/trips', {
                routeId: routePayload.routeId,
                busId,
                departureTime: '09:00',
                estimatedArrivalTime: '10:10',
                turnNumber: 1,
                status: 'ACTIVE',
            })
        )
    ).json();
    expect(tripJson.success).toBe(true);

    return { busId, tripId: tripJson.trip.tripId, routeId: routePayload.routeId };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('transport records written by admin are read back by journey search', () => {
    it('returns the vehicle the admin created, through the same database', async () => {
        const db = createFakeFirestore({});
        const { busId, tripId, routeId } = await seedThroughAdminApi(db);

        const json = await (await searchJourneys(post('/api/journeys/search', searchBody))).json();

        expect(json.success).toBe(true);
        expect(json.routes).toHaveLength(1);

        const match = json.routes[0];
        expect(match.routeId).toBe(routeId);
        expect(match.routeNumber).toBe('177');

        expect(match.trips).toHaveLength(1);
        const [option] = match.trips;

        expect(option.trip.tripId).toBe(tripId);
        expect(option.trip.departureTime).toBe('09:00');
        expect(option.trip.estimatedArrivalTime).toBe('10:10');

        // The vehicle reaches the passenger exactly as the admin recorded it.
        expect(option.bus).toEqual({
            busId,
            numberPlate: 'NB-1234',
            busModel: 'Ashok Leyland Viking',
            manufacturer: 'Ashok Leyland',
            seatCapacity: 54,
            accessibilityFacilities: busPayload.accessibilityFacilities,
        });
    });

    it('keeps the bus login credential out of the passenger response', async () => {
        const db = createFakeFirestore({});
        const { busId } = await seedThroughAdminApi(db);

        // The admin created this bus with a password, so the document really
        // does hold the credential — this is not a vacuous assertion. It is
        // stored in the clear by project decision, which is exactly why the
        // passenger boundary below has to hold.
        const storedBus = (await db.collection('buses').doc(busId).get()).data() ?? {};
        expect(storedBus.password).toBe(busPayload.password);

        const json = await (await searchJourneys(post('/api/journeys/search', searchBody))).json();
        const { bus } = json.routes[0].trips[0];

        // The passenger payload is an allow-list, so a credential stored beside
        // the vehicle cannot travel with it.
        expect(bus.password).toBeUndefined();
        expect(bus.passwordHash).toBeUndefined();
        expect(Object.keys(bus).sort()).toEqual([
            'accessibilityFacilities',
            'busId',
            'busModel',
            'manufacturer',
            'numberPlate',
            'seatCapacity',
        ]);
    });

    it('stores the trip as references only, resolving route and bus at read time', async () => {
        const db = createFakeFirestore({});
        const { busId, tripId, routeId } = await seedThroughAdminApi(db);

        const storedTrip = (await db.collection('trips').doc(tripId).get()).data() ?? {};

        // No copy of the route or the bus is denormalised onto the trip, so an
        // admin edit to either is picked up by the next search rather than
        // leaving the passenger with a stale record.
        expect(storedTrip.routeId).toBe(routeId);
        expect(storedTrip.busId).toBe(busId);
        expect(storedTrip.numberPlate).toBeUndefined();
        expect(storedTrip.accessibilityFacilities).toBeUndefined();
        expect(storedTrip.stops).toBeUndefined();
    });

    it('keeps each document id equal to the id field stored inside it', async () => {
        const db = createFakeFirestore({});
        const { busId, tripId, routeId } = await seedThroughAdminApi(db);

        // The search matches routes on the stored routeId field but looks buses
        // up by document path, so the two must not drift apart.
        expect((await db.collection('buses').doc(busId).get()).data()?.busId).toBe(busId);
        expect((await db.collection('routes').doc(routeId).get()).data()?.routeId).toBe(routeId);
        expect((await db.collection('trips').doc(tripId).get()).data()?.tripId).toBe(tripId);
    });

    it('reflects an admin change to the vehicle on the next search', async () => {
        const db = createFakeFirestore({});
        const { busId } = await seedThroughAdminApi(db);

        // Written straight to the collection the admin endpoints use.
        await db.collection('buses').doc(busId).update({
            accessibilityFacilities: {
                ...busPayload.accessibilityFacilities,
                wheelchairRamp: false,
            },
        });

        const json = await (await searchJourneys(post('/api/journeys/search', searchBody))).json();

        expect(
            json.routes[0].trips[0].bus.accessibilityFacilities.wheelchairRamp
        ).toBe(false);
    });
});