/**
 * A passenger auto-qualifies for a priority seat when their profile already
 * signals an accessibility need — elderly status (from NIC-derived age) or a
 * completed accessibility profile. This is the system "identifying"
 * passengers with accessibility requirements, per the story's first
 * acceptance criterion.
 */
export function isAutoEligibleForPriority(user: {
    isElderPerson?: boolean;
    accessibilityProfileId?: string | null;
} | null | undefined): boolean {
    if (!user) return false;
    return !!user.isElderPerson || !!user.accessibilityProfileId;
}