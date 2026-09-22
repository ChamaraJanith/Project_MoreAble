// The passenger rating a search result card shows (MOV-80 / MOV-118).
//
// Every other rating suite covers one end of this. `busRatingsSummary+api`
// covers the bus-scoped endpoint, `accessibilityScore` covers the arithmetic,
// and `busCommunityFeedback` covers the wording. What none of them covers is the
// path the search card actually uses: stored ratings -> the search response's
// `bus.passengerRating` -> the words on the card.
//
// So this drives the real search endpoint over an in-memory Firestore seeded
// with real rating documents, and carries each answer through
// `describeRatingSummary` — the same function the card renders from. A break
// anywhere along that chain fails here.
//
// It also pins the distinction the whole story rests on: the passenger rating is
// the 1-5 mean, the accessibility score is the 0-100 blend, and they travel as
// two separate fields that must never be read as one.

import { POST as search } from '../../../app/api/journeys/search+api';
import { describeRatingSummary } from '../../../src/features/reports/utils/busCommunityFeedback';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import { busRatingDocumentId, BUS_RATINGS_COLLECTION } from '../../../src/shared/server/busRating';
import { computeRatingScore } from '../../../src/shared/utils/accessibility';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import {
    makeBus,
    makeRoute,
    makeStop,
    makeTrip,
    PARTLY_EQUIPPED,
} from '../../testUtils/journeyFixtures';

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

const mockGeocodeLocation = geocodeLocation as jest.MockedFunction<typeof geocodeLocation>;
const mockGetRoute = getRouteBetweenCoordinates as jest.MockedFunction<
    typeof getRouteBetweenCoordinates
>;
const mockGetRouteThrough = getRouteThroughCoordinates as jest.MockedFunction<
    typeof getRouteThroughCoordinates
>;

const ROUTE_ID = 'ROUTE-177';
const STOPS = ['Kaduwela', 'Malabe', 'Borella'];

const route = makeRoute(ROUTE_ID, STOPS, { routeNumber: '177', distanceKm: 20 });

const STOP_DOCS = [
    makeStop('Kaduwela', 6.9333, 79.9833),
    makeStop('Malabe', 6.9061, 79.9558),
    makeStop('Borella', 6.9147, 79.8778),
];

let ratingSeq = 0;

/** One rating document, in the shape submitBusRating writes. */
function rating(busId: string, stars: unknown) {
    ratingSeq += 1;
    const passengerId = `PASSENGER-R${ratingSeq}`;
    const tripId = `TRIP-RUN-${ratingSeq}`;
    const journeyStartedAt = '2026-09-01T08:00:00.000Z';
    const ratingId = busRatingDocumentId(passengerId, tripId, journeyStartedAt);

    return {
        id: ratingId,
        ratingId,
        passengerId,
        bookingId: `BOOKING-${ratingSeq}`,
        busId,
        tripId,
        journeyStartedAt,
        rating: stars,
        createdAt: '2026-09-01T09:00:00.000Z',
    };
}

/** Runs a real search over a fleet plus whatever ratings are stored. */
async function searchWith(options: {
    buses: any[];
    trips: any[];
    ratings?: Record<string, unknown>[];
}) {
    mockGetAdminDb.mockReturnValue(
        createFakeFirestore({
            routes: [route],
            buses: options.buses,
            trips: options.trips,
            stops: STOP_DOCS,
            [BUS_RATINGS_COLLECTION]: (options.ratings ?? []) as any,
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

    return response.json();
}

/** The bus on the departure `tripId`, as the search returned it. */
function busOf(json: any, tripId: string) {
    for (const match of json.routes ?? []) {
        for (const option of match.trips ?? []) {
            if (option.trip.tripId === tripId) return option.bus;
        }
    }

    return null;
}

beforeEach(() => {
    jest.clearAllMocks();
    ratingSeq = 0;

    mockGeocodeLocation.mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    mockGetRoute.mockResolvedValue({ distanceKm: 20, durationMinutes: 60 });
    mockGetRouteThrough.mockResolvedValue({ distanceKm: 20, durationMinutes: 60 });
});

const BUS_A = makeBus('BUS-A', 'NB-8899', PARTLY_EQUIPPED);
const TRIP_A = makeTrip('TRIP-A', ROUTE_ID, 'BUS-A', '06:00');

// ==================================================================
// A RATED BUS
// ==================================================================
describe('a bus its passengers have rated', () => {
    // The story's worked example: 5, 4, 4, 3 -> 4.0 from 4 ratings.
    const RATED = [
        rating('BUS-A', 5),
        rating('BUS-A', 4),
        rating('BUS-A', 4),
        rating('BUS-A', 3),
    ];

    it('carries the average and the count on the search response', async () => {
        const json = await searchWith({ buses: [BUS_A], trips: [TRIP_A], ratings: RATED });

        expect(busOf(json, 'TRIP-A').passengerRating).toEqual({
            busId: 'BUS-A',
            average: 4,
            count: 4,
        });
    });

    it('reads on the card as the average and the number of ratings behind it', async () => {
        const json = await searchWith({ buses: [BUS_A], trips: [TRIP_A], ratings: RATED });

        const display = describeRatingSummary(busOf(json, 'TRIP-A').passengerRating);

        expect(display.hasRatings).toBe(true);
        expect(display.averageLabel).toBe('4.0');
        expect(display.countLabel).toBe('4 ratings');
        // What the compact row on the result card actually shows.
        expect(display.compactLabel).toBe('4.0 (4)');
    });

    it('speaks the rating as its own sentence, on the 1 to 5 scale', async () => {
        const json = await searchWith({ buses: [BUS_A], trips: [TRIP_A], ratings: RATED });

        expect(describeRatingSummary(busOf(json, 'TRIP-A').passengerRating).accessibilityLabel).toBe(
            'Average passenger rating 4.0 out of 5, from 4 ratings.'
        );
    });

    it('carries a decimal average without flattening it', async () => {
        // 5 + 4 + 4 + 3 + 2 = 18 over 5 ratings.
        const json = await searchWith({
            buses: [BUS_A],
            trips: [TRIP_A],
            ratings: [...RATED, rating('BUS-A', 2)],
        });

        const summary = busOf(json, 'TRIP-A').passengerRating;

        expect(summary).toEqual({ busId: 'BUS-A', average: 3.6, count: 5 });
        expect(describeRatingSummary(summary).compactLabel).toBe('3.6 (5)');
    });

    it('gives every departure of the same bus the same rating', async () => {
        const json = await searchWith({
            buses: [BUS_A],
            trips: [TRIP_A, makeTrip('TRIP-A2', ROUTE_ID, 'BUS-A', '08:00')],
            ratings: RATED,
        });

        expect(busOf(json, 'TRIP-A2').passengerRating).toEqual(
            busOf(json, 'TRIP-A').passengerRating
        );
    });
});

// ==================================================================
// AN UNRATED BUS
// ==================================================================
describe('a bus nobody has rated', () => {
    it('carries no average rather than a zero', async () => {
        const json = await searchWith({ buses: [BUS_A], trips: [TRIP_A], ratings: [] });

        expect(busOf(json, 'TRIP-A').passengerRating).toEqual({
            busId: 'BUS-A',
            average: null,
            count: 0,
        });
    });

    it('reads on the card as "No ratings yet", and never as a number', async () => {
        const json = await searchWith({ buses: [BUS_A], trips: [TRIP_A], ratings: [] });

        const display = describeRatingSummary(busOf(json, 'TRIP-A').passengerRating);

        expect(display.hasRatings).toBe(false);
        expect(display.compactLabel).toBe('No ratings yet');
        // Not 0, not 3, not 5 — no invented fallback of any kind.
        expect(display.compactLabel).not.toMatch(/\d/);
        expect(display.averageLabel).toBeNull();
        expect(display.countLabel).toBeNull();
    });

    it('still shows an accessibility score, which does not depend on ratings', async () => {
        const json = await searchWith({ buses: [BUS_A], trips: [TRIP_A], ratings: [] });

        expect(typeof busOf(json, 'TRIP-A').accessibilityScore).toBe('number');
    });
});

// ==================================================================
// INVALID STORED RATINGS
// ==================================================================
describe('ratings the project does not consider valid', () => {
    it('leaves the average and the count to the valid ones alone', async () => {
        const json = await searchWith({
            buses: [BUS_A],
            trips: [TRIP_A],
            ratings: [
                rating('BUS-A', 5),
                rating('BUS-A', 3),
                rating('BUS-A', 0),
                rating('BUS-A', 6),
                rating('BUS-A', -1),
                rating('BUS-A', 4.5),
                rating('BUS-A', '5'),
                rating('BUS-A', null),
                { ...rating('BUS-A', 4), passengerId: '' },
            ],
        });

        // 5 and 3 only.
        expect(busOf(json, 'TRIP-A').passengerRating).toEqual({
            busId: 'BUS-A',
            average: 4,
            count: 2,
        });
    });

    it('reads as unrated when every stored rating is unusable', async () => {
        const json = await searchWith({
            buses: [BUS_A],
            trips: [TRIP_A],
            ratings: [rating('BUS-A', 0), rating('BUS-A', '4'), rating('BUS-A', null)],
        });

        const summary = busOf(json, 'TRIP-A').passengerRating;

        expect(summary).toEqual({ busId: 'BUS-A', average: null, count: 0 });
        expect(describeRatingSummary(summary).compactLabel).toBe('No ratings yet');
    });
});

// ==================================================================
// ONE BUS'S RATINGS STAY ON ONE BUS
// ==================================================================
describe('each card shows its own bus', () => {
    const BUS_B = makeBus('BUS-B', 'NB-7777', PARTLY_EQUIPPED);
    const TRIP_B = makeTrip('TRIP-B', ROUTE_ID, 'BUS-B', '07:00');

    const fleetRatings = [
        rating('BUS-A', 5),
        rating('BUS-A', 4),
        rating('BUS-A', 4),
        rating('BUS-B', 2),
        rating('BUS-B', 1),
    ];

    it('rates bus A from bus A alone', async () => {
        const json = await searchWith({
            buses: [BUS_A, BUS_B],
            trips: [TRIP_A, TRIP_B],
            ratings: fleetRatings,
        });

        const summary = busOf(json, 'TRIP-A').passengerRating;

        expect(summary.count).toBe(3);
        expect(summary.average).toBeCloseTo(13 / 3, 10);
        expect(describeRatingSummary(summary).compactLabel).toBe('4.3 (3)');
    });

    it('rates bus B from bus B alone', async () => {
        const json = await searchWith({
            buses: [BUS_A, BUS_B],
            trips: [TRIP_A, TRIP_B],
            ratings: fleetRatings,
        });

        expect(busOf(json, 'TRIP-B').passengerRating).toEqual({
            busId: 'BUS-B',
            average: 1.5,
            count: 2,
        });
    });

    it('never shows one bus a fleet-wide average', async () => {
        const json = await searchWith({
            buses: [BUS_A, BUS_B],
            trips: [TRIP_A, TRIP_B],
            ratings: fleetRatings,
        });

        // 16/5 = 3.2 is every rating in the database.
        for (const tripId of ['TRIP-A', 'TRIP-B']) {
            expect(busOf(json, tripId).passengerRating.average).not.toBeCloseTo(3.2, 6);
            expect(busOf(json, tripId).passengerRating.count).not.toBe(fleetRatings.length);
        }
    });

    it('names its own bus in the summary it carries', async () => {
        const json = await searchWith({
            buses: [BUS_A, BUS_B],
            trips: [TRIP_A, TRIP_B],
            ratings: fleetRatings,
        });

        expect(busOf(json, 'TRIP-A').passengerRating.busId).toBe('BUS-A');
        expect(busOf(json, 'TRIP-B').passengerRating.busId).toBe('BUS-B');
    });
});

// ==================================================================
// THE RATING IS NOT THE ACCESSIBILITY SCORE
// ==================================================================
describe('the two numbers on a card are two different numbers', () => {
    const RATED = [rating('BUS-A', 5), rating('BUS-A', 5), rating('BUS-A', 5)];

    it('carries the rating and the score as separate fields', async () => {
        const json = await searchWith({ buses: [BUS_A], trips: [TRIP_A], ratings: RATED });
        const bus = busOf(json, 'TRIP-A');

        expect(bus.passengerRating.average).toBe(5);
        expect(typeof bus.accessibilityScore).toBe('number');
        expect(bus.accessibilityScore).not.toBe(bus.passengerRating.average);
    });

    it('keeps the passenger rating on the 1 to 5 scale, never 0 to 100', async () => {
        const json = await searchWith({ buses: [BUS_A], trips: [TRIP_A], ratings: RATED });
        const { passengerRating } = busOf(json, 'TRIP-A');

        expect(passengerRating.average).toBeGreaterThanOrEqual(1);
        expect(passengerRating.average).toBeLessThanOrEqual(5);
    });

    it('is the plain mean, not the score component the mean feeds', async () => {
        const json = await searchWith({ buses: [BUS_A], trips: [TRIP_A], ratings: RATED });
        const { passengerRating } = busOf(json, 'TRIP-A');

        // Three 5-star ratings: the mean is 5.0, while MOV-79's component pulls
        // it toward a neutral 3 and remaps onto 0-100. Showing the second one to
        // a passenger as their rating is the mistake this story exists to avoid.
        expect(passengerRating.average).toBe(5);
        expect(passengerRating.average).not.toBe(computeRatingScore({ count: 3, total: 15 }));
    });

    it('does not put a 0 to 100 rating figure on the bus', async () => {
        const json = await searchWith({ buses: [BUS_A], trips: [TRIP_A], ratings: RATED });
        const bus = busOf(json, 'TRIP-A');

        expect(bus.ratingScore).toBeUndefined();
        expect(bus.passengerRating.ratingScore).toBeUndefined();
    });
});

// ==================================================================
// NOTHING PRIVATE RIDES ALONG
// ==================================================================
describe('what the rating summary does not carry', () => {
    it('names no passenger, booking, run or rating document', async () => {
        const json = await searchWith({
            buses: [BUS_A],
            trips: [TRIP_A],
            ratings: [rating('BUS-A', 5), rating('BUS-A', 3)],
        });

        const { passengerRating } = busOf(json, 'TRIP-A');

        expect(Object.keys(passengerRating).sort()).toEqual(['average', 'busId', 'count']);

        const serialised = JSON.stringify(json);
        expect(serialised).not.toContain('PASSENGER-R');
        expect(serialised).not.toContain('BOOKING-');
        expect(serialised).not.toContain('ratingId');
        expect(serialised).not.toContain('journeyStartedAt');
    });
});
