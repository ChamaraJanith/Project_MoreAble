// The project's password policy, in one place.
//
// The rule itself is not new: registration, the forgot-password form and
// POST /api/auth/reset-password have all required at least six characters since
// those flows were written. It was simply repeated as a literal in each of
// them. Anything that needs to apply the same rule — the admin bus credential
// among them — reads it from here instead of restating the number.

export const MIN_PASSWORD_LENGTH = 6;

export interface PasswordValidationResult {
    valid: boolean;
    /** Present only when invalid; safe to show to the person typing. */
    message?: string;
}

/**
 * Checks a candidate password against the project policy.
 *
 * Takes `unknown` because the backend applies this to a raw request body, where
 * the value may be any JSON type or missing entirely. It never echoes the value
 * it rejected — the message describes the rule, not the input.
 */
export function validatePassword(value: unknown, label = 'Password'): PasswordValidationResult {
    if (typeof value !== 'string' || value.length === 0) {
        return { valid: false, message: `${label} is required.` };
    }

    if (value.length < MIN_PASSWORD_LENGTH) {
        return {
            valid: false,
            message: `${label} must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        };
    }

    return { valid: true };
}