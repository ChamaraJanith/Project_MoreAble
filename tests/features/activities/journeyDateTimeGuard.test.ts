// One guard for the passenger journey date and times (MOV-309 / MOV-317).
//
// Every journey date and time a passenger sees — on the Activities card, the
// Live Journey screen and the Completed Journey screen — is on the service
// clock, through src/shared/utils/serviceTime. This keeps those surfaces, and
// the helpers they format with, free of anything that reads the phone's own
// time zone: Date's local getters, toLocale*, Intl date formatting, and the
// device-local helpers MOV-315/316 removed.
//
// Deliberately narrow. Device-local formatting elsewhere in the app is not
// this story's concern and is not checked here — nor is the Activities tab
// rule for which bookings count as completed (activityStatus), the driver's
// Trip Control, or the search API's own Asia/Colombo clock.

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..');

/** The passenger screens that show MOV-309 dates and times. */
const SURFACES = [
    'src/features/activities/ui/ActivityJourneyCard.tsx',
    'src/features/activities/ui/OngoingJourneyScreen.tsx',
    'src/features/activities/ui/CompletedJourneyScreen.tsx',
];

/** The helpers those screens format journey times with. */
const HELPERS = ['src/features/activities/utils/ongoingJourneyTracking.ts', 'src/features/activities/utils/completedJourney.ts'];

/** Source with comments removed: comments may name what the code avoids. */
const code = (file: string) =>
    readFileSync(join(ROOT, file), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const DEVICE_LOCAL: [string, RegExp][] = [
    ['a local Date getter', /\.(getHours|getMinutes|getSeconds|getDate|getDay|getMonth|getFullYear)\(/],
    ['toLocale* formatting', /\.toLocale(Date|Time)?String\(/],
    ['Intl date formatting', /Intl\.DateTimeFormat/],
    ['formatFriendlyDate (device-local Today/Tomorrow)', /\bformatFriendlyDate\b/],
    ['formatDisplayDate (device-local)', /\bformatDisplayDate\b/],
    ['a removed device-local helper', /\b(formatClockTime|formatStartedAt|formatJourneyDay|formatJourneyDate)\b/],
];

describe.each([...SURFACES, ...HELPERS])('%s', (file) => {
    const source = code(file);

    it.each(DEVICE_LOCAL)('uses no %s', (_, pattern) => {
        expect(source).not.toMatch(pattern);
    });
});

describe.each(SURFACES)('%s', (file) => {
    it('formats its journey dates and times with the shared service-time formatter', () => {
        expect(code(file)).toContain("import { formatServiceDate, formatServiceTime } from '../../../shared/utils/serviceTime';");
    });
});

describe('the guard itself', () => {
    it('would catch each kind of device-local formatting', () => {
        const samples = [
            'const t = when.getHours();',
            'const d = new Date(iso).toLocaleDateString();',
            'const t = new Date(iso).toLocaleTimeString();',
            "const f = new Intl.DateTimeFormat('en', { hour: 'numeric' });",
            'const d = formatFriendlyDate(date);',
            'const t = formatClockTime(iso);',
        ];
        for (const sample of samples) {
            expect(DEVICE_LOCAL.some(([, pattern]) => pattern.test(sample))).toBe(true);
        }
    });

    it('does not trip over what the surfaces legitimately use', () => {
        for (const allowed of ['new Date(iso).getTime()', 'formatServiceTime(run?.startedAt)', 'formatServiceDate(x)', 'formatScheduleTime(value)', 'date.getUTCHours()']) {
            expect(DEVICE_LOCAL.some(([, pattern]) => pattern.test(allowed))).toBe(false);
        }
    });
});
