export type BusStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';

export interface CountedFacility {
    available: boolean;
    count: number;
}

export interface BusAccessibilityFacilities {
    wheelchairRamp: boolean;
    audioAnnouncement: boolean;
    lowFloorVehicle: boolean;
    walkingAssistance: boolean;
    wheelchairSpace: CountedFacility;
    guardianSeats: CountedFacility;
    prioritySeats: CountedFacility;
    elderlySeats: CountedFacility;
}

/**
 * The most recently reported position of a vehicle.
 *
 * Reported by the device on the bus and stored one document per vehicle, so the
 * record always holds where that bus is now rather than a trail of where it has
 * been. It references the bus by id only — the fleet record stays the single
 * source of truth for everything else about the vehicle.
 */
export interface VehicleLocation {
    busId: string;
    latitude: number;
    longitude: number;
    /** ISO 8601 time of the GPS fix itself, as reported by the device. */
    recordedAt: string;
    /**
     * The trip this fix was reported for (MOV-295). Set only when the device
     * published with the journey-sharing credential Start Journey issued, so it
     * always names a trip the server started for this bus. Absent otherwise.
     */
    tripId?: string;
    /**
     * Which run of that trip (MOV-296): the server's startedAt of the journey
     * that was running when the fix was stored. Set together with tripId.
     */
    journeyStartedAt?: string;
}

/**
 * A vehicle in the fleet.
 *
 * `password` is the bus login credential, held on the Firestore document as
 * the literal configured string so an authorised admin can read it directly.
 * It is optional here for two reasons: buses created before the credential
 * existed do not have one, and — importantly — every bus API strips it, so a
 * record that arrived from an HTTP response will never carry it. Treat its
 * presence as meaning "this object came from Firestore, not from an API".
 */
export interface Bus {
    busId: string;
    numberPlate: string;
    chassisNumber: string;
    busModel: string;
    manufacturer: string;
    manufactureYear: number;
    seatCapacity: number;
    accessibilityFacilities: BusAccessibilityFacilities;
    status: BusStatus;
    /** Server-side only; removed from every API response. */
    password?: string;
    createdAt?: unknown;
    updatedAt?: unknown;
}

/**
 * The four values one accessibility score snapshot holds (MOV-113): the final
 * score and the three components that produced it, exactly as MOV-111's
 * functions returned them. The components are not rounded.
 */
export interface AccessibilityScoreValues {
    accessibilityScore: number;
    facilityScore: number;
    communityScore: number;
    ratingScore: number;
}

/**
 * One entry of a bus's accessibility score history:
 * `accessibilityScoreHistory/{busId}__{sequence, 6 digits}`.
 *
 * Append-only. Written only when a value differs from the bus's previous entry,
 * so consecutive entries always differ.
 */
export interface AccessibilityScoreHistoryEntry extends AccessibilityScoreValues {
    historyId: string;
    /** The bus DOCUMENT id. */
    busId: string;
    /** Per bus, from 1. */
    sequence: number;
    /** ISO 8601 time the snapshot was calculated and stored. */
    calculatedAt: string;
}

/**
 * The newest history entry for one bus: `accessibilityScoreLatest/{busId}`.
 *
 * Exists only so the history can tell whether a new snapshot differs from the
 * last one. It is never the current score: that is always calculated from the
 * bus and its evidence (MOV-111).
 */
export interface AccessibilityScoreLatest extends AccessibilityScoreValues {
    busId: string;
    lastSequence: number;
    historyId: string;
    calculatedAt: string;
}