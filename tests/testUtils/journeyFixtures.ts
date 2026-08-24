// Shared journey-search fixtures (MOV-90).
//
// The accessibility facility sets below are ORDERED BY CONTAINMENT rather than
// by any particular score:
//
//     NOT_EQUIPPED  ⊂  PARTLY_EQUIPPED  ⊂  MOSTLY_EQUIPPED  ⊂  FULLY_EQUIPPED
//
// That matters for a ranking test. A bus with strictly more facilities than
// another must score at least as well however `computeAccessibilityScore` is
// weighted, so a test written against these keeps meaning the same thing after
// MOV-79 widens the formula. No file that uses these should ever write a score
// down as a number — derive it from the shared function instead.
//
// Nothing here fabricates a credential. `Bus.password` exists in production and
// is stripped by every API; a test that needs to prove the stripping generates
// its value with `nextUniqueValue()` rather than writing a literal.

import { Bus, BusAccessibilityFacilities } from '../../src/entities/bus/model/types';
import { Route } from '../../src/entities/route/model/types';
import { Trip } from '../../src/entities/trip/model/types';

/** Every facility recorded. */
export const FULLY_EQUIPPED: BusAccessibilityFacilities = {
    wheelchairRamp: true,
    audioAnnouncement: true,
    lowFloorVehicle: true,
    walkingAssistance: true,
    wheelchairSpace: { available: true, count: 2 },
    guardianSeats: { available: true, count: 2 },
    prioritySeats: { available: true, count: 4 },
    elderlySeats: { available: true, count: 4 },
};

/** Everything except walking assistance and guardian seats. */
export const MOSTLY_EQUIPPED: BusAccessibilityFacilities = {
    ...FULLY_EQUIPPED,
    walkingAssistance: false,
    guardianSeats: { available: false, count: 0 },
};

/** A ramp and priority seats, nothing else. */
export const PARTLY_EQUIPPED: BusAccessibilityFacilities = {
    wheelchairRamp: true,
    audioAnnouncement: false,
    lowFloorVehicle: false,
    walkingAssistance: false,
    wheelchairSpace: { available: false, count: 0 },
    guardianSeats: { available: false, count: 0 },
    prioritySeats: { available: true, count: 4 },
    elderlySeats: { available: false, count: 0 },
};

/** Nothing recorded as available. */
export const NOT_EQUIPPED: BusAccessibilityFacilities = {
    wheelchairRamp: false,
    audioAnnouncement: false,
    lowFloorVehicle: false,
    walkingAssistance: false,
    wheelchairSpace: { available: false, count: 0 },
    guardianSeats: { available: false, count: 0 },
    prioritySeats: { available: false, count: 0 },
    elderlySeats: { available: false, count: 0 },
};

/** A Firestore-shaped document: the fake store keys documents by `id`. */
export type Stored<T> = T & { id: string };

export function makeBus(
    busId: string,
    numberPlate: string,
    facilities: BusAccessibilityFacilities | undefined,
    overrides: Partial<Bus> = {}
): Stored<Bus> {
    return {
        id: busId,
        busId,
        numberPlate,
        chassisNumber: `CHS-${busId}`,
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities: facilities as BusAccessibilityFacilities,
        status: 'ACTIVE',
        ...overrides,
    };
}

export function makeTrip(
    tripId: string,
    routeId: string,
    busId: string,
    departureTime: string,
    overrides: Partial<Trip> = {}
): Stored<Trip> {
    return {
        id: tripId,
        tripId,
        routeId,
        busId,
        departureTime,
        estimatedArrivalTime: '23:59',
        turnNumber: 1,
        status: 'ACTIVE',
        ...overrides,
    };
}

export function makeRoute(
    routeId: string,
    stops: string[],
    overrides: Partial<Route> = {}
): Stored<Route> {
    return {
        id: routeId,
        routeId,
        routeNumber: routeId,
        routeName: `${stops[0]} - ${stops[stops.length - 1]}`,
        startLocation: stops[0],
        endLocation: stops[stops.length - 1],
        stops,
        distanceKm: null,
        estimatedDuration: null,
        status: 'ACTIVE',
        ...overrides,
    };
}

/** A stop document carrying coordinates, as the `stops` collection holds it. */
export function makeStop(name: string, latitude: number, longitude: number) {
    return {
        id: name.toLowerCase().replace(/\s+/g, '-'),
        stopId: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        latitude,
        longitude,
    };
}
