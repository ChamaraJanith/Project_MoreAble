import { BusAccessibilityFacilities } from '../../entities/bus/model/types';

/** Percentage of the bus's 8 accessibility facility flags that are available. */
export function computeAccessibilityScore(facilities?: BusAccessibilityFacilities | null): number {
    if (!facilities) return 0;

    const checks = [
        facilities.wheelchairRamp,
        facilities.audioAnnouncement,
        facilities.lowFloorVehicle,
        facilities.walkingAssistance,
        facilities.wheelchairSpace?.available,
        facilities.guardianSeats?.available,
        facilities.prioritySeats?.available,
        facilities.elderlySeats?.available,
    ];

    const available = checks.filter(Boolean).length;
    return Math.round((available / checks.length) * 100);
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
    | 'walkingAssistance';

/** Canonical order, so a normalized list is the same list whatever order it arrived in. */
export const ACCESSIBILITY_REQUIREMENT_KEYS: readonly AccessibilityRequirementKey[] = [
    'wheelchairRamp',
    'prioritySeats',
    'audioAnnouncement',
    'lowFloorVehicle',
    'walkingAssistance',
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

    if (key === 'prioritySeats') {
        const prioritySeats = facilities.prioritySeats;
        return typeof prioritySeats === 'object' && prioritySeats?.available === true;
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
