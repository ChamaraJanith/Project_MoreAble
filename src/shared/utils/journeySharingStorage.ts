// The running journey's location-sharing grant, on the bus phone (MOV-294).
//
// Kept apart from `busSession` on purpose. The bus session is the dashboard
// sign-in, and logging out clears it. The sharing grant belongs to the
// JOURNEY: it is written when Start Journey succeeds and removed only when the
// journey ends (End Journey, or its window running out). Logging out never
// touches it, which is what lets location sharing continue after sign-out.
//
// The storage mechanism is the same one busSession uses — the encrypted secure
// store on a device, localStorage on web — so there is one way credentials are
// held rather than two.
//
// The token held here is narrow: issued by the server for one bus and one
// trip, it can only report that bus's position and expires with the journey.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'moreable_journey_sharing';

/** Everything the sharing loop needs to keep reporting for one journey. */
export interface JourneySharingGrant {
    tripId: string;
    busId: string;
    /** The narrow location-sharing credential for this journey. */
    token: string;
    /** ISO 8601 — the journey's window end; sharing never outlives it. */
    expiresAt: string;
}

function isUsableGrant(value: Partial<JourneySharingGrant> | null): value is JourneySharingGrant {
    return (
        !!value &&
        typeof value.tripId === 'string' &&
        !!value.tripId.trim() &&
        typeof value.busId === 'string' &&
        !!value.busId.trim() &&
        typeof value.token === 'string' &&
        !!value.token.trim() &&
        typeof value.expiresAt === 'string' &&
        !Number.isNaN(new Date(value.expiresAt).getTime())
    );
}

/** Stores the grant for a started journey. Failures propagate to the caller. */
export async function saveJourneySharingGrant(grant: JourneySharingGrant): Promise<void> {
    const value = JSON.stringify({
        tripId: grant.tripId,
        busId: grant.busId,
        token: grant.token,
        expiresAt: grant.expiresAt,
    });

    if (Platform.OS === 'web') {
        localStorage.setItem(KEY, value);
        return;
    }

    await SecureStore.setItemAsync(KEY, value);
}

/** The stored grant, or null when there is none or it is unreadable. */
export async function getJourneySharingGrant(): Promise<JourneySharingGrant | null> {
    try {
        const raw = Platform.OS === 'web' ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as Partial<JourneySharingGrant>;
        return isUsableGrant(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/** Removes the grant — only when the journey itself has ended. */
export async function clearJourneySharingGrant(): Promise<void> {
    try {
        if (Platform.OS === 'web') {
            localStorage.removeItem(KEY);
            return;
        }

        await SecureStore.deleteItemAsync(KEY);
    } catch {
        // Nothing stored, or storage unavailable: either way nothing to share.
    }
}
