// The data a recommended route is ranked from (MOV-89).
//
// MOV-87 built the ranking and stopped, because the search response carried no
// accessibility score for it to rank by. MOV-89 is the retrieval half: every
// journey option now carries the score for its own vehicle, so a recommendation
// can be ordered without any caller re-deriving it.
//
// What matters here is the CONTRACT, not the arithmetic. The score itself comes
// from `computeAccessibilityScore`, which the booking flow has used in
// production for some time and which MOV-79 will later widen to consider
// community reports, ratings, delay history and reliability. Re-deriving that
// formula in this file would create a second definition of it that keeps
// passing after the real one changes, so nothing below recalculates a score:
// the expected values are taken from the shared function itself.
//
// The association is what this file guards. A score paired with the wrong bus
// would put a wheelchair user on a vehicle that cannot carry them, and that
// mistake is invisible in a response that otherwise looks correct.
//
// No credential, session value or authentication data appears here. Journey
// search needs none, so none is fabricated.

import { POST } from '../../../app/api/journeys/search+api';
import { Bus, BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import { Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import { computeAccessibilityScore } from '../../../src/shared/utils/accessibility';
import { rankJourneyOptions } from '../../../src/shared/utils/journeyRanking';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

const mockGeocodeLocation = geocodeLocation as jest.MockedFunction<typeof geocodeLocation>;
const mockGetRoute = getRouteBetweenCoordinates as jest.MockedFunction<
    typeof getRouteBetweenCoordinates
>;
const mockGetRouteThrough = getRouteThroughCoordinates as jest.MockedFunction<
    typeof getRouteThroughCoordinates
>;

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// The external map/routing providers play no part in accessibility data.
jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(),
    getRouteThroughCoordinates: jest.fn(),
}));

// ------------------------------------------------------------------
// Fixtures — the same route and shapes the existing search suites use
// ------------------------------------------------------------------
const ROUTE_ID = '177_KADUWELA_KOLLUPITIYA';

const route: Route & { id: string } = {
    id: ROUTE_ID,
    routeId: ROUTE_ID,
    routeNumber: '177',
    routeName: 'Kaduwela - Kollupitiya',
    startLocation: 'Kaduwela',
    endLocation: 'Kollupitiya',
    stops: ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella', 'Kollupitiya'],
    distanceKm: 22.5,
    estimatedDuration: '1h 15m',
    status: 'ACTIVE',
};

/** Every facility recorded. */
const FULLY_EQUIPPED: BusAccessibilityFacilities = {
    wheelchairRamp: true,
    audioAnnouncement: true,
    lowFloorVehicle: true,
    walkingAssistance: true,
    wheelchairSpace: { available: true, count: 2 },
    guardianSeats: { available: true, count: 2 },
    prioritySeats: { available: true, count: 4 },
    elderlySeats: { available: true, count: 4 },
};

/** A ramp and priority seats, nothing else. */
const PARTLY_EQUIPPED: BusAccessibilityFacilities = {
    wheelchairRamp: true,
    audioAnnouncement: false,
    lowFloorVehicle: false,
    walkingAssistance: false,
    wheelchairSpace: { available: false, count: 0 },
    guardianSeats: { available: false, count: 0 },
    prioritySeats: { available: true, count: 4 },
    elderlySeats: { available: false, count: 0 },
};

/** Nothing recorded as available. */
const NOT_EQUIPPED: BusAccessibilityFacilities = {
    wheelchairRamp: false,
    audioAnnouncement: false,
    lowFloorVehicle: false,
    walkingAssistance: false,
    wheelchairSpace: { available: false, count: 0 },
    guardianSeats: { available: false, count: 0 },
    prioritySeats: { available: false, count: 0 },
    elderlySeats: { available: false, count: 0 },
};

function bus(
    busId: string,
    numberPlate: string,
    facilities: BusAccessibilityFacilities | undefined
): Bus & { id: string } {
    return {
        id: busId,
        busId,
        numberPlate,
        chassisNumber: `CHS-${busId}`,
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities: facilities as BusAccessibilityFacilities,
        status: 'ACTIVE',
    };
}

function trip(tripId: string, busId: string, departureTime: string): Trip & { id: string } {
    return {
        id: tripId,
        tripId,
        routeId: ROUTE_ID,
        busId,
        departureTime,
        estimatedArrivalTime: '10:10',
        turnNumber: 1,
        status: 'ACTIVE',
    };
}

function buildRequest(body: unknown): Request {
    return new Request('http://localhost/api/journeys/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const SEARCH = {
    origin: 'Kaduwela',
    destination: 'Borella',
    travelDate: '2026-08-20',
    travelTime: '08:00',
};

/** Runs the real search endpoint against the given fleet. */
async function search(db: ReturnType<typeof createFakeFirestore>): Promise<any> {
    mockGetAdminDb.mockReturnValue(db);
    const response = await POST(buildRequest(SEARCH));
    return response.json();
}

/** The single matched route's journey options. */
const optionsOf = (json: any) => json.routes[0].trips;

const optionFor = (json: any, tripId: string) =>
    optionsOf(json).find((option: any) => option.trip.tripId === tripId);

beforeEach(() => {
    jest.clearAllMocks();

    mockGeocodeLocation.mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    mockGetRoute.mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
    mockGetRouteThrough.mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
});

// ==================================================================
// A. THE ROUTE, TRIP AND BUS A RECOMMENDATION IS BUILT FROM
// ==================================================================
describe('the data behind one recommended option', () => {
    it('returns the matched route with the passenger own boarding and alighting stops', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-00001', 'NB-1234', FULLY_EQUIPPED)],
            trips: [trip('TRIP-00001', 'BUS-00001', '09:00')],
        });

        const matched = (await search(db)).routes[0];

        expect(matched.routeId).toBe(ROUTE_ID);
        expect(matched.routeNumber).toBe('177');
        expect(matched.origin).toBe('Kaduwela');
        expect(matched.destination).toBe('Borella');
        expect(matched.distanceKm).toBe(22.5);
    });

    it('returns the departure that will actually be travelled on', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-00001', 'NB-1234', FULLY_EQUIPPED)],
            trips: [trip('TRIP-00001', 'BUS-00001', '09:00')],
        });

        const { trip: departure } = optionFor(await search(db), 'TRIP-00001');

        expect(departure).toEqual({
            tripId: 'TRIP-00001',
            departureTime: '09:00',
            estimatedArrivalTime: '10:10',
            turnNumber: 1,
        });
    });

    it('returns the vehicle that trip names, and its own facilities', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [
                bus('BUS-00001', 'NB-1234', FULLY_EQUIPPED),
                bus('BUS-00002', 'NB-5678', NOT_EQUIPPED),
            ],
            trips: [trip('TRIP-00001', 'BUS-00002', '09:00')],
        });

        const { bus: vehicle } = optionFor(await search(db), 'TRIP-00001');

        expect(vehicle.busId).toBe('BUS-00002');
        expect(vehicle.numberPlate).toBe('NB-5678');
        expect(vehicle.accessibilityFacilities).toEqual(NOT_EQUIPPED);
    });
});

// ==================================================================
// B. THE SCORE TRAVELS, AND BELONGS TO ITS OWN VEHICLE
// ==================================================================
describe('the accessibility score on a journey option', () => {
    it('carries a score for the bus operating the trip', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-00001', 'NB-1234', FULLY_EQUIPPED)],
            trips: [trip('TRIP-00001', 'BUS-00001', '09:00')],
        });

        const { bus: vehicle } = optionFor(await search(db), 'TRIP-00001');

        // Taken from the shared function rather than written down, so this
        // test cannot become a second definition of the score.
        expect(vehicle.accessibilityScore).toBe(computeAccessibilityScore(FULLY_EQUIPPED));
        expect(typeof vehicle.accessibilityScore).toBe('number');
    });

    it('reports the same figure the booking flow already shows for that bus', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-00001', 'NB-1234', PARTLY_EQUIPPED)],
            trips: [trip('TRIP-00001', 'BUS-00001', '09:00')],
        });

        const { bus: vehicle } = optionFor(await search(db), 'TRIP-00001');

        // One definition of how accessible a bus is. A passenger comparing a
        // recommendation with the booking screen must not see two numbers.
        expect(vehicle.accessibilityScore).toBe(computeAccessibilityScore(PARTLY_EQUIPPED));
    });

    it('gives each departure the score of its own bus, never a neighbour own', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [
                bus('BUS-BEST', 'NB-1111', FULLY_EQUIPPED),
                bus('BUS-MIDDLING', 'NB-2222', PARTLY_EQUIPPED),
                bus('BUS-WORST', 'NB-3333', NOT_EQUIPPED),
            ],
            trips: [
                trip('TRIP-A', 'BUS-WORST', '09:00'),
                trip('TRIP-B', 'BUS-BEST', '09:30'),
                trip('TRIP-C', 'BUS-MIDDLING', '10:00'),
            ],
        });

        const json = await search(db);

        // Deliberately not in fleet order, so a mix-up by array position shows.
        expect(optionFor(json, 'TRIP-A').bus.busId).toBe('BUS-WORST');
        expect(optionFor(json, 'TRIP-A').bus.accessibilityScore).toBe(
            computeAccessibilityScore(NOT_EQUIPPED)
        );

        expect(optionFor(json, 'TRIP-B').bus.busId).toBe('BUS-BEST');
        expect(optionFor(json, 'TRIP-B').bus.accessibilityScore).toBe(
            computeAccessibilityScore(FULLY_EQUIPPED)
        );

        expect(optionFor(json, 'TRIP-C').bus.busId).toBe('BUS-MIDDLING');
        expect(optionFor(json, 'TRIP-C').bus.accessibilityScore).toBe(
            computeAccessibilityScore(PARTLY_EQUIPPED)
        );
    });

    it('keeps three departures on three different scores', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [
                bus('BUS-BEST', 'NB-1111', FULLY_EQUIPPED),
                bus('BUS-MIDDLING', 'NB-2222', PARTLY_EQUIPPED),
                bus('BUS-WORST', 'NB-3333', NOT_EQUIPPED),
            ],
            trips: [
                trip('TRIP-A', 'BUS-BEST', '09:00'),
                trip('TRIP-B', 'BUS-MIDDLING', '09:30'),
                trip('TRIP-C', 'BUS-WORST', '10:00'),
            ],
        });

        const scores = optionsOf(await search(db)).map((o: any) => o.bus.accessibilityScore);

        // Three distinct values: nothing collapsed onto one shared vehicle.
        expect(new Set(scores).size).toBe(3);
    });

    it('gives two departures on the SAME bus the same score', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-00001', 'NB-1234', PARTLY_EQUIPPED)],
            trips: [
                trip('TRIP-A', 'BUS-00001', '09:00'),
                trip('TRIP-B', 'BUS-00001', '11:00'),
            ],
        });

        const json = await search(db);
        const expected = computeAccessibilityScore(PARTLY_EQUIPPED);

        // The bus read is cached across trips; the score must be resolved from
        // that bus each time rather than from whichever trip got there first.
        expect(optionFor(json, 'TRIP-A').bus.accessibilityScore).toBe(expected);
        expect(optionFor(json, 'TRIP-B').bus.accessibilityScore).toBe(expected);
    });
});

// ==================================================================
// C. NOTHING IS INVENTED WHEN THE DATA IS NOT THERE
// ==================================================================
describe('a departure whose accessibility data is incomplete', () => {
    it('reports no bus at all when the trip names one that does not exist', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-00001', 'NB-1234', FULLY_EQUIPPED)],
            trips: [trip('TRIP-00001', 'BUS-MISSING', '09:00')],
        });

        const option = optionFor(await search(db), 'TRIP-00001');

        // No stand-in vehicle and no borrowed score. `bus: null` is what the
        // ranking layer reads as an unknown score rather than a bad one.
        expect(option.bus).toBeNull();
    });

    it('never lends one bus facilities to a trip whose bus is missing', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-PRESENT', 'NB-1111', FULLY_EQUIPPED)],
            trips: [
                trip('TRIP-OK', 'BUS-PRESENT', '09:00'),
                trip('TRIP-ORPHAN', 'BUS-GONE', '09:30'),
            ],
        });

        const json = await search(db);

        expect(optionFor(json, 'TRIP-OK').bus.accessibilityScore).toBe(
            computeAccessibilityScore(FULLY_EQUIPPED)
        );
        expect(optionFor(json, 'TRIP-ORPHAN').bus).toBeNull();
    });

    it('does not invent facilities for a bus record that has none', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-00001', 'NB-1234', undefined)],
            trips: [trip('TRIP-00001', 'BUS-00001', '09:00')],
        });

        const { bus: vehicle } = optionFor(await search(db), 'TRIP-00001');

        // The facilities are passed through as they were stored — absent — and
        // the score is whatever the shared function makes of that. Nothing is
        // filled in to make the vehicle look better than the record says.
        expect(vehicle.accessibilityFacilities).toBeUndefined();
        expect(vehicle.accessibilityScore).toBe(computeAccessibilityScore(undefined));
    });

    it('never turns missing accessibility data into a positive score', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-00001', 'NB-1234', undefined)],
            trips: [trip('TRIP-00001', 'BUS-00001', '09:00')],
        });

        const { bus: vehicle } = optionFor(await search(db), 'TRIP-00001');

        expect(vehicle.accessibilityScore).toBe(0);
    });
});

// ==================================================================
// D. THE RANKING LAYER CAN CONSUME THIS RESPONSE DIRECTLY
// ==================================================================
describe('the response feeds the MOV-87 ranking layer', () => {
    /** The adapter a caller writes: where each ranking fact lives. */
    const describeOption = (entry: { routeId: string; option: any }) => ({
        accessibilityScore: entry.option.bus?.accessibilityScore,
        departureTime: entry.option.trip.departureTime,
        routeId: entry.routeId,
        tripId: entry.option.trip.tripId,
    });

    function flatten(json: any) {
        return json.routes.flatMap((matched: any) =>
            matched.trips.map((option: any) => ({ routeId: matched.routeId, option }))
        );
    }

    it('ranks the most accessible departure first, from the response alone', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [
                bus('BUS-BEST', 'NB-1111', FULLY_EQUIPPED),
                bus('BUS-WORST', 'NB-3333', NOT_EQUIPPED),
            ],
            trips: [
                // The least accessible bus leaves first, so departure order and
                // recommended order genuinely differ.
                trip('TRIP-EARLY', 'BUS-WORST', '09:00'),
                trip('TRIP-LATER', 'BUS-BEST', '17:00'),
            ],
        });

        const ranked = rankJourneyOptions(flatten(await search(db)), describeOption);

        expect(ranked.map((entry) => entry.option.trip.tripId)).toEqual([
            'TRIP-LATER',
            'TRIP-EARLY',
        ]);
    });

    it('ranks a departure with no bus last, without dropping it', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-WORST', 'NB-3333', NOT_EQUIPPED)],
            trips: [
                trip('TRIP-ORPHAN', 'BUS-GONE', '09:00'),
                trip('TRIP-SCORED', 'BUS-WORST', '09:30'),
            ],
        });

        const ranked = rankJourneyOptions(flatten(await search(db)), describeOption);

        // A measured zero still outranks an unknown, and neither is discarded.
        expect(ranked.map((entry) => entry.option.trip.tripId)).toEqual([
            'TRIP-SCORED',
            'TRIP-ORPHAN',
        ]);
    });

    it('falls back to departure time for equally accessible departures', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [
                bus('BUS-A', 'NB-1111', PARTLY_EQUIPPED),
                bus('BUS-B', 'NB-2222', PARTLY_EQUIPPED),
            ],
            trips: [
                trip('TRIP-LATE', 'BUS-A', '16:00'),
                trip('TRIP-EARLY', 'BUS-B', '09:00'),
            ],
        });

        const ranked = rankJourneyOptions(flatten(await search(db)), describeOption);

        expect(ranked.map((entry) => entry.option.trip.tripId)).toEqual([
            'TRIP-EARLY',
            'TRIP-LATE',
        ]);
    });
});

// ==================================================================
// E. WHAT MOV-89 MUST NOT HAVE CHANGED
// ==================================================================
describe('the rest of journey search is untouched', () => {
    it('still returns departures earliest first, as the search always has', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [
                bus('BUS-BEST', 'NB-1111', FULLY_EQUIPPED),
                bus('BUS-WORST', 'NB-3333', NOT_EQUIPPED),
            ],
            trips: [
                trip('TRIP-LATER', 'BUS-BEST', '17:00'),
                trip('TRIP-EARLY', 'BUS-WORST', '09:00'),
            ],
        });

        const order = optionsOf(await search(db)).map((o: any) => o.trip.tripId);

        // MOV-89 makes ranking POSSIBLE; it does not reorder the response.
        // Applying the order is a separate change, and doing it here would
        // silently alter what every existing caller receives.
        expect(order).toEqual(['TRIP-EARLY', 'TRIP-LATER']);
    });

    it('still filters out departures before the requested time', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-00001', 'NB-1234', FULLY_EQUIPPED)],
            trips: [
                trip('TRIP-PAST', 'BUS-00001', '06:00'),
                trip('TRIP-UPCOMING', 'BUS-00001', '09:00'),
            ],
        });

        const ids = optionsOf(await search(db)).map((o: any) => o.trip.tripId);

        expect(ids).toEqual(['TRIP-UPCOMING']);
    });

    it('still carries the live status block for each option', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-00001', 'NB-1234', FULLY_EQUIPPED)],
            trips: [trip('TRIP-00001', 'BUS-00001', '09:00')],
        });

        const option = optionFor(await search(db), 'TRIP-00001');

        expect(option.liveStatus).toBeDefined();
        expect(option.liveStatus.available).toBe(false);
    });
});

// ==================================================================
// F. NOTHING PRIVATE TRAVELS WITH THE VEHICLE
// ==================================================================
describe('what the journey response does not expose', () => {
    it('carries only the agreed vehicle fields', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus('BUS-00001', 'NB-1234', FULLY_EQUIPPED)],
            trips: [trip('TRIP-00001', 'BUS-00001', '09:00')],
        });

        const { bus: vehicle } = optionFor(await search(db), 'TRIP-00001');

        // Built field by field rather than spread, so a column added to the
        // fleet record later cannot leak into a passenger response.
        expect(Object.keys(vehicle).sort()).toEqual([
            'accessibilityFacilities',
            'accessibilityScore',
            'busId',
            'busModel',
            'manufacturer',
            'numberPlate',
            'seatCapacity',
        ]);
    });

    it('leaves the fleet credential and internal fields behind', async () => {
        const stored = bus('BUS-00001', 'NB-1234', FULLY_EQUIPPED);
        // Generated, never written down — the project's existing scanner-safe
        // fixture, so no credential-shaped literal enters the repository.
        const configured = nextUniqueValue();

        const db = createFakeFirestore({
            routes: [route],
            // The fleet record carries a bus credential in production (MOV-265),
            // and internal columns besides. Neither may reach a passenger.
            buses: [{ ...stored, password: configured, chassisNumber: 'CHS-INTERNAL' }],
            trips: [trip('TRIP-00001', 'BUS-00001', '09:00')],
        });

        const json = await search(db);
        const whole = JSON.stringify(json);

        expect(whole).not.toContain(configured);
        expect(whole).not.toContain('CHS-INTERNAL');
        expect(optionFor(json, 'TRIP-00001').bus.password).toBeUndefined();
    });
});
