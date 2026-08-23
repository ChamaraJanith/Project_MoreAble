# Pull Request: Update Accessibility Profile Completion Percentage Logic

## Description
This PR updates the business logic for calculating the profile completion percentage for users with accessibility needs. The logic now accurately reflects new requirements for both elderly (60+) and standard passengers (< 60) based on their Guardian registration status and Accessibility Profile verification status.

## Changes Included
* Updated `getProfileCompletionPercentage` function in `src/shared/utils/profileUtils.ts`.
* Updated JSDoc comments to clearly document the new matrix rules.
* Updated Unit Tests in `tests/features/auth/registrationAccessibility.test.ts` to cover the new scenarios for standard passengers.

## Logic Matrix Implemented

### 1. Elderly Passengers (Age 60+)
* **50%**: Guardian NOT registered & Accessibility UNVERIFIED
* **60%**: Guardian NOT registered & Accessibility VERIFIED (or no accessibility needs)
* **80%**: Guardian REGISTERED & Accessibility UNVERIFIED
* **100%**: Guardian REGISTERED & Accessibility VERIFIED (or no accessibility needs)

### 2. Standard Passengers (Age < 60) with Accessibility Needs
* **50%**: Guardian NOT registered & Accessibility UNVERIFIED
* **60%**: Guardian NOT registered & Accessibility VERIFIED
* **90%**: Guardian REGISTERED & Accessibility UNVERIFIED
* **100%**: Guardian REGISTERED & Accessibility VERIFIED

*Note: Standard passengers with no accessibility needs remain at 100% upon registration.*

## Testing
* **Unit Tests**: Executed `jest tests/features/auth/registrationAccessibility.test.ts`
* **Status**: All tests passed successfully. Matrix cases were fully validated.

## Jira / Ticket Reference
* Relates to profile completion indicator task.
