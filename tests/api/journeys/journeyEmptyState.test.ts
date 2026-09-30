// MOV-308 AC6 — an empty journey search says why it is empty.
//
// Three different situations reach the results screen as "nothing to show":
//
//   A. no route serves the origin and destination;
//   B. a route runs, but nothing leaves within an hour of the requested time —
//      with or without accessibility requirements selected;
//   C/D. departures do leave within the hour, but none meets the requirements.
//
// Driven end to end: the real search endpoint, then `journeyEmptyReason`, the
// helper the results screen reads its empty state from, fed exactly as the
// screen feeds it. The screen's own wiring is checked by reading its source,
// as this project's node-only Jest has no React Native renderer.
//
// No credential-shaped value appears; journey search needs none.

import * as fs from 'fs';
import * as path from 'path';
import { POST } from '../../../app/api/journeys/search+api';
import { journeyEmptyReason } from '../../../src/features/journey/utils/journeyEmptyState';
import { toRecommendedJourneys } from '../../../src/features/journey/utils/journeyRecommendations';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import {
    FULLY_EQUIPPED,
    makeBus,
    makeRoute,
    makeStop,
    makeTrip,
    NOT_EQUIPPED,
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

const BUSES = [makeBus('BUS-FULLY', 'NB-1111', FULLY_EQUIPPED), makeBus('BUS-NONE', 'NB-3333', NOT_EQUIPPED)];

// A past date, so the current clock plays no part.
const PAST_DATE = '2026-08-25';
// Requested 10:00: the window is 09:00-11:00.
const REQUESTED = '10:00';
const RAMP = ['wheelchairRamp'];

interface SearchOptions {
    origin?: string;
    destination?: string;
    accessibilityRequirements?: string[];
}

/** One search, and the empty-state reason the results screen would show for it. */
async function search(trips: ReturnType<typeof makeTrip>[], options: SearchOptions = {}) {
    mockGetAdminDb.mockReturnValue(
        createFakeFirestore({ routes: [route], buses: BUSES, trips, stops: STOP_DOCS })
    );

    const requirements = options.accessibilityRequirements ?? [];
    const response = await POST(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origin: options.origin ?? 'Kaduwela',
                destination: options.destination ?? 'Borella',
                travelDate: PAST_DATE,
                travelTime: REQUESTED,
                accessibilityRequirements: requirements,
            }),
        })
    );
    const json = await response.json();
    const journeys = toRecommendedJourneys(json.routes ?? []);

    return {
        status: response.status,
        json,
        journeys,
        // Exactly the inputs JourneySearchResults hands the helper.
        reason: journeyEmptyReason({
            searchWindow: json.searchWindow,
            isFiltering: requirements.length > 0,
            returnedRouteCount: (json.routes ?? []).length,
        }),
    };
}

beforeEach(() => {
    jest.clearAllMocks();

    (geocodeLocation as jest.Mock).mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    (getRouteBetweenCoordinates as jest.Mock).mockResolvedValue({ distanceKm: 20, durationMinutes: 41 });
    (getRouteThroughCoordinates as jest.Mock).mockResolvedValue({ distanceKm: 20, durationMinutes: 41 });
});

// ==================================================================
// A — no route
// ==================================================================
describe('A: no route serves the journey', () => {
    // Both stops exist, but the route only runs Kaduwela -> Borella.
    const reversed = { origin: 'Borella', destination: 'Kaduwela' };

    it('reports no matched route, and keeps the no-route empty state', async () => {
        const result = await search([makeTrip('T-1', ROUTE_ID, 'BUS-FULLY', REQUESTED)], reversed);

        expect(result.status).toBe(200);
        expect(result.journeys).toEqual([]);
        expect(result.json.searchWindow).toEqual({ matchedRouteCount: 0, departureCount: 0 });
        expect(result.reason).toBe('NO_ROUTE');
    });

    it('keeps the no-route empty state with requirements selected too', async () => {
        const result = await search([makeTrip('T-1', ROUTE_ID, 'BUS-FULLY', REQUESTED)], {
            ...reversed,
            accessibilityRequirements: RAMP,
        });

        expect(result.journeys).toEqual([]);
        expect(result.reason).toBe('NO_ROUTE');
    });
});

// ==================================================================
// B — the route runs, nothing within the hour, no requirements
// ==================================================================
describe('B: the route runs but nothing leaves within an hour, no requirements', () => {
    it('shows the time-window empty state', async () => {
        // 06:00 and 13:00 are both more than an hour from 10:00.
        const result = await search([
            makeTrip('T-EARLY', ROUTE_ID, 'BUS-FULLY', '06:00'),
            makeTrip('T-LATE', ROUTE_ID, 'BUS-FULLY', '13:00'),
        ]);

        expect(result.journeys).toEqual([]);
        expect(result.json.searchWindow).toEqual({ matchedRouteCount: 1, departureCount: 0 });
        expect(result.reason).toBe('NO_JOURNEY_IN_WINDOW');
    });
});

// ==================================================================
// C — the same, WITH requirements selected (the AC6 defect)
// ==================================================================
describe('C: the route runs but nothing leaves within an hour, WITH requirements', () => {
    it('shows the time-window empty state, not the requirements one', async () => {
        // The only departures are outside the window and on a fully equipped
        // bus: the requirement is not what left the list empty.
        const result = await search(
            [
                makeTrip('T-EARLY', ROUTE_ID, 'BUS-FULLY', '06:00'),
                makeTrip('T-LATE', ROUTE_ID, 'BUS-FULLY', '13:00'),
            ],
            { accessibilityRequirements: RAMP }
        );

        expect(result.journeys).toEqual([]);
        // The filter still drops the route with no suitable departure...
        expect(result.json.routes).toEqual([]);
        // ...but the search says a route matched and nothing was in the window.
        expect(result.json.searchWindow).toEqual({ matchedRouteCount: 1, departureCount: 0 });
        expect(result.reason).toBe('NO_JOURNEY_IN_WINDOW');
        expect(result.reason).not.toBe('NO_SUITABLE_JOURNEY');
        expect(result.json.message).toBe('No departures within an hour of the requested time.');
    });

    it('does so whichever requirement is selected', async () => {
        const result = await search([makeTrip('T-EARLY', ROUTE_ID, 'BUS-NONE', '06:00')], {
            accessibilityRequirements: ['wheelchairRamp', 'audioAnnouncement'],
        });

        expect(result.reason).toBe('NO_JOURNEY_IN_WINDOW');
    });
});

// ==================================================================
// D — departures in the window, all removed by the requirements
// ==================================================================
describe('D: departures leave within the hour but none meets the requirements', () => {
    it('keeps the accessibility-filter empty state', async () => {
        // Exact and nearby departures exist, both on a bus with no ramp.
        const result = await search(
            [
                makeTrip('T-EXACT-NONE', ROUTE_ID, 'BUS-NONE', REQUESTED),
                makeTrip('T-NEARBY-NONE', ROUTE_ID, 'BUS-NONE', '10:30'),
            ],
            { accessibilityRequirements: RAMP }
        );

        expect(result.journeys).toEqual([]);
        expect(result.json.searchWindow).toEqual({ matchedRouteCount: 1, departureCount: 2 });
        expect(result.reason).toBe('NO_SUITABLE_JOURNEY');
        expect(result.reason).not.toBe('NO_JOURNEY_IN_WINDOW');
        expect(result.json.message).toBe('No routes match your accessibility requirements.');
    });

    it('blames the requirements when they removed what was in the window, even if other trips were outside it', async () => {
        const result = await search(
            [
                makeTrip('T-IN-WINDOW-NONE', ROUTE_ID, 'BUS-NONE', '10:15'),
                makeTrip('T-OUTSIDE-FULLY', ROUTE_ID, 'BUS-FULLY', '06:00'),
            ],
            { accessibilityRequirements: RAMP }
        );

        expect(result.json.searchWindow).toEqual({ matchedRouteCount: 1, departureCount: 1 });
        expect(result.reason).toBe('NO_SUITABLE_JOURNEY');
    });

    it('still filters exactly as before: the same search without the requirement shows the departures', async () => {
        const trips = [makeTrip('T-EXACT-NONE', ROUTE_ID, 'BUS-NONE', REQUESTED)];

        expect((await search(trips, { accessibilityRequirements: RAMP })).journeys).toEqual([]);
        expect((await search(trips)).journeys.map((journey) => journey.option.trip.tripId)).toEqual([
            'T-EXACT-NONE',
        ]);
    });
});

// ==================================================================
// The window figures themselves
// ==================================================================
describe('the searchWindow figures', () => {
    it('count only catchable departures inside the window, before the requirements', async () => {
        const result = await search(
            [
                makeTrip('T-A', ROUTE_ID, 'BUS-FULLY', '09:00'),
                makeTrip('T-B', ROUTE_ID, 'BUS-NONE', '10:00'),
                makeTrip('T-C', ROUTE_ID, 'BUS-FULLY', '11:00'),
                makeTrip('T-OUT', ROUTE_ID, 'BUS-FULLY', '11:01'),
            ],
            { accessibilityRequirements: RAMP }
        );

        // Three in the inclusive ±60 window; the requirement then removes T-B.
        expect(result.json.searchWindow).toEqual({ matchedRouteCount: 1, departureCount: 3 });
        expect(result.journeys.map((journey) => journey.option.trip.tripId).sort()).toEqual(['T-A', 'T-C']);
    });

    it('carry counts only, nothing about a trip, vehicle or its accessibility', async () => {
        const result = await search([makeTrip('T-A', ROUTE_ID, 'BUS-FULLY', REQUESTED)]);

        expect(Object.keys(result.json.searchWindow).sort()).toEqual(['departureCount', 'matchedRouteCount']);
    });
});

// ==================================================================
// The helper on its own
// ==================================================================
describe('journeyEmptyReason', () => {
    const window = (matchedRouteCount: number, departureCount: number) => ({ matchedRouteCount, departureCount });

    it.each([
        ['no route', window(0, 0), false, 'NO_ROUTE'],
        ['no route, filtered', window(0, 0), true, 'NO_ROUTE'],
        ['route, nothing in the window', window(1, 0), false, 'NO_JOURNEY_IN_WINDOW'],
        ['route, nothing in the window, filtered', window(2, 0), true, 'NO_JOURNEY_IN_WINDOW'],
        ['departures in the window removed by requirements', window(1, 3), true, 'NO_SUITABLE_JOURNEY'],
    ] as const)('%s', (_label, searchWindow, isFiltering, expected) => {
        expect(journeyEmptyReason({ searchWindow, isFiltering, returnedRouteCount: 0 })).toBe(expected);
    });

    it.each([
        ['absent', undefined],
        ['null', null],
        ['a negative count', window(-1, 0)],
        ['a fractional count', window(1, 0.5)],
        ['a string count', { matchedRouteCount: '1', departureCount: 0 }],
    ])('falls back to the previous rule when the figures are %s', (_label, searchWindow) => {
        expect(journeyEmptyReason({ searchWindow, isFiltering: true, returnedRouteCount: 0 })).toBe(
            'NO_SUITABLE_JOURNEY'
        );
        expect(journeyEmptyReason({ searchWindow, isFiltering: false, returnedRouteCount: 1 })).toBe(
            'NO_JOURNEY_IN_WINDOW'
        );
        expect(journeyEmptyReason({ searchWindow, isFiltering: false, returnedRouteCount: 0 })).toBe('NO_ROUTE');
    });
});

// ==================================================================
// The results screen reads it
// ==================================================================
describe('the results screen', () => {
    const results = fs.readFileSync(
        path.resolve(__dirname, '../../../src/features/journey/ui/JourneySearchResults.tsx'),
        'utf8'
    );

    it('keeps the search window figures from the response', () => {
        expect(results).toContain('setSearchWindow(response.searchWindow ?? null);');
    });

    it('chooses its empty state from the helper, not from whether requirements are selected', () => {
        expect(results).toMatch(
            /journeyEmptyReason\(\{ searchWindow, isFiltering, returnedRouteCount: routes\.length \}\)/
        );
        expect(results).toContain("const isFilteredEmpty = emptyReason === 'NO_SUITABLE_JOURNEY';");
        expect(results).toContain("const hasMatchedRoutes = emptyReason === 'NO_JOURNEY_IN_WINDOW';");
        expect(results).not.toMatch(/const isFilteredEmpty = isEmpty && isFiltering/);
    });

    it('shows the time-window or no-route state whenever the requirements are not the reason', () => {
        expect(results).toMatch(/\{isEmpty && !isFilteredEmpty && \(/);
        expect(results).not.toMatch(/\{isEmpty && !isFiltering && \(/);
    });
});
