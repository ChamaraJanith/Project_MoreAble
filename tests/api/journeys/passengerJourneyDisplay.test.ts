// What a passenger actually SEES for a partial journey (MOV-88).
//
// WHY THIS FILE EXISTS.
// MOV-88's calculation layer was correct and thoroughly unit-tested, and the
// passenger UI was still wrong. Manual verification found both recommended
// routes on route 177 showing the full route's values:
//
//     Kaduwela -> Malabe        6:00 AM -> 7:10 AM   20 km   2 Stops
//     Kaduwela -> Rajagiriya    6:00 AM -> 7:10 AM   20 km   4 Stops
//
// 07:10 is when the bus reaches Kollupitiya and 20 km is the whole route, and
// neither passenger travels that far. The tested utilities never saw it, because
// the substitution happened above them: each screen fell back to
// `trip.estimatedArrivalTime` and `route.distanceKm` whenever the passenger's own
// figure was unknown.
//
// So these tests deliberately do not stop at the utility. They run the REAL
// search endpoint and push its response through the REAL view model — the same
// `toRecommendedJourneys` and `describeJourneyForDisplay` the screens render
// from — and assert on the rendered strings. A regression that reintroduces a
// whole-route fallback fails here even if every unit test still passes.
//
// No credential, session value or authentication data appears here. Journey
// search needs none, so none is fabricated.

import { POST } from '../../../app/api/journeys/search+api';
import { Bus } from '../../../src/entities/bus/model/types';
import { Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';
import { toRecommendedJourneys } from '../../../src/features/journey/utils/journeyRecommendations';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

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

jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(),
    getRouteThroughCoordinates: jest.fn(),
}));

// ------------------------------------------------------------------
// The real route 177 document, exactly as Firestore holds it.
//
//   index 0 Kaduwela   1 Malabe   2 Battaramulla
//   index 3 Rajagiriya 4 Borella  5 Kollupitiya
//
// The array is ZERO-BASED. Every expectation below is written in passenger terms
// — stop names and stop counts — so a zero-based index can never leak into an
// assertion and quietly become the expected output.
// ------------------------------------------------------------------
const ROUTE_ID = '177_KADUWELA_KOLLUPITIYA';

const STOPS = [
    'Kaduwela',
    'Malabe',
    'Battaramulla',
    'Rajagiriya',
    'Borella',
    'Kollupitiya',
];

//   Kaduwela -8m- Malabe -6m- Battaramulla -12m- Rajagiriya -15m- Borella -9m- Kollupitiya
const SEGMENTS = [8, 6, 12, 15, 9];

/** Stop coordinates, as the `stops` collection holds them. */
const STOP_DOCS = [
    { stopId: 'kaduwela', name: 'Kaduwela', latitude: 6.9333, longitude: 79.9833 },
    { stopId: 'malabe', name: 'Malabe', latitude: 6.9061, longitude: 79.9558 },
    { stopId: 'battaramulla', name: 'Battaramulla', latitude: 6.8994, longitude: 79.9186 },
    { stopId: 'rajagiriya', name: 'Rajagiriya', latitude: 6.9094, longitude: 79.8944 },
    { stopId: 'borella', name: 'Borella', latitude: 6.9147, longitude: 79.8778 },
    { stopId: 'kollupitiya', name: 'Kollupitiya', latitude: 6.9167, longitude: 79.85 },
];

function routeDoc(overrides: Partial<Route> = {}): Route & { id: string } {
    return {
        id: ROUTE_ID,
        routeId: ROUTE_ID,
        routeNumber: '177',
        routeName: 'Kaduwela - Kollupitiya',
        startLocation: 'Kaduwela',
        endLocation: 'Kollupitiya',
        stops: STOPS,
        // The whole route, end to end. Correct for a Kaduwela -> Kollupitiya
        // passenger and for nobody else.
        distanceKm: 20,
        estimatedDuration: '1h 10m',
        segmentDurationsMinutes: SEGMENTS,
        status: 'ACTIVE',
        ...overrides,
    };
}

const bus: Bus & { id: string } = {
    id: 'BUS-1',
    busId: 'BUS-1',
    numberPlate: 'NB-1234',
    chassisNumber: 'CHS-BUS-1',
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
        guardianSeats: { available: false, count: 0 },
        prioritySeats: { available: true, count: 4 },
        elderlySeats: { available: false, count: 0 },
    },
    status: 'ACTIVE',
};

/** The 6:00 AM departure from the screenshots, reaching Kollupitiya at 7:10. */
const trip: Trip & { id: string } = {
    id: 'TRIP-1',
    tripId: 'TRIP-1',
    routeId: ROUTE_ID,
    busId: 'BUS-1',
    departureTime: '06:00',
    estimatedArrivalTime: '07:10',
    turnNumber: 1,
    status: 'ACTIVE',
};

/**
 * Runs the real endpoint and returns what the passenger screens render.
 *
 * `display` is the very object `JourneyOptionCard` and `RouteDetailsScreen`
 * destructure, so these assertions are the screens' own output rather than a
 * restatement of it.
 */
async function view(
    origin: string,
    destination: string,
    route: Route & { id: string } = routeDoc()
) {
    mockGetAdminDb.mockReturnValue(
        createFakeFirestore({ routes: [route], buses: [bus], trips: [trip], stops: STOP_DOCS })
    );

    const response = await POST(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origin,
                destination,
                travelDate: '2026-08-25',
                travelTime: '05:00',
            }),
        })
    );

    const json = await response.json();
    const journeys = toRecommendedJourneys(json.routes ?? []);

    return { json, journeys, display: journeys[0]?.display, timing: journeys[0]?.timing };
}

beforeEach(() => {
    jest.clearAllMocks();

    mockGeocodeLocation.mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    mockGetRoute.mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
    mockGetRouteThrough.mockResolvedValue({ distanceKm: 18.4, durationMinutes: 55 });
});

// ==================================================================
// A. THE TWO JOURNEYS FROM THE SCREENSHOTS
// ==================================================================
describe('the journeys that were reported wrong', () => {
    it('shows Kaduwela to Malabe as its own 8-minute journey', async () => {
        const { display } = await view('Kaduwela', 'Malabe');

        // Boards at the route's first stop, so 6:00 is genuinely theirs.
        expect(display.departureLabel).toBe('6:00 AM');
        // 6:00 + 8. Emphatically not 7:10, which is Kollupitiya.
        expect(display.arrivalLabel).toBe('6:08 AM');
        expect(display.durationLabel).toBe('8m');
        expect(display.stopCount).toBe(2);
    });

    it('shows Kaduwela to Rajagiriya as its own 26-minute journey', async () => {
        const { display } = await view('Kaduwela', 'Rajagiriya');

        // 8 + 6 + 12
        expect(display.departureLabel).toBe('6:00 AM');
        expect(display.arrivalLabel).toBe('6:26 AM');
        expect(display.durationLabel).toBe('26m');
        expect(display.stopCount).toBe(4);
    });

    it('no longer shows the two journeys as identical', async () => {
        const short = (await view('Kaduwela', 'Malabe')).display;
        const longer = (await view('Kaduwela', 'Rajagiriya')).display;

        // The exact failure that was reported: both cards reading the same.
        expect(short.arrivalLabel).not.toBe(longer.arrivalLabel);
        expect(short.durationLabel).not.toBe(longer.durationLabel);
        expect(short.distanceLabel).not.toBe(longer.distanceLabel);
    });

    it('never shows the route arrival at Kollupitiya to a passenger not going there', async () => {
        for (const [origin, destination] of [
            ['Kaduwela', 'Malabe'],
            ['Kaduwela', 'Rajagiriya'],
            ['Malabe', 'Battaramulla'],
        ]) {
            const { display } = await view(origin, destination);

            expect(display.arrivalLabel).not.toBe('7:10 AM');
        }
    });

    it('never shows the full 20 km route distance to a passenger not travelling it', async () => {
        for (const [origin, destination] of [
            ['Kaduwela', 'Malabe'],
            ['Kaduwela', 'Rajagiriya'],
            ['Malabe', 'Borella'],
        ]) {
            const { display } = await view(origin, destination);

            expect(display.distanceLabel).not.toBe('20 km');
        }
    });
});

// ==================================================================
// B. THE WORKED EXAMPLE FROM THE TICKET
// ==================================================================
describe('a passenger boarding mid-route', () => {
    it('shows Malabe to Borella as 6:08 AM to 6:41 AM, 33m', async () => {
        // Boarding: 06:00 + 8. Journey: 6 + 12 + 15 = 33. Arrival: 06:41.
        const { display } = await view('Malabe', 'Borella');

        expect(display.departureLabel).toBe('6:08 AM');
        expect(display.arrivalLabel).toBe('6:41 AM');
        expect(display.durationLabel).toBe('33m');
        expect(display.stopCount).toBe(4);
    });

    it('shows Rajagiriya to Kollupitiya from the last two segments', async () => {
        // Boarding: 06:00 + 8 + 6 + 12 = 06:26. Journey: 15 + 9 = 24.
        const { display } = await view('Rajagiriya', 'Kollupitiya');

        expect(display.departureLabel).toBe('6:26 AM');
        expect(display.arrivalLabel).toBe('6:50 AM');
        expect(display.durationLabel).toBe('24m');
        expect(display.stopCount).toBe(3);
    });

    it('sums only the segments crossed, for every pair on the route', async () => {
        const expected: [string, string, string, number][] = [
            // origin, destination, duration, stops
            ['Kaduwela', 'Malabe', '8m', 2],
            ['Kaduwela', 'Battaramulla', '14m', 3],
            ['Kaduwela', 'Rajagiriya', '26m', 4],
            ['Kaduwela', 'Borella', '41m', 5],
            ['Kaduwela', 'Kollupitiya', '50m', 6],
            ['Malabe', 'Battaramulla', '6m', 2],
            ['Malabe', 'Rajagiriya', '18m', 3],
            ['Malabe', 'Borella', '33m', 4],
            ['Battaramulla', 'Borella', '27m', 3],
            ['Rajagiriya', 'Kollupitiya', '24m', 3],
        ];

        for (const [origin, destination, duration, stopCount] of expected) {
            const { display } = await view(origin, destination);

            expect([origin, destination, display.durationLabel, display.stopCount]).toEqual([
                origin,
                destination,
                duration,
                stopCount,
            ]);
        }
    });
});

// ==================================================================
// C. THE FULL ROUTE STILL BEHAVES AS IT DID
// ==================================================================
describe('a passenger travelling the whole route', () => {
    it('shows the route end to end with the route own distance', async () => {
        const { display } = await view('Kaduwela', 'Kollupitiya');

        expect(display.departureLabel).toBe('6:00 AM');
        expect(display.travelsWholeRoute).toBe(true);
        expect(display.stopCount).toBe(6);
        // The operator's own recorded total, unchanged.
        expect(display.distanceLabel).toBe('20 km');
    });

    it('falls back to the trip scheduled duration when the route has no timings', async () => {
        // For this passenger the whole route IS the journey, so 06:00 -> 07:10
        // is theirs rather than a stand-in for it.
        const { display, timing } = await view(
            'Kaduwela',
            'Kollupitiya',
            routeDoc({ segmentDurationsMinutes: null })
        );

        expect(display.departureLabel).toBe('6:00 AM');
        expect(display.arrivalLabel).toBe('7:10 AM');
        expect(display.durationLabel).toBe('1h 10m');
        expect(timing.source).toBe('WHOLE_ROUTE_SCHEDULE');
        expect(display.distanceLabel).toBe('20 km');
    });
});

// ==================================================================
// D. WHEN THE TIMINGS ARE MISSING, NOTHING IS SUBSTITUTED
//
// This is the state the reported route was actually in: the field had never been
// filled in. The honest answer is an absent value, and specifically NOT the
// route's own end-to-end figures.
// ==================================================================
describe('a partial journey on a route with no configured timings', () => {
    const untimed = () => routeDoc({ segmentDurationsMinutes: null });

    it('reports no duration rather than the route total', async () => {
        const { display, timing } = await view('Kaduwela', 'Rajagiriya', untimed());

        expect(display.durationLabel).toBeNull();
        expect(timing.source).toBe('UNKNOWN');
        expect(display.hasIncompleteTimes).toBe(true);
    });

    it('reports no arrival time rather than the route arrival', async () => {
        const { display } = await view('Kaduwela', 'Rajagiriya', untimed());

        // 7:10 belongs to Kollupitiya. Showing it here is the reported bug.
        expect(display.arrivalLabel).toBeNull();
    });

    it('still shows the departure when the passenger boards at the first stop', async () => {
        const { display } = await view('Kaduwela', 'Rajagiriya', untimed());

        // The trip leaves Kaduwela at 06:00, so for this passenger that time is
        // a fact rather than a substitute.
        expect(display.departureLabel).toBe('6:00 AM');
    });

    it('still shows the arrival when the passenger alights at the last stop', async () => {
        const { display } = await view('Rajagiriya', 'Kollupitiya', untimed());

        expect(display.arrivalLabel).toBe('7:10 AM');
        expect(display.departureLabel).toBeNull();
        expect(display.durationLabel).toBeNull();
    });

    it('shows neither time for a journey between two middle stops', async () => {
        const { display } = await view('Malabe', 'Borella', untimed());

        expect(display.departureLabel).toBeNull();
        expect(display.arrivalLabel).toBeNull();
        expect(display.durationLabel).toBeNull();
    });

    it('still shows the measured distance, which needs no timings', async () => {
        const { display } = await view('Kaduwela', 'Rajagiriya', untimed());

        expect(display.distanceLabel).not.toBeNull();
        expect(display.distanceLabel).not.toBe('20 km');
    });

    it('reports no duration when only one crossed segment is untimed', async () => {
        // Battaramulla -> Rajagiriya unmeasured, so Malabe -> Borella crosses a
        // gap nobody has timed. A partial sum would understate the journey.
        const { display } = await view(
            'Malabe',
            'Borella',
            routeDoc({ segmentDurationsMinutes: [8, 6, null, 15, 9] })
        );

        expect(display.durationLabel).toBeNull();
    });

    it('still measures a journey that avoids the untimed segment', async () => {
        const { display } = await view(
            'Kaduwela',
            'Battaramulla',
            routeDoc({ segmentDurationsMinutes: [8, 6, null, 15, 9] })
        );

        expect(display.durationLabel).toBe('14m');
    });
});

// ==================================================================
// E. DISTANCE
// ==================================================================
describe('journey distance', () => {
    it('measures a partial journey over the stops actually travelled', async () => {
        const short = (await view('Kaduwela', 'Malabe')).json.routes[0];
        const longer = (await view('Kaduwela', 'Rajagiriya')).json.routes[0];

        expect(short.journeyDistanceKm).toBeGreaterThan(0);
        // A longer ride along the same route cannot be shorter.
        expect(longer.journeyDistanceKm).toBeGreaterThan(short.journeyDistanceKm);
        // And neither is the whole route.
        expect(short.journeyDistanceKm).toBeLessThan(20);
        expect(longer.journeyDistanceKm).toBeLessThan(20);
    });

    it('adds up consistently along the route', async () => {
        const a = (await view('Kaduwela', 'Malabe')).json.routes[0].journeyDistanceKm;
        const b = (await view('Malabe', 'Battaramulla')).json.routes[0].journeyDistanceKm;
        const whole = (await view('Kaduwela', 'Battaramulla')).json.routes[0].journeyDistanceKm;

        // Rounding is to one decimal per measurement, so allow for it.
        expect(Math.abs(a + b - whole)).toBeLessThanOrEqual(0.2);
    });

    it('leaves the route own total untouched for the admin screens', async () => {
        const matched = (await view('Kaduwela', 'Malabe')).json.routes[0];

        expect(matched.distanceKm).toBe(20);
        expect(matched.estimatedDuration).toBe('1h 10m');
    });

    it('reports no distance rather than an estimate when a stop has no coordinates', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                routes: [routeDoc()],
                buses: [bus],
                trips: [trip],
                // Battaramulla is missing, so a Kaduwela -> Rajagiriya path
                // cannot be measured end to end.
                stops: STOP_DOCS.filter((stop) => stop.name !== 'Battaramulla'),
            })
        );

        const response = await POST(
            new Request('http://localhost/api/journeys/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    origin: 'Kaduwela',
                    destination: 'Rajagiriya',
                    travelDate: '2026-08-25',
                    travelTime: '05:00',
                }),
            })
        );

        const json = await response.json();
        const journeys = toRecommendedJourneys(json.routes ?? []);

        // Never the route total scaled by a fraction of the stops.
        expect(json.routes[0].journeyDistanceKm).toBeNull();
        expect(journeys[0].display.distanceLabel).toBeNull();
    });
});

// ==================================================================
// F. STOP COUNT IS A COUNT, NEVER A ZERO-BASED INDEX
// ==================================================================
describe('the stop count shown to a passenger', () => {
    it('counts the stops on the journey, both endpoints included', async () => {
        // Kaduwela is index 0 and Malabe index 1; the passenger sees 2 stops.
        expect((await view('Kaduwela', 'Malabe')).display.stopCount).toBe(2);
        // Indexes 0..3 is four stops, not three and not "3".
        expect((await view('Kaduwela', 'Rajagiriya')).display.stopCount).toBe(4);
    });

    it('is never the destination index', async () => {
        const { display, json } = await view('Rajagiriya', 'Kollupitiya');

        // Rajagiriya is index 3 and Kollupitiya index 5: three stops travelled.
        expect(display.stopCount).toBe(3);
        expect(json.routes[0].journeyStops).toEqual(['Rajagiriya', 'Borella', 'Kollupitiya']);
    });

    it('matches the stops the response says are travelled', async () => {
        for (const [origin, destination] of [
            ['Kaduwela', 'Malabe'],
            ['Kaduwela', 'Rajagiriya'],
            ['Malabe', 'Borella'],
            ['Kaduwela', 'Kollupitiya'],
        ]) {
            const { display, json } = await view(origin, destination);

            expect(display.stopCount).toBe(json.routes[0].journeyStops.length);
            expect(json.routes[0].journeyStops[0]).toBe(origin);
            expect(json.routes[0].journeyStops[display.stopCount - 1]).toBe(destination);
        }
    });
});

// ==================================================================
// G. INVALID JOURNEYS ARE REFUSED BEFORE THEY CAN BE MEASURED
// ==================================================================
describe('journeys that are not travellable', () => {
    it('matches no route when the destination comes before the origin', async () => {
        // The search itself requires originIndex < destinationIndex, so a
        // reversed pair can never reach the timing layer with negative minutes.
        const { json, journeys } = await view('Rajagiriya', 'Malabe');

        expect(json.routes).toEqual([]);
        expect(journeys).toEqual([]);
    });

    it('rejects a journey that starts and ends at the same stop', async () => {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({ routes: [routeDoc()], buses: [bus], trips: [trip], stops: STOP_DOCS })
        );

        const response = await POST(
            new Request('http://localhost/api/journeys/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    origin: 'Malabe',
                    destination: 'Malabe',
                    travelDate: '2026-08-25',
                    travelTime: '05:00',
                }),
            })
        );

        expect(response.status).toBe(400);
    });

    it('never produces a negative duration', async () => {
        for (const [origin, destination] of [
            ['Kaduwela', 'Malabe'],
            ['Malabe', 'Borella'],
            ['Kaduwela', 'Kollupitiya'],
        ]) {
            const { timing } = await view(origin, destination);

            expect(timing.durationMinutes).toBeGreaterThan(0);
        }
    });
});

// ==================================================================
// H. MOV-87 AND MOV-89 ARE UNAFFECTED
// ==================================================================
describe('ranking and accessibility survive the journey-specific values', () => {
    const secondBus: Bus & { id: string } = {
        ...bus,
        id: 'BUS-2',
        busId: 'BUS-2',
        numberPlate: 'NB-9999',
        chassisNumber: 'CHS-BUS-2',
        accessibilityFacilities: {
            wheelchairRamp: false,
            audioAnnouncement: false,
            lowFloorVehicle: false,
            walkingAssistance: false,
            wheelchairSpace: { available: false, count: 0 },
            guardianSeats: { available: false, count: 0 },
            prioritySeats: { available: false, count: 0 },
            elderlySeats: { available: false, count: 0 },
        },
    };

    /** The less accessible bus leaves first, so the two orders really differ. */
    const trips: (Trip & { id: string })[] = [
        { ...trip, id: 'TRIP-EARLY', tripId: 'TRIP-EARLY', busId: 'BUS-2', departureTime: '06:00' },
        { ...trip, id: 'TRIP-LATER', tripId: 'TRIP-LATER', busId: 'BUS-1', departureTime: '09:00' },
    ];

    async function rankedFor(origin: string, destination: string) {
        mockGetAdminDb.mockReturnValue(
            createFakeFirestore({
                routes: [routeDoc()],
                buses: [bus, secondBus],
                trips,
                stops: STOP_DOCS,
            })
        );

        const response = await POST(
            new Request('http://localhost/api/journeys/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    origin,
                    destination,
                    travelDate: '2026-08-25',
                    travelTime: '05:00',
                }),
            })
        );

        const json = await response.json();
        return toRecommendedJourneys(json.routes ?? []);
    }

    it('still puts the most accessible departure first on a partial journey', async () => {
        const ranked = await rankedFor('Kaduwela', 'Rajagiriya');

        expect(ranked.map((entry) => entry.option.trip.tripId)).toEqual([
            'TRIP-LATER',
            'TRIP-EARLY',
        ]);
    });

    it('keeps every departure available for comparison', async () => {
        const ranked = await rankedFor('Kaduwela', 'Rajagiriya');

        expect(ranked).toHaveLength(2);
    });

    it('keeps each score with its own bus', async () => {
        const ranked = await rankedFor('Kaduwela', 'Rajagiriya');

        const byTrip = new Map(
            ranked.map((entry) => [entry.option.trip.tripId, entry.option.bus?.numberPlate])
        );

        expect(byTrip.get('TRIP-LATER')).toBe('NB-1234');
        expect(byTrip.get('TRIP-EARLY')).toBe('NB-9999');
        // Nothing here recomputes the figure; it only has to stay attached.
        expect(ranked[0].accessibilityScore).toBeGreaterThan(
            ranked[1].accessibilityScore as number
        );
    });

    it('gives both departures the same journey-specific duration', async () => {
        // The duration belongs to the route segment, not to the vehicle, so
        // ranking must not change it.
        const ranked = await rankedFor('Kaduwela', 'Rajagiriya');

        expect(ranked.map((entry) => entry.display.durationLabel)).toEqual(['26m', '26m']);
    });

    it('reports a direct journey as having no transfer', async () => {
        const { timing } = await view('Kaduwela', 'Rajagiriya');

        expect(timing.transferCount).toBe(0);
    });
});
