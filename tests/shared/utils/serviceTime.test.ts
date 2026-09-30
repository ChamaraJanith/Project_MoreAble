// Journey dates and times in MoreAble service time (MOV-309).
//
// One clock for every journey time a passenger sees: Sri Lanka local time
// (UTC+05:30), the clock the journey lifecycle dates its services by. The
// service date of a journey is the calendar date of its scheduled departure on
// that clock, so an overnight service keeps its departure's date, and no phone
// time zone can move either the date or the times.

import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import * as ts from 'typescript';
import { formatServiceDate, formatServiceTime, serviceDateOf } from '../../../src/shared/utils/serviceTime';
import { scheduledServiceFor } from '../../../src/shared/utils/journeyLifecycle';

const ROOT = join(__dirname, '..', '..', '..');

/** A Sri Lanka wall-clock moment as the stored ISO instant (UTC). */
const serviceInstant = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();

describe('A. a normal service time', () => {
    const departure = '2026-09-21T03:30:00.000Z'; // 09:00 in Sri Lanka

    it('gives the service date', () => {
        expect(serviceDateOf(departure)).toBe('2026-09-21');
        expect(formatServiceDate(departure)).toBe('Mon, 21 Sep 2026');
    });

    it('gives the service clock time', () => {
        expect(formatServiceTime(departure)).toBe('9:00 AM');
    });

    it('reads noon and midnight on the 12-hour clock', () => {
        expect(formatServiceTime(serviceInstant('2026-09-21', '12:00'))).toBe('12:00 PM');
        expect(formatServiceTime(serviceInstant('2026-09-22', '00:00'))).toBe('12:00 AM');
        expect(formatServiceTime(serviceInstant('2026-09-21', '00:05'))).toBe('12:05 AM');
    });

    it('accepts an instant written with its own +05:30 offset', () => {
        expect(serviceDateOf('2026-09-21T23:30:00+05:30')).toBe('2026-09-21');
        expect(formatServiceTime('2026-09-21T23:30:00+05:30')).toBe('11:30 PM');
    });
});

describe('B. an overnight journey', () => {
    // 23:30 on Mon 21 Sep -> 00:50 on Tue 22 Sep, Sri Lanka time. Both stored
    // instants fall on 21 Sep in UTC; only the arrival crosses midnight here.
    const departure = serviceInstant('2026-09-21', '23:30');
    const arrival = serviceInstant('2026-09-22', '00:50');

    it('keeps the departure on the service day D', () => {
        expect(departure).toBe('2026-09-21T18:00:00.000Z');
        expect(serviceDateOf(departure)).toBe('2026-09-21');
        expect(formatServiceDate(departure)).toBe('Mon, 21 Sep 2026');
        expect(formatServiceTime(departure)).toBe('11:30 PM');
    });

    it('puts the arrival on D+1', () => {
        expect(arrival).toBe('2026-09-21T19:20:00.000Z');
        expect(serviceDateOf(arrival)).toBe('2026-09-22');
        expect(formatServiceDate(arrival)).toBe('Tue, 22 Sep 2026');
        expect(formatServiceTime(arrival)).toBe('12:50 AM');
    });

    it("agrees with the lifecycle's own service day, even for a start after midnight", () => {
        const slot = { departureTime: '23:30', estimatedArrivalTime: '00:50' };
        // Started at 00:30 on D+1: still D's 23:30 service (journeyLifecycle).
        const service = scheduledServiceFor(slot, new Date(serviceInstant('2026-09-22', '00:30')))!;

        expect(serviceDateOf(service.departureAt.toISOString())).toBe('2026-09-21');
        expect(serviceDateOf(service.arrivalAt.toISOString())).toBe('2026-09-22');
    });
});

describe('C. the UTC / service-date boundary', () => {
    it('reads 2026-09-21T18:45:00Z as 22 Sep 2026, 12:15 AM', () => {
        expect(serviceDateOf('2026-09-21T18:45:00Z')).toBe('2026-09-22');
        expect(formatServiceDate('2026-09-21T18:45:00Z')).toBe('Tue, 22 Sep 2026');
        expect(formatServiceTime('2026-09-21T18:45:00Z')).toBe('12:15 AM');
    });

    it('keeps 18:29Z on the earlier date', () => {
        expect(serviceDateOf('2026-09-21T18:29:00Z')).toBe('2026-09-21');
        expect(formatServiceTime('2026-09-21T18:29:00Z')).toBe('11:59 PM');
    });
});

describe('D. independent of the device time zone', () => {
    // A Jest worker does not pick up a TZ changed at run time, so each zone
    // gets its own Node process started with TZ set, running the module as
    // compiled JavaScript. The originals are never touched.
    const SAMPLES = ['2026-09-21T18:00:00.000Z', '2026-09-21T19:20:00.000Z', '2026-09-21T18:45:00Z', '2026-09-21T03:30:00.000Z'];
    const MODULES = ['src/shared/utils/serviceTime.ts', 'src/shared/utils/journeyLifecycle.ts', 'src/features/journey/utils/dateTime.ts'];
    let outDir: string;

    beforeAll(() => {
        outDir = mkdtempSync(join(tmpdir(), 'service-time-'));
        for (const file of MODULES) {
            const { outputText } = ts.transpileModule(readFileSync(join(ROOT, file), 'utf-8'), {
                compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
            });
            const target = join(outDir, file.replace(/\.ts$/, '.js'));
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, outputText);
        }
    });

    afterAll(() => {
        rmSync(outDir, { recursive: true, force: true });
    });

    const formatAllIn = (tz: string) => {
        const script = `
            const s = require(${JSON.stringify(join(outDir, 'src/shared/utils/serviceTime.js'))});
            const samples = ${JSON.stringify(SAMPLES)};
            process.stdout.write(JSON.stringify({
                offset: new Date('2026-09-21T12:00:00Z').getTimezoneOffset(),
                values: samples.map((iso) => [s.serviceDateOf(iso), s.formatServiceDate(iso), s.formatServiceTime(iso)]),
            }));`;
        const output = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf-8' });
        return JSON.parse(output) as { offset: number; values: (string | null)[][] };
    };

    it('gives the same dates and times in UTC and in America/New_York', () => {
        const utc = formatAllIn('UTC');
        const newYork = formatAllIn('America/New_York');

        // Proves each process really ran in its zone, so the comparison is not vacuous.
        expect(utc.offset).toBe(0);
        expect(newYork.offset).toBe(240);
        expect(newYork.values).toEqual(utc.values);
        expect(utc.values).toEqual([
            ['2026-09-21', 'Mon, 21 Sep 2026', '11:30 PM'],
            ['2026-09-22', 'Tue, 22 Sep 2026', '12:50 AM'],
            ['2026-09-22', 'Tue, 22 Sep 2026', '12:15 AM'],
            ['2026-09-21', 'Mon, 21 Sep 2026', '9:00 AM'],
        ]);
    });
});

describe('E–G. nothing is invented for a missing or unreadable time', () => {
    it.each([
        ['E. null', null],
        ['F. undefined', undefined],
        ['G. an empty string', ''],
        ['G. whitespace', '   '],
        ['G. garbage', 'not-a-date'],
        ['G. an impossible date', '2026-13-45T25:99:00Z'],
        ['G. a bare date (not an instant)', '2026-09-21'],
        ['G. a date-time with no offset (would be read in the device zone)', '2026-09-21T23:30:00'],
        ['G. a clock time only', '23:30'],
    ])('%s -> null', (_, value) => {
        expect(serviceDateOf(value as any)).toBeNull();
        expect(formatServiceDate(value as any)).toBeNull();
        expect(formatServiceTime(value as any)).toBeNull();
    });

    it('rejects a value that is not a string at all', () => {
        for (const value of [0, 1_790_000_000_000, {}, new Date('2026-09-21T18:00:00Z')]) {
            expect(serviceDateOf(value as any)).toBeNull();
            expect(formatServiceTime(value as any)).toBeNull();
        }
    });
});

describe('source safety', () => {
    const source = readFileSync(join(ROOT, 'src/shared/utils/serviceTime.ts'), 'utf-8');
    // Comments may name what the module avoids; only the code is checked.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    it.each(['getHours', 'getDate', 'getDay', 'getMinutes', 'getMonth', 'getFullYear'])('never reads the device-local %s', (method) => {
        expect(code).not.toMatch(new RegExp(`\\.${method}\\(`));
    });

    it('never formats with toLocale*', () => {
        expect(code).not.toMatch(/toLocale/);
    });

    it('never reads the current time', () => {
        expect(code).not.toMatch(/new Date\(\s*\)/);
        expect(code).not.toMatch(/Date\.now\(/);
    });

    it('uses the lifecycle service offset rather than a second convention', () => {
        expect(code).toContain("import { SERVICE_UTC_OFFSET_MINUTES } from './journeyLifecycle'");
        expect(code).not.toMatch(/Asia\/Colombo|timeZone|Intl\./);
        expect(code).not.toContain('formatFriendlyDate');
    });
});
