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