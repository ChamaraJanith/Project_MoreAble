// Unique throwaway values for tests.
//
// Tests need arbitrary strings to stand in for things a real deployment would
// never write down. Typing those as literals is the problem this exists to
// avoid: a literal sitting next to a word like "password" is indistinguishable
// from a real leaked credential to a secret scanner, and this repository is
// pushed to GitHub.
//
// Two rules keep it safe, and both are structural rather than cosmetic:
//
//   1. Nothing here is named after a credential, so importing or calling it
//      cannot put a scanner keyword next to a quoted string.
//   2. It takes no arguments, so there is no place to pass a quoted label
//      even by accident.
//
// The values are produced at run time and never appear in source. Each is
// unique — a counter guarantees it — and unpredictable, so a test can never
// come to depend on a particular value.

let sequence = 0;

/**
 * A value no two calls will share.
 *
 * Reads as an identifier rather than a credential, which is what it is: a
 * disposable string that exists only for the duration of one test run.
 */
export function nextUniqueValue(): string {
    sequence += 1;

    const ordinal = String(sequence);
    const moment = Date.now().toString(36);
    const noise = Math.random().toString(36).slice(2, 10);

    return [ordinal, moment, noise].join('-');
}
