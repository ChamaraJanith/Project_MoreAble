/**
 * Where the journey-planning screens are, and how Back behaves on them.
 *
 * The stack itself is declared in `app/(tabs)/journey/_layout.tsx`; this module
 * holds the paths and the one rule every Back control in the flow follows, so
 * the rule can be tested without a renderer (Jest here is node-only, and the
 * paths are strings either way).
 *
 * Nothing here re-implements navigation. With the stack in place `router.back()`
 * already pops to the right screen — the only thing this adds is what to do when
 * there is nothing to pop, which a deep link or a reload can produce.
 */

import { router } from 'expo-router';

export const JOURNEY_PLANNER_PATH = '/journey';
export const JOURNEY_RESULTS_PATH = '/journey/results';
export const JOURNEY_ROUTE_DETAILS_PATH = '/journey/route-details';
export const JOURNEY_COMMUNITY_FEEDBACK_PATH = '/journey/community-feedback';

/**
 * Favourite routes (MOV-99).
 *
 * A root route rather than a frame of the journey stack, because it is reached
 * from Profile as well as from the planner — the same arrangement Accessibility
 * Reports already uses.
 */
export const FAVOURITE_ROUTES_PATH = '/favourite-routes';

/** What the planner needs to open with a journey pair already filled in. */
export interface JourneyPrefillParams {
    origin: string;
    destination: string;
    prefillAt: string;
}

/**
 * The params that open the Journey Planner on a chosen journey pair (MOV-99).
 *
 * Origin and destination only. The travel date and time are deliberately absent
 * — a favourite does not store them, and the planner asks for them as it always
 * has before it will search.
 *
 * `prefillAt` is what makes a second tap on the SAME favourite work. The
 * planner applies a prefill when these params change, and origin and
 * destination alone do not change when the same favourite is chosen twice, so
 * the form would keep whatever the passenger had edited it to in between. A
 * per-tap stamp makes each choice distinct. Injectable so a test can pin it.
 */
export function journeyPrefillParams(
    origin: string,
    destination: string,
    now: number = Date.now()
): JourneyPrefillParams {
    return {
        origin: origin.trim(),
        destination: destination.trim(),
        prefillAt: String(now),
    };
}

/** Home, the tab the journey flow was entered from and the last safe fallback. */
export const HOME_PATH = '/';

/**
 * The minimum a Back control needs from the router.
 *
 * Declared as an interface so a test can hand in a double. `router` satisfies
 * it, and is the default, so no caller passes anything.
 */
export interface BackNavigator {
    canGoBack: () => boolean;
    back: () => void;
    replace: (path: any) => void;
}

/**
 * Go back one screen, or to `fallback` when there is no screen to go back to.
 *
 * `router.back()` is always preferred, because only the stack knows where the
 * passenger actually came from: Route Details is reached from the results, but
 * also from the community feedback screen's own Back, and hard-coding either
 * one would be wrong half the time.
 *
 * The fallback is for the case the stack cannot answer — opened by deep link, or
 * restored into a single frame — where `router.back()` would do nothing at all
 * and leave the passenger stuck on a screen with a dead arrow. It REPLACES
 * rather than pushes, so the fallback does not stack a second copy of a screen
 * behind the one being left.
 */
export function goBackOrTo(fallback: string, navigator: BackNavigator = router): void {
    if (navigator.canGoBack()) {
        navigator.back();
        return;
    }

    navigator.replace(fallback);
}
