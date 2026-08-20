// The signed-in bus, on the driver's phone (MOV-265).
//
// Kept separate from `tokenStorage`, which holds the passenger/admin session:
// a phone mounted in a bus is signed in as a vehicle, not as a person, and the
// two must never be mistaken for one another or overwrite each other. The
// storage mechanism is deliberately the same one — encrypted secure store on a
// device, localStorage on web — so there is one way credentials are held.
//
// The bus password is never stored. Only the token issued for it is, and the
// token does not contain the password.

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEYS = {
    BUS_TOKEN: 'moreable_bus_token',
    BUS_DATA: 'moreable_bus_data',
} as const;

/** What the dashboard needs to know about the bus it is signed in as. */
export interface BusSession {
    /** The authenticated bus id, as issued by the login route. */
    busId: string;
    /** Shown to the driver so they can confirm the right bus is signed in. */
    numberPlate: string;
    /** The bearer token carrying the `BUS` role and this `busId`. */
    token: string;
}

function isUsableSession(value: unknown): value is BusSession {
    const session = value as Partial<BusSession> | null;

    return (
        !!session &&
        typeof session.busId === 'string' &&
        session.busId.trim().length > 0 &&
        typeof session.token === 'string' &&
        session.token.trim().length > 0
    );
}

/** Stores the session established by a successful bus login. */
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
 * longer usable. A partial session is treated as no session at all, because a
 * busId without a token cannot publish anything and a token without a busId has
 * no bus to publish for.
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
        // Unreadable or corrupt storage means no session, not a crash on a
        // screen the driver needs.
        return null;
    }
}

/** Clears the bus session — used when the driver signs the vehicle out. */
export async function clearBusSession(): Promise<void> {
    if (Platform.OS === 'web') {
        localStorage.removeItem(KEYS.BUS_TOKEN);
        localStorage.removeItem(KEYS.BUS_DATA);
        return;
    }

    await SecureStore.deleteItemAsync(KEYS.BUS_TOKEN);
    await SecureStore.deleteItemAsync(KEYS.BUS_DATA);
}
