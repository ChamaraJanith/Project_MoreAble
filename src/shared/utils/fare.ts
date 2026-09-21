import { FareBreakdown, FarePolicy } from '../../entities/booking/model/types';

export type { FareBreakdown, FarePolicy };

/**
 * Baseline default pricing policy aligned with national transport commission standards.
 * Used as fallback if no custom policy is configured in Firestore.
 */
export const DEFAULT_FARE_POLICY: FarePolicy = {
    id: 'default',
    currency: 'LKR',
    baseFare: 30,
    baseDistanceKm: 2,
    ratePerKm: 8.5,
    accessibilityDiscountPercent: 20,
    elderlyDiscountPercent: 15,
    assistanceSurchargeLkr: 50,
    guardianCompanionRatePercent: 100,
    updatedAt: new Date().toISOString(),
};

export interface FareCalculationOptions {
    /** Custom fare policy from Firestore or simulation */
    policy?: Partial<FarePolicy> | null;
    /** Whether the passenger has registered/verified accessibility needs */
    isAccessibilityEligible?: boolean;
    /** Whether the passenger qualifies for senior citizen concession (age 60+) */
    isElderlyEligible?: boolean;
    /** Whether personal boarding/walking/wheelchair assistance was requested */
    hasAssistanceRequested?: boolean;
    /** Whether a wheelchair bay with an automatically paired guardian seat (e.g. G1) was selected */
    isWheelchairPaired?: boolean;
    /** Paired companion seat identifier (e.g. 'G1') */
    pairedSeatNumber?: string | null;
}

/**
 * Calculates the authoritative ticket fare and detailed breakdown based on distance,
 * active fare policy, concession eligibility, conductor assistance surcharge,
 * and paired wheelchair guardian companion seats.
 *
 * Fully backward-compatible with legacy calls passing just `(distanceKm, isPrecise)`.
 */
export function calculateFare(
    distanceKm: number,
    isPrecise: boolean,
    options?: FareCalculationOptions
): FareBreakdown {
    const activePolicy = {
        ...DEFAULT_FARE_POLICY,
        ...(options?.policy || {}),
    };

    const validDistance = Math.max(0, typeof distanceKm === 'number' && !isNaN(distanceKm) ? distanceKm : 0);
    const roundedDistance = Math.round(validDistance * 10) / 10;

    const baseFare = Math.max(0, activePolicy.baseFare ?? DEFAULT_FARE_POLICY.baseFare);
    const baseDistanceKm = Math.max(0, activePolicy.baseDistanceKm ?? DEFAULT_FARE_POLICY.baseDistanceKm);
    const ratePerKm = Math.max(0, activePolicy.ratePerKm ?? DEFAULT_FARE_POLICY.ratePerKm);

    // Billable distance beyond base distance threshold
    const billableDistance = Math.max(0, roundedDistance - baseDistanceKm);
    const distanceFare = Math.ceil(billableDistance * ratePerKm);
    const subtotalFare = baseFare + distanceFare;

    // Concession determination (Accessibility takes precedence, then Elderly)
    let concessionType: 'ACCESSIBILITY' | 'ELDERLY' | 'NONE' = 'NONE';
    let concessionDiscountPercent = 0;

    if (options?.isAccessibilityEligible) {
        concessionType = 'ACCESSIBILITY';
        concessionDiscountPercent = Math.min(100, Math.max(0, activePolicy.accessibilityDiscountPercent ?? 20));
    } else if (options?.isElderlyEligible) {
        concessionType = 'ELDERLY';
        concessionDiscountPercent = Math.min(100, Math.max(0, activePolicy.elderlyDiscountPercent ?? 15));
    }

    const concessionDiscount = Math.round((subtotalFare * concessionDiscountPercent) / 100);
    const netJourneyFare = Math.max(0, subtotalFare - concessionDiscount);

    // Conductor dedicated assistance surcharge
    const assistanceFee = options?.hasAssistanceRequested
        ? Math.max(0, activePolicy.assistanceSurchargeLkr ?? DEFAULT_FARE_POLICY.assistanceSurchargeLkr)
        : 0;

    // Paired Wheelchair Guardian / Companion Seat calculation
    const isWheelchairPaired = !!options?.isWheelchairPaired;
    const pairedSeatNumber = options?.pairedSeatNumber || (isWheelchairPaired ? 'G1' : null);
    const guardianRatePercent = isWheelchairPaired
        ? Math.min(100, Math.max(0, activePolicy.guardianCompanionRatePercent ?? DEFAULT_FARE_POLICY.guardianCompanionRatePercent))
        : 0;
    const guardianFare = isWheelchairPaired
        ? Math.round((subtotalFare * guardianRatePercent) / 100)
        : 0;

    const totalFare = netJourneyFare + assistanceFee + guardianFare;

    return {
        distanceKm: roundedDistance,
        baseFare,
        distanceFare,
        subtotalFare,
        concessionDiscount,
        concessionType,
        concessionDiscountPercent,
        assistanceFee,
        isWheelchairPaired,
        pairedSeatNumber,
        guardianFare,
        guardianRatePercent,
        totalFare,
        currency: 'LKR',
        isEstimate: !isPrecise,
    };
}