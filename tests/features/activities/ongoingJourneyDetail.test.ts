// The Live Journey screen's date and times (MOV-309 / MOV-315).
//
// Like journeyUiCopy and ongoingJourneyCard, this reads the component's source
// (the project has no React renderer). It pins where each value in "Journey
// information" comes from:
//
//   Journey date         service date of activeJourney.scheduledDepartureAt
//   Scheduled departure  activeJourney.scheduledDepartureAt, on the service clock
//   Scheduled arrival    activeJourney.scheduledArrivalAt, on the service clock
//   Actual start         activeJourney.startedAt, on the service clock
//
// that a missing one reads "Not available" and is never hidden or borrowed,
// that the passenger's own stop times stay beside them, and that the old
// 'HH:MM' route-start/route-end rows are gone. It also pins the new wording in
// both languages, an overnight service, and that the Activities card and this
// screen read the same sources.

import { readFileSync } from 'fs';
import { join } from 'path';
import { describeOngoingSchedule } from '../../../src/features/activities/utils/ongoingJourneyTracking';
import { scheduledServiceFor } from '../../../src/shared/utils/journeyLifecycle';
import { formatServiceDate, formatServiceTime, serviceDateOf } from '../../../src/shared/utils/serviceTime';

const ROOT = join(__dirname, '..', '..', '..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf-8');
const screen = read('src/features/activities/ui/OngoingJourneyScreen.tsx');
const card = read('src/features/activities/ui/ActivityJourneyCard.tsx');
const en = JSON.parse(read('src/shared/i18n/locales/en.json'));
const si = JSON.parse(read('src/shared/i18n/locales/si.json'));

/** The right-hand side of `const <name> = ...;` in a component. */
function definition(source: string, name: string): string {
    const match = source.match(new RegExp(`const ${name} = ([^;]*);`));
    if (!match) throw new Error(`no const ${name}`);
    return match[1];
}

/** The `<InfoRow ... />` whose label uses translation `key`, and what precedes it. */
function infoRow(key: string): { row: string; before: string } {
    // Exact key: `ongoingJourney.scheduledArrival` must not match `...scheduledArrivalTime`.
    const at = screen.indexOf(`t('${key}',`);
    expect(at).toBeGreaterThan(-1);
    const start = screen.lastIndexOf('<InfoRow', at);
    return { row: screen.slice(start, screen.indexOf('/>', at) + 2), before: screen.slice(0, start).trimEnd() };
}

const DEVICE_LOCAL = ['formatClockTime', 'formatFriendlyDate', 'formatDisplayDate', 'getHours', 'getMinutes', 'getDate', 'getDay', 'getMonth', 'toLocale'];
const OTHER_TIMES = ['boardedAt', 'journeyDate', 'travelDate', 'departureDate', 'completedAt', 'departureTime', 'estimatedArrivalTime', 'expiresAt'];

// ------------------------------------------------------------------
describe('C. Live Journey — the run it describes', () => {
    it('reads the running journey the server sent, and the shared service-time formatter', () => {
        expect(definition(screen, 'run')).toBe('journey!.activeJourney');
        expect(screen).toContain("import { formatServiceDate, formatServiceTime } from '../../../shared/utils/serviceTime';");
    });

    it.each([
        ['1. Journey date', 'serviceDate', 'formatServiceDate(run?.scheduledDepartureAt) ?? notAvailable', 'ongoingJourney.journeyDate'],
        ['2. Scheduled departure', 'scheduledDeparture', 'formatServiceTime(run?.scheduledDepartureAt) ?? notAvailable', 'ongoingJourney.scheduledDepartureTime'],
        ['3. Scheduled arrival', 'scheduledArrival', 'formatServiceTime(run?.scheduledArrivalAt) ?? notAvailable', 'ongoingJourney.scheduledArrivalTime'],
        ['4. Actual start', 'actualStart', 'formatServiceTime(run?.startedAt) ?? notAvailable', 'ongoingJourney.actualStart'],
    ])('%s comes only from its own persisted time', (_, name, expected, key) => {
        expect(definition(screen, name)).toBe(expected);
        expect(infoRow(key).row).toContain(`value={${name}}`);
    });

    it.each(['serviceDate', 'scheduledDeparture', 'scheduledArrival', 'actualStart'])(
        '12. %s uses no device-local formatting and no other timestamp',
        (name) => {
            const expression = definition(screen, name);
            for (const banned of [...DEVICE_LOCAL, ...OTHER_TIMES]) {
                expect(expression).not.toContain(banned);
            }
        }
    );

    it('keeps scheduled and actual apart', () => {
        expect(definition(screen, 'scheduledDeparture')).not.toContain('startedAt');
        expect(definition(screen, 'actualStart')).not.toContain('scheduled');
        expect(definition(screen, 'scheduledArrival')).not.toContain('Departure');
    });

    it('11/12. no longer formats any time with the device-local helpers', () => {
        for (const banned of DEVICE_LOCAL) {
            expect(screen).not.toContain(banned);
        }
    });
});

describe('C. Live Journey — a missing time says so', () => {
    it('uses the project wording for an unavailable value', () => {
        expect(definition(screen, 'notAvailable')).toBe("t('ongoingJourney.notAvailable', 'Not available')");
    });

    it('5/6/7. the formatter gives nothing for a missing time, so "Not available" is shown', () => {
        for (const missing of [undefined, null, '', 'not-a-date']) {
            expect(formatServiceDate(missing)).toBeNull();
            expect(formatServiceTime(missing)).toBeNull();
        }
    });

    it.each(['ongoingJourney.journeyDate', 'ongoingJourney.scheduledDepartureTime', 'ongoingJourney.scheduledArrivalTime', 'ongoingJourney.actualStart'])(
        '5/6/7. the %s row is always shown, never only when its time exists',
        (key) => {
            // Nothing conditional right before the row: no `x && (`, `x &&`, `x ? (` or `x ?`.
            expect(infoRow(key).before).not.toMatch(/(&&|\?|:)\s*\(?$/);
        }
    );

    it('7. no longer hides the start when it is missing', () => {
        expect(screen).not.toContain('!!startedAt');
    });
});

describe("C. Live Journey — the passenger's own stops, and no route-start fallback", () => {
    it('8. keeps the stop-specific times, labelled with the stop, when the route can place them', () => {
        const departure = infoRow('ongoingJourney.scheduledAtStop');
        expect(departure.row).toContain("'Scheduled at {{stop}}', { stop: origin }");
        expect(departure.row).toContain('value={schedule.departure.time ?? notAvailable}');
        expect(departure.before.endsWith('{schedule.departure.isPassengerStop && (')).toBe(true);

        const arrival = infoRow('ongoingJourney.scheduledArrival');
        expect(arrival.row).toContain("'Scheduled arrival at {{stop}}', { stop: destination }");
        expect(arrival.row).toContain('value={schedule.arrival.time ?? notAvailable}');
        expect(arrival.before.endsWith('{schedule.arrival.isPassengerStop && (')).toBe(true);

        expect(screen).toContain('describeOngoingSchedule(journey, route)');
    });

    it('9. renders no HH:MM route-start or route-end row', () => {
        for (const gone of ['ongoingJourney.tripDeparture', 'ongoingJourney.tripArrival', 'Trip departure (route start)', 'Trip arrival (route end)']) {
            expect(screen).not.toContain(gone);
        }
    });

    it('10. describeOngoingSchedule itself is unchanged: it still flags the route times it falls back to', () => {
        // The Completed screen still uses it (MOV-316); only this screen stops showing the fallback.
        const journey = {
            booking: {
                journey: { startLocation: 'Malabe', endLocation: 'Rajagiriya', departureTime: '06:00', estimatedArrivalTime: '07:15' },
            },
        } as any;

        expect(describeOngoingSchedule(journey, null)).toEqual({
            departure: { time: '6:00 AM', isPassengerStop: false },
            arrival: { time: '7:15 AM', isPassengerStop: false },
            durationLabel: null,
        });
    });

    it('the footnote no longer calls the actual start a timetable time', () => {
        expect(screen.replace(/\s+/g, ' ')).toContain(
            "'ongoingJourney.scheduleNote', 'Scheduled times are from the timetable. The actual start is when the bus started this journey. A live arrival estimate is not available yet.'"
        );
        expect(screen).not.toContain("'Times are from the timetable.");
    });
});

// ------------------------------------------------------------------
describe('D. wording in English and Sinhala', () => {
    const REQUIRED: [string, string, string[]][] = [
        // key, English, placeholders
        ['activities.journeyDate', 'Journey date: {{date}}', ['date']],
        ['activities.scheduledDeparture', 'Scheduled departure: {{time}}', ['time']],
        ['activities.actualStart', 'Actual start: {{time}}', ['time']],
        ['activities.notAvailable', 'Not available', []],
        ['ongoingJourney.journeyDate', 'Journey date', []],
        ['ongoingJourney.scheduledDepartureTime', 'Scheduled departure', []],
        ['ongoingJourney.scheduledArrivalTime', 'Scheduled arrival', []],
        ['ongoingJourney.actualStart', 'Actual start', []],
        ['ongoingJourney.notAvailable', 'Not available', []],
        [
            'ongoingJourney.scheduleNote',
            'Scheduled times are from the timetable. The actual start is when the bus started this journey. A live arrival estimate is not available yet.',
            [],
        ],
    ];
    const lookup = (locale: any, key: string) => key.split('.').reduce((node, part) => node?.[part], locale);
    const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort();

    it.each(REQUIRED)('%s is in English, matching the text in the component', (key, english) => {
        expect(lookup(en, key)).toBe(english);
        const component = (key.startsWith('activities.') ? card : screen).replace(/\s+/g, ' ');
        expect(component).toContain(`'${key}', '${english}'`);
    });

    it.each(REQUIRED)('%s is in Sinhala script, with the same placeholders', (key, _english, expected) => {
        const value = lookup(si, key);
        expect(typeof value).toBe('string');
        expect(value).toMatch(/[඀-෿]/);
        // Sinhala script, not Singlish: no Latin words outside the {{placeholders}}.
        expect(value.replace(/\{\{\w+\}\}/g, '')).not.toMatch(/[A-Za-z]/);
        expect(placeholders(value)).toEqual(expected);
    });

    it('both languages have exactly the same keys', () => {
        const keys = (node: any, prefix = ''): string[] =>
            Object.entries(node).flatMap(([key, value]) => (typeof value === 'object' ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`]));
        expect(keys(si).sort()).toEqual(keys(en).sort());
    });

    it('drops the old "Started {{time}}" card label, which nothing uses any more', () => {
        expect(en.activities.startedAt).toBeUndefined();
        expect(si.activities.startedAt).toBeUndefined();
        expect(card).not.toContain("activities.startedAt'");
    });
});

// ------------------------------------------------------------------
describe('E. an overnight service', () => {
    // The 23:30 -> 00:50 slot, started at 23:40 on Mon 21 Sep (Sri Lanka time):
    // what Start Journey persists for that run.
    const service = scheduledServiceFor(
        { departureTime: '23:30', estimatedArrivalTime: '00:50' },
        new Date('2026-09-21T23:40:00+05:30')
    )!;
    const activeJourney = {
        startedAt: '2026-09-21T18:10:00.000Z',
        scheduledDepartureAt: service.departureAt.toISOString(),
        scheduledArrivalAt: service.arrivalAt.toISOString(),
    };

    it('keeps the journey date on the departure day D', () => {
        expect(serviceDateOf(activeJourney.scheduledDepartureAt)).toBe('2026-09-21');
        expect(formatServiceDate(activeJourney.scheduledDepartureAt)).toBe('Mon, 21 Sep 2026');
        // The arrival is on D+1, but the date is never taken from it.
        expect(serviceDateOf(activeJourney.scheduledArrivalAt)).toBe('2026-09-22');
    });

    it('shows 11:30 PM -> 12:50 AM, and the actual start on the same clock', () => {
        expect(formatServiceTime(activeJourney.scheduledDepartureAt)).toBe('11:30 PM');
        expect(formatServiceTime(activeJourney.scheduledArrivalAt)).toBe('12:50 AM');
        expect(formatServiceTime(activeJourney.startedAt)).toBe('11:40 PM');
    });

    it('works out the date in one place: the screen only formats scheduledDepartureAt', () => {
        expect(definition(screen, 'serviceDate')).not.toMatch(/scheduledArrivalAt|startedAt/);
        expect(screen).not.toMatch(/serviceDateOf|MINUTES_PER_DAY|SERVICE_UTC_OFFSET/);
    });
});

// ------------------------------------------------------------------
describe('F. the Activities card and the Live Journey screen agree', () => {
    it.each(['serviceDate', 'scheduledDeparture', 'actualStart'])('%s comes from the same source on both', (name) => {
        expect(definition(card, name)).toBe(definition(screen, name));
    });

    it('both read the run from the server response', () => {
        expect(definition(card, 'run')).toBe('isOngoing ? booking.activeJourney : undefined');
        expect(definition(screen, 'run')).toBe('journey!.activeJourney');
    });

    it('the scheduled arrival is on the screen only, from scheduledArrivalAt', () => {
        expect(definition(screen, 'scheduledArrival')).toBe('formatServiceTime(run?.scheduledArrivalAt) ?? notAvailable');
        expect(card).not.toContain('scheduledArrivalAt');
    });
});
