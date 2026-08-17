// What the Live Bus Status card reads from the backend (MOV-119).
//
// Two decisions sit between the API and the passenger: how to word the age of a
// GPS report, and whether there is a position worth drawing at all. The second
// matters most — anything that slips through becomes a bus marker on the map,
// so every way the data can be incomplete has to end in "no vehicle" rather
// than in a coordinate borrowed from somewhere else.
//
// The backend contract itself is already covered by the MOV-120 suite; these
// only cover the presentation decisions made on top of it.

import { JourneyLiveStatus } from '../../../src/entities/route/model/types';
import {
    formatLocationAge,
    resolveVehiclePosition,
} from '../../../src/features/journey/utils/liveStatus';

/** A live block shaped exactly as `POST /api/journeys/search` returns it. */
function live(overrides: Partial<JourneyLiveStatus> = {}): JourneyLiveStatus {
    return {
        available: true,
        location: {
            busId: 'BUS-00001',
            latitude: 6.9061,
            longitude: 79.9558,
            recordedAt: '2026-08-20T09:05:00.000Z',
        },
        locationAgeSeconds: 150,
        ...overrides,
    };
}

// ==================================================================
// HOW RECENT THE REPORT IS
// ==================================================================
describe('formatLocationAge', () => {
    it.each([
        [0, 'Updated just now'],
        [59, 'Updated just now'],
        [60, 'Updated 1 min ago'],
        [119, 'Updated 1 min ago'],
        [120, 'Updated 2 mins ago'],
        [150, 'Updated 2 mins ago'],
        [3599, 'Updated 59 mins ago'],
    ])('reads %i seconds as "%s"', (seconds, expected) => {
        expect(formatLocationAge(seconds)).toBe(expected);
    });

    it('switches to hours, then days, rather than counting thousands of minutes', () => {
        expect(formatLocationAge(3600)).toBe('Updated 1 hour ago');
        expect(formatLocationAge(7200)).toBe('Updated 2 hours ago');
        expect(formatLocationAge(86400)).toBe('Updated 1 day ago');
        expect(formatLocationAge(259200)).toBe('Updated 3 days ago');
    });

    it('treats a bus whose clock runs ahead as reporting just now', () => {
        // The backend reports clock skew as a negative age rather than hiding
        // it. "Updated -5 mins ago" would alarm a passenger over what is only a
        // device clock being wrong, and the fix is current either way.
        expect(formatLocationAge(-1)).toBe('Updated just now');
        expect(formatLocationAge(-300)).toBe('Updated just now');
    });

    it('returns nothing to display when there is no usable age', () => {
        expect(formatLocationAge(undefined)).toBeNull();
        expect(formatLocationAge(null)).toBeNull();
        expect(formatLocationAge(Number.NaN)).toBeNull();
        expect(formatLocationAge(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('never shows a raw seconds count', () => {
        expect(formatLocationAge(150)).not.toMatch(/second/i);
        expect(formatLocationAge(150)).not.toMatch(/150/);
    });
});

// ==================================================================
// WHETHER THERE IS A BUS TO DRAW
// ==================================================================
describe('resolveVehiclePosition', () => {
    it('returns the reported position when the bus is reporting', () => {
        expect(resolveVehiclePosition(live())).toEqual({
            latitude: 6.9061,
            longitude: 79.9558,
        });
    });

    it('carries the coordinate through unchanged, rounding nothing', () => {
        const position = resolveVehiclePosition(
            live({
                location: {
                    busId: 'BUS-00001',
                    latitude: 6.906123456,
                    longitude: 79.955987654,
                    recordedAt: '2026-08-20T09:05:00.000Z',
                },
            })
        );

        expect(position).toEqual({ latitude: 6.906123456, longitude: 79.955987654 });
    });

    it('returns nothing when the bus has never reported', () => {
        expect(
            resolveVehiclePosition({
                available: false,
                message: 'Live location is not available for this vehicle yet.',
            })
        ).toBeNull();
    });

    it('returns nothing when the live block is missing entirely', () => {
        // A selection held from a response that predates live data.
        expect(resolveVehiclePosition(undefined)).toBeNull();
        expect(resolveVehiclePosition(null)).toBeNull();
    });

    it('returns nothing when available is set but no position came with it', () => {
        expect(resolveVehiclePosition({ available: true })).toBeNull();
    });

    it.each([
        ['latitude past the pole', { latitude: 90.1, longitude: 79.9558 }],
        ['latitude below the pole', { latitude: -90.1, longitude: 79.9558 }],
        ['longitude past the meridian', { latitude: 6.9061, longitude: 180.1 }],
        ['longitude below the meridian', { latitude: 6.9061, longitude: -180.1 }],
        ['NaN latitude', { latitude: Number.NaN, longitude: 79.9558 }],
        ['infinite longitude', { latitude: 6.9061, longitude: Number.POSITIVE_INFINITY }],
    ])('refuses to plot a %s', (_label, coordinate) => {
        const status = live({
            location: {
                busId: 'BUS-00001',
                recordedAt: '2026-08-20T09:05:00.000Z',
                ...coordinate,
            },
        });

        expect(resolveVehiclePosition(status)).toBeNull();
    });

    it('never substitutes another coordinate when the position is unusable', () => {
        // The only correct answer is "no vehicle". A stop, a route point or the
        // journey's origin would each put a bus somewhere it is not.
        const noPosition = resolveVehiclePosition({ available: false });
        const brokenPosition = resolveVehiclePosition(
            live({
                location: {
                    busId: 'BUS-00001',
                    latitude: Number.NaN,
                    longitude: Number.NaN,
                    recordedAt: '2026-08-20T09:05:00.000Z',
                },
            })
        );

        expect(noPosition).toBeNull();
        expect(brokenPosition).toBeNull();
    });
});
