// Password values for tests, built at run time.
//
// Nothing password-shaped is written as a literal anywhere in the test suite.
// A realistic-looking constant in a test file is indistinguishable from a real
// leaked credential to a secret scanner, and this repository is pushed to
// GitHub — so the values are assembled here from harmless fragments plus a
// per-run counter instead.
//
// The results look like identifiers ("pw-bus-mf3k1a-1"), not credentials, and
// no two calls return the same value.

let sequence = 0;

/**
 * A value that satisfies the project password policy.
 *
 * `label` only makes the value easier to place when a test fails; it carries no
 * meaning and is never a secret.
 */
export function buildTestPassword(label = 'bus'): string {
    sequence += 1;
    return ['pw', label, Date.now().toString(36), String(sequence)].join('-');
}

/**
 * A value deliberately shorter than the policy minimum, for rejection paths.
 *
 * Kept well under the limit so it stays invalid if the minimum is ever raised.
 */
export function buildTooShortTestPassword(): string {
    sequence += 1;
    return `p${sequence}`;
}

/**
 * A stand-in for a session token, built the same way and for the same reason.
 *
 * Tests need values to pass as bearer credentials and to assert on. Written as
 * literals they look exactly like leaked tokens to a secret scanner — which is
 * what this avoids. The result reads as an identifier ("tk-session-mf3k1a-4"),
 * is unique per call, and is never a real token: nothing in this project would
 * accept one.
 */
export function buildTestToken(label = 'session'): string {
    sequence += 1;
    return ['tk', label, Date.now().toString(36), String(sequence)].join('-');
}