// The accessibility analytics the Admin Dashboard reports (MOV-169, for MOV-133).
//
// The module is pure: it is handed records that have already been loaded and
// buses that have already been scored by MOV-79, and it derives four figures
// from them. What can go wrong is all about what is counted, what is joined to
// what, and what is said when nothing can be counted:
//
//   what counts      — ACTIVE buses; ACTIVE trips operated by ACTIVE buses;
//                      ISSUE reports naming a bus;
//   what does not    — INACTIVE and MAINTENANCE vehicles, disabled turns,
//                      positive feedback, reports naming no vehicle, and the
//                      same bus counted twice for running a route twice;
//   nothing at all   — an unrun route, a week before any score was recorded and
//                      an empty fleet are all null, never 0, because 0 is a
//                      real score and "we cannot say" is not a finding.
//
// Nothing here scores anything. `accessibilityScore` arrives on the bus as an
// input — the loader produces it with `computeAccessibilityScore` — and the
// test that the two agree lives with the route, where the real function runs.

import {
    ACTIVE_TRIP_STATUS,
    AnalyticsHistoryEntry,
    AnalyticsReport,
    AnalyticsRoute,
    AnalyticsTrip,
    ScoredBus,
    TOP_RANKED_LIMIT,
    TREND_WEEKS,
    accessibilityAnalytics,
    accessibilityScoreTrend,
    averageAccessibilityScore,
    mostAccessibleRoutes,
    mostReportedVehicles,
    routeAccessibilityScores,
} from '../../../src/features/admin/utils/accessibilityAnalytics';

// ------------------------------------------------------------------
// Fixtures — shaped as the loader actually hands them over.
// ------------------------------------------------------------------

function bus(
    busId: string,
    accessibilityScore: number | undefined,
    status = 'ACTIVE',
    overrides: Partial<ScoredBus> = {}
): ScoredBus {
    return {
        busId,
        status,
        accessibilityScore,
        numberPlate: `NB-${busId.slice(-4)}`,
        busModel: 'Viking',
        manufacturer: 'Ashok Leyland',
        ...overrides,
    };
}

function trip(routeId: string, busId: string, status = 'ACTIVE'): AnalyticsTrip {
    return { routeId, busId, status };
}

function route(routeId: string, overrides: Partial<AnalyticsRoute> = {}): AnalyticsRoute {
    return {
        routeId,
        routeNumber: routeId.replace('R-', ''),
        routeName: `Route ${routeId}`,
        ...overrides,
    };
}

function issue(busId: string | undefined, status = 'PENDING'): AnalyticsReport {
    return {
        ...(busId === undefined ? {} : { busId }),
        status,
        // An issue report is stored WITHOUT a `type` field — see reportTypeOf.
    };
}

function positive(busId: string, status = 'VERIFIED'): AnalyticsReport {
    return { busId, status, type: 'POSITIVE' };
}

function historyEntry(
    busId: string,
    accessibilityScore: number,
    calculatedAt: string
): AnalyticsHistoryEntry {
    return { busId, accessibilityScore, calculatedAt };
}

/** A Thursday, so nothing in the bucketing can be passing by weekday accident. */
const NOW = new Date('2026-09-24T10:30:00.000Z');

// ==================================================================
// 1. Average Accessibility Score
// ==================================================================
describe('average accessibility score', () => {
    it('averages the scores of the buses in service', () => {
        const result = averageAccessibilityScore([
            bus('BUS-0001', 90),
            bus('BUS-0002', 80),
            bus('BUS-0003', 70),
        ]);

        expect(result).toEqual({ value: 80, busesIncluded: 3 });
    });

    it('rounds to a whole number, the scale the score itself reports on', () => {
        // 81.67 -> 82
        expect(averageAccessibilityScore([bus('A', 80), bus('B', 82), bus('C', 83)])).toEqual({
            value: 82,
            busesIncluded: 3,
        });
    });

    it('leaves out INACTIVE and MAINTENANCE vehicles', () => {
        const result = averageAccessibilityScore([
            bus('BUS-0001', 90),
            bus('BUS-0002', 10, 'INACTIVE'),
            bus('BUS-0003', 10, 'MAINTENANCE'),
        ]);

        expect(result).toEqual({ value: 90, busesIncluded: 1 });
    });

    it('is null, not 0, when no bus is in service', () => {
        const result = averageAccessibilityScore([bus('BUS-0001', 90, 'INACTIVE')]);

        expect(result).toEqual({ value: null, busesIncluded: 0 });
    });

    it('is null, not 0, on an empty fleet', () => {
        expect(averageAccessibilityScore([])).toEqual({ value: null, busesIncluded: 0 });
    });

    it('is null when handed nothing to count', () => {
        expect(averageAccessibilityScore(null)).toEqual({ value: null, busesIncluded: 0 });
        expect(averageAccessibilityScore(undefined)).toEqual({ value: null, busesIncluded: 0 });
    });

    it('keeps a real score of zero, which is a finding rather than a gap', () => {
        const result = averageAccessibilityScore([bus('BUS-0001', 0), bus('BUS-0002', 50)]);

        expect(result).toEqual({ value: 25, busesIncluded: 2 });
    });

    it('leaves out a bus whose score could not be produced', () => {
        const result = averageAccessibilityScore([
            bus('BUS-0001', 80),
            bus('BUS-0002', undefined),
            { busId: 'BUS-0003', status: 'ACTIVE', accessibilityScore: 'high' },
        ]);

        expect(result).toEqual({ value: 80, busesIncluded: 1 });
    });
});

// ==================================================================
// 2. Most Accessible Routes
// ==================================================================
describe('most accessible routes', () => {
    it('averages the distinct buses that run the route', () => {
        const ranked = mostAccessibleRoutes(
            [route('R-138')],
            [trip('R-138', 'BUS-0001'), trip('R-138', 'BUS-0002')],
            [bus('BUS-0001', 90), bus('BUS-0002', 70)]
        );

        expect(ranked).toEqual([
            {
                routeId: 'R-138',
                routeNumber: '138',
                routeName: 'Route R-138',
                averageScore: 80,
                busCount: 2,
            },
        ]);
    });

    it('counts a bus once however many turns it runs on the route', () => {
        const ranked = mostAccessibleRoutes(
            [route('R-138')],
            [
                trip('R-138', 'BUS-0001'),
                trip('R-138', 'BUS-0001'),
                trip('R-138', 'BUS-0001'),
                trip('R-138', 'BUS-0001'),
                trip('R-138', 'BUS-0002'),
            ],
            [bus('BUS-0001', 90), bus('BUS-0002', 70)]
        );

        // 80, not 86 — five turns by BUS-0001 must not pull the average its way.
        expect(ranked[0].averageScore).toBe(80);
        expect(ranked[0].busCount).toBe(2);
    });

    it('ranks routes best first', () => {
        const ranked = mostAccessibleRoutes(
            [route('R-100'), route('R-200'), route('R-300')],
            [trip('R-100', 'BUS-A'), trip('R-200', 'BUS-B'), trip('R-300', 'BUS-C')],
            [bus('BUS-A', 40), bus('BUS-B', 95), bus('BUS-C', 70)]
        );

        expect(ranked.map((entry) => entry.routeId)).toEqual(['R-200', 'R-300', 'R-100']);
    });

    it('leaves a route with no trips out of the ranking, and scores it null', () => {
        const routes = [route('R-138'), route('R-999')];
        const trips = [trip('R-138', 'BUS-0001')];
        const buses = [bus('BUS-0001', 90)];

        expect(mostAccessibleRoutes(routes, trips, buses).map((entry) => entry.routeId)).toEqual([
            'R-138',
        ]);

        // Null rather than 0: an unrun route is not an inaccessible route.
        expect(routeAccessibilityScores(routes, trips, buses)).toContainEqual(
            expect.objectContaining({ routeId: 'R-999', averageScore: null, busCount: 0 })
        );
    });

    it('ignores a disabled turn', () => {
        const routes = [route('R-138')];
        const trips = [trip('R-138', 'BUS-0001', 'INACTIVE')];
        const buses = [bus('BUS-0001', 90)];

        expect(mostAccessibleRoutes(routes, trips, buses)).toEqual([]);
        expect(routeAccessibilityScores(routes, trips, buses)[0]).toEqual(
            expect.objectContaining({ averageScore: null, busCount: 0 })
        );
    });

    it('ignores an ACTIVE turn operated by a withdrawn bus', () => {
        const ranked = mostAccessibleRoutes(
            [route('R-138')],
            [trip('R-138', 'BUS-0001'), trip('R-138', 'BUS-0002')],
            [bus('BUS-0001', 90), bus('BUS-0002', 10, 'MAINTENANCE')]
        );

        expect(ranked[0]).toEqual(expect.objectContaining({ averageScore: 90, busCount: 1 }));
    });

    it('ignores a turn naming a bus that is not in the fleet', () => {
        const ranked = mostAccessibleRoutes(
            [route('R-138')],
            [trip('R-138', 'BUS-0001'), trip('R-138', 'BUS-GONE')],
            [bus('BUS-0001', 90)]
        );

        expect(ranked[0]).toEqual(expect.objectContaining({ averageScore: 90, busCount: 1 }));
    });

    it('returns at most the top five', () => {
        const routes = Array.from({ length: 9 }, (_, index) => route(`R-${index + 1}`));
        const trips = routes.map((entry, index) => trip(String(entry.routeId), `BUS-${index}`));
        const buses = routes.map((_, index) => bus(`BUS-${index}`, 10 + index));

        const ranked = mostAccessibleRoutes(routes, trips, buses);

        expect(ranked).toHaveLength(TOP_RANKED_LIMIT);
        // Descending, so the highest-scoring five and no others.
        expect(ranked.map((entry) => entry.averageScore)).toEqual([18, 17, 16, 15, 14]);
    });

    it('breaks a tie on the bus count, then on the route id', () => {
        const ranked = mostAccessibleRoutes(
            [route('R-BBB'), route('R-AAA'), route('R-CCC')],
            [
                trip('R-BBB', 'BUS-1'),
                trip('R-AAA', 'BUS-2'),
                trip('R-CCC', 'BUS-3'),
                trip('R-CCC', 'BUS-4'),
            ],
            [bus('BUS-1', 80), bus('BUS-2', 80), bus('BUS-3', 80), bus('BUS-4', 80)]
        );

        // All average 80. R-CCC rests on two buses, so it leads; the other two
        // are separated by their ids.
        expect(ranked.map((entry) => entry.routeId)).toEqual(['R-CCC', 'R-AAA', 'R-BBB']);
    });

    it('is deterministic across runs of the same data in a different order', () => {
        const buses = [bus('BUS-1', 80), bus('BUS-2', 80)];
        const first = mostAccessibleRoutes(
            [route('R-AAA'), route('R-BBB')],
            [trip('R-AAA', 'BUS-1'), trip('R-BBB', 'BUS-2')],
            buses
        );
        const second = mostAccessibleRoutes(
            [route('R-BBB'), route('R-AAA')],
            [trip('R-BBB', 'BUS-2'), trip('R-AAA', 'BUS-1')],
            buses
        );

        expect(first.map((entry) => entry.routeId)).toEqual(second.map((entry) => entry.routeId));
    });

    it('names a route by its id when it has no route number', () => {
        const ranked = mostAccessibleRoutes(
            [{ routeId: 'R-138' }],
            [trip('R-138', 'BUS-0001')],
            [bus('BUS-0001', 90)]
        );

        expect(ranked[0]).toEqual(
            expect.objectContaining({ routeNumber: 'R-138', routeName: null })
        );
    });

    it('skips a route record with no id at all', () => {
        expect(routeAccessibilityScores([{ routeNumber: '138' }], [], [])).toEqual([]);
    });

    it('answers with nothing when there is nothing to rank', () => {
        expect(mostAccessibleRoutes(null, null, null)).toEqual([]);
        expect(mostAccessibleRoutes([], [], [])).toEqual([]);
    });

    it('uses the trip status the module names', () => {
        expect(ACTIVE_TRIP_STATUS).toBe('ACTIVE');
    });
});

// ==================================================================
// 3. Most Reported Vehicles
// ==================================================================
describe('most reported vehicles', () => {
    it('ranks buses by how many issue reports name them', () => {
        const ranked = mostReportedVehicles(
            [issue('BUS-A'), issue('BUS-A'), issue('BUS-B'), issue('BUS-A')],
            [bus('BUS-A', 40), bus('BUS-B', 80)]
        );

        expect(ranked.map((entry) => [entry.busId, entry.reportCount])).toEqual([
            ['BUS-A', 3],
            ['BUS-B', 1],
        ]);
    });

    it('does not count positive feedback towards the ranking', () => {
        const ranked = mostReportedVehicles(
            [
                issue('BUS-A'),
                positive('BUS-A'),
                positive('BUS-A'),
                positive('BUS-A'),
                issue('BUS-B'),
                issue('BUS-B'),
            ],
            [bus('BUS-A', 40), bus('BUS-B', 80)]
        );

        // BUS-A has four reports in the collection but only one issue.
        expect(ranked.map((entry) => [entry.busId, entry.reportCount])).toEqual([
            ['BUS-B', 2],
            ['BUS-A', 1],
        ]);
    });

    it('leaves out a bus named only by positive feedback', () => {
        const ranked = mostReportedVehicles([positive('BUS-A')], [bus('BUS-A', 90)]);

        expect(ranked).toEqual([]);
    });

    it('attributes a report naming no bus to no bus', () => {
        const ranked = mostReportedVehicles(
            [issue(undefined), issue(''), issue('   '), issue('BUS-A')],
            [bus('BUS-A', 40)]
        );

        expect(ranked).toHaveLength(1);
        expect(ranked[0]).toEqual(expect.objectContaining({ busId: 'BUS-A', reportCount: 1 }));
    });

    it('counts every status, and states separately how many were upheld', () => {
        const ranked = mostReportedVehicles(
            [
                issue('BUS-A', 'VERIFIED'),
                issue('BUS-A', 'VERIFIED'),
                issue('BUS-A', 'PENDING'),
                issue('BUS-A', 'REJECTED'),
            ],
            [bus('BUS-A', 40)]
        );

        // The total does not fall when an admin rejects one; the verified
        // sub-count is what states what is actually upheld.
        expect(ranked[0]).toEqual(
            expect.objectContaining({ reportCount: 4, verifiedReportCount: 2 })
        );
    });

    it('counts a report with no stored status as not verified', () => {
        const ranked = mostReportedVehicles([{ busId: 'BUS-A' }], [bus('BUS-A', 40)]);

        expect(ranked[0]).toEqual(
            expect.objectContaining({ reportCount: 1, verifiedReportCount: 0 })
        );
    });

    it("prefers the report's own snapshot of the vehicle", () => {
        const ranked = mostReportedVehicles(
            [
                {
                    busId: 'BUS-A',
                    status: 'PENDING',
                    vehicle: { numberPlate: 'NB-OLD', busModel: 'Rosa', manufacturer: 'Mitsubishi' },
                },
            ],
            [bus('BUS-A', 40, 'ACTIVE', { numberPlate: 'NB-NEW', busModel: 'Viking' })]
        );

        expect(ranked[0]).toEqual(
            expect.objectContaining({
                numberPlate: 'NB-OLD',
                busModel: 'Rosa',
                manufacturer: 'Mitsubishi',
            })
        );
    });

    it('falls back to the live fleet record when the report carried no snapshot', () => {
        const ranked = mostReportedVehicles(
            [issue('BUS-A')],
            [bus('BUS-A', 40, 'ACTIVE', { numberPlate: 'NB-9999', busModel: 'Viking' })]
        );

        expect(ranked[0]).toEqual(
            expect.objectContaining({ numberPlate: 'NB-9999', busModel: 'Viking' })
        );
    });

    it('falls back to the bus id when neither names the vehicle', () => {
        const ranked = mostReportedVehicles([issue('BUS-GONE')], []);

        expect(ranked[0]).toEqual(
            expect.objectContaining({
                busId: 'BUS-GONE',
                numberPlate: 'BUS-GONE',
                busModel: null,
                manufacturer: null,
            })
        );
    });

    it('still ranks a bus that has been removed from the fleet', () => {
        const ranked = mostReportedVehicles(
            [issue('BUS-GONE'), issue('BUS-GONE'), issue('BUS-A')],
            [bus('BUS-A', 40)]
        );

        expect(ranked[0]).toEqual(expect.objectContaining({ busId: 'BUS-GONE', reportCount: 2 }));
    });

    it('returns at most the top five', () => {
        const reports = Array.from({ length: 8 }, (_, index) =>
            Array.from({ length: index + 1 }, () => issue(`BUS-${index}`))
        ).flat();

        const ranked = mostReportedVehicles(reports, []);

        expect(ranked).toHaveLength(TOP_RANKED_LIMIT);
        expect(ranked.map((entry) => entry.reportCount)).toEqual([8, 7, 6, 5, 4]);
    });

    it('breaks a tie on the verified count, then on the bus id', () => {
        const ranked = mostReportedVehicles(
            [
                issue('BUS-B', 'PENDING'),
                issue('BUS-B', 'PENDING'),
                issue('BUS-A', 'PENDING'),
                issue('BUS-A', 'PENDING'),
                issue('BUS-C', 'VERIFIED'),
                issue('BUS-C', 'PENDING'),
            ],
            []
        );

        // All three have two reports. BUS-C has one upheld, so it leads; the
        // other two are separated by their ids.
        expect(ranked.map((entry) => entry.busId)).toEqual(['BUS-C', 'BUS-A', 'BUS-B']);
    });

    it('answers with nothing when there is nothing to rank', () => {
        expect(mostReportedVehicles(null, null)).toEqual([]);
        expect(mostReportedVehicles([], [])).toEqual([]);
    });
});

// ==================================================================
// 4. Accessibility Trends
// ==================================================================
describe('accessibility trend', () => {
    it('returns one bucket per week, oldest first, ending on the current week', () => {
        const trend = accessibilityScoreTrend([], { now: NOW });

        expect(trend).toHaveLength(TREND_WEEKS);
        expect(trend[TREND_WEEKS - 1].date).toBe('2026-09-24');
        expect(trend[TREND_WEEKS - 2].date).toBe('2026-09-17');
        // Twelve weeks back from the current week.
        expect(trend[0].date).toBe('2026-07-09');
    });

    it('honours a narrower window', () => {
        const trend = accessibilityScoreTrend([], { now: NOW, weeks: 3 });

        expect(trend.map((point) => point.date)).toEqual([
            '2026-09-10',
            '2026-09-17',
            '2026-09-24',
        ]);
    });

    it('averages the buses that have a known score in the bucket', () => {
        const trend = accessibilityScoreTrend(
            [
                historyEntry('BUS-A', 90, '2026-09-22T09:00:00.000Z'),
                historyEntry('BUS-B', 70, '2026-09-22T09:00:00.000Z'),
            ],
            { now: NOW, weeks: 2 }
        );

        expect(trend[1]).toEqual({ date: '2026-09-24', averageScore: 80 });
    });

    it('carries the latest known score forward into later weeks', () => {
        const trend = accessibilityScoreTrend(
            [historyEntry('BUS-A', 60, '2026-08-05T09:00:00.000Z')],
            { now: NOW, weeks: 4 }
        );

        // One entry, seven weeks before the window, and every bucket reports it.
        expect(trend.map((point) => point.averageScore)).toEqual([60, 60, 60, 60]);
    });

    it('moves to the newer score from the week it was recorded', () => {
        const trend = accessibilityScoreTrend(
            [
                historyEntry('BUS-A', 50, '2026-09-01T09:00:00.000Z'),
                // Recorded mid-week, so it belongs to that week rather than the next.
                historyEntry('BUS-A', 90, '2026-09-19T09:00:00.000Z'),
            ],
            { now: NOW, weeks: 4 }
        );

        expect(trend).toEqual([
            { date: '2026-09-03', averageScore: 50 },
            { date: '2026-09-10', averageScore: 50 },
            { date: '2026-09-17', averageScore: 90 },
            { date: '2026-09-24', averageScore: 90 },
        ]);
    });

    it('is null, not 0, for a week before any score was recorded', () => {
        const trend = accessibilityScoreTrend(
            [historyEntry('BUS-A', 90, '2026-09-19T09:00:00.000Z')],
            { now: NOW, weeks: 3 }
        );

        expect(trend).toEqual([
            { date: '2026-09-10', averageScore: null },
            { date: '2026-09-17', averageScore: 90 },
            { date: '2026-09-24', averageScore: 90 },
        ]);
    });

    it('lets a bus join the line partway through without dragging it down', () => {
        const trend = accessibilityScoreTrend(
            [
                historyEntry('BUS-A', 80, '2026-09-01T09:00:00.000Z'),
                historyEntry('BUS-B', 40, '2026-09-19T09:00:00.000Z'),
            ],
            { now: NOW, weeks: 3 }
        );

        // BUS-B contributes nothing before it existed — the first bucket is
        // BUS-A alone at 80, not 80 and a 0 averaged to 40.
        expect(trend.map((point) => point.averageScore)).toEqual([80, 60, 60]);
    });

    it('is all null on an empty history', () => {
        const trend = accessibilityScoreTrend([], { now: NOW, weeks: 3 });

        expect(trend.every((point) => point.averageScore === null)).toBe(true);
    });

    it('is all null when handed no history at all', () => {
        expect(accessibilityScoreTrend(null, { now: NOW, weeks: 2 })).toEqual([
            { date: '2026-09-17', averageScore: null },
            { date: '2026-09-24', averageScore: null },
        ]);
    });

    it('keeps a recorded score of zero rather than reading it as no data', () => {
        const trend = accessibilityScoreTrend(
            [historyEntry('BUS-A', 0, '2026-09-19T09:00:00.000Z')],
            { now: NOW, weeks: 2 }
        );

        expect(trend[1].averageScore).toBe(0);
    });

    it('drops an entry that cannot be read rather than guessing at it', () => {
        const trend = accessibilityScoreTrend(
            [
                { busId: 'BUS-A', accessibilityScore: 90, calculatedAt: 'not-a-date' },
                { busId: '', accessibilityScore: 90, calculatedAt: '2026-09-19T09:00:00.000Z' },
                { busId: 'BUS-C', accessibilityScore: null, calculatedAt: '2026-09-19T09:00:00.000Z' },
                historyEntry('BUS-D', 70, '2026-09-19T09:00:00.000Z'),
            ],
            { now: NOW, weeks: 1 }
        );

        expect(trend).toEqual([{ date: '2026-09-24', averageScore: 70 }]);
    });

    it('ignores an entry recorded after the window closes', () => {
        const trend = accessibilityScoreTrend(
            [historyEntry('BUS-A', 90, '2027-01-01T00:00:00.000Z')],
            { now: NOW, weeks: 2 }
        );

        expect(trend.every((point) => point.averageScore === null)).toBe(true);
    });

    it('asks for no buckets when asked for no weeks', () => {
        expect(accessibilityScoreTrend([], { now: NOW, weeks: 0 })).toEqual([]);
    });
});

// ==================================================================
// 5. The whole report
// ==================================================================
describe('accessibility analytics', () => {
    it('derives all four figures from one set of records', () => {
        const analytics = accessibilityAnalytics(
            {
                buses: [bus('BUS-A', 90), bus('BUS-B', 70), bus('BUS-C', 10, 'INACTIVE')],
                trips: [trip('R-138', 'BUS-A'), trip('R-138', 'BUS-B'), trip('R-255', 'BUS-A')],
                routes: [route('R-138'), route('R-255'), route('R-999')],
                reports: [issue('BUS-B', 'VERIFIED'), issue('BUS-B'), positive('BUS-A')],
                history: [historyEntry('BUS-A', 90, '2026-09-19T09:00:00.000Z')],
            },
            { now: NOW, weeks: 2 }
        );

        expect(analytics.averageScore).toEqual({ value: 80, busesIncluded: 2 });
        expect(analytics.mostAccessibleRoutes.map((entry) => entry.routeId)).toEqual([
            'R-255',
            'R-138',
        ]);
        expect(analytics.mostReportedVehicles).toEqual([
            expect.objectContaining({ busId: 'BUS-B', reportCount: 2, verifiedReportCount: 1 }),
        ]);
        expect(analytics.trend).toEqual([
            { date: '2026-09-17', averageScore: 90 },
            { date: '2026-09-24', averageScore: 90 },
        ]);
    });

    it('answers with empty figures rather than failing on an empty platform', () => {
        const analytics = accessibilityAnalytics({}, { now: NOW, weeks: 2 });

        expect(analytics.averageScore).toEqual({ value: null, busesIncluded: 0 });
        expect(analytics.mostAccessibleRoutes).toEqual([]);
        expect(analytics.mostReportedVehicles).toEqual([]);
        expect(analytics.trend.every((point) => point.averageScore === null)).toBe(true);
    });
});
