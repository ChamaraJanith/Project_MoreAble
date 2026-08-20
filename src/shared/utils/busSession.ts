// The signed-in bus, on the driver's phone (MOV-265).
//
// Kept deliberately separate from `tokenStorage`, which holds the passenger and
// admin session. A phone mounted in a bus is signed in as a vehicle, not as a
// person: the two are different identities, they are used by different screens,
// and neither may overwrite the other. Separate keys are what guarantee that.
//
// The storage mechanism is the same one the rest of the project uses — the
// encrypted secure store on a device, localStorage on web — so there is one way
// credentials are held rather than two.
//
// The bus password is never stored. Only the token issued in exchange for it,
// and that token does not contain the password.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Distinct from the ACCESS_TOKEN / USER_DATA keys used for a person's session.
const KEYS = {
    BUS_TOKEN: 'moreable_bus_token',
    BUS_DATA: 'moreable_bus_data',
} as const;

/** Everything a driver screen needs to know about the bus it is signed in as. */
export interface BusSession {
    /** The authenticated bus id, exactly as the login route issued it. */
    busId: string;
    /** Shown to the driver so they can confirm the right bus is signed in. */
    numberPlate: string;
    /** The bearer token carrying the BUS role and this busId. */
    token: string;
}

function isUsableSession(value: Partial<BusSession> | null): value is BusSession {
    return (
        !!value &&
        typeof value.busId === 'string' &&
        value.busId.trim().length > 0 &&
        typeof value.token === 'string' &&
        value.token.trim().length > 0
    );
}

/**
 * Stores the session established by a successful bus login.
 *
 * Only the three fields above are written — the session is rebuilt field by
 * field rather than spread, so nothing else from a login response can end up
 * persisted on the device by accident.
 *
 * Failures are allowed to propagate. A caller must be able to tell that the
 * session did not persist, because navigating on to a driver screen with no
 * stored session would strand the driver there.
 */
export async function saveBusSession(session: BusSession): Promise<void> {
    const busData = JSON.stringify({
        busId: session.busId,
        numberPlate: session.numberPlate,
    });

    if (Platform.OS === 'web') {
        localStorage.setItem(KEYS.BUS_TOKEN, session.token);
        localStorage.setItem(KEYS.BUS_DATA, busData);
        return;
    }

    await SecureStore.setItemAsync(KEYS.BUS_TOKEN, session.token);
    await SecureStore.setItemAsync(KEYS.BUS_DATA, busData);
}

/**
 * The bus this phone is signed in as, or null.
 *
 * Null covers a phone that has never signed in and a stored record that is no
 * longer usable. A half-written session counts as none at all: a busId with no
 * token cannot authenticate anything, and a token with no busId has no vehicle
 * to act for.
 */
export async function getBusSession(): Promise<BusSession | null> {
    try {
        let token: string | null;
        let raw: string | null;

        if (Platform.OS === 'web') {
            token = localStorage.getItem(KEYS.BUS_TOKEN);
            raw = localStorage.getItem(KEYS.BUS_DATA);
        } else {
            token = await SecureStore.getItemAsync(KEYS.BUS_TOKEN);
            raw = await SecureStore.getItemAsync(KEYS.BUS_DATA);
        }

        if (!token || !raw) return null;

        const stored = JSON.parse(raw) as { busId?: string; numberPlate?: string };

        const session = {
            busId: stored?.busId ?? '',
            numberPlate: stored?.numberPlate ?? '',
            token,
        };

        return isUsableSession(session) ? session : null;
    } catch {
        // Unreadable or corrupt storage means no session — not a crash on a
        // screen the driver needs to reach.
        return null;
    }
}

/** Clears the bus session, for when the driver signs the vehicle out. */
export async function clearBusSession(): Promise<void> {
    if (Platform.OS === 'web') {
        localStorage.removeItem(KEYS.BUS_TOKEN);
        localStorage.removeItem(KEYS.BUS_DATA);
        return;
    }

    await SecureStore.deleteItemAsync(KEYS.BUS_TOKEN);
    await SecureStore.deleteItemAsync(KEYS.BUS_DATA);
}
