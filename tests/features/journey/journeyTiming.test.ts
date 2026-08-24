// The estimated travel time a passenger is actually shown (MOV-88).
//
// The bug this replaces: a trip stores one departure time and one arrival time
// for its WHOLE route, so a passenger boarding partway along was shown the whole
// route's duration. On the five-stop route below that meant a Malabe -> Borella
// search reporting 41 minutes for a 33-minute journey.
//
// So the assertions here are about a span, not about a total. Each one names the
// stops travelled and the minutes that span should come to, and the arithmetic is
// written out in the test rather than recomputed from the fixture — a test that
// derives its expectation the same way the code does would keep passing after
// both went wrong together.
//
// The other half is honesty. When the configured timings do not cover the stops
// travelled there is no way to measure the journey from stored data, and these
// tests pin down that the answer is then "unknown" rather than a plausible wrong
// number.

import {
    resolveJourneyTiming,
    resolveLegTiming,
} from '../../../src/features/journey/utils/journeyTiming';

// ------------------------------------------------------------------
// Fixture: the project's own route, with realistic stop-to-stop timings.
//
//   Kaduwela --8m--> Malabe --6m--> Battaramulla --12m--> Rajagiriya --15m--> Borella
//
// End to end that is 41 minutes, and every partial journey below is a sum of a
// contiguous run of those four numbers.
// ------------------------------------------------------------------
const STOPS = ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella'];
const SEGMENTS = [8, 6, 12, 15];

const DEPARTS_FIRST_STOP = '09:00';
const ARRIVES_LAST_STOP = '09:41';

function leg(overrides: Partial<Parameters<typeof resolveLegTiming>[0]> = {}) {
    return {
        stops: STOPS,
        segmentDurationsMinutes: SEGMENTS,
        boardStop: 'Kaduwela',
        alightStop: 'Borella',
        scheduledDepartureTime: DEPARTS_FIRST_STOP,
        scheduledArrivalTime: ARRIVES_LAST_STOP,
        ...overrides,
    };
}

/** Minutes for a single-leg journey between two stops on the fixture route. */
const minutesFor = (boardStop: string, alightStop: string) =>
    resolveJourneyTiming([leg({ boardStop, alightStop })]).durationMinutes;

// ==================================================================
// A. THE PASSENGER'S OWN SPAN, NOT THE ROUTE'S TOTAL
// ==================================================================
describe('estimated travel time covers only the stops travelled', () => {
    it('gives the whole route to a passenger who travels the whole route', () => {
        // 8 + 6 + 12 + 15
        expect(minutesFor('Kaduwela', 'Borella')).toBe(41);
    });

    it('gives an intermediate boarder only the journey that remains', () => {
        // 6 + 12 + 15 — the 8 minutes before Malabe are not the passenger's.
        expect(minutesFor('Malabe', 'Borella')).toBe(33);
    });

    it('does not hand a Malabe to Borella passenger the Kaduwela to Borella total', () => {
        const wholeRoute = minutesFor('Kaduwela', 'Borella');

        expect(minutesFor('Malabe', 'Borella')).not.toBe(wholeRoute);
        expect(minutesFor('Malabe', 'Borella')).toBeLessThan(wholeRoute as number);
    });

    it('sums the last two segments for a Battaramulla to Borella journey', () => {
        // 12 + 15
        expect(minutesFor('Battaramulla', 'Borella')).toBe(27);
    });

    it('stops at the alighting stop and counts nothing beyond it', () => {
        // 8 + 6 + 12, with the final 15-minute segment excluded.
        expect(minutesFor('Kaduwela', 'Rajagiriya')).toBe(26);
    });

    it('measures a journey that neither starts nor ends at a route endpoint', () => {
        // 6 + 12
        expect(minutesFor('Malabe', 'Rajagiriya')).toBe(18);
    });

    it('measures a single hop from one segment alone', () => {
        expect(minutesFor('Battaramulla', 'Rajagiriya')).toBe(12);
    });

    it('sums in route order rather than in the order the stops are named', () => {
        // Every contiguous span is the sum of exactly the segments it crosses,
        // in sequence — checked across the whole route so a reversed or shifted
        // read of the array could not pass.
        const spans: [string, string, number][] = [
            ['Kaduwela', 'Malabe', 8],
            ['Kaduwela', 'Battaramulla', 14],
            ['Kaduwela', 'Rajagiriya', 26],
            ['Kaduwela', 'Borella', 41],
            ['Malabe', 'Battaramulla', 6],
            ['Malabe', 'Rajagiriya', 18],
            ['Malabe', 'Borella', 33],
            ['Battaramulla', 'Rajagiriya', 12],
            ['Battaramulla', 'Borella', 27],
            ['Rajagiriya', 'Borella', 15],
        ];

        for (const [boardStop, alightStop, expected] of spans) {
            expect(minutesFor(boardStop, alightStop)).toBe(expected);
        }
    });

    it('reports the timings as the source of the figure', () => {
        expect(resolveJourneyTiming([leg({ boardStop: 'Malabe' })]).source).toBe(
            'CONFIGURED_SEGMENTS'
        );
    });

    it('matches stop names the way the search does, ignoring case and padding', () => {
        expect(minutesFor('  malabe ', 'BORELLA')).toBe(33);
    });
});

// ==================================================================
// B. THE PASSENGER'S OWN BOARDING AND ALIGHTING TIMES
//
// The stored departure time belongs to the route's first stop. A passenger
// boarding later boards later, and a duration shown beside the wrong clock times
// would not add up.
// ==================================================================
describe('boarding and alighting times', () => {
    it('places a first-stop passenger at the trip departure time', () => {
        const timing = resolveJourneyTiming([leg()]);

        expect(timing.boardingTime).toBe('09:00');
        expect(timing.alightingTime).toBe('09:41');
    });

    it('places an intermediate boarder after the segments before their stop', () => {
        // Kaduwela 09:00, +8 to Malabe, then 33 minutes on board.
        const timing = resolveJourneyTiming([leg({ boardStop: 'Malabe' })]);

        expect(timing.boardingTime).toBe('09:08');
        expect(timing.alightingTime).toBe('09:41');
    });

    it('keeps the times consistent with the duration it reports', () => {
        const timing = resolveJourneyTiming([
            leg({ boardStop: 'Malabe', alightStop: 'Rajagiriya' }),
        ]);

        expect(timing.boardingTime).toBe('09:08');
        // 09:08 + 18 minutes
        expect(timing.alightingTime).toBe('09:26');
        expect(timing.durationMinutes).toBe(18);
    });

    it('wraps past midnight rather than producing an impossible time', () => {
        const timing = resolveJourneyTiming([
            leg({ boardStop: 'Rajagiriya', scheduledDepartureTime: '23:50' }),
        ]);

        // 23:50 + 26 minutes to Rajagiriya = 00:16, then 15 minutes on board.
        expect(timing.boardingTime).toBe('00:16');
        expect(timing.alightingTime).toBe('00:31');
        expect(timing.durationMinutes).toBe(15);
    });

    it('still reports the duration when the trip has no usable departure time', () => {
        const timing = resolveJourneyTiming([
            leg({ boardStop: 'Malabe', scheduledDepartureTime: null }),
        ]);

        expect(timing.durationMinutes).toBe(33);
        expect(timing.boardingTime).toBeNull();
        expect(timing.alightingTime).toBeNull();
    });
});

// ==================================================================
// C. WHEN THE TIMINGS DO NOT COVER THE JOURNEY
// ==================================================================
describe('routes with no configured stop-to-stop timings', () => {
    const untimed = (overrides = {}) =>
        resolveJourneyTiming([leg({ segmentDurationsMinutes: null, ...overrides })]);

    it('gives a whole-route passenger the trip scheduled duration', () => {
        // 09:00 to 09:41 — for this passenger the whole route IS their journey,
        // so the stored times are theirs and not an approximation.
        const timing = untimed();

        expect(timing.durationMinutes).toBe(41);
        expect(timing.source).toBe('WHOLE_ROUTE_SCHEDULE');
        expect(timing.boardingTime).toBe('09:00');
        expect(timing.alightingTime).toBe('09:41');
    });

    it('refuses to give a partial journey the route total', () => {
        const timing = untimed({ boardStop: 'Malabe' });

        expect(timing.durationMinutes).toBeNull();
        expect(timing.durationLabel).toBeNull();
        expect(timing.source).toBe('UNKNOWN');
        expect(timing.problem).toBe('SEGMENTS_INCOMPLETE');
    });

    it('reports no time rather than a partial sum when one crossed gap is untimed', () => {
        // Battaramulla -> Rajagiriya has no recorded timing, so a Malabe ->
        // Borella journey crosses a gap nobody has measured. Adding up only the
        // gaps that are known would understate the journey.
        const timing = resolveJourneyTiming([
            leg({
                boardStop: 'Malabe',
                segmentDurationsMinutes: [8, 6, null, 15],
            }),
        ]);

        expect(timing.durationMinutes).toBeNull();
        expect(timing.source).toBe('UNKNOWN');
    });

    it('still measures a journey that avoids the untimed gap', () => {
        const timing = resolveJourneyTiming([
            leg({
                boardStop: 'Kaduwela',
                alightStop: 'Battaramulla',
                segmentDurationsMinutes: [8, 6, null, 15],
            }),
        ]);

        expect(timing.durationMinutes).toBe(14);
    });

    it('treats a non-numeric or negative stored entry as untimed', () => {
        for (const bad of ['12', -5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
            const timing = resolveJourneyTiming([
                leg({
                    boardStop: 'Malabe',
                    alightStop: 'Battaramulla',
                    segmentDurationsMinutes: [8, bad as number, 12, 15],
                }),
            ]);

            expect(timing.durationMinutes).toBeNull();
        }
    });

    it('never falls back to a scheduled total for a partial journey, however short', () => {
        const timing = untimed({ boardStop: 'Rajagiriya', alightStop: 'Borella' });

        expect(timing.durationMinutes).toBeNull();
    });
});

// ==================================================================
// C2. A CLOCK TIME IS THE PASSENGER'S OWN, OR IT IS ABSENT
//
// A trip stores one departure (from the route's FIRST stop) and one arrival (at
// its LAST). Those two are this passenger's own only if they board first or
// alight last. Reporting either one in any other case hands them a time for a
// stop they never reach — which is exactly how a Kaduwela -> Malabe card came to
// display the bus's 07:10 arrival at Kollupitiya.
//
// Returning them where they DO apply matters just as much: it is the difference
// between "we cannot work this out" and "we know when your bus leaves".
// ==================================================================
describe('clock times on a route with no configured timings', () => {
    const untimed = (overrides = {}) =>
        resolveJourneyTiming([leg({ segmentDurationsMinutes: null, ...overrides })]);

    it('reports the departure for a passenger boarding at the first stop', () => {
        const timing = untimed({ alightStop: 'Rajagiriya' });

        expect(timing.boardingTime).toBe(DEPARTS_FIRST_STOP);
        // Rajagiriya is not the last stop, so its arrival is unknowable.
        expect(timing.alightingTime).toBeNull();
        expect(timing.durationMinutes).toBeNull();
    });

    it('reports the arrival for a passenger alighting at the last stop', () => {
        const timing = untimed({ boardStop: 'Rajagiriya' });

        expect(timing.alightingTime).toBe(ARRIVES_LAST_STOP);
        expect(timing.boardingTime).toBeNull();
        expect(timing.durationMinutes).toBeNull();
    });

    it('reports neither for a journey between two middle stops', () => {
        const timing = untimed({ boardStop: 'Malabe', alightStop: 'Rajagiriya' });

        expect(timing.boardingTime).toBeNull();
        expect(timing.alightingTime).toBeNull();
    });

    it('never hands the route arrival to a passenger alighting early', () => {
        for (const alightStop of ['Malabe', 'Battaramulla', 'Rajagiriya']) {
            expect(untimed({ alightStop }).alightingTime).not.toBe(ARRIVES_LAST_STOP);
        }
    });

    it('never hands the route departure to a passenger boarding late', () => {
        for (const boardStop of ['Malabe', 'Battaramulla', 'Rajagiriya']) {
            expect(untimed({ boardStop }).boardingTime).not.toBe(DEPARTS_FIRST_STOP);
        }
    });

    it('reports both ends for a passenger travelling the whole route', () => {
        const timing = untimed();

        expect(timing.boardingTime).toBe(DEPARTS_FIRST_STOP);
        expect(timing.alightingTime).toBe(ARRIVES_LAST_STOP);
    });
});

// ==================================================================
// D. INVALID JOURNEYS
//
// The search itself refuses a route whose origin comes after its destination, so
// anything reaching here reversed is malformed input. It must not become a
// negative duration.
// ==================================================================
describe('invalid stop combinations', () => {
    it('reports a reversed journey instead of a negative duration', () => {
        const timing = resolveJourneyTiming([
            leg({ boardStop: 'Borella', alightStop: 'Malabe' }),
        ]);

        expect(timing.durationMinutes).toBeNull();
        expect(timing.problem).toBe('REVERSED_STOPS');
        expect(timing.source).toBe('UNKNOWN');
    });

    it('reports a journey that begins and ends at the same stop', () => {
        const timing = resolveJourneyTiming([
            leg({ boardStop: 'Malabe', alightStop: 'Malabe' }),
        ]);

        expect(timing.durationMinutes).toBeNull();
        expect(timing.problem).toBe('REVERSED_STOPS');
    });

    it('reports a stop that is not on the route', () => {
        const timing = resolveJourneyTiming([leg({ boardStop: 'Galle' })]);

        expect(timing.durationMinutes).toBeNull();
        expect(timing.problem).toBe('STOP_NOT_ON_ROUTE');
    });

    it('survives an empty or malformed route without throwing', () => {
        expect(resolveJourneyTiming([leg({ stops: [] })]).durationMinutes).toBeNull();
        expect(
            resolveJourneyTiming([leg({ stops: undefined as unknown as string[] })])
                .durationMinutes
        ).toBeNull();
        expect(resolveJourneyTiming([]).durationMinutes).toBeNull();
        expect(
            resolveJourneyTiming(undefined as unknown as Parameters<typeof resolveJourneyTiming>[0])
                .durationMinutes
        ).toBeNull();
    });
});

// ==================================================================
// E. FORMATTING
//
// The label uses the project's existing duration format, so a journey measured
// from segments reads exactly like one measured between two clock times.
// ==================================================================
describe('the label shown on a journey card', () => {
    it('formats a sub-hour journey in minutes', () => {
        expect(resolveJourneyTiming([leg({ boardStop: 'Malabe' })]).durationLabel).toBe('33m');
    });

    it('formats an hour-plus journey with both parts', () => {
        const timing = resolveJourneyTiming([
            leg({ segmentDurationsMinutes: [30, 20, 15, 5] }),
        ]);

        expect(timing.durationMinutes).toBe(70);
        expect(timing.durationLabel).toBe('1h 10m');
    });

    it('formats a whole number of hours without a stray zero', () => {
        const timing = resolveJourneyTiming([
            leg({ segmentDurationsMinutes: [30, 30, 30, 30] }),
        ]);

        expect(timing.durationLabel).toBe('2h');
    });

    it('has no label when there is no duration to show', () => {
        const timing = resolveJourneyTiming([
            leg({ boardStop: 'Malabe', segmentDurationsMinutes: null }),
        ]);

        expect(timing.durationLabel).toBeNull();
    });
});

// ==================================================================
// F. TRANSFERS
//
// The journey search matches only routes that carry a passenger the whole way on
// one bus, so every journey it returns has one leg. The arithmetic is still
// written over the legs given, so an interchange is measured from its real legs
// rather than from one bus's route total.
// ==================================================================
describe('transfers', () => {
    it('reports no transfer for a single-leg journey', () => {
        const timing = resolveJourneyTiming([leg()]);

        expect(timing.transferCount).toBe(0);
        expect(timing.transferWaitMinutes).toEqual([]);
    });

    it('counts one transfer for a two-leg journey', () => {
        const timing = resolveJourneyTiming([
            leg({ alightStop: 'Battaramulla' }),
            leg({
                boardStop: 'Battaramulla',
                alightStop: 'Borella',
                scheduledDepartureTime: '09:20',
            }),
        ]);

        expect(timing.transferCount).toBe(1);
    });

    it('measures a transfer journey from its own legs plus the wait between them', () => {
        // Leg 1: Kaduwela -> Battaramulla, 8 + 6 = 14 minutes, 09:00 to 09:14.
        // Leg 2 departs its route's first stop at 09:20 and the passenger joins
        // it at Battaramulla, 14 minutes later, at 09:34 — a 20-minute wait.
        // On board for 12 + 15 = 27 minutes.
        const timing = resolveJourneyTiming([
            leg({ alightStop: 'Battaramulla' }),
            leg({
                boardStop: 'Battaramulla',
                alightStop: 'Borella',
                scheduledDepartureTime: '09:20',
            }),
        ]);

        expect(timing.perLeg.map((entry) => entry.durationMinutes)).toEqual([14, 27]);
        expect(timing.transferWaitMinutes).toEqual([20]);
        expect(timing.durationMinutes).toBe(14 + 20 + 27);
        expect(timing.boardingTime).toBe('09:00');
        expect(timing.alightingTime).toBe('10:01');
    });

    it('never reports a transfer journey as just the first bus route total', () => {
        const timing = resolveJourneyTiming([
            leg({ alightStop: 'Battaramulla' }),
            leg({
                boardStop: 'Battaramulla',
                alightStop: 'Borella',
                scheduledDepartureTime: '09:20',
            }),
        ]);

        // 41 is the first leg's route end to end; 14 is only its first leg.
        expect(timing.durationMinutes).not.toBe(41);
        expect(timing.durationMinutes).not.toBe(14);
    });

    it('reports no total when one leg of a transfer journey cannot be measured', () => {
        const timing = resolveJourneyTiming([
            leg({ alightStop: 'Battaramulla' }),
            leg({
                boardStop: 'Battaramulla',
                alightStop: 'Borella',
                segmentDurationsMinutes: null,
                scheduledDepartureTime: '09:20',
            }),
        ]);

        expect(timing.durationMinutes).toBeNull();
        // Still known to involve a change, which is worth telling a passenger.
        expect(timing.transferCount).toBe(1);
    });
});
