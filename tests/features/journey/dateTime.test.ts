// The times shown on Route Details (MOV-98, "display estimated arrival time").
//
// The screen renders three values from the selected trip:
//
//   departure       formatFriendlyTime(parseApiTimeString(trip.departureTime))
//   est. arrival    formatFriendlyTime(parseApiTimeString(trip.estimatedArrivalTime))
//   duration        formatDurationBetween(departureTime, estimatedArrivalTime)
//
// Only those three helpers are covered here; the date helpers in the same module
// belong to the Journey Planner, not Route Details.

import {
    addMinutesToApiTime,
    formatDurationBetween,
    formatDurationMinutes,
    formatFriendlyTime,
    minutesBetweenApiTimes,
    parseApiTimeString,
} from '../../../src/features/journey/utils/dateTime';

/** Exactly what the Route Details screen does to one stored time. */
const displayed = (apiTime: string) => formatFriendlyTime(parseApiTimeString(apiTime));

// ==================================================================
// DEPARTURE AND ESTIMATED ARRIVAL
// ==================================================================
describe('a stored trip time as displayed on Route Details', () => {
    it('shows a morning time in 12-hour form', () => {
        expect(displayed('09:00')).toBe('9:00 AM');
    });

    it('shows an afternoon time in 12-hour form', () => {
        expect(displayed('14:05')).toBe('2:05 PM');
    });

    it('keeps the leading zero on the minutes', () => {
        expect(displayed('10:07')).toBe('10:07 AM');
    });

    it('shows midday as 12 PM, not 0 PM', () => {
        expect(displayed('12:00')).toBe('12:00 PM');
    });

    it('shows midnight as 12 AM, not 0 AM', () => {
        expect(displayed('00:30')).toBe('12:30 AM');
    });

    it('shows the last minute of the day as 11:59 PM', () => {
        expect(displayed('23:59')).toBe('11:59 PM');
    });

    it('reads the hour and minute apart correctly', () => {
        expect(parseApiTimeString('16:45')).toEqual({ hour: 4, minute: 45, period: 'PM' });
    });
});

// ==================================================================
// JOURNEY DURATION
// ==================================================================
describe('the journey duration between departure and estimated arrival', () => {
    it('reports hours and minutes together', () => {
        expect(formatDurationBetween('09:00', '10:10')).toBe('1h 10m');
    });

    it('reports minutes alone for a short hop', () => {
        expect(formatDurationBetween('09:00', '09:45')).toBe('45m');
    });

    it('reports whole hours without a minutes part', () => {
        expect(formatDurationBetween('09:00', '11:00')).toBe('2h');
    });

    it('handles an arrival after midnight as crossing the day', () => {
        // A late departure must not produce a negative or day-long duration.
        expect(formatDurationBetween('23:30', '00:15')).toBe('45m');
    });

    it('reports nothing when the two times are identical', () => {
        // The screen falls back to an arrow rather than printing "0m".
        expect(formatDurationBetween('09:00', '09:00')).toBeNull();
    });

    it('reports nothing when a time is unusable', () => {
        expect(formatDurationBetween('', '10:10')).toBeNull();
        expect(formatDurationBetween('09:00', 'later')).toBeNull();
    });

    it('is consistent with the times shown either side of it', () => {
        // The trio as the screen renders it, from one selected trip.
        const departureTime = '09:00';
        const estimatedArrivalTime = '10:10';

        expect(displayed(departureTime)).toBe('9:00 AM');
        expect(displayed(estimatedArrivalTime)).toBe('10:10 AM');
        expect(formatDurationBetween(departureTime, estimatedArrivalTime)).toBe('1h 10m');
    });
});

// ==================================================================
// A DURATION MEASURED IN MINUTES (MOV-88)
//
// A passenger's journey time is arrived at by summing configured stop-to-stop
// timings, so it starts life as a number of minutes rather than as a pair of
// clock times. It must read exactly like the durations above — the same
// formatter produces both, and these cases hold that to the existing format.
// ==================================================================
describe('a duration given in minutes', () => {
    it('formats minutes under an hour on their own', () => {
        expect(formatDurationMinutes(33)).toBe('33m');
        expect(formatDurationMinutes(45)).toBe('45m');
    });

    it('formats hours and minutes together', () => {
        expect(formatDurationMinutes(70)).toBe('1h 10m');
    });

    it('formats a whole number of hours without a stray zero', () => {
        expect(formatDurationMinutes(120)).toBe('2h');
    });

    it('agrees with the clock-time formatter for the same span', () => {
        // The two must never disagree: one delegates to the other.
        expect(formatDurationMinutes(70)).toBe(formatDurationBetween('09:00', '10:10'));
        expect(formatDurationMinutes(45)).toBe(formatDurationBetween('23:30', '00:15'));
    });

    it('reports nothing for a duration there is no point showing', () => {
        expect(formatDurationMinutes(0)).toBeNull();
        expect(formatDurationMinutes(-10)).toBeNull();
        expect(formatDurationMinutes(null)).toBeNull();
        expect(formatDurationMinutes(undefined)).toBeNull();
        expect(formatDurationMinutes(Number.NaN)).toBeNull();
        expect(formatDurationMinutes(Number.POSITIVE_INFINITY)).toBeNull();
    });
});

// ==================================================================
// PLACING A PASSENGER'S OWN STOP INSIDE A TRIP (MOV-88)
// ==================================================================
describe('moving a stored time on by a number of minutes', () => {
    it('adds minutes within the hour', () => {
        expect(addMinutesToApiTime('09:00', 8)).toBe('09:08');
    });

    it('carries over into the next hour', () => {
        expect(addMinutesToApiTime('09:50', 26)).toBe('10:16');
    });

    it('wraps past midnight rather than producing a 25th hour', () => {
        expect(addMinutesToApiTime('23:50', 26)).toBe('00:16');
    });

    it('keeps the zero-padded form the API stores', () => {
        expect(addMinutesToApiTime('08:05', 0)).toBe('08:05');
        expect(addMinutesToApiTime('00:00', 5)).toBe('00:05');
    });

    it('reports nothing when the time or the offset is unusable', () => {
        expect(addMinutesToApiTime('later', 10)).toBeNull();
        expect(addMinutesToApiTime('', 10)).toBeNull();
        expect(addMinutesToApiTime('09:00', Number.NaN)).toBeNull();
    });
});

describe('minutes between two stored times', () => {
    it('measures a same-day gap', () => {
        expect(minutesBetweenApiTimes('09:00', '09:41')).toBe(41);
    });

    it('treats a wrap as crossing midnight', () => {
        expect(minutesBetweenApiTimes('23:30', '00:15')).toBe(45);
    });

    it('reports zero for two identical times, leaving the label to decide', () => {
        // The measurement is zero; whether that is worth printing is the
        // formatter's call, which is why they are separate functions.
        expect(minutesBetweenApiTimes('09:00', '09:00')).toBe(0);
        expect(formatDurationBetween('09:00', '09:00')).toBeNull();
    });

    it('reports nothing when a time is unusable', () => {
        expect(minutesBetweenApiTimes('', '10:10')).toBeNull();
        expect(minutesBetweenApiTimes('09:00', 'later')).toBeNull();
    });
});
