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