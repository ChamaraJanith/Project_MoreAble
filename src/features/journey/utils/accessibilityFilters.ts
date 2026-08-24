// The accessibility requirements a passenger can filter their results by
// (MOV-91).
//
// The five requirements are the ones the story names, and each maps onto a
// field the bus record already stores — nothing here invents a facility, a name
// or a shape. `prioritySeats` is a counted facility on the bus, so it is read
// through its `available` flag while the other four are plain booleans; that
// asymmetry belongs to the data model and is absorbed here rather than in a
// screen.
//
// Availability is tested against `true` rather than for truthiness, exactly as
// `listAccessibilityFacilities` does. A stored value of `'no'` is truthy, and a
// passenger who filters for a ramp must never be handed a bus whose record was
// written in the wrong shape. Filtering is the strictest reading of that rule:
// anything not recorded as exactly `true` does not match.
//
// Kept out of the screen so all of it is testable without a renderer.

import { BusAccessibilityFacilities } from '../../../entities/bus/model/types';
import { JourneySearchOption } from '../../../entities/route/model/types';

/** Field names are the bus record's own — never an alternative naming. */
export type AccessibilityRequirementKey =
    | 'wheelchairRamp'
    | 'prioritySeats'
    | 'audioAnnouncement'
    | 'lowFloorVehicle'
    | 'walkingAssistance';

export interface AccessibilityRequirement {
    key: AccessibilityRequirementKey;
    /** Short name shown on the control. */
    label: string;
    /** Plain-language explanation of what the requirement means. */
    description: string;
}

/**
 * The five requirements, in the order they are offered.
 *
 * One list, so the controls, the screen-reader wording and the filtering all
 * read from the same place and cannot drift apart.
 */
export const ACCESSIBILITY_REQUIREMENTS: readonly AccessibilityRequirement[] = [
    {
        key: 'wheelchairRamp',
        label: 'Wheelchair ramp',
        description: 'A ramp for boarding in a wheelchair',
    },
    {
        key: 'prioritySeats',
        label: 'Priority seat',
        description: 'Seats kept for passengers who need them',
    },
    {
        key: 'audioAnnouncement',
        label: 'Audio announcements',
        description: 'Stops announced out loud on board',
    },
    {
        key: 'lowFloorVehicle',
        label: 'Low floor vehicle',
        description: 'A step-free entrance at the door',
    },
    {
        key: 'walkingAssistance',
        label: 'Walking assistance',
        description: 'Help from the crew to board and get off',
    },
];

/** Which requirements the passenger has selected. */
export type AccessibilityRequirementSelection = Record<AccessibilityRequirementKey, boolean>;

/** Nothing selected: the default, in which no journey is filtered out. */
export const NO_ACCESSIBILITY_REQUIREMENTS: AccessibilityRequirementSelection = Object.freeze({
    wheelchairRamp: false,
    prioritySeats: false,
    audioAnnouncement: false,
    lowFloorVehicle: false,
    walkingAssistance: false,
});

/** Selecting and deselecting are the same action, so there is one function. */
export function toggleAccessibilityRequirement(
    selection: AccessibilityRequirementSelection,
    key: AccessibilityRequirementKey
): AccessibilityRequirementSelection {
    return { ...selection, [key]: !selection[key] };
}

/** The selected requirements, in the order they are offered. */
export function selectedAccessibilityRequirements(
    selection: AccessibilityRequirementSelection
): AccessibilityRequirementKey[] {
    return ACCESSIBILITY_REQUIREMENTS.map((requirement) => requirement.key).filter(
        (key) => selection[key] === true
    );
}

export function hasSelectedAccessibilityRequirements(
    selection: AccessibilityRequirementSelection
): boolean {
    return selectedAccessibilityRequirements(selection).length > 0;
}

/**
 * Whether one recorded facility set satisfies one requirement.
 *
 * A bus with no facilities recorded satisfies nothing — it is unknown, and an
 * unknown cannot be offered to a passenger who said they need this.
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

/** Every selected requirement must be met — they narrow, they do not widen. */
export function meetsAccessibilityRequirements(
    facilities: BusAccessibilityFacilities | null | undefined,
    selection: AccessibilityRequirementSelection
): boolean {
    return selectedAccessibilityRequirements(selection).every((key) =>
        meetsAccessibilityRequirement(facilities, key)
    );
}

/**
 * The journeys a passenger's requirements leave them with.
 *
 * Filters and never reorders: the list arrives in MOV-87's ranked order and
 * leaves in it, minus the options that cannot meet the stated needs. With
 * nothing selected the list is returned untouched, so the existing search
 * behaviour is exactly what it was before this feature existed.
 *
 * A departure whose bus record is missing carries no facilities at all. It is
 * kept while no requirement is selected — a passenger is still entitled to see
 * it — and dropped once one is, because nothing about that vehicle can be shown
 * to meet the need.
 *
 * Generic over the journey shape so this stays a rule about buses rather than
 * about the recommendations view model.
 */
export function filterJourneysByAccessibility<T extends { option: JourneySearchOption }>(
    journeys: T[],
    selection: AccessibilityRequirementSelection
): T[] {
    if (!hasSelectedAccessibilityRequirements(selection)) return journeys;

    return journeys.filter((journey) =>
        meetsAccessibilityRequirements(journey.option?.bus?.accessibilityFacilities, selection)
    );
}
