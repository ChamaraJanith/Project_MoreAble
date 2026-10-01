// What the vehicle dashboard's emergency console does, kept out of the screen
// so it can be tested on its own.
//
// Each operation reads the bus session fresh (as persistJourney does), finds
// the bus's newest open emergency on the server, and acts on that one. An
// outcome is `ok` only when the server confirmed it: the screen shows success,
// or clears the emergency banner, on nothing less.

import { BusCrewEmergency } from '../../../entities/emergency/model/types';
import { BusSession, getBusSession } from '../../../shared/utils/busSession';
import {
    confirmBusEmergencyResolvedApi,
    getOpenBusEmergencies,
    sendBusCrewMessageApi,
} from '../api/busEmergencyApi';

export type BusEmergencyConsoleOutcome =
    | { ok: true; emergency: BusCrewEmergency }
    | { ok: false; message: string };

type ReadBusSession = () => Promise<BusSession | null>;

const SIGN_IN_AGAIN = 'Please sign this bus in again.';
const NO_OPEN_EMERGENCY = 'No open emergency was found for this bus.';

async function readSession(read: ReadBusSession): Promise<BusSession | null> {
    return read().catch(() => null);
}

function failure(error: unknown, fallback: string): BusEmergencyConsoleOutcome {
    const message = error instanceof Error && error.message ? error.message : fallback;
    return { ok: false, message };
}

/** The bus's newest open emergency, or null. Throws when it cannot be read. */
export async function findOpenBusEmergency(read: ReadBusSession = getBusSession): Promise<BusCrewEmergency | null> {
    const session = await readSession(read);
    if (!session) return null;

    const open = await getOpenBusEmergencies(session);
    return open[0] ?? null;
}

async function actOnOpenEmergency(
    read: ReadBusSession,
    act: (session: BusSession, emergencyId: string) => Promise<BusCrewEmergency>,
    fallback: string
): Promise<BusEmergencyConsoleOutcome> {
    const session = await readSession(read);
    if (!session) return { ok: false, message: SIGN_IN_AGAIN };

    try {
        const open = await getOpenBusEmergencies(session);
        const active = open[0];
        if (!active) return { ok: false, message: NO_OPEN_EMERGENCY };

        return { ok: true, emergency: await act(session, active.id) };
    } catch (error) {
        return failure(error, fallback);
    }
}

/** Sends a crew message to Control Center on the bus's open emergency. */
export function sendCrewMessage(
    text: string,
    read: ReadBusSession = getBusSession
): Promise<BusEmergencyConsoleOutcome> {
    return actOnOpenEmergency(
        read,
        (session, emergencyId) => sendBusCrewMessageApi(session, emergencyId, text),
        'Unable to send message to Control Center.'
    );
}

/** Confirms the bus's open emergency resolved; ok only once the server has. */
export function confirmCrewResolution(read: ReadBusSession = getBusSession): Promise<BusEmergencyConsoleOutcome> {
    return actOnOpenEmergency(
        read,
        (session, emergencyId) => confirmBusEmergencyResolvedApi(session, emergencyId),
        'Unable to mark the emergency as resolved.'
    );
}
