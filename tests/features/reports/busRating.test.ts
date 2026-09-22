// Rate this bus on the client: the stars on offer, what the screen says, what
// the API client sends, and how the screen sits in the End Journey flow —
// shown after completion, never part of it, and always leading to Activities.

import * as fs from 'fs';
import * as path from 'path';
import { isBusRatingValue } from '../../../src/entities/rating/model/types';
import { busRatingHref } from '../../../src/features/activities/utils/activityRoutes';
import { getBusRatingContext, submitBusRating } from '../../../src/features/reports/api/busRatingApi';
import {
    BUS_RATING_STARS,
    describeRatedBus,
    describeRatingFailure,
    ratingDescription,
    starLabel,
} from '../../../src/features/reports/utils/busRating';

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

// ------------------------------------------------------------------
describe('rating values', () => {
    it('offers exactly 1 to 5 stars, with no 0', () => {
        expect(BUS_RATING_STARS).toEqual([1, 2, 3, 4, 5]);
    });

    it('accepts only whole numbers from 1 to 5', () => {
        [1, 2, 3, 4, 5].forEach((value) => expect(isBusRatingValue(value)).toBe(true));
        [0, 6, -1, 2.5, NaN, Infinity, '3', null, undefined, true, {}].forEach((value) =>
            expect(isBusRatingValue(value)).toBe(false)
        );
    });

    it('reads each choice aloud as a number of stars', () => {
        expect(starLabel(1)).toBe('1 star');
        expect(starLabel(4)).toBe('4 stars');
        expect(ratingDescription(1)).toBe('Very poor');
        expect(ratingDescription(5)).toBe('Excellent');
        expect(ratingDescription(null)).toBeNull();
    });
});

// ------------------------------------------------------------------
describe('what the screen says about the bus', () => {
    it('names the bus by its number plate, with model and manufacturer when recorded', () => {
        expect(
            describeRatedBus({ busId: 'BUS-A', numberPlate: 'NB-8899', busModel: 'Viking', manufacturer: 'Ashok Leyland', accessibilityFacilities: null })
        ).toEqual({ title: 'NB-8899', details: 'Viking · Ashok Leyland' });
    });

    it('invents nothing the record does not hold', () => {
        expect(
            describeRatedBus({ busId: 'BUS-A', numberPlate: null, busModel: null, manufacturer: null, accessibilityFacilities: null })
        ).toEqual({ title: 'Your bus', details: null });
    });
});

// ------------------------------------------------------------------
describe('a refused submission', () => {
    it('treats an existing rating as done', () => {
        expect(describeRatingFailure(409, 'ALREADY_RATED', 'x').alreadyRated).toBe(true);
    });

    it('reassures the passenger their journey is still completed when saving fails', () => {
        const failure = describeRatingFailure(500, null, 'Failed to save your rating.');
        expect(failure.alreadyRated).toBe(false);
        expect(failure.message).toMatch(/journey is still completed/);
        expect(describeRatingFailure(null, null, 'Network error').message).toMatch(/journey is still completed/);
    });

    it('uses the API’s own wording for a request it refused on its merits', () => {
        expect(describeRatingFailure(409, 'BUS_MISMATCH', 'This is not the bus you travelled on for this journey.').message).toBe(
            'This is not the bus you travelled on for this journey.'
        );
    });
});

// ------------------------------------------------------------------
describe('busRatingApi', () => {
    const originalFetch = global.fetch;
    let mockFetch: jest.Mock;

    beforeEach(() => {
        mockFetch = jest.fn();
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    const respond = (status: number, body: unknown) =>
        mockFetch.mockResolvedValueOnce({ ok: status >= 200 && status < 300, status, json: async () => body });

    it('sends only the booking, the bus shown and the stars, with the session token', async () => {
        respond(201, { success: true, rating: { ratingId: 'r', rating: 4 } });

        const result = await submitBusRating('tok', { bookingId: 'BK-A', busId: 'BUS-A', rating: 4 });

        expect(result).toEqual({ ok: true, value: { ratingId: 'r', rating: 4 } });
        const [url, init] = mockFetch.mock.calls[0];
        expect(url).toBe('/api/journeys/completed/rating');
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer tok');
        expect(JSON.parse(init.body)).toEqual({ bookingId: 'BK-A', busId: 'BUS-A', rating: 4 });
    });

    it('reports the status and code of a refusal', async () => {
        respond(409, { success: false, code: 'ALREADY_RATED', message: 'You have already rated the bus for this journey.' });

        expect(await submitBusRating('tok', { bookingId: 'BK-A', busId: 'BUS-A', rating: 4 })).toEqual({
            ok: false,
            status: 409,
            code: 'ALREADY_RATED',
            message: 'You have already rated the bus for this journey.',
        });
    });

    it('reports a network failure with no status', async () => {
        mockFetch.mockRejectedValueOnce(new Error('offline'));

        const result = await submitBusRating('tok', { bookingId: 'BK-A', busId: 'BUS-A', rating: 4 });

        expect(result.ok).toBe(false);
        expect(!result.ok && result.status).toBeNull();
    });

    it('sends nothing without a session', async () => {
        const result = await submitBusRating('', { bookingId: 'BK-A', busId: 'BUS-A', rating: 4 });

        expect(!result.ok && result.status).toBe(401);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('reads the bus for a completed booking by its id', async () => {
        respond(200, { success: true, journey: { bookingId: 'BK A' }, bus: { busId: 'BUS-A' }, myRating: null });

        const result = await getBusRatingContext('tok', 'BK A');

        expect(mockFetch.mock.calls[0][0]).toBe('/api/journeys/completed/rating?bookingId=BK%20A');
        expect(result).toEqual({ ok: true, value: { journey: { bookingId: 'BK A' }, bus: { busId: 'BUS-A' }, myRating: null } });
    });
});

// ------------------------------------------------------------------
describe('the End Journey flow', () => {
    const live = read('src/features/activities/ui/OngoingJourneyScreen.tsx');
    const screen = read('src/features/reports/ui/BusRatingScreen.tsx');
    const tabs = read('app/(tabs)/_layout.tsx');

    it('opens Rate this bus only once the journey is completed', () => {
        expect(busRatingHref('BK-A')).toEqual({ pathname: '/activities/rate/[bookingId]', params: { bookingId: 'BK-A' } });
        expect(live).toMatch(/outcome\.status === 'COMPLETED'\) \{[\s\S]*?stopTracking\(\);\s*if \(bookingId\) router\.replace\(busRatingHref\(bookingId\)\)/);
        expect(live.match(/busRatingHref\(/g)).toHaveLength(1);
    });

    it('never makes completing the journey wait on a rating', () => {
        // The Live Journey screen knows nothing about submitting ratings.
        expect(live).not.toMatch(/busRatingApi|submitBusRating/);
        const end = read('src/shared/server/passengerJourneyCompletion.ts');
        expect(end).not.toMatch(/\brating|busRating/i);
    });

    it('is a hidden screen of the tabs, not a tab of its own', () => {
        expect(tabs).toMatch(/name="activities\/rate\/\[bookingId\]"\s*options=\{\{[\s\S]*?href: null/);
        expect(fs.existsSync(path.join(ROOT, 'app/(tabs)/activities/rate/[bookingId].tsx'))).toBe(true);
    });

    it('sends Submit and Skip to Activities, never Home', () => {
        expect(screen).toMatch(/function goToActivities\(\) \{\s*router\.replace\('\/activities'\);\s*\}/);
        // Submit: on success, straight to Activities.
        expect(screen).toMatch(/if \(result\.ok\) \{\s*goToActivities\(\);/);
        // Skip: navigation only — no request, so no rating is created.
        expect(screen).toMatch(/style=\{styles\.skipButton\}\s*onPress=\{goToActivities\}/);
        expect(screen).not.toMatch(/router\.(replace|navigate|push)\(['"]\/['"]\)/);
        expect(screen).not.toMatch(/\/\(tabs\)['"]|pathname: '\/'/);
    });

    it('is stars only: no free-text comment field', () => {
        expect(screen).not.toMatch(/TextInput/);
    });

    it('lists the bus’s facilities with the existing facility rules', () => {
        expect(screen).toContain('describeAccessibilityFacilities(bus.accessibilityFacilities)');
    });
});
