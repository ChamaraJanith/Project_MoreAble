// Back, on the journey-planning screens.
//
// The bug this covers: the planner, the results and the route details were four
// sibling routes of the BOTTOM-TAB navigator, hidden from the tab bar with
// `href: null`. A tab router keeps no push history — with its default
// `backBehavior` of 'firstRoute' its whole history is [first tab, current tab] —
// so every Back answered with the FIRST tab, which is Home. Route Details went
// to Home instead of the results the passenger came from.
//
// The fix is a real Stack for the journey flow, so these tests assert the route
// structure that produces correct Back behaviour, plus the one rule the screens
// apply on top of it: fall back only when there is genuinely nothing to pop.

import * as fs from 'fs';
import * as path from 'path';

// The module under test only imports `router` to use as its default navigator;
// every case below injects its own. Mocked because pulling in the real
// expo-router drags React Native into a node-only test environment.
jest.mock('expo-router', () => ({
    router: { canGoBack: jest.fn(() => false), back: jest.fn(), replace: jest.fn() },
}));

import {
    BackNavigator,
    HOME_PATH,
    JOURNEY_COMMUNITY_FEEDBACK_PATH,
    JOURNEY_PLANNER_PATH,
    JOURNEY_RESULTS_PATH,
    JOURNEY_ROUTE_DETAILS_PATH,
    goBackOrTo,
} from '../../../src/features/journey/utils/journeyNavigation';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function fakeNavigator(canGoBack: boolean): BackNavigator & {
    back: jest.Mock;
    replace: jest.Mock;
} {
    return {
        canGoBack: () => canGoBack,
        back: jest.fn(),
        replace: jest.fn(),
    };
}

// ------------------------------------------------------------------
describe('the journey flow is a stack, not four tabs', () => {
    const journeyLayout = read('app/(tabs)/journey/_layout.tsx');
    const tabLayout = read('app/(tabs)/_layout.tsx');

    it('declares a Stack for the journey screens', () => {
        expect(journeyLayout).toContain('<Stack');
        expect(journeyLayout).toContain("from 'expo-router'");
    });

    it('holds every journey screen as a frame of that stack', () => {
        for (const name of ['index', 'results', 'route-details', 'community-feedback']) {
            expect(journeyLayout).toContain(`name="${name}"`);
        }
    });

    it('no longer registers the journey sub-screens as tab routes', () => {
        // These were the four siblings whose Back fell through to the tab
        // router. Re-adding any of them would bring the bug straight back.
        expect(tabLayout).not.toContain('name="journey/index"');
        expect(tabLayout).not.toContain('name="journey/results"');
        expect(tabLayout).not.toContain('name="journey/route-details"');
    });

    it('keeps Journey as one bottom tab', () => {
        expect(tabLayout).toContain('name="journey"');
        expect(tabLayout).toContain("title: 'Journey'");
    });

    it('leaves the other tabs alone', () => {
        for (const name of ['index', 'activities/index', 'booking/index', 'notifications']) {
            expect(tabLayout).toContain(`name="${name}"`);
        }
    });
});

// ------------------------------------------------------------------
describe('Back, when there is a screen to go back to', () => {
    it('pops rather than jumping to any hard-coded destination', () => {
        const navigator = fakeNavigator(true);

        goBackOrTo(JOURNEY_PLANNER_PATH, navigator);

        expect(navigator.back).toHaveBeenCalledTimes(1);
        expect(navigator.replace).not.toHaveBeenCalled();
    });

    it('never sends a normal Back to Home', () => {
        const navigator = fakeNavigator(true);

        goBackOrTo(JOURNEY_RESULTS_PATH, navigator);

        expect(navigator.replace).not.toHaveBeenCalledWith(HOME_PATH);
    });
});

// ------------------------------------------------------------------
describe('Back, when there is nothing to go back to', () => {
    it('falls back rather than leaving a dead arrow', () => {
        const navigator = fakeNavigator(false);

        goBackOrTo(JOURNEY_RESULTS_PATH, navigator);

        expect(navigator.back).not.toHaveBeenCalled();
        expect(navigator.replace).toHaveBeenCalledWith(JOURNEY_RESULTS_PATH);
    });

    it('replaces rather than pushes, so the fallback does not stack up behind', () => {
        const navigator = fakeNavigator(false);

        goBackOrTo(JOURNEY_PLANNER_PATH, navigator);

        expect(navigator.replace).toHaveBeenCalledTimes(1);
    });
});

// ------------------------------------------------------------------
describe('each journey screen goes back to the right place', () => {
    const planner = read('src/features/journey/ui/JourneyPlannerForm.tsx');
    const results = read('src/features/journey/ui/JourneySearchResults.tsx');
    const details = read('src/features/journey/ui/RouteDetailsScreen.tsx');
    const feedback = read('src/features/reports/ui/BusCommunityFeedbackScreen.tsx');

    it('Route Details falls back to the results it is normally opened from', () => {
        expect(details).toContain('goBackOrTo(JOURNEY_RESULTS_PATH)');
    });

    it('Search Results falls back to the planner', () => {
        expect(results).toContain('goBackOrTo(JOURNEY_PLANNER_PATH)');
    });

    it('Community Feedback falls back to Route Details', () => {
        expect(feedback).toContain('goBackOrTo(JOURNEY_ROUTE_DETAILS_PATH)');
    });

    it('the planner, being the root of the flow, falls back to Home', () => {
        expect(planner).toContain('goBackOrTo(HOME_PATH)');
    });

    it('no journey screen calls a bare router.back() any more', () => {
        for (const source of [planner, results, details, feedback]) {
            expect(source).not.toMatch(/router\.back\(\)/);
        }
    });

    it('no journey screen hard-codes Home as a Back destination', () => {
        for (const source of [results, details, feedback]) {
            expect(source).not.toMatch(/router\.(replace|push)\(['"]\/['"]\)/);
            expect(source).not.toMatch(/pathname: '\/'/);
        }
    });
});

// ------------------------------------------------------------------
describe('going forward still pushes, so there is something to pop', () => {
    const planner = read('src/features/journey/ui/JourneyPlannerForm.tsx');
    const card = read('src/features/journey/ui/JourneyOptionCard.tsx');
    const details = read('src/features/journey/ui/RouteDetailsScreen.tsx');

    it('the planner pushes the results', () => {
        expect(planner).toContain('router.push');
        expect(planner).toContain('JOURNEY_RESULTS_PATH');
    });

    it('a result card pushes the route details', () => {
        expect(card).toContain('router.push');
        expect(card).toContain('JOURNEY_ROUTE_DETAILS_PATH');
    });

    it('route details pushes the community feedback', () => {
        expect(details).toContain('JOURNEY_COMMUNITY_FEEDBACK_PATH');
    });

    it('none of them replaces the screen it came from', () => {
        // A replace would drop the frame Back needs, which is the other way to
        // reproduce the original bug.
        for (const source of [planner, card]) {
            expect(source).not.toContain('router.replace');
        }
    });
});

// ------------------------------------------------------------------
describe('Edit search keeps the search it is editing', () => {
    const results = read('src/features/journey/ui/JourneySearchResults.tsx');

    it('goes back to the planner instead of pushing a second, empty one', () => {
        expect(results).toMatch(/handleEditSearch[\s\S]{0,400}goBackOrTo\(JOURNEY_PLANNER_PATH\)/);
        expect(results).not.toMatch(/handleEditSearch[\s\S]{0,400}router\.push/);
    });
});

// ------------------------------------------------------------------
describe('the paths themselves', () => {
    it('are the URLs the screens already lived at', () => {
        expect(JOURNEY_PLANNER_PATH).toBe('/journey');
        expect(JOURNEY_RESULTS_PATH).toBe('/journey/results');
        expect(JOURNEY_ROUTE_DETAILS_PATH).toBe('/journey/route-details');
        expect(JOURNEY_COMMUNITY_FEEDBACK_PATH).toBe('/journey/community-feedback');
    });

    it('put the community feedback screen inside the journey stack', () => {
        expect(JOURNEY_COMMUNITY_FEEDBACK_PATH.startsWith(`${JOURNEY_PLANNER_PATH}/`)).toBe(true);
    });
});
