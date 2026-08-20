export const QUALIFYING_PRIORITY_NEEDS = [
    'low_vision',
    'hearing_impairment',
    'other',
] as const;

export type QualifyingPriorityNeed = typeof QUALIFYING_PRIORITY_NEEDS[number];

export interface PriorityUserEligibilityInput {
    accessibilityNeeds?: string[] | null;
    isLowVisionPerson?: boolean;
    isHearingImpaired?: boolean;
    isOtherAccessibilityPerson?: boolean;
    hasAccessibilityNeeds?: boolean;
    accessibilityProfileId?: string | null;
    isElderPerson?: boolean;
}

/**
 * Validates if a passenger qualifies for a priority seat.
 * Priority seats are locked for normal commuters and reserved EXCLUSIVELY
 * for passengers with registered accessibility needs:
 * - low_vision
 * - hearing_impairment
 * - other
 */
export function isEligibleForPrioritySeat(
    user: PriorityUserEligibilityInput | null | undefined
): boolean {
    if (!user) return false;

    // 1. Check direct boolean flags on user object
    if (user.isLowVisionPerson || user.isHearingImpaired || user.isOtherAccessibilityPerson) {
        return true;
    }

    // 2. Check accessibilityNeeds array
    if (Array.isArray(user.accessibilityNeeds) && user.accessibilityNeeds.length > 0) {
        const hasQualifyingNeed = user.accessibilityNeeds.some((need) =>
            typeof need === 'string' &&
            QUALIFYING_PRIORITY_NEEDS.includes(need.toLowerCase().trim() as QualifyingPriorityNeed)
        );
        if (hasQualifyingNeed) return true;
    }

    return false;
}

/** Backward-compatibility alias for legacy code callers. */
export function isAutoEligibleForPriority(
    user: PriorityUserEligibilityInput | null | undefined
): boolean {
    return isEligibleForPrioritySeat(user);
}