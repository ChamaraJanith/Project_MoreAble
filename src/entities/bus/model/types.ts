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