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
    formatDurationBetween,
    formatFriendlyTime,
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
