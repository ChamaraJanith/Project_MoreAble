// What the Route Details accessibility section lists (MOV-97).
//
// This is the only thing standing between the stored bus record and the chips a
// passenger reads, so the rule it has to keep is strict: list what the bus
// actually records, and never imply a facility it does not have. A passenger who
// relies on a wheelchair ramp cannot afford an optimistic default.

import { BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import { listAccessibilityFacilities } from '../../../src/features/journey/utils/accessibilityFacilities';

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

const labels = (input?: BusAccessibilityFacilities | null) =>
    listAccessibilityFacilities(input).map((item) => item.label);

// ==================================================================
// NOTHING IS INVENTED
// ==================================================================
describe('listAccessibilityFacilities - a bus with nothing recorded', () => {
    it('lists nothing when every facility is absent', () => {
        expect(listAccessibilityFacilities(facilities())).toEqual([]);
    });

    it('lists nothing when the bus has no facilities object at all', () => {
        expect(listAccessibilityFacilities(undefined)).toEqual([]);
        expect(listAccessibilityFacilities(null)).toEqual([]);
    });

    it('never reports a facility the bus does not have', () => {
        const rampOnly = facilities({ wheelchairRamp: true });

        expect(labels(rampOnly)).toEqual(['Wheelchair ramp']);
        expect(labels(rampOnly)).not.toContain('Low floor');
        expect(labels(rampOnly)).not.toContain('Audio announcements');
        expect(labels(rampOnly)).not.toContain('Walking assistance');
    });

    it('omits a counted facility that is marked unavailable even with a count', () => {
        // A decommissioned bay: the count lingers, availability is what governs.
        const stale = facilities({ wheelchairSpace: { available: false, count: 2 } });

        expect(listAccessibilityFacilities(stale)).toEqual([]);
    });
});

// ==================================================================
// WHAT THE BUS DOES RECORD
// ==================================================================
describe('listAccessibilityFacilities - a bus with facilities', () => {
    it('lists each recorded boolean facility', () => {
        expect(
            labels(
                facilities({
                    wheelchairRamp: true,
                    lowFloorVehicle: true,
                    audioAnnouncement: true,
                    walkingAssistance: true,
                })
            )
        ).toEqual([
            'Wheelchair ramp',
            'Low floor',
            'Audio announcements',
            'Walking assistance',
        ]);
    });

    it('reports the recorded count for each counted facility', () => {
        expect(
            labels(
                facilities({
                    wheelchairSpace: { available: true, count: 2 },
                    prioritySeats: { available: true, count: 4 },
                    elderlySeats: { available: true, count: 3 },
                    guardianSeats: { available: true, count: 2 },
                })
            )
        ).toEqual([
            '2 wheelchair spaces',
            '4 priority seats',
            '3 elderly seats',
            '2 guardian seats',
        ]);
    });

    it('uses the singular form for a single unit', () => {
        expect(labels(facilities({ prioritySeats: { available: true, count: 1 } }))).toEqual([
            '1 priority seat',
        ]);
    });

    it('names an available facility with no recorded count', () => {
        expect(labels(facilities({ wheelchairSpace: { available: true, count: 0 } }))).toEqual([
            'wheelchair space',
        ]);
    });

    it('gives every entry a stable key for list rendering', () => {
        const items = listAccessibilityFacilities(
            facilities({
                wheelchairRamp: true,
                wheelchairSpace: { available: true, count: 2 },
            })
        );

        expect(items.map((item) => item.key)).toEqual(['wheelchairRamp', 'wheelchairSpace']);
        expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
    });
});

// ==================================================================
// MALFORMED RECORDS
// ==================================================================
describe('listAccessibilityFacilities - malformed records', () => {
    it('ignores a counted facility stored as a bare boolean', () => {
        // Legacy shape: not enough information to state a count, so it is not
        // claimed rather than being guessed at.
        const legacy = facilities({
            wheelchairSpace: true as unknown as BusAccessibilityFacilities['wheelchairSpace'],
        });

        expect(listAccessibilityFacilities(legacy)).toEqual([]);
    });

    it('ignores a counted facility that is null', () => {
        const broken = facilities({
            prioritySeats: null as unknown as BusAccessibilityFacilities['prioritySeats'],
        });

        expect(listAccessibilityFacilities(broken)).toEqual([]);
    });

    it('does not treat a non-boolean flag as a recorded facility', () => {
        // The bus API stores whatever shape it is handed, and 'no' is truthy.
        // Reading it loosely would tell a wheelchair user a ramp exists on a bus
        // that was explicitly recorded as not having one.
        expect(
            listAccessibilityFacilities(
                facilities({ wheelchairRamp: 'no' as unknown as boolean })
            )
        ).toEqual([]);

        expect(
            listAccessibilityFacilities(
                facilities({ wheelchairRamp: 'yes' as unknown as boolean })
            )
        ).toEqual([]);
    });

    it('does not treat a non-boolean availability as available', () => {
        const odd = facilities({
            prioritySeats: { available: 'no', count: 4 } as unknown as
                BusAccessibilityFacilities['prioritySeats'],
        });

        expect(listAccessibilityFacilities(odd)).toEqual([]);
    });

    it('names an available facility without a count when the count is not a number', () => {
        const odd = facilities({
            wheelchairSpace: { available: true, count: 'two' } as unknown as
                BusAccessibilityFacilities['wheelchairSpace'],
        });

        expect(labels(odd)).toEqual(['wheelchair space']);
    });
});
