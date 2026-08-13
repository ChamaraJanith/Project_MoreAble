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
