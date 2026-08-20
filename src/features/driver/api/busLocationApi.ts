// Sending the phone's position to the bus location endpoint (MOV-265).
//
// The reading comes from the phone (MOV-263), the driver triggers it (MOV-264),
// and this puts it on the wire. One request per call — repeating it on a timer
// is MOV-262 and does not happen here or anywhere this is called from.
//
// The bus and the credential both arrive as arguments. Nothing here resolves,
// stores or guesses either: publishing a real position against the wrong bus
// would put a vehicle somewhere it is not on a passenger's map, so the identity
// has to come from the session that established it.

import { API_BASE_URL } from '../../../shared/api/config';
import { PhoneLocation } from '../../../shared/utils/phoneLocation';

/**
 * Why publishing failed.
 *
 * The endpoint refuses a report with a specific status, and a driver can act on
 * some of those and not others. Collapsing them into one message would leave
 * someone retrying a request that can never succeed.
 */
export type PublishLocationErrorReason =
    /** No credential, or one the server would not accept. */
    | 'NOT_AUTHENTICATED'
    /** Authenticated, but not permitted to move this bus. */
    | 'NOT_AUTHORISED'
    /** The bus is not in the fleet. */
    | 'BUS_NOT_FOUND'
    /** The reading itself was refused. */
    | 'INVALID_LOCATION'
    /** The request never reached the server. */
    | 'NETWORK_UNAVAILABLE'
    /** Anything else, including a server fault or an unconfirmed answer. */
    | 'PUBLISH_FAILED';

const MESSAGES: Record<PublishLocationErrorReason, string> = {
    NOT_AUTHENTICATED: 'This bus is signed out. Please sign in again to share its location.',
    NOT_AUTHORISED: 'This device is not allowed to share the location for this bus.',
    BUS_NOT_FOUND: 'This bus is no longer in the fleet. Please contact your operator.',
    INVALID_LOCATION: 'The location reading could not be sent. Please try again.',
    NETWORK_UNAVAILABLE: 'No connection. Please check your signal and try again.',
    PUBLISH_FAILED: 'The location could not be shared just now. Please try again.',
};

/**
 * A publishing failure the app can act on.
 *
 * Carries a message safe to show, matching how the rest of this project reports
 * a failed request, plus a `reason` a caller can branch on. The server's own
 * wording is kept on `serverMessage` for diagnostics rather than shown, since
 * it is written for an operator rather than a driver.
 */
export class PublishLocationError extends Error {
    readonly reason: PublishLocationErrorReason;
    readonly serverMessage?: string;

    constructor(reason: PublishLocationErrorReason, serverMessage?: string) {
        super(MESSAGES[reason]);
        this.name = 'PublishLocationError';
        this.reason = reason;
        if (serverMessage) {
            this.serverMessage = serverMessage;
        }
    }
}

/** Maps the endpoint's status codes onto something a driver can act on. */
function reasonForStatus(status: number): PublishLocationErrorReason {
    if (status === 401) return 'NOT_AUTHENTICATED';
    if (status === 403) return 'NOT_AUTHORISED';
    if (status === 404) return 'BUS_NOT_FOUND';
    if (status === 400) return 'INVALID_LOCATION';
    // A 2xx reaches here only when the body did not confirm the write, which is
    // a failed publish worth retrying rather than a credential problem.
    return 'PUBLISH_FAILED';
}

/**
 * Publishes one reading as the given bus.
 *
 * `busId` identifies the bus in the URL and the session credential proves the
 * caller may move it — the endpoint compares the two and refuses when they
 * disagree, so a wrong id here is rejected rather than acted on.
 *
 * The body is exactly the three fields the endpoint accepts. Nothing else from
 * the handset travels with it: speed, heading, altitude and accuracy are all
 * available from the GPS reading and none of them is sent. The credential
 * travels in the Authorization header and never in the body or the URL.
 *
 * Coordinates are never logged — they go into the request body and nowhere
 * else.
 */
export async function publishBusLocation(
    busId: string,
    location: PhoneLocation,
    sessionCredential: string
): Promise<void> {
    // Guarded rather than left to build a malformed URL: `/api/buses//location`
    // would reach a different route entirely.
    if (typeof busId !== 'string' || !busId.trim()) {
        throw new PublishLocationError('BUS_NOT_FOUND');
    }

    if (typeof sessionCredential !== 'string' || !sessionCredential.trim()) {
        // No point spending a request that is certain to be refused.
        throw new PublishLocationError('NOT_AUTHENTICATED');
    }

    let response: Response;

    try {
        response = await fetch(
            `${API_BASE_URL}/api/buses/${encodeURIComponent(busId.trim())}/location`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${sessionCredential}`,
                },
                body: JSON.stringify({
                    latitude: location.latitude,
                    longitude: location.longitude,
                    recordedAt: location.recordedAt,
                }),
            }
        );
    } catch {
        // Offline, DNS, server unreachable. Distinguished from a rejection
        // because the reading itself was fine and retrying may well work.
        throw new PublishLocationError('NETWORK_UNAVAILABLE');
    }

    const data = await response.json().catch(() => null);

    // Both halves are required. A 2xx alone does not mean the position was
    // stored: anything that is not this route can answer 200, and telling a
    // driver the bus is being tracked on that basis would be a lie.
    if (!response.ok || !data?.success) {
        throw new PublishLocationError(reasonForStatus(response.status), data?.message);
    }
}
