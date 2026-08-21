export interface ProfileCompletionInput {
  hasAccessibilityNeeds?: boolean | null;
  isAccessibilityVerified?: boolean | null;
  isVerified?: boolean | null;
}

/**
 * Calculates profile completion percentage based on accessibility needs and verification status.
 *
 * Rules:
 * - If user requested accessibility assistance (hasAccessibilityNeeds === true):
 *   - If accessibility profile is unverified: returns 80%.
 *   - If accessibility profile is verified: returns 100%.
 * - If user does NOT require accessibility assistance (hasAccessibilityNeeds === false):
 *   - Returns 100% (verification not required).
 */
export function getProfileCompletionPercentage(user: ProfileCompletionInput | null | undefined): number {
  if (!user) return 100;

  if (user.hasAccessibilityNeeds === true) {
    const isVerified = Boolean(user.isAccessibilityVerified ?? user.isVerified);
    return isVerified ? 100 : 80;
  }

  return 100;
}

export function isAccessibilityProfileVerified(user: ProfileCompletionInput | null | undefined): boolean {
  if (!user) return false;
  if (!user.hasAccessibilityNeeds) return true;
  return Boolean(user.isAccessibilityVerified ?? user.isVerified);
}
