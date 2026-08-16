import { BusAccessibilityFacilities } from '../../../entities/bus/model/types';

export interface AccessibilityFacilityItem {
    /** Stable key for list rendering. */
    key: string;
    label: string;
}

const COUNTED_FACILITIES: [keyof BusAccessibilityFacilities, string][] = [
    ['wheelchairSpace', 'wheelchair space'],
    ['prioritySeats', 'priority seat'],
    ['elderlySeats', 'elderly seat'],
    ['guardianSeats', 'guardian seat'],
];

/**
 * Lists the facilities actually recorded on the bus, as plain factual labels.
 *
 * Only available facilities are returned, so a bus is never implied to have
 * something it does not. No score, percentage or ranking is derived from them —
 * that is a separate, future feature.
 */
export function listAccessibilityFacilities(
    facilities?: BusAccessibilityFacilities | null
): AccessibilityFacilityItem[] {
    if (!facilities) return [];

    const items: AccessibilityFacilityItem[] = [];

    if (facilities.wheelchairRamp) items.push({ key: 'wheelchairRamp', label: 'Wheelchair ramp' });
    if (facilities.lowFloorVehicle) items.push({ key: 'lowFloorVehicle', label: 'Low floor' });
    if (facilities.audioAnnouncement) {
        items.push({ key: 'audioAnnouncement', label: 'Audio announcements' });
    }
    if (facilities.walkingAssistance) {
        items.push({ key: 'walkingAssistance', label: 'Walking assistance' });
    }

    for (const [key, label] of COUNTED_FACILITIES) {
        const facility = facilities[key];

        if (typeof facility === 'object' && facility?.available) {
            items.push({
                key,
                label:
                    facility.count > 0
                        ? `${facility.count} ${label}${facility.count > 1 ? 's' : ''}`
                        : label,
            });
        }
    }

    return items;
}
