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
 *
 * Availability is tested against `true` rather than for truthiness on purpose.
 * A stored value of `'no'` is truthy, and a passenger who depends on a ramp
 * cannot be told one exists because a record was written in the wrong shape;
 * anything that is not exactly `true` is treated as not recorded.
 */
export function listAccessibilityFacilities(
    facilities?: BusAccessibilityFacilities | null
): AccessibilityFacilityItem[] {
    if (!facilities) return [];

    const items: AccessibilityFacilityItem[] = [];

    if (facilities.wheelchairRamp === true) {
        items.push({ key: 'wheelchairRamp', label: 'Wheelchair ramp' });
    }
    if (facilities.lowFloorVehicle === true) {
        items.push({ key: 'lowFloorVehicle', label: 'Low floor' });
    }
    if (facilities.audioAnnouncement === true) {
        items.push({ key: 'audioAnnouncement', label: 'Audio announcements' });
    }
    if (facilities.walkingAssistance === true) {
        items.push({ key: 'walkingAssistance', label: 'Walking assistance' });
    }

    for (const [key, label] of COUNTED_FACILITIES) {
        const facility = facilities[key];

        if (typeof facility === 'object' && facility?.available === true) {
            // A count that is not a real number states nothing reliable, so the
            // facility is named without one rather than with a made-up figure.
            const count = typeof facility.count === 'number' ? facility.count : 0;

            items.push({
                key,
                label: count > 0 ? `${count} ${label}${count > 1 ? 's' : ''}` : label,
            });
        }
    }

    return items;
}

/**
 * Why a bus has no facilities to show.
 *
 *  - `AVAILABLE`      — at least one facility is recorded as available.
 *  - `NONE_AVAILABLE` — the vehicle WAS assessed, and everything it records is
 *                       unavailable. A statement about the bus.
 *  - `UNKNOWN`        — nothing about accessibility was ever recorded for it.
 *                       Not a statement about the bus at all.
 */
export type AccessibilityFacilitiesStatus = 'AVAILABLE' | 'NONE_AVAILABLE' | 'UNKNOWN';

export interface AccessibilityFacilitiesSummary {
    status: AccessibilityFacilitiesStatus;
    /** The facilities to list. Empty unless the status is `AVAILABLE`. */
    items: AccessibilityFacilityItem[];
}

/**
 * Every field the fleet record can hold an accessibility answer in.
 *
 * Typed as a total map of the facility model, so the compiler refuses a key
 * that does not exist and refuses to let one be forgotten if the model grows.
 */
const RECORDED_FACILITY_FIELDS: Record<keyof BusAccessibilityFacilities, true> = {
    wheelchairRamp: true,
    audioAnnouncement: true,
    lowFloorVehicle: true,
    walkingAssistance: true,
    wheelchairSpace: true,
    guardianSeats: true,
    prioritySeats: true,
    elderlySeats: true,
};

/**
 * Whether anything was ever recorded about this vehicle's accessibility.
 *
 * A key carrying a real stored value means somebody answered that question,
 * whatever the answer was. An empty object, or one holding nothing but nulls,
 * means nobody has — Firestore drops `undefined` on write, so a key that is
 * present with a value is evidence of an actual answer.
 */
function hasAnyRecordedFacility(facilities: BusAccessibilityFacilities): boolean {
    return (Object.keys(RECORDED_FACILITY_FIELDS) as (keyof BusAccessibilityFacilities)[]).some(
        (field) => facilities[field] !== undefined && facilities[field] !== null
    );
}

/**
 * What a passenger screen should say about this bus's facilities.
 *
 * `listAccessibilityFacilities` answers "what does it have?" and returns an
 * empty list for two situations that are not the same thing: a bus assessed and
 * found to have nothing, and a bus nobody has assessed. Telling a passenger the
 * second is the first asserts something the data does not support — the vehicle
 * may well have a ramp that no one has entered yet.
 *
 * So the list is reused unchanged and only the reason for an empty one is added.
 * Nothing here decides what counts as available; that stays the strict rule in
 * `listAccessibilityFacilities`.
 */
export function describeAccessibilityFacilities(
    facilities?: BusAccessibilityFacilities | null
): AccessibilityFacilitiesSummary {
    const items = listAccessibilityFacilities(facilities);

    if (items.length > 0) {
        return { status: 'AVAILABLE', items };
    }

    const isRecord = typeof facilities === 'object' && facilities !== null;

    return {
        status: isRecord && hasAnyRecordedFacility(facilities) ? 'NONE_AVAILABLE' : 'UNKNOWN',
        items: [],
    };
}
