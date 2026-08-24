// Filtering the recommended routes by what a passenger actually needs (MOV-91).
//
// The rule this file exists to protect is a safety rule, not a UI one: a
// passenger who states a requirement must never be shown a journey that cannot
// be proven to meet it. So the tests below check both directions — that a
// matching journey survives, and that everything unproven is removed — and they
// check the awkward records too, because a wrongly-shaped facility value is
// exactly where an optimistic filter would leak one through.
//
// Nothing here re-implements the ranking. Order is MOV-87's, and these tests
// assert only that filtering does not disturb it.

import { BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import { JourneySearchOption } from '../../../src/entities/route/model/types';
import {
    ACCESSIBILITY_REQUIREMENTS,
    AccessibilityRequirementKey,
    AccessibilityRequirementSelection,
    filterJourneysByAccessibility,
    hasSelectedAccessibilityRequirements,
    meetsAccessibilityRequirement,
    meetsAccessibilityRequirements,
    NO_ACCESSIBILITY_REQUIREMENTS,
    selectedAccessibilityRequirements,
    toggleAccessibilityRequirement,
} from '../../../src/features/journey/utils/accessibilityFilters';

function facilities(
    overrides: Partial<BusAccessibilityFacilities> = {}
): BusAccessibilityFacilities {
    return {
        wheelchairRamp: false,
        audioAnnouncement: false,
        lowFloorVehicle: false,
        walkingAssistance: false,
        wheelchairSpace: { available: false, count: 0 },
        guardianSeats: { available: false, count: 0 },
        prioritySeats: { available: false, count: 0 },
        elderlySeats: { available: false, count: 0 },
        ...overrides,
    };
}

/** The facility set that satisfies exactly one requirement and nothing else. */
function facilitiesFor(key: AccessibilityRequirementKey): BusAccessibilityFacilities {
    return key === 'prioritySeats'
        ? facilities({ prioritySeats: { available: true, count: 4 } })
        : facilities({ [key]: true } as Partial<BusAccessibilityFacilities>);
}

function select(...keys: AccessibilityRequirementKey[]): AccessibilityRequirementSelection {
    return keys.reduce<AccessibilityRequirementSelection>(
        (selection, key) => toggleAccessibilityRequirement(selection, key),
        NO_ACCESSIBILITY_REQUIREMENTS
    );
}

interface Journey {
    key: string;
    option: JourneySearchOption;
}

function journey(key: string, busFacilities: BusAccessibilityFacilities | null): Journey {
    return {
        key,
        option: {
            trip: {
                tripId: `TRIP-${key}`,
                departureTime: '09:00',
                estimatedArrivalTime: '09:41',
                turnNumber: 1,
            },
            bus: busFacilities
                ? ({
                      busId: `BUS-${key}`,
                      numberPlate: `NB-${key}`,
                      busModel: 'Ashok Leyland Viking',
                      manufacturer: 'Ashok Leyland',
                      seatCapacity: 54,
                      accessibilityFacilities: busFacilities,
                      accessibilityScore: 50,
                  } as JourneySearchOption['bus'])
                : null,
            liveStatus: { available: false },
        },
    };
}

const keys = (journeys: Journey[]) => journeys.map((entry) => entry.key);

const REQUIREMENT_KEYS = ACCESSIBILITY_REQUIREMENTS.map((requirement) => requirement.key);

// ==================================================================
// THE FIVE REQUIREMENTS THE STORY NAMES
// ==================================================================
describe('the offered accessibility requirements', () => {
    it('offers exactly the five requirements, under the stored field names', () => {
        expect(REQUIREMENT_KEYS).toEqual([
            'wheelchairRamp',
            'prioritySeats',
            'audioAnnouncement',
            'lowFloorVehicle',
            'walkingAssistance',
        ]);
    });

    it('gives every requirement a label and an explanation to show', () => {
        for (const requirement of ACCESSIBILITY_REQUIREMENTS) {
            expect(requirement.label.trim().length).toBeGreaterThan(0);
            expect(requirement.description.trim().length).toBeGreaterThan(0);
        }
    });

    it('starts with nothing selected', () => {
        expect(selectedAccessibilityRequirements(NO_ACCESSIBILITY_REQUIREMENTS)).toEqual([]);
        expect(hasSelectedAccessibilityRequirements(NO_ACCESSIBILITY_REQUIREMENTS)).toBe(false);
    });
});

// ==================================================================
// SELECTING AND DESELECTING
// ==================================================================
describe('selecting and deselecting a requirement', () => {
    it.each(REQUIREMENT_KEYS)('can select and then deselect %s', (key) => {
        const selected = toggleAccessibilityRequirement(NO_ACCESSIBILITY_REQUIREMENTS, key);
        expect(selected[key]).toBe(true);
        expect(selectedAccessibilityRequirements(selected)).toEqual([key]);
        expect(hasSelectedAccessibilityRequirements(selected)).toBe(true);

        const deselected = toggleAccessibilityRequirement(selected, key);
        expect(deselected[key]).toBe(false);
        expect(selectedAccessibilityRequirements(deselected)).toEqual([]);
        expect(hasSelectedAccessibilityRequirements(deselected)).toBe(false);
    });

    it('keeps the other selections when one is toggled', () => {
        const selection = select('wheelchairRamp', 'audioAnnouncement', 'walkingAssistance');

        const afterDeselect = toggleAccessibilityRequirement(selection, 'audioAnnouncement');

        expect(selectedAccessibilityRequirements(afterDeselect)).toEqual([
            'wheelchairRamp',
            'walkingAssistance',
        ]);
    });

    it('never mutates the selection it is given, so state updates stay predictable', () => {
        const selection = select('prioritySeats');

        toggleAccessibilityRequirement(selection, 'lowFloorVehicle');

        expect(selectedAccessibilityRequirements(selection)).toEqual(['prioritySeats']);
        expect(selectedAccessibilityRequirements(NO_ACCESSIBILITY_REQUIREMENTS)).toEqual([]);
    });

    it('reports selections in the order the requirements are offered', () => {
        const selection = select('walkingAssistance', 'wheelchairRamp', 'prioritySeats');

        expect(selectedAccessibilityRequirements(selection)).toEqual([
            'wheelchairRamp',
            'prioritySeats',
            'walkingAssistance',
        ]);
    });
});

// ==================================================================
// EACH REQUIREMENT READS ITS OWN STORED FIELD
// ==================================================================
describe('matching one requirement against a bus record', () => {
    it.each(REQUIREMENT_KEYS)('matches %s only against its own recorded facility', (key) => {
        const equipped = facilitiesFor(key);

        expect(meetsAccessibilityRequirement(equipped, key)).toBe(true);

        for (const other of REQUIREMENT_KEYS) {
            if (other === key) continue;
            expect(meetsAccessibilityRequirement(equipped, other)).toBe(false);
        }
    });

    it('reads priority seats through availability, not through the count', () => {
        // A decommissioned bay: the count lingers, availability is what governs.
        const stale = facilities({ prioritySeats: { available: false, count: 4 } });

        expect(meetsAccessibilityRequirement(stale, 'prioritySeats')).toBe(false);
    });

    it('does not accept a facility recorded in the wrong shape', () => {
        // A stored string is truthy. A passenger who needs a ramp cannot be told
        // one exists because a record was written badly.
        const wronglyShaped = facilities({ wheelchairRamp: 'no' as never });

        expect(meetsAccessibilityRequirement(wronglyShaped, 'wheelchairRamp')).toBe(false);
    });

    it('matches nothing when the bus has no facilities recorded at all', () => {
        for (const key of REQUIREMENT_KEYS) {
            expect(meetsAccessibilityRequirement(undefined, key)).toBe(false);
            expect(meetsAccessibilityRequirement(null, key)).toBe(false);
        }
    });
});

// ==================================================================
// SEVERAL REQUIREMENTS NARROW, THEY DO NOT WIDEN
// ==================================================================
describe('matching several requirements at once', () => {
    it('requires every selected requirement, not just one of them', () => {
        const rampOnly = facilitiesFor('wheelchairRamp');

        expect(meetsAccessibilityRequirements(rampOnly, select('wheelchairRamp'))).toBe(true);
        expect(
            meetsAccessibilityRequirements(rampOnly, select('wheelchairRamp', 'lowFloorVehicle'))
        ).toBe(false);
    });

    it('accepts a bus that records everything selected', () => {
        const equipped = facilities({
            wheelchairRamp: true,
            lowFloorVehicle: true,
            prioritySeats: { available: true, count: 4 },
        });

        expect(
            meetsAccessibilityRequirements(
                equipped,
                select('wheelchairRamp', 'lowFloorVehicle', 'prioritySeats')
            )
        ).toBe(true);
    });

    it('accepts every bus while nothing is selected', () => {
        expect(meetsAccessibilityRequirements(facilities(), NO_ACCESSIBILITY_REQUIREMENTS)).toBe(
            true
        );
        expect(meetsAccessibilityRequirements(null, NO_ACCESSIBILITY_REQUIREMENTS)).toBe(true);
    });
});

// ==================================================================
// WHAT THE SCREEN IS LEFT WITH
// ==================================================================
describe('filtering the recommended journeys', () => {
    const ramped = journey('ramped', facilitiesFor('wheelchairRamp'));
    const priority = journey('priority', facilitiesFor('prioritySeats'));
    const fullyEquipped = journey(
        'equipped',
        facilities({
            wheelchairRamp: true,
            audioAnnouncement: true,
            lowFloorVehicle: true,
            walkingAssistance: true,
            prioritySeats: { available: true, count: 4 },
        })
    );
    const bare = journey('bare', facilities());
    const busless = journey('busless', null);

    const all = [ramped, priority, fullyEquipped, bare, busless];

    it('returns every journey untouched when no requirement is selected', () => {
        const result = filterJourneysByAccessibility(all, NO_ACCESSIBILITY_REQUIREMENTS);

        expect(result).toBe(all);
        expect(keys(result)).toEqual(['ramped', 'priority', 'equipped', 'bare', 'busless']);
    });

    it('keeps only the journeys whose bus records the requirement', () => {
        const result = filterJourneysByAccessibility(all, select('wheelchairRamp'));

        expect(keys(result)).toEqual(['ramped', 'equipped']);
    });

    it('narrows further as more requirements are selected', () => {
        expect(keys(filterJourneysByAccessibility(all, select('prioritySeats')))).toEqual([
            'priority',
            'equipped',
        ]);

        expect(
            keys(filterJourneysByAccessibility(all, select('prioritySeats', 'wheelchairRamp')))
        ).toEqual(['equipped']);
    });

    it('drops a departure whose bus record is missing once a requirement is stated', () => {
        // Nothing is known about that vehicle, so nothing about it can be shown
        // to meet the need.
        const result = filterJourneysByAccessibility(all, select('audioAnnouncement'));

        expect(keys(result)).not.toContain('busless');
        expect(keys(result)).toEqual(['equipped']);
    });

    it('can leave the passenger with nothing rather than with an unsuitable option', () => {
        const result = filterJourneysByAccessibility(
            [ramped, bare, busless],
            select('walkingAssistance')
        );

        expect(result).toEqual([]);
    });

    it('preserves the ranked order it was given', () => {
        const ordered = [fullyEquipped, ramped, priority];

        expect(keys(filterJourneysByAccessibility(ordered, NO_ACCESSIBILITY_REQUIREMENTS))).toEqual([
            'equipped',
            'ramped',
            'priority',
        ]);
        expect(keys(filterJourneysByAccessibility(ordered, select('wheelchairRamp')))).toEqual([
            'equipped',
            'ramped',
        ]);
    });

    it('restores every journey when the requirements are cleared again', () => {
        const selection = select('wheelchairRamp', 'audioAnnouncement');
        expect(keys(filterJourneysByAccessibility(all, selection))).toEqual(['equipped']);

        const cleared = REQUIREMENT_KEYS.reduce(
            (current, key) =>
                current[key] ? toggleAccessibilityRequirement(current, key) : current,
            selection
        );

        expect(keys(filterJourneysByAccessibility(all, cleared))).toEqual(keys(all));
    });

    it('leaves the journey objects themselves untouched', () => {
        const [onlyMatch] = filterJourneysByAccessibility(all, select('walkingAssistance'));

        expect(onlyMatch).toBe(fullyEquipped);
    });
});
