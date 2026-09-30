// The Activities card for an ongoing journey: its date and times (MOV-309 / MOV-315).
//
// The project has no React renderer, so — like journeyUiCopy — this reads the
// component's source. It pins where each value on an ONGOING card comes from:
//
//   Journey date         service date of activeJourney.scheduledDepartureAt
//   Scheduled departure  activeJourney.scheduledDepartureAt, on the service clock
//   Actual start         activeJourney.startedAt, on the service clock
//
// and that a missing time reads "Not available" instead of borrowing another.
// The same component renders Completed cards; those were standardised by
// MOV-316 (completedJourneyDateTime.test.ts), and group H keeps the two apart.

import { readFileSync } from 'fs';
import { join } from 'path';
import { formatServiceDate, formatServiceTime } from '../../../src/shared/utils/serviceTime';

const ROOT = join(__dirname, '..', '..', '..');
const source = readFileSync(join(ROOT, 'src/features/activities/ui/ActivityJourneyCard.tsx'), 'utf-8');

/** The right-hand side of `const <name> = ...;` in the card. */
function definition(name: string): string {
    const match = source.match(new RegExp(`const ${name} = ([^;]*);`));
    if (!match) throw new Error(`ActivityJourneyCard has no const ${name}`);
    return match[1];
}

/** The JSX of the `{isOngoing && (...)}` badge whose text uses `key`. */
function ongoingBadge(key: string): string {
    const at = source.indexOf(`t('${key}'`);
    expect(at).toBeGreaterThan(-1);
    const start = source.lastIndexOf('{isOngoing', at);
    return source.slice(start, source.indexOf('</View>', at));
}

const FALLBACK_SOURCES = ['boardedAt', 'journeyDate', 'travelDate', 'departureDate', 'rawDate', 'completedAt', 'departureTime'];
const DEVICE_LOCAL = ['formatStartedAt', 'formatClockTime', 'formatFriendlyDate', 'formatJourneyDate', 'getHours', 'getMinutes', 'getDate', 'getDay', 'toLocale'];

describe('ongoing card — the run it describes', () => {
    it("reads only the server's running journey, and only for the ongoing variant", () => {
        expect(definition('run')).toBe('isOngoing ? booking.activeJourney : undefined');
    });

    it('uses the shared service-time formatter', () => {
        expect(source).toContain("import { formatServiceDate, formatServiceTime } from '../../../shared/utils/serviceTime';");
    });
});

describe('A/B. journey date', () => {
    it('A. comes from the service date of scheduledDepartureAt', () => {
        expect(definition('serviceDate')).toBe('formatServiceDate(run?.scheduledDepartureAt) ?? notAvailable');
        expect(ongoingBadge('activities.journeyDate')).toContain('{ date: serviceDate }');
    });

    it.each(FALLBACK_SOURCES)('B. never falls back to %s', (field) => {
        expect(definition('serviceDate')).not.toContain(field);
        // The badge's own translation key is named journeyDate; only what it shows is checked.
        expect(ongoingBadge('activities.journeyDate').replace("t('activities.journeyDate'", '')).not.toContain(field);
    });

    it('B. the card has no date fallback chain left at all (MOV-316 removed the Completed one too)', () => {
        for (const gone of ['rawDate', 'booking.boardedAt', 'booking.journeyDate', 'booking.travelDate', 'journey?.journeyDate', 'journey?.departureDate', 'formatJourneyDate']) {
            expect(source).not.toContain(gone);
        }
    });
});

describe('C/D/E. scheduled departure and actual start', () => {
    it('C. scheduled departure is scheduledDepartureAt, labelled as the scheduled departure', () => {
        expect(definition('scheduledDeparture')).toBe('formatServiceTime(run?.scheduledDepartureAt) ?? notAvailable');
        const badge = ongoingBadge('activities.scheduledDeparture');
        expect(badge).toContain("'Scheduled departure: {{time}}'");
        expect(badge).toContain('{ time: scheduledDeparture }');
    });

    it('C. no card shows the booking HH:MM route times any more', () => {
        for (const gone of ['{departure} → {arrival}', 'departureTime', 'estimatedArrivalTime', 'formatScheduledTime']) {
            expect(source).not.toContain(gone);
        }
    });

    it('D. actual start is startedAt, labelled as the actual start', () => {
        expect(definition('actualStart')).toBe('formatServiceTime(run?.startedAt) ?? notAvailable');
        const badge = ongoingBadge('activities.actualStart');
        expect(badge).toContain("'Actual start: {{time}}'");
        expect(badge).toContain('{ time: actualStart }');
    });

    it.each(['serviceDate', 'scheduledDeparture', 'actualStart'])('E. %s uses no device-local formatting and no other timestamp', (name) => {
        const expression = definition(name);
        for (const banned of [...DEVICE_LOCAL, ...FALLBACK_SOURCES]) {
            expect(expression).not.toContain(banned);
        }
        expect(expression).toMatch(/^formatService(Date|Time)\(run\?\.(scheduledDepartureAt|startedAt)\) \?\? notAvailable$/);
    });

    it('E. the scheduled departure and actual start are distinct sources', () => {
        expect(definition('scheduledDeparture')).not.toContain('startedAt');
        expect(definition('actualStart')).not.toContain('scheduledDepartureAt');
    });
});

describe('F/G. a missing time says so', () => {
    it('uses the project wording for an unavailable value', () => {
        expect(definition('notAvailable')).toBe("t('activities.notAvailable', 'Not available')");
    });

    it('F/G. the formatter gives nothing for a missing time, so "Not available" is shown', () => {
        for (const missing of [undefined, null, 'not-a-date']) {
            expect(formatServiceDate(missing)).toBeNull();
            expect(formatServiceTime(missing)).toBeNull();
        }
    });

    it.each(['activities.journeyDate', 'activities.scheduledDeparture', 'activities.actualStart'])(
        'G. the %s badge is shown on every ongoing card, never hidden when its time is missing',
        (key) => {
            const at = source.indexOf(`t('${key}'`);
            const opener = source.slice(source.lastIndexOf('{isOngoing', at), at);
            expect(opener).toMatch(/^\{isOngoing (&&|\?) \(/);
            expect(opener).not.toMatch(/!!|serviceDate &&|scheduledDeparture &&|actualStart &&/);
        }
    );

    it('G. no longer hides the start when it is missing', () => {
        expect(source).not.toContain('!!startedAt');
    });
});

// MOV-316 standardised the Completed side of this component; its full
// coverage is in completedJourneyDateTime.test.ts. Pinned here: the two sides
// never read each other's data, and the rest of the Completed card is intact.
describe('H. the Completed card (MOV-316) and the ongoing card stay apart', () => {
    it.each([
        ['completion', 'isOngoing ? undefined : booking.passengerJourney'],
        ['completedRun', 'isOngoing ? undefined : booking.passengerJourneySchedule'],
        ['completedServiceDate', 'formatServiceDate(completedRun?.scheduledDepartureAt) ?? notAvailable'],
        ['completedScheduledDeparture', 'formatServiceTime(completedRun?.scheduledDepartureAt) ?? notAvailable'],
        ['completedScheduledArrival', 'formatServiceTime(completedRun?.scheduledArrivalAt) ?? notAvailable'],
        ['completedActualStart', 'formatServiceTime(completion?.journeyStartedAt) ?? notAvailable'],
        ['completedActualEnd', 'formatServiceTime(completion?.completedAt) ?? notAvailable'],
    ])('the Completed %s is its own canonical value', (name, expected) => {
        expect(definition(name)).toBe(expected);
    });

    it.each(['serviceDate', 'scheduledDeparture', 'actualStart'])('the ongoing %s never reads a completion', (name) => {
        expect(definition(name)).not.toMatch(/completion|completedRun|passengerJourney/);
    });

    it('renders the Completed values only on a Completed card, after the ongoing badges', () => {
        const group = source.indexOf('{!isOngoing && (');
        expect(group).toBeGreaterThan(source.indexOf("t('activities.journeyDate'"));
        expect(source.indexOf('completedServiceDate }')).toBeGreaterThan(group);
    });

    it.each([
        'const reason = completion ? completionReasonLabel(completion.completionReason) : null;',
        '{!!fare && (',
        '{!!reason && <Text style={styles.reasonText}>{reason}</Text>}',
    ])('keeps the rest of the Completed card: %s', (fragment) => {
        expect(source).toContain(fragment);
    });

    it('has no device-local formatter left', () => {
        for (const gone of ['function formatStartedAt(', 'function formatJourneyDate(', '.getHours(', '.getMinutes(', 'formatFriendlyDate', "from '../../journey/utils/dateTime'"]) {
            expect(source).not.toContain(gone);
        }
    });
});
