import { FarePolicy } from '../../entities/booking/model/types';
import { DEFAULT_FARE_POLICY } from '../utils/fare';

/**
 * Retrieves the active fare policy from Firestore.
 * If the policy has not been configured in the database, returns the default baseline policy.
 */
export async function getActiveFarePolicy(adminDb: any): Promise<FarePolicy> {
    try {
        const policyDoc = await adminDb.collection('fare_policies').doc('default').get();
        if (policyDoc.exists) {
            const data = policyDoc.data();
            return {
                id: 'default',
                currency: 'LKR',
                baseFare: typeof data.baseFare === 'number' ? data.baseFare : DEFAULT_FARE_POLICY.baseFare,
                baseDistanceKm: typeof data.baseDistanceKm === 'number' ? data.baseDistanceKm : DEFAULT_FARE_POLICY.baseDistanceKm,
                ratePerKm: typeof data.ratePerKm === 'number' ? data.ratePerKm : DEFAULT_FARE_POLICY.ratePerKm,
                accessibilityDiscountPercent:
                    typeof data.accessibilityDiscountPercent === 'number'
                        ? data.accessibilityDiscountPercent
                        : DEFAULT_FARE_POLICY.accessibilityDiscountPercent,
                elderlyDiscountPercent:
                    typeof data.elderlyDiscountPercent === 'number'
                        ? data.elderlyDiscountPercent
                        : DEFAULT_FARE_POLICY.elderlyDiscountPercent,
                assistanceSurchargeLkr:
                    typeof data.assistanceSurchargeLkr === 'number'
                        ? data.assistanceSurchargeLkr
                        : DEFAULT_FARE_POLICY.assistanceSurchargeLkr,
                guardianCompanionRatePercent:
                    typeof data.guardianCompanionRatePercent === 'number'
                        ? data.guardianCompanionRatePercent
                        : DEFAULT_FARE_POLICY.guardianCompanionRatePercent,
                updatedAt: data.updatedAt || new Date().toISOString(),
                updatedBy: data.updatedBy || 'admin',
            };
        }
    } catch (err) {
        console.warn('[FarePolicyServer] Unable to load policy from Firestore, falling back to defaults:', err);
    }

    return DEFAULT_FARE_POLICY;
}
