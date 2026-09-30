// MOV-312 Step 2 — ordering by closeness to the requested time (R3) and never
// treating an unknown accessibility score as 100 (R5).
//
// Driven end to end: the real search endpoint, then `toRecommendedJourneys`,
// which is the list the results screen renders. No ordering rule is
// re-implemented here. Accessibility order is taken from `rankJourneyOptions`
// itself where a test needs it, and every score precondition is read from
// `computeAccessibilityScore` rather than written down. No credential-shaped
// value appears; journey search needs none.

import { POST } from '../../../app/api/journeys/search+api';
import {
    knownAccessibilityScore,
    RecommendedJourney,
    toRecommendedJourneys,
} from '../../../src/features/journey/utils/journeyRecommendations';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import { computeAccessibilityScore } from '../../../src/shared/utils/accessibility';
import { rankJourneyOptions } from '../../../src/shared/utils/journeyRanking';
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
// Kaduwela -(8)- Malabe -(6)- Battaramulla -(12)- Rajagiriya -(15)- Borella
// ------------------------------------------------------------------
const ROUTE_ID = 'ROUTE-177';
const STOPS = ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella'];

const route = makeRoute(ROUTE_ID, STOPS, {
    routeNumber: '177',
    distanceKm: 20,
    segmentDurationsMinutes: [8, 6, 12, 15],
});

const STOP_DOCS = [
    makeStop('Kaduwela', 6.9333, 79.9833),
    makeStop('Malabe', 6.9061, 79.9558),
    makeStop('Battaramulla', 6.8994, 79.9186),
    makeStop('Rajagiriya', 6.9094, 79.8944),
    makeStop('Borella', 6.9147, 79.8778),
];

const BUSES = [
    makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED),
    makeBus('BUS-PARTLY', 'NB-2222', PARTLY_EQUIPPED),
    makeBus('BUS-NONE', 'NB-3333', NOT_EQUIPPED),
];

const scoreOf = computeAccessibilityScore;

// A past date, so the current clock plays no part unless a test says so.
const PAST_DATE = '2026-08-25';

interface SearchOptions {
    travelTime?: string;
    travelDate?: string;
    origin?: string;
    accessibilityRequirements?: string[];
}

async function search(
    trips: ReturnType<typeof makeTrip>[],
    options: SearchOptions = {}
): Promise<{ json: any; journeys: RecommendedJourney[] }> {
    mockGetAdminDb.mockReturnValue(
        createFakeFirestore({ routes: [route], buses: BUSES, trips, stops: STOP_DOCS })
    );

    const response = await POST(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origin: options.origin ?? 'Kaduwela',
                destination: 'Borella',
                travelDate: options.travelDate ?? PAST_DATE,
                travelTime: options.travelTime ?? '10:00',
                accessibilityRequirements: options.accessibilityRequirements ?? [],
            }),
        })
    );

    const json = await response.json();
    return { json, journeys: toRecommendedJourneys(json.routes ?? []) };
}

const orderOf = (journeys: RecommendedJourney[]) =>
    journeys.map((journey) => journey.option.trip.tripId);

/** The accessibility-only order, straight from MOV-87's ranking. */
const accessibilityOrderOf = (journeys: RecommendedJourney[]) =>
    orderOf(
        rankJourneyOptions(journeys, (journey) => ({
            accessibilityScore: journey.accessibilityScore,
            departureTime: journey.option.trip.departureTime,
            routeId: journey.route.routeId,
            tripId: journey.option.trip.tripId,
        }))
    );

beforeEach(() => {
    jest.clearAllMocks();

    mockGeocodeLocation.mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    mockGetRoute.mockResolvedValue({ distanceKm: 20, durationMinutes: 41 });
    mockGetRouteThrough.mockResolvedValue({ distanceKm: 20, durationMinutes: 41 });
});

describe('the fleet these tests order', () => {
    it('scores the buses in a strict order', () => {
        expect(scoreOf(FULLY_EQUIPPED)).toBeGreaterThan(scoreOf(PARTLY_EQUIPPED));
        expect(scoreOf(PARTLY_EQUIPPED)).toBeGreaterThan(scoreOf(NOT_EQUIPPED));
    });
});

// ==================================================================
// R3 — exact first, then closeness, then accessibility for ties
// ==================================================================
describe('R3 — closeness to the requested time', () => {
    it('A: puts an exact journey before a nearby one even when the nearby bus scores higher', async () => {
        const { journeys } = await search([
            makeTrip('T-NEARBY-HIGH', ROUTE_ID, 'BUS-FULLY', '10:10'),
            makeTrip('T-EXACT-LOW', ROUTE_ID, 'BUS-NONE', '10:00'),
        ]);

        expect(journeys[0].accessibilityScore).toBeLessThan(journeys[1].accessibilityScore as number);
        expect(orderOf(journeys)).toEqual(['T-EXACT-LOW', 'T-NEARBY-HIGH']);
    });

    it('B: orders several exact journeys by the existing accessibility ranking', async () => {
        const { journeys } = await search([
            makeTrip('T-NONE', ROUTE_ID, 'BUS-NONE', '10:00'),
            makeTrip('T-FULLY', ROUTE_ID, 'BUS-FULLY', '10:00'),
            makeTrip('T-PARTLY', ROUTE_ID, 'BUS-PARTLY', '10:00'),
        ]);

        expect(journeys.map((journey) => journey.option.minutesFromRequestedTime)).toEqual([0, 0, 0]);
        expect(orderOf(journeys)).toEqual(['T-FULLY', 'T-PARTLY', 'T-NONE']);
        expect(orderOf(journeys)).toEqual(accessibilityOrderOf(journeys));
    });

    it('C: orders nearby journeys by distance, earlier and later alike', async () => {
        // The most accessible bus is the furthest away, so accessibility alone
        // would put it first.
        const { journeys } = await search([
            makeTrip('T-1045', ROUTE_ID, 'BUS-FULLY', '10:45'),
            makeTrip('T-0930', ROUTE_ID, 'BUS-PARTLY', '09:30'),
            makeTrip('T-1020', ROUTE_ID, 'BUS-NONE', '10:20'),
            makeTrip('T-0950', ROUTE_ID, 'BUS-NONE', '09:50'),
        ]);

        expect(orderOf(journeys)).toEqual(['T-0950', 'T-1020', 'T-0930', 'T-1045']);
        expect(journeys.map((journey) => journey.option.minutesFromRequestedTime)).toEqual([
            10, 20, 30, 45,
        ]);
    });

    it('D: breaks an equal-distance tie with the existing accessibility ranking', async () => {
        // 09:50 and 10:10 are both 10 minutes away. The better bus wins whichever
        // side of the requested time it is on — not the earlier departure.
        const laterIsBetter = await search([
            makeTrip('T-0950', ROUTE_ID, 'BUS-NONE', '09:50'),
            makeTrip('T-1010', ROUTE_ID, 'BUS-FULLY', '10:10'),
        ]);
        const earlierIsBetter = await search([
            makeTrip('T-0950', ROUTE_ID, 'BUS-FULLY', '09:50'),
            makeTrip('T-1010', ROUTE_ID, 'BUS-NONE', '10:10'),
        ]);

        expect(orderOf(laterIsBetter.journeys)).toEqual(['T-1010', 'T-0950']);
        expect(orderOf(earlierIsBetter.journeys)).toEqual(['T-0950', 'T-1010']);
        expect(orderOf(laterIsBetter.journeys)).toEqual(accessibilityOrderOf(laterIsBetter.journeys));
    });

    it('keeps exact first, then each distance, with accessibility deciding within one', async () => {
        const { journeys } = await search([
            makeTrip('T-FAR-FULLY', ROUTE_ID, 'BUS-FULLY', '10:40'),
            makeTrip('T-NEAR-NONE', ROUTE_ID, 'BUS-NONE', '09:55'),
            makeTrip('T-NEAR-PARTLY', ROUTE_ID, 'BUS-PARTLY', '10:05'),
            makeTrip('T-EXACT-NONE', ROUTE_ID, 'BUS-NONE', '10:00'),
        ]);

        expect(orderOf(journeys)).toEqual([
            'T-EXACT-NONE',
            'T-NEAR-PARTLY',
            'T-NEAR-NONE',
            'T-FAR-FULLY',
        ]);
    });
});

// ==================================================================
// Accessibility filtering still applies to both tiers
// ==================================================================
describe('accessibility filtering across exact and nearby journeys', () => {
    it('E: excludes an exact journey whose vehicle fails the requirement', async () => {
        const { journeys } = await search(
            [
                makeTrip('T-EXACT-NONE', ROUTE_ID, 'BUS-NONE', '10:00'),
                makeTrip('T-NEARBY-FULLY', ROUTE_ID, 'BUS-FULLY', '10:20'),
            ],
            { accessibilityRequirements: ['wheelchairRamp'] }
        );

        expect(orderOf(journeys)).toEqual(['T-NEARBY-FULLY']);
    });

    it('F: excludes a nearby journey whose vehicle fails the requirement', async () => {
        const { journeys } = await search(
            [
                makeTrip('T-EXACT-FULLY', ROUTE_ID, 'BUS-FULLY', '10:00'),
                makeTrip('T-NEARBY-NONE', ROUTE_ID, 'BUS-NONE', '10:05'),
            ],
            { accessibilityRequirements: ['wheelchairRamp'] }
        );

        expect(orderOf(journeys)).toEqual(['T-EXACT-FULLY']);
    });
});

// ==================================================================
// R5 — an unknown score stays unknown
// ==================================================================
describe('R5 — an unknown accessibility score is never 100', () => {
    it('G: keeps a vehicle with no score unknown, and ranks it as unknown', async () => {
        // Both exact. Were the missing bus treated as 100 it would lead; as an
        // unknown it ranks after even a measured low score.
        const { journeys } = await search([
            makeTrip('T-UNKNOWN', ROUTE_ID, 'BUS-MISSING', '10:00'),
            makeTrip('T-NONE', ROUTE_ID, 'BUS-NONE', '10:00'),
        ]);

        const unknown = journeys.find((journey) => journey.option.trip.tripId === 'T-UNKNOWN');

        expect(unknown?.option.bus).toBeNull();
        expect(unknown?.accessibilityScore).toBeNull();
        expect(orderOf(journeys)).toEqual(['T-NONE', 'T-UNKNOWN']);
    });

    it('G: carries no stand-in number into a booking selection', () => {
        expect(knownAccessibilityScore(undefined)).toBeNull();
        expect(knownAccessibilityScore(null, undefined)).toBeNull();
        expect(knownAccessibilityScore(Number.NaN, 'high')).toBeNull();
        // A measured score is carried as measured — zero included.
        expect(knownAccessibilityScore(undefined, 0)).toBe(0);
        expect(knownAccessibilityScore(63, 90)).toBe(63);
    });
});

// ==================================================================
// Step 1 still holds underneath the new ordering
// ==================================================================
describe('Step 1 regression under the new ordering', () => {
    it('H: measures closeness at the passenger own boarding stop, not the first stop', async () => {
        // Boarding at Malabe, 8 minutes after Kaduwela: 09:52 boards at 10:00.
        const { journeys } = await search(
            [
                makeTrip('T-FIRST-STOP-EXACT', ROUTE_ID, 'BUS-FULLY', '10:00'), // boards 10:08
                makeTrip('T-MALABE-EXACT', ROUTE_ID, 'BUS-NONE', '09:52'), // boards 10:00
            ],
            { origin: 'Malabe' }
        );

        expect(orderOf(journeys)).toEqual(['T-MALABE-EXACT', 'T-FIRST-STOP-EXACT']);
        expect(journeys.map((journey) => journey.option.minutesFromRequestedTime)).toEqual([0, 8]);
    });

    it('H: keeps the inclusive ±60-minute window', async () => {
        const { journeys } = await search([
            makeTrip('T-0859', ROUTE_ID, 'BUS-FULLY', '08:59'),
            makeTrip('T-0900', ROUTE_ID, 'BUS-FULLY', '09:00'),
            makeTrip('T-1100', ROUTE_ID, 'BUS-FULLY', '11:00'),
            makeTrip('T-1101', ROUTE_ID, 'BUS-FULLY', '11:01'),
        ]);

        expect(orderOf(journeys).slice().sort()).toEqual(['T-0900', 'T-1100']);
    });

    describe('H: today and future dates', () => {
        // 04:35 UTC is 10:05 in Colombo on 25 Aug 2026.
        beforeEach(() => {
            jest.useFakeTimers({
                now: new Date('2026-08-25T04:35:00.000Z'),
                doNotFake: ['nextTick', 'setImmediate'],
            });
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        const trips = () => [
            makeTrip('T-GONE', ROUTE_ID, 'BUS-FULLY', '10:00'),
            makeTrip('T-SOON', ROUTE_ID, 'BUS-NONE', '10:15'),
        ];

        it('still excludes a journey that has already departed today, even an exact one', async () => {
            const { journeys } = await search(trips(), { travelDate: '2026-08-25' });

            expect(orderOf(journeys)).toEqual(['T-SOON']);
        });

        it('still never filters a future date by the current clock', async () => {
            const { journeys } = await search(trips(), { travelDate: '2026-08-26' });

            expect(orderOf(journeys)).toEqual(['T-GONE', 'T-SOON']);
        });
    });
});
