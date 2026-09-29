// Exact-time and nearby journey groups on the results screen (MOV-310).
//
// This project's Jest setup is node-only, with no React Native renderer, so the
// screen is checked the way `favouriteRoutes.test.ts` and
// `journeyBackNavigation.test.ts` check theirs: by reading its source. What CAN
// run without a renderer does — the ordering property that lets the screen
// split the list without sorting it again, and the locale files themselves.
//
// No credential-shaped value appears; none of this needs one.

import * as fs from 'fs';
import * as path from 'path';
import {
    JourneySearchMatch,
    JourneySearchOption,
} from '../../../src/entities/route/model/types';
import {
    isExactTimeMatch,
    toRecommendedJourneys,
} from '../../../src/features/journey/utils/journeyRecommendations';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const results = read('src/features/journey/ui/JourneySearchResults.tsx');
const card = read('src/features/journey/ui/JourneyOptionCard.tsx');

const locale = (lang: 'en' | 'si') =>
    JSON.parse(read(`src/shared/i18n/locales/${lang}.json`)) as Record<string, any>;

const NEW_KEYS = [
    'exactTimeHeading',
    'nearbyHeading',
    'noExactNotice',
    'noSuitableTitle',
    'noSuitableDesc',
] as const;

// ------------------------------------------------------------------
// The two groups
// ------------------------------------------------------------------
describe('splitting the results into exact and nearby journeys', () => {
    it('classifies with the shared helper, from the search own measurement', () => {
        expect(results).toMatch(/import \{[^}]*isExactTimeMatch[^}]*\} from '\.\.\/utils\/journeyRecommendations'/);
        expect(results).toMatch(
            /const exactJourneys = useMemo\([\s\S]*?visibleJourneys\.filter\([\s\S]*?isExactTimeMatch\(journey\.option\.minutesFromRequestedTime\)/
        );
        expect(results).toMatch(
            /const nearbyJourneys = useMemo\([\s\S]*?visibleJourneys\.filter\([\s\S]*?!isExactTimeMatch\(journey\.option\.minutesFromRequestedTime\)/
        );
    });

    it('never works the time relation out again on the device', () => {
        expect(results).not.toMatch(/timing\.boardingTime/);
        expect(results).not.toMatch(/minutesFromRequestedTime\s*(<=|>=|<|>|===\s*0)/);
    });

    it('does not reorder either group', () => {
        expect(results).not.toMatch(/\.sort\(/);
        expect(results).not.toMatch(/rankJourneyOptions\(/);
    });

    it('renders every journey with the existing card, in its own group', () => {
        expect(results).toMatch(/exactJourneys\.map\(renderJourneyCard\)/);
        expect(results).toMatch(/nearbyJourneys\.map\(renderJourneyCard\)/);
        expect(results).toMatch(/const renderJourneyCard = [\s\S]*?<JourneyOptionCard/);
        // No flat list of every journey alongside the groups.
        expect(results).not.toMatch(/visibleJourneys\.map\(/);
    });

    it('puts the exact group before the nearby group', () => {
        expect(results.indexOf('exactJourneys.map(renderJourneyCard)')).toBeLessThan(
            results.indexOf('nearbyJourneys.map(renderJourneyCard)')
        );
    });
});

// ------------------------------------------------------------------
// Why filtering is enough: exact journeys already lead the list
// ------------------------------------------------------------------
describe('the recommended order the groups are cut from', () => {
    const STOPS = ['Kaduwela', 'Malabe', 'Battaramulla'];

    function option(tripId: string, minutes: number | null, score: number): JourneySearchOption {
        return {
            trip: { tripId, departureTime: '10:00', estimatedArrivalTime: '10:30', turnNumber: 1 },
            bus: {
                busId: `BUS-${tripId}`,
                numberPlate: `NB-${tripId}`,
                busModel: 'Ashok Leyland Viking',
                manufacturer: 'Ashok Leyland',
                seatCapacity: 54,
                accessibilityFacilities: {} as never,
                accessibilityScore: score,
            } as JourneySearchOption['bus'],
            liveStatus: { available: false },
            minutesFromRequestedTime: minutes,
        };
    }

    const route: JourneySearchMatch = {
        routeId: 'ROUTE-177',
        routeNumber: '177',
        routeName: 'Kaduwela - Battaramulla',
        startLocation: 'Kaduwela',
        endLocation: 'Battaramulla',
        origin: 'Kaduwela',
        destination: 'Battaramulla',
        stops: STOPS,
        journeyStops: STOPS,
        distanceKm: 8,
        estimatedDuration: null,
        segmentDurationsMinutes: [8, 6],
        trips: [
            // The best-scoring buses are nearby; the exact ones score lower.
            option('NEAR-10', 10, 90),
            option('EXACT-LOW', 0, 20),
            option('NEAR-45', 45, 95),
            option('EXACT-HIGH', 0, 60),
            option('UNMEASURED', null, 99),
        ],
    };

    it('places every exact journey ahead of every nearby one', () => {
        const kinds = toRecommendedJourneys([route]).map((journey) =>
            isExactTimeMatch(journey.option.minutesFromRequestedTime) ? 'exact' : 'nearby'
        );

        expect(kinds).toEqual(['exact', 'exact', 'nearby', 'nearby', 'nearby']);
    });

    it('so filtering it keeps each group in the recommended order', () => {
        const ordered = toRecommendedJourneys([route]);
        const exact = ordered.filter((j) => isExactTimeMatch(j.option.minutesFromRequestedTime));
        const nearby = ordered.filter((j) => !isExactTimeMatch(j.option.minutesFromRequestedTime));

        expect([...exact, ...nearby]).toEqual(ordered);
        expect(exact.map((j) => j.option.trip.tripId)).toEqual(['EXACT-HIGH', 'EXACT-LOW']);
        expect(nearby.map((j) => j.option.trip.tripId)).toEqual(['NEAR-10', 'NEAR-45', 'UNMEASURED']);
    });
});

// ------------------------------------------------------------------
// Headings, the no-exact notice, and screen readers
// ------------------------------------------------------------------
describe('what the passenger is told', () => {
    it('announces both group headings as headers', () => {
        expect(results).toMatch(
            /function SectionHeading[\s\S]*?<Text[^>]*accessibilityRole="header"[\s\S]*?\{title\}/
        );
        expect(results).toMatch(/<SectionHeading[\s\S]*?t\('journey\.exactTimeHeading'/);
        expect(results).toMatch(/<SectionHeading[\s\S]*?t\('journey\.nearbyHeading'/);
    });

    it('explains that nothing leaves at exactly the requested time', () => {
        expect(results).toMatch(
            /exactJourneys\.length === 0 && nearbyJourneys\.length > 0 && \(\s*<View[\s\S]*?accessibilityLiveRegion="polite"[\s\S]*?t\('journey\.noExactNotice', \{\s*time: friendlyTime/
        );
    });

    it('shows that notice before the nearby group', () => {
        expect(results.indexOf("t('journey.noExactNotice'")).toBeLessThan(
            results.indexOf('nearbyJourneys.map(renderJourneyCard)')
        );
    });
});

// ------------------------------------------------------------------
// Empty states
// ------------------------------------------------------------------
describe('when nothing is offered', () => {
    it('no longer describes a search that only looked forward', () => {
        expect(results).not.toMatch(/Try an earlier time/);
        expect(results).not.toMatch(/at or after/);
        expect(results).not.toMatch(/No departures left/);
    });

    it('says no suitable journey leaves within an hour of the requested time', () => {
        expect(results).toMatch(/t\('journey\.noSuitableTitle'/);
        expect(results).toMatch(
            /t\('journey\.noSuitableDesc', \{\s*origin,\s*destination,\s*time: friendlyTime/
        );
    });

    it('keeps the empty state for a journey no route serves', () => {
        expect(results).toMatch(/'No routes found'/);
        expect(results).toMatch(/Try a nearby stop or check the spelling\./);
    });

    it('keeps the empty state for requirements nothing meets, unchanged', () => {
        expect(results).toMatch(/\{isFilteredEmpty && \(/);
        expect(results).toMatch(/t\('journey\.noMatchesTitle', 'No matching journeys'\)/);
        expect(results).toMatch(/Try removing a requirement\./);
        expect(results).toMatch(/onPress=\{handleClearRequirements\}/);
        expect(results).toMatch(/accessibilityLabel="Clear accessibility requirements"/);
    });

    it('keeps the time-window empty state for an unfiltered search only', () => {
        expect(results).toMatch(/\{isEmpty && !isFiltering && \(/);
    });

    it('no longer claims the list is ordered by accessibility alone', () => {
        expect(results).not.toMatch(/most accessible first/);
        expect(results).toMatch(/closest to your time first,\s*then most accessible/);
    });
});

// ------------------------------------------------------------------
// The card: booking and details unchanged, time match announced
// ------------------------------------------------------------------
describe('each journey card', () => {
    it('still books and opens details the way it did', () => {
        expect(card).toMatch(/`Book this trip on route \$\{route\.routeNumber\}`/);
        expect(card).toMatch(/`View details for route \$\{route\.routeNumber\}`/);
        expect(card).toMatch(/pathname: JOURNEY_ROUTE_DETAILS_PATH/);
        expect(card).toMatch(/pathname: '\/booking\/seats\/\[tripId\]'/);
    });

    it('classifies itself with the shared helper, from the search own measurement', () => {
        expect(card).toMatch(/import \{[^}]*isExactTimeMatch[^}]*\} from '\.\.\/utils\/journeyRecommendations'/);
        expect(card).toMatch(
            /const isExactTime = isExactTimeMatch\(option\.minutesFromRequestedTime\)/
        );
    });

    it('tells a screen reader when the journey is at the requested time', () => {
        expect(card).toMatch(
            /const summaryLabel =\s*`\$\{isExactTime \? 'At your requested time\. '/
        );
    });

    it('tells a screen reader when the journey is a nearby alternative', () => {
        expect(card).toMatch(
            /const summaryLabel =\s*`\$\{isExactTime \? '[^']*' : 'Nearby alternative, within an hour of your requested time\. '\}`/
        );
    });

    it('never works the time relation out again on the device', () => {
        expect(card).not.toMatch(/minutesFromRequestedTime\s*(===|<=|>=|<|>)/);
        expect(card).not.toMatch(/timing\.boardingTime/);
    });
});

// ------------------------------------------------------------------
// Localization
// ------------------------------------------------------------------
describe('the new journey strings', () => {
    const en = locale('en').journey;
    const si = locale('si').journey;

    it.each(NEW_KEYS)('exists in both English and Sinhala: %s', (key) => {
        expect(typeof en[key]).toBe('string');
        expect(typeof si[key]).toBe('string');
        expect(si[key].length).toBeGreaterThan(0);
    });

    it('keeps the same journey keys in both languages', () => {
        expect(Object.keys(si).sort()).toEqual(Object.keys(en).sort());
    });

    it('interpolates the requested time where the text refers to it', () => {
        for (const key of ['exactTimeHeading', 'noExactNotice', 'noSuitableDesc']) {
            expect(en[key]).toContain('{{time}}');
            expect(si[key]).toContain('{{time}}');
        }

        for (const lang of [en, si]) {
            expect(lang.noSuitableDesc).toContain('{{origin}}');
            expect(lang.noSuitableDesc).toContain('{{destination}}');
        }
    });

    it('uses the English text as the in-code fallback, so the two cannot drift', () => {
        for (const key of NEW_KEYS) {
            expect(results).toContain(en[key]);
        }
    });

    it('never suggests only an earlier time, in either language', () => {
        for (const key of NEW_KEYS) {
            expect(en[key]).not.toMatch(/earlier time/i);
        }
    });
});
