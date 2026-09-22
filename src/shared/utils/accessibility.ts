import { BusAccessibilityFacilities } from '../../entities/bus/model/types';
import { BusRating, isBusRatingValue } from '../../entities/rating/model/types';
import { AccessibilityReport, reportTypeOf } from '../../entities/report/model/types';

// ==================================================================
// Accessibility score (MOV-79 / MOV-111)
//
// The single definition of how accessible a bus is, as one number from 0 to
// 100. Every API that reports `accessibilityScore` calls this; nothing else
// holds a weight or a formula. See docs/accessibility-score.md.
//
//     score = round(clamp(facility * 0.50 + community * 0.30 + rating * 0.20))
//
// Pure and deterministic: the caller loads the evidence (see
// shared/server/accessibilityScoreEvidence) and this only does the arithmetic.
// ==================================================================

export const FACILITY_WEIGHT = 0.5;
export const COMMUNITY_WEIGHT = 0.3;
export const RATING_WEIGHT = 0.2;

export const MIN_ACCESSIBILITY_SCORE = 0;
export const MAX_ACCESSIBILITY_SCORE = 100;

/** Community score for a bus with no verified reports: no evidence, not bad evidence. */
export const COMMUNITY_NEUTRAL_SCORE = 50;
/** How many reports' worth of weight the neutral prior carries. */
export const COMMUNITY_PRIOR_WEIGHT = 5;

/** The neutral prior rating, in stars. */
export const RATING_NEUTRAL_VALUE = 3;
/** How many ratings' worth of weight the neutral prior carries. */
export const RATING_PRIOR_WEIGHT = 5;
const RATING_SCALE_MIN = 1;
const RATING_SCALE_MAX = 5;

/** Every facility the bus record stores, under its own field name. */
export type AccessibilityFacilityKey = keyof BusAccessibilityFacilities;

/** The 8 canonical facilities, each worth an equal share of the facility score. */
export const ACCESSIBILITY_FACILITY_KEYS: readonly AccessibilityFacilityKey[] = [
    'wheelchairRamp',
    'audioAnnouncement',
    'lowFloorVehicle',
    'walkingAssistance',
    'wheelchairSpace',
    'guardianSeats',
    'prioritySeats',
    'elderlySeats',
];

const COUNTED_FACILITY_KEYS: ReadonlySet<AccessibilityFacilityKey> = new Set<AccessibilityFacilityKey>([
    'wheelchairSpace',
    'guardianSeats',
    'prioritySeats',
    'elderlySeats',
]);

/**
 * Whether the bus record says it has this facility.
 *
 * Strictly `true` — the convention `meetsAccessibilityRequirement` and
 * `listAccessibilityFacilities` follow. A counted facility is read through its
 * `available` flag, never its count. Missing, null, `'true'`, `1` all mean no.
 */
export function isFacilityConfigured(
    facilities: BusAccessibilityFacilities | null | undefined,
    key: AccessibilityFacilityKey
): boolean {
    if (!facilities) return false;

    if (COUNTED_FACILITY_KEYS.has(key)) {
        const group = facilities[key];
        return typeof group === 'object' && (group as { available?: unknown } | null)?.available === true;
    }

    return facilities[key] === true;
}

/** Verified positive and issue reports about one bus. */
export interface CommunityReportTally {
    positiveCount: number;
    issueCount: number;
}

/** Valid passenger ratings of one bus. */
export interface PassengerRatingTally {
    count: number;
    /** Sum of the stars, so the average is exact rather than a rounded input. */
    total: number;
}

/**
 * Everything beyond the bus record that the score weighs.
 *
 * Every field is optional, and absent means "no evidence": the neutral score
 * for that factor, never zero.
 */
export interface AccessibilityScoreEvidence {
    community?: CommunityReportTally | null;
    ratings?: PassengerRatingTally | null;
    /**
     * Facilities the bus is configured with but that are unavailable right now
     * because of an ACTIVE verified issue. Integration boundary only: Community
     * Reporting does not yet record which facility an issue concerns, nor when
     * one is resolved, so no caller supplies this today.
     *
     * It can only take a facility away. A resolved issue is simply no longer
     * listed, and the configured state applies again. The bus record itself is
     * never changed.
     */
    unavailableFacilities?: readonly AccessibilityFacilityKey[] | null;
}

/** A count that can be used as evidence: a finite number above zero, else zero. */
function usableCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Whether a facility is available now: configured, and not taken out by an active verified issue. */
export function isFacilityEffectivelyAvailable(
    facilities: BusAccessibilityFacilities | null | undefined,
    key: AccessibilityFacilityKey,
    unavailableFacilities?: readonly AccessibilityFacilityKey[] | null
): boolean {
    return isFacilityConfigured(facilities, key) && !(unavailableFacilities ?? []).includes(key);
}

/** Factor 1: share of the 8 facilities effectively available, 0–100. */
export function computeFacilityScore(
    facilities: BusAccessibilityFacilities | null | undefined,
    unavailableFacilities?: readonly AccessibilityFacilityKey[] | null
): number {
    const available = ACCESSIBILITY_FACILITY_KEYS.filter((key) =>
        isFacilityEffectivelyAvailable(facilities, key, unavailableFacilities)
    ).length;

    return (available / ACCESSIBILITY_FACILITY_KEYS.length) * MAX_ACCESSIBILITY_SCORE;
}

/**
 * Factor 2: share of verified reports that are positive, 0–100, pulled toward
 * the neutral 50 in proportion to how few reports there are:
 *
 *     (n / (n + M)) * raw + (M / (n + M)) * 50
 */
export function computeCommunityScore(tally?: CommunityReportTally | null): number {
    const positive = usableCount(tally?.positiveCount);
    const n = positive + usableCount(tally?.issueCount);

    if (n === 0) return COMMUNITY_NEUTRAL_SCORE;

    const raw = (positive / n) * MAX_ACCESSIBILITY_SCORE;
    const M = COMMUNITY_PRIOR_WEIGHT;

    return (n / (n + M)) * raw + (M / (n + M)) * COMMUNITY_NEUTRAL_SCORE;
}

/**
 * Factor 3: the average star rating, pulled toward the neutral 3 in proportion
 * to how few ratings there are, then mapped from 1–5 stars onto 0–100.
 */
export function computeRatingScore(tally?: PassengerRatingTally | null): number {
    const n = usableCount(tally?.count);
    const M = RATING_PRIOR_WEIGHT;

    const adjusted =
        n === 0
            ? RATING_NEUTRAL_VALUE
            : (n / (n + M)) * (usableCount(tally?.total) / n) + (M / (n + M)) * RATING_NEUTRAL_VALUE;

    return ((adjusted - RATING_SCALE_MIN) / (RATING_SCALE_MAX - RATING_SCALE_MIN)) * MAX_ACCESSIBILITY_SCORE;
}

/**
 * The accessibility score of one bus: a whole number from 0 to 100, higher is
 * better.
 *
 * Called with the facilities alone, community and rating evidence are absent
 * and both sit at their neutral 50.
 */
export function computeAccessibilityScore(
    facilities?: BusAccessibilityFacilities | null,
    evidence?: AccessibilityScoreEvidence | null
): number {
    const weighted =
        computeFacilityScore(facilities, evidence?.unavailableFacilities) * FACILITY_WEIGHT +
        computeCommunityScore(evidence?.community) * COMMUNITY_WEIGHT +
        computeRatingScore(evidence?.ratings) * RATING_WEIGHT;

    const clamped = Math.min(MAX_ACCESSIBILITY_SCORE, Math.max(MIN_ACCESSIBILITY_SCORE, weighted));
    return Math.round(clamped);
}

/**
 * Verified community reports about `busId`, split by the report system's own
 * reading of type: an explicit POSITIVE is positive, anything else is an issue
 * (`reportTypeOf`). PENDING, REJECTED and every other status are ignored, as is
 * a report naming another bus or none.
 */
export function tallyVerifiedCommunityReports(
    reports: readonly (Partial<Pick<AccessibilityReport, 'busId' | 'status' | 'type'>> | null | undefined)[],
    busId: string
): CommunityReportTally {
    const tally: CommunityReportTally = { positiveCount: 0, issueCount: 0 };
    if (typeof busId !== 'string' || !busId) return tally;

    for (const report of reports) {
        if (!report || report.status !== 'VERIFIED' || report.busId !== busId) continue;

        if (reportTypeOf(report) === 'POSITIVE') tally.positiveCount += 1;
        else tally.issueCount += 1;
    }

    return tally;
}

/** Valid 1–5 star ratings of `busId`. A rating of another bus, or not a whole 1–5, is ignored. */
export function tallyPassengerRatings(
    ratings: readonly (Partial<Pick<BusRating, 'busId' | 'rating'>> | null | undefined)[],
    busId: string
): PassengerRatingTally {
    const tally: PassengerRatingTally = { count: 0, total: 0 };
    if (typeof busId !== 'string' || !busId) return tally;

    for (const entry of ratings) {
        if (!entry || entry.busId !== busId || !isBusRatingValue(entry.rating)) continue;

        tally.count += 1;
        tally.total += entry.rating;
    }

    return tally;
}

/**
 * The project's accessibility-score colour scale.
 *
 * Lifted out of the booking flow's TransportOptionCard so the journey
 * recommendations (MOV-88) can show a score the same way instead of introducing
 * a second scale. The thresholds are unchanged.
 *
 * Colour is always an ADDITION to a written score, never the only way to read
 * one — a passenger who cannot distinguish these colours still gets the number.
 */
export function accessibilityScoreColor(score: number): string {
    if (score >= 70) return '#388E3C';
    if (score >= 40) return '#F57C00';
    return '#D32F2F';
}

// ==================================================================
// Accessibility requirements (MOV-74)
//
// What a passenger can require of a vehicle, and the single rule for deciding
// whether a vehicle meets it.
//
// This lives in `shared` because the same question is asked in two places: the
// search API decides which journeys to return (MOV-92) and the passenger screen
// decides what to render (MOV-91). One definition, so a bus can never be
// suitable on the server and unsuitable on the screen — or the reverse, which is
// the dangerous direction.
//
// Deliberately separate from `computeAccessibilityScore` above. A score ranks;
// a requirement excludes. A passenger who needs a ramp is not helped by a bus
// that scores well on everything else, so nothing here consults the score and
// nothing here changes it.
// ==================================================================

/**
 * The five requirements the story names, under the field names the bus record
 * already stores. Never an alternative naming.
 */
export type AccessibilityRequirementKey =
    | 'wheelchairRamp'
    | 'prioritySeats'
    | 'audioAnnouncement'
    | 'lowFloorVehicle'
    | 'walkingAssistance'
    | 'elderlySeats'
    | 'guardianSeats';

/** Canonical order, so a normalized list is the same list whatever order it arrived in. */
export const ACCESSIBILITY_REQUIREMENT_KEYS: readonly AccessibilityRequirementKey[] = [
    'wheelchairRamp',
    'prioritySeats',
    'audioAnnouncement',
    'lowFloorVehicle',
    'walkingAssistance',
    'elderlySeats',
    'guardianSeats',
];

export function isAccessibilityRequirementKey(
    value: unknown
): value is AccessibilityRequirementKey {
    return (
        typeof value === 'string' &&
        (ACCESSIBILITY_REQUIREMENT_KEYS as readonly string[]).includes(value)
    );
}

/**
 * Whether one recorded facility set satisfies one requirement.
 *
 * Availability is tested against `true` rather than for truthiness, the same
 * strict convention `listAccessibilityFacilities` follows. Firestore is
 * schema-less: a stored `'no'` or `'false'` is a truthy string, and a passenger
 * who depends on a ramp must never be handed a bus because a record was written
 * in the wrong shape. Anything that is not exactly `true` is not recorded.
 *
 * `prioritySeats` is a counted facility, so it is read through its `available`
 * flag. The count is never the condition: a decommissioned bay can leave a count
 * behind, and availability is what governs.
 *
 * A bus with no facilities recorded satisfies nothing. That is unknown, not
 * suitable, and an unknown cannot be offered to a passenger who said they need
 * this.
 */
export function meetsAccessibilityRequirement(
    facilities: BusAccessibilityFacilities | null | undefined,
    key: AccessibilityRequirementKey
): boolean {
    if (!facilities) return false;

    if (key === 'prioritySeats' || key === 'elderlySeats' || key === 'guardianSeats') {
        const seatGroup = facilities[key];
        return typeof seatGroup === 'object' && seatGroup?.available === true;
    }

    return facilities[key] === true;
}

/**
 * Whether a vehicle meets EVERY requirement asked of it.
 *
 * Requirements narrow, they never widen: two selected requirements mean both,
 * not either. An empty list asks nothing, so every vehicle passes and search
 * behaves exactly as it did before this feature existed.
 */
export function meetsAccessibilityRequirements(
    facilities: BusAccessibilityFacilities | null | undefined,
    requirements: readonly AccessibilityRequirementKey[]
): boolean {
    return requirements.every((key) => meetsAccessibilityRequirement(facilities, key));
}

/** What a request's accessibility requirements were understood to be. */
export interface ParsedAccessibilityRequirements {
    /** The recognised requirements, deduplicated and in canonical order. */
    requirements: AccessibilityRequirementKey[];
    /** Entries naming no known requirement, as received, for an error message. */
    unrecognized: string[];
    /** True when the field was present but was not an array. */
    malformed: boolean;
}

/**
 * Reads the requirements off an untrusted request body.
 *
 * Absent means "not asked for" and parses to an empty list, which is what keeps
 * every existing request behaving exactly as before.
 *
 * An unrecognised entry is REPORTED rather than skipped. Silently ignoring one
 * would answer a passenger who asked for a ramp — and mistyped it — with
 * unfiltered results that look filtered, which is precisely the failure this
 * feature exists to prevent. The caller decides what to do with that; the search
 * API rejects the request.
 */
export function parseAccessibilityRequirements(value: unknown): ParsedAccessibilityRequirements {
    if (value === undefined || value === null) {
        return { requirements: [], unrecognized: [], malformed: false };
    }

    if (!Array.isArray(value)) {
        return { requirements: [], unrecognized: [], malformed: true };
    }

    const selected = new Set<AccessibilityRequirementKey>();
    const unrecognized: string[] = [];

    for (const entry of value) {
        if (isAccessibilityRequirementKey(entry)) {
            selected.add(entry);
        } else {
            unrecognized.push(typeof entry === 'string' ? entry : String(entry));
        }
    }

    return {
        // Canonical order rather than the order received, so the same selection
        // always produces the same list — including the one echoed back.
        requirements: ACCESSIBILITY_REQUIREMENT_KEYS.filter((key) => selected.has(key)),
        unrecognized,
        malformed: false,
    };
}
