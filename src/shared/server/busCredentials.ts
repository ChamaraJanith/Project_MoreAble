// The bus login credential, on the server side only.
//
// A bus password is stored as the literal string the admin typed, under
// `password` on the bus document, so an authorised admin can read the
// configured credential straight out of Firestore. That is a deliberate
// project decision for the fleet, and it is NOT how user accounts work: those
// remain bcrypt-hashed under `passwordHash` in the auth routes, untouched.
//
// Because the stored value is the working credential itself, keeping it out of
// API responses is the only thing standing between it and every caller — which
// is what this module exists for.

/**
 * Strips every credential field from a bus record before it leaves the server.
 *
 * Removes both names on purpose:
 *
 * - `password` is what the fleet stores now, and it is the live credential.
 * - `passwordHash` may still sit on documents written by the earlier hashed
 *   implementation. It is left in place in Firestore rather than deleted, but
 *   it is never published either.
 *
 * Applied to every bus response — create, list, detail and update — because
 * two of those spread the stored document wholesale, so anything not removed
 * here goes out over the wire.
 */
export function withoutBusCredentials<T extends Record<string, any>>(
    bus: T
): Omit<T, 'password' | 'passwordHash'> {
    const { password: _password, passwordHash: _legacyHash, ...safeBus } = bus;
    return safeBus;
}