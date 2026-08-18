// The project password policy.
//
// The rule is not new — registration, the forgot-password form and the
// reset-password endpoint have all required six characters since they were
// written. It now lives in one place so the admin bus credential enforces the
// same rule rather than a second one that could drift away from it.
//
// No password-shaped literal appears here; values are built at run time.

import {
    MIN_PASSWORD_LENGTH,
    validatePassword,
} from '../../../src/shared/utils/password';
import { buildTestPassword, buildTooShortTestPassword } from '../../testUtils/testPassword';

/** A value of exactly `length` characters, built from a non-secret filler. */
function passwordOfLength(length: number): string {
    return 'x'.repeat(length);
}

describe('validatePassword', () => {
    it('accepts a password that meets the minimum', () => {
        expect(validatePassword(buildTestPassword())).toEqual({ valid: true });
    });

    it('accepts a password of exactly the minimum length', () => {
        expect(validatePassword(passwordOfLength(MIN_PASSWORD_LENGTH)).valid).toBe(true);
    });

    it('rejects one character short of the minimum', () => {
        expect(validatePassword(passwordOfLength(MIN_PASSWORD_LENGTH - 1)).valid).toBe(false);
    });

    it('rejects a password shorter than the minimum', () => {
        const result = validatePassword(buildTooShortTestPassword());

        expect(result.valid).toBe(false);
        expect(result.message).toContain(`${MIN_PASSWORD_LENGTH} characters`);
    });

    it.each([
        ['missing', undefined],
        ['null', null],
        ['empty', ''],
        ['a number', 123456],
        ['an object', {}],
    ])('rejects a password that is %s', (_label, value) => {
        // The backend applies this to a raw request body, so anything at all
        // can arrive here and none of it may be hashed as though it were a
        // password.
        expect(validatePassword(value).valid).toBe(false);
    });

    it('names the field so one message can serve several forms', () => {
        expect(validatePassword('', 'Bus password').message).toBe('Bus password is required.');
        expect(validatePassword(buildTooShortTestPassword(), 'Bus password').message).toContain(
            'Bus password'
        );
    });

    it('never echoes the value it rejected', () => {
        const rejected = buildTooShortTestPassword();

        // An error message is rendered on screen and often logged; repeating
        // the attempted credential back into it would defeat masking the input.
        expect(validatePassword(rejected).message).not.toContain(rejected);
    });
});