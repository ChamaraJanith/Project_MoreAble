// Reading and saving the passenger's journey accessibility filters (MOV-93).
//
// There is no new store and no new record here: the preference lives on the
// passenger's existing accessibility profile, and this is the journey feature's
// view of the endpoint that already owns it. The screen never talks to
// Firestore, exactly as it never does for anything else.
//
// Nothing in this module throws. A saved preference is a convenience: a
// passenger whose profile cannot be reached must still get a working journey
// search, filtered by whatever they select by hand. The one thing that must
// never happen is a stored value becoming a filter it is not, so what comes back
// is sanitised through the same shared parser the search API uses.

import { API_BASE_URL } from '../../../shared/api/config';
import {
    AccessibilityRequirementKey,
    parseAccessibilityRequirements,
} from '../../../shared/utils/accessibility';

/**
 * The requirements this passenger last applied, or an empty list.
 *
 * Empty covers every "nothing to restore" case identically — no profile yet, no
 * preference saved, an unreachable endpoint, a malformed record — because they
 * all mean the same thing to the screen: start with nothing selected, which is
 * exactly how the journey search behaved before this feature existed.
 */
export async function fetchSavedAccessibilityRequirements(
    passengerId: string
): Promise<AccessibilityRequirementKey[]> {
    if (!passengerId) return [];

    try {
        const response = await fetch(
            `${API_BASE_URL}/api/accessibility-profile?passengerId=${encodeURIComponent(passengerId)}`
        );

        if (!response.ok) return [];

        const data = await response.json().catch(() => null);

        // Sanitised again on arrival rather than trusted because the endpoint
        // sanitises: the rule that only a recognised key can become a filter is
        // cheap to enforce twice and expensive to get wrong once.
        return parseAccessibilityRequirements(data?.profile?.journeyAccessibilityRequirements)
            .requirements;
    } catch {
        return [];
    }
}

/**
 * Saves the passenger's current selection against their own profile.
 *
 * An empty list is a real preference — "I cleared my filters" — and is saved as
 * such rather than skipped. Resolves either way; the caller treats saving as
 * fire-and-forget, since failing to remember a selection must never interrupt
 * the search the passenger is running now.
 */
export async function saveAccessibilityRequirements(
    passengerId: string,
    requirements: readonly AccessibilityRequirementKey[]
): Promise<boolean> {
    if (!passengerId) return false;

    try {
        const response = await fetch(`${API_BASE_URL}/api/accessibility-profile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Only the preference: the profile screen owns the rest of the
            // record, and this request must not carry — or clear — any of it.
            body: JSON.stringify({
                passengerId,
                journeyAccessibilityRequirements: requirements,
            }),
        });

        return response.ok;
    } catch {
        return false;
    }
}
