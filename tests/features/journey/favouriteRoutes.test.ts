// Favourite routes — the rules the feature is built on, and where they are wired in.
//
// MOV-76 asks for three things: a passenger can save a favourite route, their
// favourites appear in Profile, and they can remove one. The first half of this
// file covers the pure rules those depend on — what makes two journeys the same
// favourite, what the list order is, and what a screen reader is told. The
// second half covers the wiring that a node-only Jest setup cannot render,
// by reading the screens themselves, which is how this project already pins
// down the End Journey flow in `busRating.test.ts`.
//
// Nothing here touches the network, Firestore or a session.

import * as fs from 'fs';
import * as path from 'path';
import {
    FAVOURITE_ROUTE_CARD_HINT,
    FavouriteRoute,
    MAX_PLANNER_FAVOURITES,
    canSaveFavouriteRoute,
    favouriteChangeAnnouncement,
    favouriteRouteCardLabel,
    favouriteRouteJourneyLabel,
    favouriteRoutePairKey,
    favouriteRoutesCountLabel,
    favouriteToggleHint,
    favouriteToggleLabel,
    favouriteToggleText,
    findFavouriteRoute,
    hasHiddenPlannerFavourites,
    isFavouriteRouteSaved,
    isSameFavouriteRoute,
    plannerFavourites,
    removeFavouriteLabel,
    removeFavouriteRouteById,
    sortFavouriteRoutes,
    upsertFavouriteRoute,
} from '../../../src/features/journey/utils/favouriteRoutes';
import { journeyPrefillParams } from '../../../src/features/journey/utils/journeyNavigation';

// `journeyNavigation` imports `router` only to use as a default navigator, and
// nothing here navigates. Mocked because the real expo-router drags React
// Native into a node-only test environment — the same reason
// `journeyBackNavigation.test.ts` mocks it. `jest.mock` is hoisted above the
// imports above, so it is in place before that module loads.
jest.mock('expo-router', () => ({
    router: { canGoBack: () => false, back: () => {}, replace: () => {}, push: () => {}, navigate: () => {} },
}));

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function favourite(
    origin: string,
    destination: string,
    createdAt = '2026-09-20T08:30:00.000Z',
    favouriteId = `${origin}->${destination}`
): FavouriteRoute {
    return { favouriteId, origin, destination, createdAt };
}

const COLOMBO_TO_KADUWELA = favourite('Colombo Fort', 'Kaduwela');

// ------------------------------------------------------------------
describe('what makes two journeys the same favourite', () => {
    it('ignores casing and surrounding whitespace, as the journey search does', () => {
        expect(
            isSameFavouriteRoute(
                { origin: 'Colombo Fort', destination: 'Kaduwela' },
                { origin: '  colombo fort ', destination: 'KADUWELA' }
            )
        ).toBe(true);
    });

    it('treats the two directions as different journeys', () => {
        expect(
            isSameFavouriteRoute(
                { origin: 'Colombo Fort', destination: 'Kaduwela' },
                { origin: 'Kaduwela', destination: 'Colombo Fort' }
            )
        ).toBe(false);
    });

    it('does not confuse a pair whose parts share a boundary', () => {
        // 'ab' + 'c' and 'a' + 'bc' must not collapse into one key.
        expect(favouriteRoutePairKey('ab', 'c')).not.toBe(favouriteRoutePairKey('a', 'bc'));
    });

    it('finds a saved journey however the passenger typed it', () => {
        const saved = [COLOMBO_TO_KADUWELA];

        expect(findFavouriteRoute(saved, { origin: 'colombo fort', destination: 'kaduwela' }))
            .toBe(COLOMBO_TO_KADUWELA);
        expect(isFavouriteRouteSaved(saved, { origin: 'COLOMBO FORT', destination: 'Kaduwela' }))
            .toBe(true);
        expect(isFavouriteRouteSaved(saved, { origin: 'Kaduwela', destination: 'Colombo Fort' }))
            .toBe(false);
        expect(findFavouriteRoute([], { origin: 'Colombo Fort', destination: 'Kaduwela' })).toBeNull();
    });
});

// ------------------------------------------------------------------
describe('the saved list', () => {
    it('never shows one journey twice', () => {
        const first = favourite('Colombo Fort', 'Kaduwela', '2026-09-20T08:00:00.000Z', 'first');
        const again = favourite('colombo fort', 'KADUWELA', '2026-09-21T08:00:00.000Z', 'second');

        const list = upsertFavouriteRoute([first], again);

        expect(list).toHaveLength(1);
        expect(list[0].favouriteId).toBe('second');
    });

    it('keeps different journeys apart, both directions included', () => {
        let list: FavouriteRoute[] = [];

        list = upsertFavouriteRoute(list, favourite('A', 'B', '2026-09-20T08:00:00.000Z', 'ab'));
        list = upsertFavouriteRoute(list, favourite('B', 'A', '2026-09-20T09:00:00.000Z', 'ba'));
        list = upsertFavouriteRoute(list, favourite('A', 'C', '2026-09-20T10:00:00.000Z', 'ac'));

        expect(list.map((entry) => entry.favouriteId).sort()).toEqual(['ab', 'ac', 'ba']);
    });

    it('is newest first', () => {
        const older = favourite('A', 'B', '2026-09-18T08:00:00.000Z', 'older');
        const newer = favourite('C', 'D', '2026-09-22T08:00:00.000Z', 'newer');
        const middle = favourite('E', 'F', '2026-09-20T08:00:00.000Z', 'middle');

        expect(sortFavouriteRoutes([older, newer, middle]).map((entry) => entry.favouriteId))
            .toEqual(['newer', 'middle', 'older']);
    });

    it('sorts an unreadable timestamp last instead of scrambling the rest', () => {
        const broken = favourite('X', 'Y', 'not a date', 'broken');
        const good = favourite('A', 'B', '2026-09-18T08:00:00.000Z', 'good');

        expect(sortFavouriteRoutes([broken, good]).map((entry) => entry.favouriteId))
            .toEqual(['good', 'broken']);
    });

    it('does not reorder the caller own array', () => {
        const list = [
            favourite('A', 'B', '2026-09-18T08:00:00.000Z', 'older'),
            favourite('C', 'D', '2026-09-22T08:00:00.000Z', 'newer'),
        ];

        sortFavouriteRoutes(list);

        expect(list.map((entry) => entry.favouriteId)).toEqual(['older', 'newer']);
    });

    it('removes by id, and leaves an unknown id alone', () => {
        const list = [COLOMBO_TO_KADUWELA];

        expect(removeFavouriteRouteById(list, COLOMBO_TO_KADUWELA.favouriteId)).toEqual([]);
        expect(removeFavouriteRouteById(list, 'never-saved')).toHaveLength(1);
    });
});

// ------------------------------------------------------------------
describe('when the save control is offered', () => {
    it('needs two different places', () => {
        expect(canSaveFavouriteRoute('Colombo Fort', 'Kaduwela')).toBe(true);
    });

    it('is withheld when there is no journey to save', () => {
        const cases: [unknown, unknown][] = [
            ['', 'Kaduwela'],
            ['   ', 'Kaduwela'],
            ['Colombo Fort', ''],
            [undefined, 'Kaduwela'],
            ['Colombo Fort', null],
            [42, 'Kaduwela'],
            // A journey to where it starts is not a journey — and the search
            // refuses the same pair.
            ['Colombo Fort', 'colombo fort'],
            ['Colombo Fort', '  COLOMBO FORT  '],
        ];

        cases.forEach(([origin, destination]) =>
            expect(canSaveFavouriteRoute(origin, destination)).toBe(false)
        );
    });
});

// ------------------------------------------------------------------
describe('the shortcut list on the Journey Planner', () => {
    const many = Array.from({ length: MAX_PLANNER_FAVOURITES + 3 }, (_, index) =>
        favourite(`Origin ${index}`, `Destination ${index}`,
            // Ascending, so the LAST one made is the newest.
            `2026-09-${String(index + 1).padStart(2, '0')}T08:00:00.000Z`,
            `id-${index}`)
    );

    it('shows only the newest few', () => {
        const shown = plannerFavourites(many);

        expect(shown).toHaveLength(MAX_PLANNER_FAVOURITES);
        expect(shown[0].favouriteId).toBe(`id-${many.length - 1}`);
    });

    it('offers "view all" only when it is hiding some', () => {
        expect(hasHiddenPlannerFavourites(many)).toBe(true);
        expect(hasHiddenPlannerFavourites(many.slice(0, MAX_PLANNER_FAVOURITES))).toBe(false);
        expect(hasHiddenPlannerFavourites([])).toBe(false);
    });
});

// ------------------------------------------------------------------
describe('using a favourite', () => {
    it('carries the journey pair and nothing that would date it', () => {
        const params = journeyPrefillParams('  Colombo Fort  ', ' Kaduwela ', 1_700_000_000_000);

        expect(params.origin).toBe('Colombo Fort');
        expect(params.destination).toBe('Kaduwela');
        // A favourite stores no date or time, so none travels with it — the
        // passenger chooses those on the planner before it will search.
        expect(Object.keys(params).sort()).toEqual(['destination', 'origin', 'prefillAt']);
    });

    it('is a distinct instruction every time, so the same favourite works twice', () => {
        expect(journeyPrefillParams('A', 'B', 1).prefillAt)
            .not.toBe(journeyPrefillParams('A', 'B', 2).prefillAt);
    });
});

// ------------------------------------------------------------------
describe('what a screen reader is told', () => {
    it('names the journey rather than describing a star', () => {
        expect(favouriteRouteJourneyLabel(COLOMBO_TO_KADUWELA)).toBe('Colombo Fort to Kaduwela');
        expect(favouriteRouteCardLabel(COLOMBO_TO_KADUWELA))
            .toBe('Favourite route from Colombo Fort to Kaduwela');
        expect(removeFavouriteLabel(COLOMBO_TO_KADUWELA))
            .toBe('Remove Colombo Fort to Kaduwela from favourite routes');
    });

    it('states the action the tap performs, differently in each state', () => {
        const saved = favouriteToggleLabel(true, COLOMBO_TO_KADUWELA);
        const unsaved = favouriteToggleLabel(false, COLOMBO_TO_KADUWELA);

        expect(unsaved).toBe('Save Colombo Fort to Kaduwela as a favourite route');
        expect(saved).toBe('Remove Colombo Fort to Kaduwela from favourite routes');
        // The state has to be audible, not only visible.
        expect(saved).not.toBe(unsaved);
        expect(favouriteToggleHint(true)).not.toBe(favouriteToggleHint(false));
    });

    it('puts a word beside the star, so the state is never the icon alone', () => {
        expect(favouriteToggleText(false)).toBe('Save');
        expect(favouriteToggleText(true)).toBe('Saved');
    });

    it('confirms a save and a removal in words', () => {
        expect(favouriteChangeAnnouncement(true, COLOMBO_TO_KADUWELA))
            .toBe('Colombo Fort to Kaduwela saved to your favourite routes.');
        expect(favouriteChangeAnnouncement(false, COLOMBO_TO_KADUWELA))
            .toBe('Colombo Fort to Kaduwela removed from your favourite routes.');
    });

    it('counts favourites without saying "1 favourite routes"', () => {
        expect(favouriteRoutesCountLabel(1)).toBe('1 favourite route');
        expect(favouriteRoutesCountLabel(2)).toBe('2 favourite routes');
        expect(favouriteRoutesCountLabel(0)).toBe('0 favourite routes');
    });

    it('tells the passenger what tapping a card will do', () => {
        expect(FAVOURITE_ROUTE_CARD_HINT).toMatch(/filled in/i);
    });
});

// ------------------------------------------------------------------
// Where the feature is wired in.
//
// These read the screens because this project's Jest setup is node-only, with
// no React Native renderer — the same reason `busRating.test.ts` pins the End
// Journey flow this way.
// ------------------------------------------------------------------
describe('a passenger can save a favourite route', () => {
    const results = read('src/features/journey/ui/JourneySearchResults.tsx');
    const departure = read('src/features/journey/ui/JourneyOptionCard.tsx');

    it('puts the save control on the journey summary', () => {
        expect(results).toMatch(/<FavouriteToggleButton[\s\S]*?journey=\{journeyPair\}/);
        expect(results).toMatch(/isSaved=\{savedFavourite !== null\}/);
    });

    it('saves the searched pair, not anything belonging to a departure', () => {
        expect(results).toMatch(/const journeyPair = \{ origin: origin \?\? '', destination: destination \?\? '' \}/);
    });

    it('keeps the star off the departure card, which is a specific trip', () => {
        // A star there would promise to save that bus at that time, which is
        // not what a favourite is.
        expect(departure).not.toMatch(/favourite/i);
        expect(departure).not.toMatch(/FavouriteToggleButton/);
    });

    it('offers the control only when there is a journey to save', () => {
        expect(results).toMatch(/const canFavourite = canSaveFavouriteRoute\(origin, destination\)/);
        expect(results).toMatch(/\{canFavourite && \(/);
    });

    it('confirms the change where a screen reader will hear it', () => {
        expect(results).toMatch(/accessibilityLiveRegion="polite"/);
        expect(results).toMatch(/favouriteChangeAnnouncement\(/);
    });
});

// ------------------------------------------------------------------
describe('favourite routes appear in Profile', () => {
    const profile = read('app/profile.tsx');

    it('has a row in Account Options that opens the favourites screen', () => {
        expect(profile).toMatch(/router\.push\('\/favourite-routes' as any\)/);
        expect(profile).toMatch(/accessibilityLabel=\{t\('profile\.favouriteRoutes'/);
    });

    it('reaches a screen that exists', () => {
        expect(fs.existsSync(path.join(ROOT, 'app/favourite-routes.tsx'))).toBe(true);
        expect(read('app/favourite-routes.tsx')).toMatch(/<FavouriteRoutesScreen \/>/);
    });

    it('also surfaces them on the Journey Planner, above Recent Searches', () => {
        const planner = read('src/features/journey/ui/JourneyPlannerForm.tsx');
        const favouritesAt = planner.indexOf('journey.favourites.title');
        const recentAt = planner.indexOf('journey.recentSearches');

        expect(favouritesAt).toBeGreaterThan(-1);
        expect(recentAt).toBeGreaterThan(-1);
        expect(favouritesAt).toBeLessThan(recentAt);
        // Hidden entirely when there are none, rather than an empty section.
        expect(planner).toMatch(/\{visibleFavourites\.length > 0 && \(/);
    });
});

// ------------------------------------------------------------------
describe('a passenger can remove a saved route', () => {
    const screen = read('src/features/journey/ui/FavouriteRoutesScreen.tsx');
    const card = read('src/features/journey/ui/FavouriteRouteCard.tsx');

    it('offers a remove action on every card in the management screen', () => {
        expect(screen).toMatch(/onRemove=\{\(\) => setPendingRemoval\(favourite\)\}/);
        expect(card).toMatch(/accessibilityLabel=\{removeFavouriteLabel\(favourite\)\}/);
    });

    it('confirms before removing, using the project shared dialog', () => {
        expect(screen).toMatch(/<ConfirmDialog[\s\S]*?destructive/);
        expect(screen).toMatch(/onConfirm=\{handleConfirmRemoval\}/);
        expect(screen).toMatch(/removeFavouriteRoute\(pendingRemoval\.favouriteId\)/);
    });

    it('does not hide removal behind a swipe', () => {
        // Swipe actions are invisible to a screen reader, and this project uses
        // none anywhere.
        expect(screen).not.toMatch(/Swipeable|onSwipe/);
        expect(card).not.toMatch(/Swipeable|onSwipe/);
    });

    it('explains an empty list instead of showing a blank screen', () => {
        expect(screen).toMatch(/<AdminEmptyState[\s\S]*?journey\.favourites\.emptyTitle/);
        expect(screen).toMatch(/onAction=\{goToPlanner\}/);
    });
});

// ------------------------------------------------------------------
describe('using a favourite fills the planner and stops there', () => {
    const planner = read('src/features/journey/ui/JourneyPlannerForm.tsx');

    it('fills the origin and the destination only', () => {
        expect(planner).toMatch(
            /const handleUseFavourite = \(favourite: FavouriteRoute\) => \{\s*setFormData\(\{\s*origin: favourite\.origin,\s*destination: favourite\.destination,\s*\}\);\s*\};/
        );
    });

    it('never sets a date or a time, because a favourite has none', () => {
        const body = planner.slice(
            planner.indexOf('const handleUseFavourite'),
            planner.indexOf('const handleSelectDate')
        );

        expect(body).not.toMatch(/setSelectedDate|setSelectedTime/);
    });

    it('does not search — the passenger still presses Search themselves', () => {
        const body = planner.slice(
            planner.indexOf('const handleUseFavourite'),
            planner.indexOf('const handleSelectDate')
        );

        expect(body).not.toMatch(/handleSearch|router\.push|JOURNEY_RESULTS_PATH/);
        // And the search still refuses to run without a date and a time.
        expect(planner).toMatch(/if \(!selectedDate\) \{\s*showValidationMessage\('Please select a travel date\.'\)/);
        expect(planner).toMatch(/if \(!selectedTime\) \{\s*showValidationMessage\('Please select a travel time\.'\)/);
    });

    it('shows a favourite as a route pair, with nothing about a departure', () => {
        const card = read('src/features/journey/ui/FavouriteRouteCard.tsx');

        expect(card).toMatch(/\{favourite\.origin\}/);
        expect(card).toMatch(/\{favourite\.destination\}/);
        expect(card).not.toMatch(/tripId|busId|routeNumber|departureTime|arrivalTime|accessibilityScore|passengerRating/);
    });
});
