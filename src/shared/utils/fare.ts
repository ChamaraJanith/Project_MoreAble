export interface FareBreakdown {
    distanceKm: number;
    baseFare: number;
    distanceFare: number;
    totalFare: number;
    currency: 'LKR';
    /** True when the distance came from the proportional fallback rather than exact stop coordinates. */
    isEstimate: boolean;
}

// Mirrors the standard private-bus fare structure used in Sri Lanka: a flat
// minimum fare covers the first few kilometres, then a fixed rate per
// additional kilometre. Kept as named constants so they can be tuned in one
// place if fares change or the operator wants a different rate.
const MINIMUM_FARE_LKR = 30;
const MINIMUM_DISTANCE_KM = 2;
const RATE_PER_KM_LKR = 8.5;

export function calculateFare(distanceKm: number, isPrecise: boolean): FareBreakdown {
    const billableDistance = Math.max(0, distanceKm - MINIMUM_DISTANCE_KM);
    const distanceFare = Math.ceil(billableDistance * RATE_PER_KM_LKR);
    const totalFare = MINIMUM_FARE_LKR + distanceFare;

    return {
        distanceKm: Math.round(distanceKm * 10) / 10,
        baseFare: MINIMUM_FARE_LKR,
        distanceFare,
        totalFare,
        currency: 'LKR',
        isEstimate: !isPrecise,
    };
}