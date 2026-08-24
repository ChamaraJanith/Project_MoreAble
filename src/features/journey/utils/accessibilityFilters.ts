// The accessibility requirements a passenger can filter their results by
// (MOV-91).
//
// The RULE — which stored field each requirement reads, and how strictly — is
// not here. It is `shared/utils/accessibility`, so the search API (MOV-92) and
// this screen decide suitability with one function rather than with two that
// can drift apart. What is here is everything only a screen needs: how the five
// requirements are worded, how a selection is held and toggled, and how the
// journeys already on screen are narrowed by it.
//
// Kept out of the component so all of it is testable without a renderer.

import { BusAccessibilityFacilities } from '../../../entities/bus/model/types';
import { JourneySearchOption } from '../../../entities/route/model/types';
import {
    ACCESSIBILITY_REQUIREMENT_KEYS,
    AccessibilityRequirementKey,
    meetsAccessibilityRequirement,
    meetsAccessibilityRequirements as meetsRequiredFacilities,
} from '../../../shared/utils/accessibility';

// Re-exported so a screen importing the selection helpers gets the key type and
// the matching rule from the same place, without a second definition of either.
export type { AccessibilityRequirementKey };
export { meetsAccessibilityRequirement };

export interface AccessibilityRequirement {
    key: AccessibilityRequirementKey;
    /** Short name shown on the control. */
    label: string;
    /** Plain-language explanation of what the requirement means. */
    description: string;
}

/**
 * How each requirement is worded for a passenger.
 *
 * Keyed by the shared list rather than repeating it, so the compiler rejects a
 * requirement that gains no wording and wording for a requirement that does not
 * exist.
 */
const REQUIREMENT_WORDING: Record<AccessibilityRequirementKey, Omit<AccessibilityRequirement, 'key'>> = {
    wheelchairRamp: {
        label: 'Wheelchair ramp',
        description: 'A ramp for boarding in a wheelchair',
    },
    prioritySeats: {
        label: 'Priority seat',
        description: 'Seats kept for passengers who need them',
    },
    audioAnnouncement: {
        label: 'Audio announcements',
        description: 'Stops announced out loud on board',
    },
    lowFloorVehicle: {
        label: 'Low floor vehicle',
        description: 'A step-free entrance at the door',
    },
    walkingAssistance: {
        label: 'Walking assistance',
        description: 'Help from the crew to board and get off',
    },
};

/** The five requirements, in the order they are offered. */
export const ACCESSIBILITY_REQUIREMENTS: readonly AccessibilityRequirement[] =
    ACCESSIBILITY_REQUIREMENT_KEYS.map((key) => ({ key, ...REQUIREMENT_WORDING[key] }));

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

/**
 * The selection a saved list of requirements restores to (MOV-93).
 *
 * The inverse of `selectedAccessibilityRequirements`, so a preference written
 * from one screen reads back as the same chips on the next. Anything the list
 * does not name is simply not selected, which makes an empty list — and a
 * passenger with nothing saved — the untouched default.
 */
export function accessibilityRequirementSelection(
    requirements: readonly AccessibilityRequirementKey[]
): AccessibilityRequirementSelection {
    const selection = { ...NO_ACCESSIBILITY_REQUIREMENTS };

    for (const key of requirements) {
        selection[key] = true;
    }

    return selection;
}

export function hasSelectedAccessibilityRequirements(
    selection: AccessibilityRequirementSelection
): boolean {
    return selectedAccessibilityRequirements(selection).length > 0;
}

/**
 * Whether a vehicle meets every requirement the passenger has selected.
 *
 * The selection is the screen's own shape; the decision itself is the shared
 * rule, unchanged.
 */
export function meetsAccessibilityRequirements(
    facilities: BusAccessibilityFacilities | null | undefined,
    selection: AccessibilityRequirementSelection
): boolean {
    return meetsRequiredFacilities(facilities, selectedAccessibilityRequirements(selection));
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
