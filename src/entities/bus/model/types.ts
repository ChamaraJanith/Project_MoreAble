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
    createdAt?: unknown;
    updatedAt?: unknown;
}
