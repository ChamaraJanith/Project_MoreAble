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
// The same component renders Completed cards; those belong to MOV-316 and are
// pinned here as unchanged.

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

    it("B. keeps the old date chain away from an ongoing card", () => {
        // The chain still dates Completed cards (MOV-316); an ongoing card never gets it.
        expect(definition('journeyDate')).toBe('isOngoing ? null : formatJourneyDate(rawDate)');
    });
});

describe('C/D/E. scheduled departure and actual start', () => {
    it('C. scheduled departure is scheduledDepartureAt, labelled as the scheduled departure', () => {
        expect(definition('scheduledDeparture')).toBe('formatServiceTime(run?.scheduledDepartureAt) ?? notAvailable');
        const badge = ongoingBadge('activities.scheduledDeparture');
        expect(badge).toContain("'Scheduled departure: {{time}}'");
        expect(badge).toContain('{ time: scheduledDeparture }');
    });

    it('C. an ongoing card no longer shows the booking HH:MM route times', () => {
        // The old badge survives only in the Completed side of the branch.
        expect(source).toMatch(/\{isOngoing \? \([\s\S]*?activities\.scheduledDeparture[\s\S]*?\) : \([\s\S]*?\{departure\} → \{arrival\}/);
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

describe('H. the Completed card is unchanged (MOV-316)', () => {
    it.each([
        'const departure = formatScheduledTime(booking.journey?.departureTime);',
        'const arrival = formatScheduledTime(booking.journey?.estimatedArrivalTime);',
        'const completion = isOngoing ? undefined : booking.passengerJourney;',
        'const rawDate = completion?.completedAt ?? booking.boardedAt ?? booking.journeyDate ?? booking.travelDate ?? booking.journey?.journeyDate ?? booking.journey?.departureDate;',
        'const completedAt = completion ? formatStartedAt(completion.completedAt) : null;',
        'const reason = completion ? completionReasonLabel(completion.completionReason) : null;',
        '{departure} → {arrival}',
        '{!!journeyDate && (',
        "t('activities.completedAt', 'Completed {{time}}', { time: completedAt })",
        '{!!fare && (',
    ])('keeps %s', (fragment) => {
        expect(source).toContain(fragment);
    });

    it('still formats the completion time with its existing formatter', () => {
        expect(source).toContain('function formatStartedAt(');
        expect(source).toContain('function formatJourneyDate(');
    });
});
