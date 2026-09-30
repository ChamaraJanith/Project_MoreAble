// Completed journeys: one date and one set of times on the card and the detail
// screen (MOV-309 / MOV-316).
//
//   Journey date         service date of schedule.scheduledDepartureAt
//   Scheduled departure  schedule.scheduledDepartureAt
//   Scheduled arrival    schedule.scheduledArrivalAt
//   Actual start         completion.journeyStartedAt
//   Actual end           completion.completedAt
//
// all on the service clock (serviceTime), and "Not available" for anything
// missing — in particular a run whose trip record a later run has replaced,
// whose schedule the server reports as null (MOV-314). Nothing is rebuilt
// from the booking's 'HH:MM' copy or borrowed from another time.
//
// The project has no React renderer. Besides reading the sources, the value
// each surface shows is worked out by evaluating the component's own
// expression for it, so the overnight and null cases run against real code.

import { readFileSync } from 'fs';
import { join } from 'path';
import {
    Booking,
    JourneyRunSchedule,
    PassengerCompletedJourney,
    PassengerJourneyCompletion,
} from '../../../src/entities/booking/model/types';
import { groupActivitiesWithOngoing } from '../../../src/features/activities/utils/activityStatus';
import { describeOngoingSchedule } from '../../../src/features/activities/utils/ongoingJourneyTracking';
import { formatServiceDate, formatServiceTime } from '../../../src/shared/utils/serviceTime';

const ROOT = join(__dirname, '..', '..', '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf-8');
const card = read('src/features/activities/ui/ActivityJourneyCard.tsx');
const screen = read('src/features/activities/ui/CompletedJourneyScreen.tsx');
const en = JSON.parse(read('src/shared/i18n/locales/en.json'));
const si = JSON.parse(read('src/shared/i18n/locales/si.json'));

const NA = 'Not available';
const PASSENGER = 'PAS-2026-00001';
const NOW = new Date('2026-09-22T06:00:00.000Z');

// ------------------------------------------------------------------
// Reading and evaluating the components' own expressions
// ------------------------------------------------------------------

/** The right-hand side of `const <name> = ...;`. */
function definition(source: string, name: string): string {
    const match = source.match(new RegExp(`const ${name} = ([^;]*);`));
    if (!match) throw new Error(`no const ${name}`);
    return match[1];
}

function evaluate(source: string, name: string, scope: Record<string, unknown>): unknown {
    return new Function(...Object.keys(scope), `return (${definition(source, name)});`)(...Object.values(scope));
}

interface Shown {
    date: unknown;
    scheduledDeparture: unknown;
    scheduledArrival: unknown;
    actualStart: unknown;
    actualEnd: unknown;
}

/** What a Completed card shows for a booking, from the card's own expressions. */
function cardShows(booking: Booking): Shown {
    const scope: Record<string, unknown> = { formatServiceDate, formatServiceTime, isOngoing: false, booking, notAvailable: NA };
    for (const name of ['completion', 'completedRun', 'completedServiceDate', 'completedScheduledDeparture', 'completedScheduledArrival', 'completedActualStart', 'completedActualEnd']) {
        scope[name] = evaluate(card, name, scope);
    }
    return {
        date: scope.completedServiceDate,
        scheduledDeparture: scope.completedScheduledDeparture,
        scheduledArrival: scope.completedScheduledArrival,
        actualStart: scope.completedActualStart,
        actualEnd: scope.completedActualEnd,
    };
}

/** What the Completed Journey screen shows, from the screen's own expressions. */
function detailShows(journey: PassengerCompletedJourney): Shown {
    const scope: Record<string, unknown> = { formatServiceDate, formatServiceTime, journey, completion: journey.completion, notAvailable: NA };
    for (const name of ['run', 'serviceDate', 'scheduledDeparture', 'scheduledArrival', 'actualStart', 'actualEnd']) {
        scope[name] = evaluate(screen, name, scope);
    }
    return {
        date: scope.serviceDate,
        scheduledDeparture: scope.scheduledDeparture,
        scheduledArrival: scope.scheduledArrival,
        actualStart: scope.actualStart,
        actualEnd: scope.actualEnd,
    };
}

// ------------------------------------------------------------------
// Fixtures. The overnight run: 23:30 on Mon 21 Sep -> 00:50 on Tue 22 Sep,
// Sri Lanka time; the bus started at 23:25 and the passenger finished 00:40.
// ------------------------------------------------------------------

const OVERNIGHT: JourneyRunSchedule = {
    scheduledDepartureAt: '2026-09-21T18:00:00.000Z',
    scheduledArrivalAt: '2026-09-21T19:20:00.000Z',
};
const NO_SCHEDULE: JourneyRunSchedule = { scheduledDepartureAt: null, scheduledArrivalAt: null };

const completion = (overrides: Partial<PassengerJourneyCompletion> = {}): PassengerJourneyCompletion => ({
    status: 'COMPLETED',
    tripId: 'TRIP-001',
    busId: 'BUS-A',
    journeyStartedAt: '2026-09-21T17:55:00.000Z',
    completedAt: '2026-09-21T19:10:00.000Z',
    completionReason: 'PASSENGER',
    journeyStops: ['Kaduwela', 'Rajagiriya'],
    plannedDistanceKm: 9.6,
    ...overrides,
});

function makeBooking(bookingId: string, overrides: Partial<Booking> = {}): Booking {
    return {
        bookingId,
        userId: PASSENGER,
        tripId: 'TRIP-001',
        routeId: 'ROUTE-177',
        busId: 'BUS-A',
        seatNumber: '05A',
        isPrioritySeat: false,
        pairedSeatNumber: null,
        status: 'CONFIRMED',
        // A booked date, a boarding scan and the booking's 'HH:MM' copy that
        // none of the Completed values may use.
        journeyDate: '2026-09-25',
        travelDate: '2026-09-25',
        boardingStatus: 'BOARDED',
        boardedAt: '2026-09-23T02:00:00.000Z',
        journey: {
            routeNumber: '177',
            routeName: 'Kaduwela - Kollupitiya',
            startLocation: 'Kaduwela',
            endLocation: 'Rajagiriya',
            departureTime: '06:00',
            estimatedArrivalTime: '07:15',
            journeyDate: '2026-09-25',
            departureDate: '2026-09-25',
        },
        vehicle: { numberPlate: 'NB-8899', busModel: 'Viking', manufacturer: 'Ashok Leyland' },
        qrPayload: '',
        fare: { distanceKm: 10, baseFare: 30, distanceFare: 50, totalFare: 80, currency: 'LKR', isEstimate: false },
        assistanceRequested: { boardingAssistance: false, walkingAssistance: false, prioritySeatAssistance: false },
        specialRequests: '',
        createdAt: '2026-09-20T12:00:00.000Z',
        ...overrides,
    };
}

function completedFor(booking: Booking, schedule: JourneyRunSchedule = OVERNIGHT, record = completion()): PassengerCompletedJourney {
    return {
        booking: { ...booking, fare: { totalFare: 80, currency: 'LKR', isEstimate: false } },
        completion: record,
        schedule,
    };
}

/** The Completed card's booking exactly as Activities builds it. */
function completedCardBooking(journey: PassengerCompletedJourney, history: Booking = makeBooking(journey.booking.bookingId)): Booking {
    const { completed } = groupActivitiesWithOngoing([history], [], PASSENGER, NOW, [journey]);
    expect(completed).toHaveLength(1);
    return completed[0];
}

const OVERNIGHT_SHOWN: Shown = {
    date: 'Mon, 21 Sep 2026',
    scheduledDeparture: '11:30 PM',
    scheduledArrival: '12:50 AM',
    actualStart: '11:25 PM',
    actualEnd: '12:40 AM',
};

// ------------------------------------------------------------------
describe('A. the completed run’s schedule reaches the card', () => {
    it('is attached with the completion, exactly as the completed-journeys response gave it', () => {
        const booking = completedCardBooking(completedFor(makeBooking('BK-A')));

        expect(booking.passengerJourney).toEqual(completion());
        expect(booking.passengerJourneySchedule).toEqual(OVERNIGHT);
        expect(booking.passengerJourneySchedule?.scheduledDepartureAt).toBe('2026-09-21T18:00:00.000Z');
        expect(booking.passengerJourneySchedule?.scheduledArrivalAt).toBe('2026-09-21T19:20:00.000Z');
    });

    it('keeps a null schedule null', () => {
        expect(completedCardBooking(completedFor(makeBooking('BK-A'), NO_SCHEDULE)).passengerJourneySchedule).toEqual(NO_SCHEDULE);
    });

    it('is absent, safely, when the response carries no schedule', () => {
        const journey = completedFor(makeBooking('BK-A'));
        delete (journey as Partial<PassengerCompletedJourney>).schedule;

        const booking = completedCardBooking(journey);

        expect(booking.passengerJourneySchedule).toBeUndefined();
        expect(cardShows(booking)).toMatchObject({ date: NA, scheduledDeparture: NA, scheduledArrival: NA });
    });

    it('never takes a schedule from the history copy of the booking', () => {
        const stray = makeBooking('BK-A', { passengerJourneySchedule: OVERNIGHT });

        // Not completed on the server: nothing attached, and not Completed at all.
        const notCompleted = groupActivitiesWithOngoing([stray], [], PASSENGER, NOW, []);
        expect(notCompleted.completed.every((booking) => booking.passengerJourneySchedule === undefined)).toBe(true);

        // Completed on the server with a null schedule: the history's copy is not used.
        expect(completedCardBooking(completedFor(makeBooking('BK-A'), NO_SCHEDULE), stray).passengerJourneySchedule).toEqual(NO_SCHEDULE);
    });

    it('never attaches one booking’s schedule to another', () => {
        const a = makeBooking('BK-A');
        const b = makeBooking('BK-B');
        const other: JourneyRunSchedule = { scheduledDepartureAt: '2026-09-20T00:30:00.000Z', scheduledArrivalAt: '2026-09-20T01:45:00.000Z' };

        const { completed } = groupActivitiesWithOngoing([a, b], [], PASSENGER, NOW, [completedFor(a), completedFor(b, other)]);

        expect(completed.find((booking) => booking.bookingId === 'BK-A')?.passengerJourneySchedule).toEqual(OVERNIGHT);
        expect(completed.find((booking) => booking.bookingId === 'BK-B')?.passengerJourneySchedule).toEqual(other);
    });
});

// ------------------------------------------------------------------
describe('B. Completed card', () => {
    it.each([
        ['1. Journey date', 'completedServiceDate', 'formatServiceDate(completedRun?.scheduledDepartureAt) ?? notAvailable'],
        ['2. Scheduled departure', 'completedScheduledDeparture', 'formatServiceTime(completedRun?.scheduledDepartureAt) ?? notAvailable'],
        ['3. Scheduled arrival', 'completedScheduledArrival', 'formatServiceTime(completedRun?.scheduledArrivalAt) ?? notAvailable'],
        ['4. Actual start', 'completedActualStart', 'formatServiceTime(completion?.journeyStartedAt) ?? notAvailable'],
        ['5. Actual end', 'completedActualEnd', 'formatServiceTime(completion?.completedAt) ?? notAvailable'],
    ])('%s comes only from its own time, through serviceTime', (_, name, expected) => {
        expect(definition(card, name)).toBe(expected);
    });

    it('reads the run’s schedule and the completion only on a Completed card', () => {
        expect(definition(card, 'completedRun')).toBe('isOngoing ? undefined : booking.passengerJourneySchedule');
        expect(definition(card, 'completion')).toBe('isOngoing ? undefined : booking.passengerJourney');
    });

    it.each([
        ['activities.journeyDate', "'Journey date: {{date}}', { date: completedServiceDate }"],
        ['activities.scheduledDeparture', "'Scheduled departure: {{time}}', { time: completedScheduledDeparture }"],
        ['activities.scheduledArrival', "'Scheduled arrival: {{time}}', { time: completedScheduledArrival }"],
        ['activities.actualStart', "'Actual start: {{time}}', { time: completedActualStart }"],
        ['activities.actualEnd', "'Actual end: {{time}}', { time: completedActualEnd }"],
    ])('labels %s clearly', (key, call) => {
        expect(card).toContain(`t('${key}', ${call})`);
    });

    it('9. shows every badge on every Completed card, never only when its time exists', () => {
        const start = card.indexOf('{!isOngoing && (');
        const group = card.slice(start + '{!isOngoing && ('.length, card.indexOf('</>', start));
        expect(group.trim().startsWith('<>')).toBe(true);
        expect(group).not.toMatch(/&&|\?\s*\(|!!/);
        for (const value of ['completedServiceDate', 'completedScheduledDeparture', 'completedScheduledArrival', 'completedActualStart', 'completedActualEnd']) {
            expect(group).toContain(`: ${value} }`);
        }
    });

    it('7/8. uses no fallback chain and no booking HH:MM', () => {
        for (const gone of ['rawDate', 'boardedAt', 'travelDate', 'departureDate', 'departureTime', 'estimatedArrivalTime', '{departure} → {arrival}', "t('activities.completedAt'"]) {
            expect(card).not.toContain(gone);
        }
    });

    it('10. a missing schedule shows "Not available", never the booking dates or HH:MM', () => {
        expect(cardShows(completedCardBooking(completedFor(makeBooking('BK-A'), NO_SCHEDULE)))).toEqual({
            ...OVERNIGHT_SHOWN,
            date: NA,
            scheduledDeparture: NA,
            scheduledArrival: NA,
        });
    });

    it('10. a Completed card with no recorded completion shows "Not available" throughout', () => {
        // Boarded, and its arrival has passed, but no completion was recorded
        // (a run that expired without End Journey): nothing to show, so nothing is shown.
        const legacy = makeBooking('BK-LEGACY', { boardedAt: '2026-09-21T00:35:00.000Z' });
        const { completed } = groupActivitiesWithOngoing([legacy], [], PASSENGER, NOW, []);

        expect(completed.map((booking) => booking.bookingId)).toEqual(['BK-LEGACY']);
        expect(cardShows(completed[0])).toEqual({ date: NA, scheduledDeparture: NA, scheduledArrival: NA, actualStart: NA, actualEnd: NA });
    });
});

// ------------------------------------------------------------------
describe('C. Completed Journey screen', () => {
    /** The `<InfoRow ... />` whose label uses translation `key`, and what precedes it. */
    function infoRow(key: string): { row: string; before: string } {
        const at = screen.indexOf(`t('${key}',`);
        expect(at).toBeGreaterThan(-1);
        const start = screen.lastIndexOf('<InfoRow', at);
        return { row: screen.slice(start, screen.indexOf('/>', at) + 2), before: screen.slice(0, start).trimEnd() };
    }

    it.each([
        ['1. Journey date', 'serviceDate', 'formatServiceDate(run?.scheduledDepartureAt) ?? notAvailable', 'ongoingJourney.journeyDate'],
        ['2. Scheduled departure', 'scheduledDeparture', 'formatServiceTime(run?.scheduledDepartureAt) ?? notAvailable', 'ongoingJourney.scheduledDepartureTime'],
        ['3. Scheduled arrival', 'scheduledArrival', 'formatServiceTime(run?.scheduledArrivalAt) ?? notAvailable', 'ongoingJourney.scheduledArrivalTime'],
        ['4. Actual start', 'actualStart', 'formatServiceTime(completion.journeyStartedAt) ?? notAvailable', 'ongoingJourney.actualStart'],
        ['5. Actual end', 'actualEnd', 'formatServiceTime(completion.completedAt) ?? notAvailable', 'completedJourney.actualEnd'],
    ])('%s comes only from its own time, through serviceTime, in an always-shown row', (_, name, expected, key) => {
        expect(definition(screen, name)).toBe(expected);
        const { row, before } = infoRow(key);
        expect(row).toContain(`value={${name}}`);
        expect(before).not.toMatch(/(&&|\?|:)\s*\(?$/);
    });

    it('reads the schedule the completed-journeys response gave for this journey', () => {
        expect(definition(screen, 'run')).toBe('journey.schedule');
        expect(screen).toContain("import { formatServiceDate, formatServiceTime } from '../../../shared/utils/serviceTime';");
    });

    it('7. a null schedule (the run was replaced by a later one) shows "Not available", never HH:MM', () => {
        expect(detailShows(completedFor(makeBooking('BK-A'), NO_SCHEDULE))).toEqual({
            ...OVERNIGHT_SHOWN,
            date: NA,
            scheduledDeparture: NA,
            scheduledArrival: NA,
        });
    });

    it('9. keeps the passenger’s own stop times, only when the route can place them', () => {
        const departure = infoRow('ongoingJourney.scheduledAtStop');
        expect(departure.row).toContain('value={schedule.departure.time ?? notAvailable}');
        expect(departure.before.endsWith('{schedule.departure.isPassengerStop && (')).toBe(true);

        const arrival = infoRow('ongoingJourney.scheduledArrival');
        expect(arrival.row).toContain('value={schedule.arrival.time ?? notAvailable}');
        expect(arrival.before.endsWith('{schedule.arrival.isPassengerStop && (')).toBe(true);
    });

    it('10. renders no HH:MM route-start or route-end row', () => {
        for (const gone of ['ongoingJourney.tripDeparture', 'ongoingJourney.tripArrival', 'Trip departure (route start)', 'Trip arrival (route end)']) {
            expect(screen).not.toContain(gone);
        }
    });

    it('11. describeOngoingSchedule itself is unchanged: it still flags the route times it falls back to', () => {
        const journey = {
            booking: { journey: { startLocation: 'Kaduwela', endLocation: 'Rajagiriya', departureTime: '06:00', estimatedArrivalTime: '07:15' } },
        } as any;

        expect(describeOngoingSchedule(journey, null)).toEqual({
            departure: { time: '6:00 AM', isPassengerStop: false },
            arrival: { time: '7:15 AM', isPassengerStop: false },
            durationLabel: null,
        });
    });

    it('keeps how it finished and the time on board', () => {
        expect(screen).toContain('const reason = completionReasonLabel(completion.completionReason);');
        expect(screen).toContain('const onBoard = timeOnBoardLabel(booking, completion);');
        expect(screen).not.toMatch(/completionTimeCaption|completedJourney\.(youCompletedAt|completedAt|busStarted|date)'/);
    });
});

// ------------------------------------------------------------------
describe('E. an overnight journey, on both surfaces', () => {
    it('card: date D, 11:30 PM -> 12:50 AM, started 11:25 PM, ended 12:40 AM', () => {
        expect(cardShows(completedCardBooking(completedFor(makeBooking('BK-A'))))).toEqual(OVERNIGHT_SHOWN);
    });

    it('detail: the same', () => {
        expect(detailShows(completedFor(makeBooking('BK-A')))).toEqual(OVERNIGHT_SHOWN);
    });

    it('a start after midnight still dates the journey by its scheduled departure', () => {
        const late = completion({ journeyStartedAt: '2026-09-21T18:35:00.000Z', completedAt: '2026-09-21T19:40:00.000Z' });
        const journey = completedFor(makeBooking('BK-A'), OVERNIGHT, late);

        for (const shown of [cardShows(completedCardBooking(journey)), detailShows(journey)]) {
            expect(shown).toEqual({ ...OVERNIGHT_SHOWN, actualStart: '12:05 AM', actualEnd: '1:10 AM' });
        }
    });
});

// ------------------------------------------------------------------
describe('F. no device-local formatting on the Completed surfaces', () => {
    it.each([
        'src/features/activities/ui/ActivityJourneyCard.tsx',
        'src/features/activities/ui/CompletedJourneyScreen.tsx',
        'src/features/activities/utils/completedJourney.ts',
    ])('%s', (file) => {
        const source = read(file);
        for (const banned of ['.getHours(', '.getMinutes(', '.getDate(', '.getDay(', 'toLocale', 'formatFriendlyDate', 'formatClockTime', 'formatJourneyDay', 'formatStartedAt']) {
            expect(source).not.toContain(banned);
        }
    });

    it('the device-local helpers these screens used are gone', () => {
        expect(read('src/features/activities/utils/ongoingJourneyTracking.ts')).not.toContain('formatClockTime');
        expect(read('src/features/activities/utils/completedJourney.ts')).not.toMatch(/formatJourneyDay|completionTimeCaption/);
    });
});

// ------------------------------------------------------------------
describe('G. the card and the detail screen agree', () => {
    const pairs: [string, string][] = [
        ['completedServiceDate', 'serviceDate'],
        ['completedScheduledDeparture', 'scheduledDeparture'],
        ['completedScheduledArrival', 'scheduledArrival'],
        ['completedActualStart', 'actualStart'],
        ['completedActualEnd', 'actualEnd'],
    ];
    /** The formatter and the field it formats: `formatServiceTime`, `scheduledArrivalAt`. */
    const source = (expression: string) => expression.match(/^(formatService(?:Date|Time))\(\w+\??\.(\w+)\) \?\? notAvailable$/)?.slice(1);

    it.each(pairs)('%s and %s format the same field the same way', (cardName, screenName) => {
        const fromCard = source(definition(card, cardName));
        expect(fromCard).toBeDefined();
        expect(source(definition(screen, screenName))).toEqual(fromCard);
    });

    it.each([
        ['the overnight run', OVERNIGHT],
        ['a replaced run', NO_SCHEDULE],
        ['an ordinary morning run', { scheduledDepartureAt: '2026-09-21T00:30:00.000Z', scheduledArrivalAt: '2026-09-21T01:45:00.000Z' }],
    ])('show the same values for %s', (_, schedule) => {
        const journey = completedFor(makeBooking('BK-A'), schedule as JourneyRunSchedule);
        expect(cardShows(completedCardBooking(journey))).toEqual(detailShows(journey));
    });
});

// ------------------------------------------------------------------
describe('H. wording in English and Sinhala', () => {
    const lookup = (locale: any, key: string) => key.split('.').reduce((node, part) => node?.[part], locale);
    const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

    it.each([
        ['activities.journeyDate', 'Journey date: {{date}}', card],
        ['activities.scheduledDeparture', 'Scheduled departure: {{time}}', card],
        ['activities.scheduledArrival', 'Scheduled arrival: {{time}}', card],
        ['activities.actualStart', 'Actual start: {{time}}', card],
        ['activities.actualEnd', 'Actual end: {{time}}', card],
        ['activities.notAvailable', 'Not available', card],
        ['ongoingJourney.journeyDate', 'Journey date', screen],
        ['ongoingJourney.scheduledDepartureTime', 'Scheduled departure', screen],
        ['ongoingJourney.scheduledArrivalTime', 'Scheduled arrival', screen],
        ['ongoingJourney.actualStart', 'Actual start', screen],
        ['ongoingJourney.notAvailable', 'Not available', screen],
        ['completedJourney.actualEnd', 'Actual end', screen],
    ])('%s: English matches the component, Sinhala is Sinhala script with the same placeholders', (key, english, component) => {
        expect(lookup(en, key)).toBe(english);
        expect(component.replace(/\s+/g, ' ')).toContain(`'${key}', '${english}'`);

        const sinhala = lookup(si, key);
        expect(typeof sinhala).toBe('string');
        expect(sinhala).toMatch(/[඀-෿]/);
        expect(sinhala.replace(/\{\{\w+\}\}/g, '')).not.toMatch(/[A-Za-z]/);
        expect(placeholders(sinhala)).toEqual(placeholders(english));
    });

    it('both languages have exactly the same keys', () => {
        const keys = (node: any, prefix = ''): string[] =>
            Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`]));
        expect(keys(si).sort()).toEqual(keys(en).sort());
    });
});
