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
