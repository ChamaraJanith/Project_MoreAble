// The facility database, from the stored document to the passenger (MOV-109).
//
// The connection this story is about already exists, so nothing here builds a
// new one: a bus document holds `accessibilityFacilities`, the admin CRUD API
// writes it, `loadBus` reads it through its per-request memo, and the journey
// search hands the whole object to the passenger alongside the score derived
// from it. Several suites already prove parts of that:
//
//   * MOV-105 `transportDatabase.test.ts` — a bus created through the admin API
//     is read back by the search from the same database.
//   * MOV-89 `recommendedRouteData.test.ts` — a departure carries its own
//     vehicle's facilities, never a neighbour's, and never invented ones.
//   * `buses+api.route.test.ts` — every facility is stored exactly as supplied.
//
// What none of them covers is the FIDELITY of the transfer for the shapes a
// real fleet actually contains:
//
//   1. Each facility MOV-78 names, checked one at a time, so a field that
//      silently stopped travelling could not hide behind the seven others.
//   2. The counted facilities — `prioritySeats` and `wheelchairSpace` — whose
//      `available`/`count` pair can be flattened, rounded or repaired in
//      transit without any existing assertion noticing.
//   3. A record written before the field settled: partial, or holding a stale
//      count. Retrieval REPORTS what is stored; it does not tidy it up.
//   4. Two vehicles in one response, each keeping its own complete record —
//      asserted on the facility objects themselves rather than on the scores
//      derived from them.
//   5. That the very object delivered is the one MOV-79's score and MOV-92's
//      filter act on, so the database and its two consumers cannot drift.
//
// No score is written down: expectations come from `computeAccessibilityScore`.
// No facility rule is re-implemented. No credential literal appears — the one
// test that needs a bus password builds it with the project's existing
// `buildTestPassword()` helper.

import { POST as createBus } from '../../../app/api/buses/index+api';
import { POST as search } from '../../../app/api/journeys/search+api';
import { BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import {
    AccessibilityRequirementKey,
    computeAccessibilityScore,
    meetsAccessibilityRequirement,
} from '../../../src/shared/utils/accessibility';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import {
    FULLY_EQUIPPED,
    makeBus,
    makeRoute,
    makeStop,
    makeTrip,
    NOT_EQUIPPED,
    PARTLY_EQUIPPED,
} from '../../testUtils/journeyFixtures';
import { buildTestPassword } from '../../testUtils/testPassword';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// The map providers play no part in storing or retrieving a facility.
jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(),
    getRouteThroughCoordinates: jest.fn(),
}));

const mockGeocodeLocation = geocodeLocation as jest.MockedFunction<typeof geocodeLocation>;
const mockGetRoute = getRouteBetweenCoordinates as jest.MockedFunction<
    typeof getRouteBetweenCoordinates
>;
const mockGetRouteThrough = getRouteThroughCoordinates as jest.MockedFunction<
    typeof getRouteThroughCoordinates
>;

const ROUTE_ID = 'ROUTE-177';
const STOPS = ['Kaduwela', 'Malabe', 'Battaramulla', 'Borella'];

const route = makeRoute(ROUTE_ID, STOPS, { routeNumber: '177', distanceKm: 20 });

const STOP_DOCS = [
    makeStop('Kaduwela', 6.9333, 79.9833),
    makeStop('Malabe', 6.9061, 79.9558),
    makeStop('Battaramulla', 6.8994, 79.9186),
    makeStop('Borella', 6.9147, 79.8778),
];

interface Fleet {
    buses: any[];
    trips: any[];
}

async function searchWith(fleet: Fleet) {
    mockGetAdminDb.mockReturnValue(
        createFakeFirestore({
            routes: [route],
            buses: fleet.buses,
            trips: fleet.trips,
            stops: STOP_DOCS,
        })
    );

    const response = await search(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origin: 'Kaduwela',
                destination: 'Borella',
                travelDate: '2026-08-25',
                travelTime: '05:00',
            }),
        })
    );

    return { response, json: await response.json() };
}

/** The departure a passenger would read, straight off the HTTP response. */
function optionFor(json: any, tripId: string) {
    const option = (json.routes ?? [])
        .flatMap((match: any) => match.trips ?? [])
        .find((entry: any) => entry.trip.tripId === tripId);

    expect(option).toBeDefined();
    return option;
}

/** One bus, one departure, and the facilities it reaches the passenger with. */
async function deliveredFacilities(
    facilities: unknown
): Promise<BusAccessibilityFacilities | undefined> {
    const { json } = await searchWith({
        buses: [makeBus('BUS-UNDER-TEST', 'NB-9001', facilities as BusAccessibilityFacilities)],
        trips: [makeTrip('TRIP-UNDER-TEST', ROUTE_ID, 'BUS-UNDER-TEST', '08:00')],
    });

    return optionFor(json, 'TRIP-UNDER-TEST').bus?.accessibilityFacilities;
}

beforeEach(() => {
    jest.clearAllMocks();

    mockGeocodeLocation.mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    mockGetRoute.mockResolvedValue({ distanceKm: 20, durationMinutes: 60 });
    mockGetRouteThrough.mockResolvedValue({ distanceKm: 20, durationMinutes: 60 });
});

// ==================================================================
// 1. EVERY FACILITY MOV-78 NAMES SURVIVES THE JOURNEY
// ==================================================================
describe('each stored facility reaches the passenger', () => {
    // The five the story names, under the field names the record actually uses.
    // Checked one at a time: a field that quietly stopped travelling would
    // otherwise hide behind the ones that still do.
    const BOOLEAN_FACILITIES: ['wheelchairRamp' | 'audioAnnouncement' | 'lowFloorVehicle', string][] =
        [
            ['wheelchairRamp', 'Wheelchair Ramp'],
            ['audioAnnouncement', 'Audio Announcement'],
            ['lowFloorVehicle', 'Low Floor'],
        ];

    it.each(BOOLEAN_FACILITIES)('delivers %s when it is the only one recorded', async (field) => {
        const delivered = await deliveredFacilities({ ...NOT_EQUIPPED, [field]: true });

        expect(delivered?.[field]).toBe(true);

        // And nothing else was switched on in transit.
        for (const [other] of BOOLEAN_FACILITIES) {
            if (other !== field) expect(delivered?.[other]).toBe(false);
        }
    });

    it('delivers priority seats with their availability and their count', async () => {
        const delivered = await deliveredFacilities({
            ...NOT_EQUIPPED,
            prioritySeats: { available: true, count: 4 },
        });

        // The pair travels whole: a flattened boolean would lose the count and a
        // count alone would lose what governs.
        expect(delivered?.prioritySeats).toEqual({ available: true, count: 4 });
    });

    it('delivers wheelchair space with its availability and its count', async () => {
        const delivered = await deliveredFacilities({
            ...NOT_EQUIPPED,
            wheelchairSpace: { available: true, count: 2 },
        });

        expect(delivered?.wheelchairSpace).toEqual({ available: true, count: 2 });
    });

    it('delivers a fully equipped vehicle exactly as recorded', async () => {
        expect(await deliveredFacilities(FULLY_EQUIPPED)).toEqual(FULLY_EQUIPPED);
    });

    it('delivers a vehicle with nothing recorded exactly as recorded', async () => {
        // Every flag false and every count zero is a MEASUREMENT — the vehicle
        // was assessed — and must arrive as one rather than as an absence.
        expect(await deliveredFacilities(NOT_EQUIPPED)).toEqual(NOT_EQUIPPED);
    });

    it('survives the real admin write, not only a seeded document', async () => {
        const db = createFakeFirestore({ routes: [route], stops: STOP_DOCS });
        mockGetAdminDb.mockReturnValue(db);

        const created = await (
            await createBus(
                new Request('http://localhost/api/buses', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        // Built at run time by the project's helper; never a literal.
                        password: buildTestPassword('fleet'),
                        numberPlate: 'NB-9100',
                        chassisNumber: 'CHS-2026-09100',
                        busModel: 'Ashok Leyland Viking',
                        manufacturer: 'Ashok Leyland',
                        manufactureYear: 2025,
                        seatCapacity: 54,
                        accessibilityFacilities: FULLY_EQUIPPED,
                    }),
                })
            )
        ).json();

        expect(created.success).toBe(true);

        // The same database the admin just wrote into.
        db.collection('trips').doc('TRIP-ADMIN').set(
            makeTrip('TRIP-ADMIN', ROUTE_ID, created.bus.busId, '08:00')
        );

        const response = await search(
            new Request('http://localhost/api/journeys/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    origin: 'Kaduwela',
                    destination: 'Borella',
                    travelDate: '2026-08-25',
                    travelTime: '05:00',
                }),
            })
        );

        const json = await response.json();
        const { bus } = optionFor(json, 'TRIP-ADMIN');

        expect(bus.accessibilityFacilities).toEqual(FULLY_EQUIPPED);
        // The credential the admin set stays behind, as it always must.
        expect(bus.password).toBeUndefined();
        expect(bus.passwordHash).toBeUndefined();
    });
});

// ==================================================================
// 2. RETRIEVAL REPORTS WHAT IS STORED — IT DOES NOT TIDY IT UP
// ==================================================================
describe('records the fleet may already hold', () => {
    it('carries a partial record through without inventing the missing fields', async () => {
        // A document written before the shape settled: some keys, not all.
        const delivered = await deliveredFacilities({
            wheelchairRamp: true,
            prioritySeats: { available: true, count: 2 },
        });

        expect(delivered).toEqual({
            wheelchairRamp: true,
            prioritySeats: { available: true, count: 2 },
        });
        // Absent is absent. A defaulted `false` here would be the database
        // asserting something nobody recorded.
        expect(delivered).not.toHaveProperty('lowFloorVehicle');
        expect(delivered).not.toHaveProperty('wheelchairSpace');
    });

    it('delivers a stale count exactly as stored, without repairing it', async () => {
        // A decommissioned bay leaves its count behind. Retrieval is not the
        // place that decides what that means — the readers already do, by
        // testing `available`.
        const delivered = await deliveredFacilities({
            ...NOT_EQUIPPED,
            wheelchairSpace: { available: false, count: 6 },
        });

        expect(delivered?.wheelchairSpace).toEqual({ available: false, count: 6 });
    });

    it('delivers a bus with no facility block at all without failing the search', async () => {
        const { response, json } = await searchWith({
            buses: [makeBus('BUS-LEGACY', 'NB-9002', undefined)],
            trips: [makeTrip('TRIP-LEGACY', ROUTE_ID, 'BUS-LEGACY', '08:00')],
        });

        const option = optionFor(json, 'TRIP-LEGACY');

        expect(response.status).toBe(200);
        expect(option.bus.busId).toBe('BUS-LEGACY');
        expect(option.bus.accessibilityFacilities).toBeUndefined();
        // Derived, never written down: an unassessed vehicle scores what the
        // shared function says it scores.
        expect(option.bus.accessibilityScore).toBe(computeAccessibilityScore(undefined));
    });
});

// ==================================================================
// 3. ONE RESPONSE, SEVERAL VEHICLES, NO CROSSED WIRES
// ==================================================================
describe('several vehicles in one response', () => {
    const threeBuses: Fleet = {
        buses: [
            makeBus('BUS-FULL', 'NB-9003', FULLY_EQUIPPED),
            makeBus('BUS-PARTLY', 'NB-9004', PARTLY_EQUIPPED),
            makeBus('BUS-NONE', 'NB-9005', NOT_EQUIPPED),
        ],
        trips: [
            makeTrip('TRIP-FULL', ROUTE_ID, 'BUS-FULL', '08:00'),
            makeTrip('TRIP-PARTLY', ROUTE_ID, 'BUS-PARTLY', '08:30'),
            makeTrip('TRIP-NONE', ROUTE_ID, 'BUS-NONE', '09:00'),
        ],
    };

    it('gives each departure its own vehicle facility record, in full', async () => {
        const { json } = await searchWith(threeBuses);

        // Asserted on the facility objects themselves. Three different vehicles
        // can share a score without sharing a record, so a score comparison
        // would not catch a swapped one.
        expect(optionFor(json, 'TRIP-FULL').bus.accessibilityFacilities).toEqual(FULLY_EQUIPPED);
        expect(optionFor(json, 'TRIP-PARTLY').bus.accessibilityFacilities).toEqual(PARTLY_EQUIPPED);
        expect(optionFor(json, 'TRIP-NONE').bus.accessibilityFacilities).toEqual(NOT_EQUIPPED);
    });

    it('does not let one vehicle facility record stand in for another', async () => {
        const { json } = await searchWith(threeBuses);

        const full = optionFor(json, 'TRIP-FULL').bus.accessibilityFacilities;
        const partly = optionFor(json, 'TRIP-PARTLY').bus.accessibilityFacilities;

        expect(partly).not.toEqual(full);
        expect(partly.wheelchairRamp).toBe(true);
        expect(partly.audioAnnouncement).toBe(false);
    });

    it('gives two departures on the same vehicle the same facility record', async () => {
        // The bus is read once per request and memoised; both departures must
        // still receive that vehicle's own record, complete.
        const { json } = await searchWith({
            buses: [makeBus('BUS-SHARED', 'NB-9006', PARTLY_EQUIPPED)],
            trips: [
                makeTrip('TRIP-EARLY', ROUTE_ID, 'BUS-SHARED', '08:00'),
                makeTrip('TRIP-LATE', ROUTE_ID, 'BUS-SHARED', '09:00'),
            ],
        });

        expect(optionFor(json, 'TRIP-EARLY').bus.accessibilityFacilities).toEqual(PARTLY_EQUIPPED);
        expect(optionFor(json, 'TRIP-LATE').bus.accessibilityFacilities).toEqual(PARTLY_EQUIPPED);
    });
});

// ==================================================================
// 4. THE DELIVERED RECORD IS THE ONE ITS CONSUMERS ACT ON
// ==================================================================
describe('what the delivered facilities feed', () => {
    it('scores every departure from the facilities delivered with it', async () => {
        const { json } = await searchWith({
            buses: [
                makeBus('BUS-FULL', 'NB-9007', FULLY_EQUIPPED),
                makeBus('BUS-PARTLY', 'NB-9008', PARTLY_EQUIPPED),
                makeBus('BUS-NONE', 'NB-9009', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('TRIP-FULL', ROUTE_ID, 'BUS-FULL', '08:00'),
                makeTrip('TRIP-PARTLY', ROUTE_ID, 'BUS-PARTLY', '08:30'),
                makeTrip('TRIP-NONE', ROUTE_ID, 'BUS-NONE', '09:00'),
            ],
        });

        for (const tripId of ['TRIP-FULL', 'TRIP-PARTLY', 'TRIP-NONE']) {
            const { bus } = optionFor(json, tripId);

            // MOV-79's figure, over the record in the same response — not a
            // number this file decides, and not another vehicle's record.
            expect(bus.accessibilityScore).toBe(
                computeAccessibilityScore(bus.accessibilityFacilities)
            );
        }
    });

    it('answers a filtered search from the same stored record', async () => {
        const fleet: Fleet = {
            buses: [
                makeBus('BUS-RAMP', 'NB-9010', { ...NOT_EQUIPPED, wheelchairRamp: true }),
                makeBus('BUS-NONE', 'NB-9011', NOT_EQUIPPED),
            ],
            trips: [
                makeTrip('TRIP-RAMP', ROUTE_ID, 'BUS-RAMP', '08:00'),
                makeTrip('TRIP-NONE', ROUTE_ID, 'BUS-NONE', '08:30'),
            ],
        };

        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                routes: [route],
                buses: fleet.buses,
                trips: fleet.trips,
                stops: STOP_DOCS,
            })
        );

        const response = await search(
            new Request('http://localhost/api/journeys/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    origin: 'Kaduwela',
                    destination: 'Borella',
                    travelDate: '2026-08-25',
                    travelTime: '05:00',
                    accessibilityRequirements: ['wheelchairRamp'],
                }),
            })
        );

        const json = await response.json();
        const { bus } = optionFor(json, 'TRIP-RAMP');

        // The vehicle the filter kept is the vehicle whose delivered record
        // satisfies the requirement — the database, the filter (MOV-92) and the
        // passenger are all reading the same thing.
        expect(
            meetsAccessibilityRequirement(
                bus.accessibilityFacilities,
                'wheelchairRamp' as AccessibilityRequirementKey
            )
        ).toBe(true);
        expect(bus.accessibilityFacilities.wheelchairRamp).toBe(true);
    });
});
