import { UserRegistrationDTO, User, AccessibilityProfile } from '../../../src/entities/user/model/types';

describe('Registration Accessibility Needs DTO, User model & AccessibilityProfile', () => {
    it('should correctly format UserRegistrationDTO with accessibility needs for a Wheelchair User', () => {
        const dto: UserRegistrationDTO = {
            userName: 'John Doe',
            email: 'john@example.com',
            password: 'Password123',
            nicNo: '199012345678',
            phoneNumber: '0771234567',
            secondaryPhoneNumber: '0719876543',
            hasAccessibilityNeeds: true,
            accessibilityNeeds: ['wheelchair'],
        };

        expect(dto.hasAccessibilityNeeds).toBe(true);
        expect(dto.accessibilityNeeds).toContain('wheelchair');
        expect(dto.accessibilityNeeds).toHaveLength(1);
    });

    it('should support multiple accessibility categories (Low Vision & Hearing Impairment)', () => {
        const dto: UserRegistrationDTO = {
            userName: 'Jane Smith',
            email: 'jane@example.com',
            password: 'Password123',
            nicNo: '199512345678',
            phoneNumber: '0777654321',
            secondaryPhoneNumber: '0711234567',
            hasAccessibilityNeeds: true,
            accessibilityNeeds: ['low_vision', 'hearing_impairment'],
        };

        expect(dto.hasAccessibilityNeeds).toBe(true);
        expect(dto.accessibilityNeeds).toEqual(['low_vision', 'hearing_impairment']);
    });

    it('should handle standard user registration without accessibility needs', () => {
        const dto: UserRegistrationDTO = {
            userName: 'Bob Builder',
            email: 'bob@example.com',
            password: 'Password123',
            nicNo: '198512345678',
            phoneNumber: '0770001122',
            secondaryPhoneNumber: '0710001122',
            hasAccessibilityNeeds: false,
            accessibilityNeeds: [],
        };

        expect(dto.hasAccessibilityNeeds).toBe(false);
        expect(dto.accessibilityNeeds).toEqual([]);
    });

    it('should verify User document contains explicit boolean profile indicator flags and links to AccessibilityProfile', () => {
        const profile: AccessibilityProfile = {
            accessibilityProfileId: 'ACC-2026-00001',
            userId: 'test-uid-123',
            passengerId: 'PAS-2026-00001',
            hasAccessibilityNeeds: true,
            accessibilityNeeds: ['wheelchair', 'low_vision'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        const user: User = {
            uid: profile.userId,
            passengerId: profile.passengerId,
            userName: 'Accessibility Test User',
            email: 'test@example.com',
            nicNo: '199012345678',
            calculatedAge: 36,
            isElderPerson: false,
            role: 'PASSENGER',
            phoneNumber: '0771234567',
            secondaryPhoneNumber: '0719876543',
            isVerified: false,
            accountStatus: 'ACTIVE',
            guardianId: null,
            accessibilityProfileId: profile.accessibilityProfileId,
            hasAccessibilityNeeds: true,
            isWheelchairUser: true,
            isLowVisionPerson: true,
            isHearingImpaired: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        expect(user.accessibilityProfileId).toBe('ACC-2026-00001');
        expect(user.hasAccessibilityNeeds).toBe(true);
        expect(user.isWheelchairUser).toBe(true);
        expect(user.isLowVisionPerson).toBe(true);
        expect(user.isHearingImpaired).toBe(false);
        expect(profile.accessibilityProfileId).toBe('ACC-2026-00001');
        expect(profile.passengerId).toBe('PAS-2026-00001');
        expect(profile.accessibilityNeeds).toEqual(['wheelchair', 'low_vision']);
    });

    describe('getProfileCompletionPercentage & isAccessibilityProfileVerified', () => {
        const { getProfileCompletionPercentage, isAccessibilityProfileVerified } = require('../../../src/shared/utils/profileUtils');

        it('should indicate 80% completion for users with accessibility needs whose profile is not verified', () => {
            const userWithNeedsUnverified = {
                hasAccessibilityNeeds: true,
                isAccessibilityVerified: false,
                isVerified: false,
            };

            expect(getProfileCompletionPercentage(userWithNeedsUnverified)).toBe(80);
            expect(isAccessibilityProfileVerified(userWithNeedsUnverified)).toBe(false);
        });

        it('should indicate 100% completion for users with accessibility needs whose profile is verified', () => {
            const userWithNeedsVerified = {
                hasAccessibilityNeeds: true,
                isAccessibilityVerified: true,
                isVerified: true,
            };

            expect(getProfileCompletionPercentage(userWithNeedsVerified)).toBe(100);
            expect(isAccessibilityProfileVerified(userWithNeedsVerified)).toBe(true);
        });

        it('should indicate 100% completion for users without accessibility needs', () => {
            const standardUser = {
                hasAccessibilityNeeds: false,
                isAccessibilityVerified: false,
                isVerified: false,
            };

            expect(getProfileCompletionPercentage(standardUser)).toBe(100);
            expect(isAccessibilityProfileVerified(standardUser)).toBe(true);
        });
    });
});
