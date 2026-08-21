export interface ProfileCompletionInput {
  isElderly?: boolean | null;
  isGuardianCompleted?: boolean | null;
  hasAccessibilityNeeds?: boolean | null;
  isAccessibilityVerified?: boolean | null;
  isVerified?: boolean | null;
}

/**
 * Calculates profile completion percentage based on age (elderly status), guardian registration,
 * and accessibility profile verification status.
 *
 * Rules for Elderly Passengers (Age 60+):
 * - Guardian NOT registered & Accessibility UNVERIFIED -> 50%
 * - Guardian NOT registered & Accessibility VERIFIED -> 60%
 * - Guardian REGISTERED & Accessibility UNVERIFIED -> 80%
 * - Guardian REGISTERED & Accessibility VERIFIED -> 100%
 *
 * Rules for Standard Passengers (< 60):
 * - Accessibility requested & UNVERIFIED -> 80%
 * - Accessibility requested & VERIFIED (or no accessibility needs) -> 100%
 */
export function getProfileCompletionPercentage(user: ProfileCompletionInput | null | undefined): number {
  if (!user) return 100;

  const isElderly = Boolean(user.isElderly);
  const isGuardianDone = Boolean(user.isGuardianCompleted);
  const hasAccNeeds = Boolean(user.hasAccessibilityNeeds);

  // If user has no accessibility needs, accessibility is treated as complete/verified
  const isAccVerified = hasAccNeeds ? Boolean(user.isAccessibilityVerified ?? user.isVerified) : true;

  if (isElderly) {
    if (!isGuardianDone && !isAccVerified) {
      return 50;
    }
    if (!isGuardianDone && isAccVerified) {
      return 60;
    }
    if (isGuardianDone && !isAccVerified) {
      return 80;
    }
    return 100;
  }

  // Non-elderly (< 60)
  if (hasAccNeeds && !isAccVerified) {
    return 80;
  }

  return 100;
}

export function isAccessibilityProfileVerified(user: ProfileCompletionInput | null | undefined): boolean {
  if (!user) return false;
  if (!user.hasAccessibilityNeeds) return true;
  return Boolean(user.isAccessibilityVerified ?? user.isVerified);
}
