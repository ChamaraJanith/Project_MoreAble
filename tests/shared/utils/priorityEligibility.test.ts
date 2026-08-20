import { isEligibleForPrioritySeat } from '../../../src/shared/utils/priorityEligibility';

describe('isEligibleForPrioritySeat', () => {
    it('returns false for null, undefined, or empty user (normal commuter / guest)', () => {
        expect(isEligibleForPrioritySeat(null)).toBe(false);
        expect(isEligibleForPrioritySeat(undefined)).toBe(false);
        expect(isEligibleForPrioritySeat({})).toBe(false);
    });

    it('returns false for normal commuter without qualifying accessibility needs', () => {
        const normalCommuter = {
            hasAccessibilityNeeds: false,
            accessibilityNeeds: [],
            isElderPerson: true, // Elderly qualifies for elderly seats, NOT priority seats unless low_vision/hearing/other present
        };
        expect(isEligibleForPrioritySeat(normalCommuter)).toBe(false);
    });

    it('returns true when user has low_vision boolean flag or array entry', () => {
        expect(isEligibleForPrioritySeat({ isLowVisionPerson: true })).toBe(true);
        expect(isEligibleForPrioritySeat({ accessibilityNeeds: ['low_vision'] })).toBe(true);
    });

    it('returns true when user has hearing_impairment boolean flag or array entry', () => {
        expect(isEligibleForPrioritySeat({ isHearingImpaired: true })).toBe(true);
        expect(isEligibleForPrioritySeat({ accessibilityNeeds: ['hearing_impairment'] })).toBe(true);
    });

    it('returns true when user has other accessibility needs boolean flag or array entry', () => {
        expect(isEligibleForPrioritySeat({ isOtherAccessibilityPerson: true })).toBe(true);
        expect(isEligibleForPrioritySeat({ accessibilityNeeds: ['other'] })).toBe(true);
    });

    it('returns true for multi-need profile containing low_vision or hearing_impairment or other', () => {
        expect(
            isEligibleForPrioritySeat({
                accessibilityNeeds: ['wheelchair', 'low_vision', 'hearing_impairment'],
            })
        ).toBe(true);
    });
});
