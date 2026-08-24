// What the Accessibility section says when there is nothing to list (MOV-107).
//
// `listAccessibilityFacilities` is covered in full by MOV-97's suite next door —
// the labels, the counts, the strict availability rule, the malformed records —
// and none of that is repeated here. This file covers the one question that
// function deliberately does not answer.
//
// It returns an empty list for two situations that mean opposite things to a
// passenger:
//
//   * the vehicle WAS assessed and records nothing available, and
//   * nobody has ever recorded anything about this vehicle.
//
// The screen used to say "No accessibility facilities are recorded for this bus"
// for both. For the second that asserts something the data does not support: a
// bus can have a ramp that no one has entered yet, and a wheelchair user reading
// a flat "no facilities" may skip a departure they could actually have taken.
//
// So the distinction is what is tested here, along with the guarantee that
// drawing it changed nothing about which facilities get listed.

import { BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import {
    describeAccessibilityFacilities,
    listAccessibilityFacilities,
} from '../../../src/features/journey/utils/accessibilityFacilities';

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

const statusOf = (input?: BusAccessibilityFacilities | null) =>
    describeAccessibilityFacilities(input).status;

// ==================================================================
// NOTHING RECORDED IS NOT THE SAME AS NOTHING AVAILABLE
// ==================================================================
describe('a vehicle nobody has assessed', () => {
    it('is unknown when the facility block is missing entirely', () => {
        // The legacy record MOV-109 proved the backend still delivers: a bus
        // that predates the field, or one nobody has filled in.
        expect(statusOf(undefined)).toBe('UNKNOWN');
        expect(statusOf(null)).toBe('UNKNOWN');
    });

    it('is unknown when the block is present but holds no answers', () => {
        expect(statusOf({} as BusAccessibilityFacilities)).toBe('UNKNOWN');
    });

    it('is unknown when every field is stored as null', () => {
        const emptied = {
            wheelchairRamp: null,
            prioritySeats: null,
        } as unknown as BusAccessibilityFacilities;

        expect(statusOf(emptied)).toBe('UNKNOWN');
    });

    it('has nothing to list', () => {
        expect(describeAccessibilityFacilities(undefined).items).toEqual([]);
    });
});

describe('a vehicle assessed as having nothing', () => {
    it('is a statement about the bus, not an absence of data', () => {
        // Every question answered, every answer no.
        expect(statusOf(facilities())).toBe('NONE_AVAILABLE');
    });

    it('says so from a single recorded answer, even a negative one', () => {
        // Somebody answered the ramp question. That is an assessment, however
        // partial, so the screen is entitled to report what it found.
        const partial = { wheelchairRamp: false } as BusAccessibilityFacilities;

        expect(statusOf(partial)).toBe('NONE_AVAILABLE');
    });

    it('treats a counted facility turned off as an answer', () => {
        const stale = {
            prioritySeats: { available: false, count: 4 },
        } as BusAccessibilityFacilities;

        expect(statusOf(stale)).toBe('NONE_AVAILABLE');
        // And still lists nothing: a lingering count is not a facility.
        expect(describeAccessibilityFacilities(stale).items).toEqual([]);
    });

    it('has nothing to list either', () => {
        expect(describeAccessibilityFacilities(facilities()).items).toEqual([]);
    });
});

// ==================================================================
// A MALFORMED RECORD IS AN ANSWER THAT CANNOT BE HONOURED
// ==================================================================
describe('a vehicle whose record is malformed', () => {
    it('never reports a malformed value as an available facility', () => {
        // Every one of these is truthy in JavaScript and none of them is `true`.
        const malformed = {
            wheelchairRamp: 'no',
            audioAnnouncement: 'false',
            lowFloorVehicle: 1,
            walkingAssistance: {},
            prioritySeats: { available: 'yes', count: 4 },
        } as unknown as BusAccessibilityFacilities;

        const summary = describeAccessibilityFacilities(malformed);

        expect(summary.status).not.toBe('AVAILABLE');
        expect(summary.items).toEqual([]);
    });

    it('reports it as assessed rather than unrecorded', () => {
        // Something was written for this bus, so the honest reading is that its
        // record says nothing available — not that nobody has looked.
        const malformed = { wheelchairRamp: 'no' } as unknown as BusAccessibilityFacilities;

        expect(statusOf(malformed)).toBe('NONE_AVAILABLE');
    });
});

// ==================================================================
// WHEN THERE IS SOMETHING TO SHOW, NOTHING CHANGED
// ==================================================================
describe('a vehicle with facilities to show', () => {
    it('is available as soon as one facility is recorded', () => {
        expect(statusOf(facilities({ wheelchairRamp: true }))).toBe('AVAILABLE');
    });

    it('lists exactly what the existing rule lists, in the same order', () => {
        // The list itself is MOV-97's and is not re-derived here: whatever it
        // returns is what the screen renders.
        const equipped = facilities({
            wheelchairRamp: true,
            lowFloorVehicle: true,
            audioAnnouncement: true,
            wheelchairSpace: { available: true, count: 2 },
            prioritySeats: { available: true, count: 4 },
        });

        expect(describeAccessibilityFacilities(equipped).items).toEqual(
            listAccessibilityFacilities(equipped)
        );
    });

    it('keeps the counted facilities the passenger reads', () => {
        const equipped = facilities({
            wheelchairSpace: { available: true, count: 2 },
            prioritySeats: { available: true, count: 4 },
        });

        const labels = describeAccessibilityFacilities(equipped).items.map((item) => item.label);

        expect(labels).toEqual(['2 wheelchair spaces', '4 priority seats']);
    });

    it('shows the five facilities the story names, under their own keys', () => {
        const equipped = facilities({
            wheelchairRamp: true,
            audioAnnouncement: true,
            lowFloorVehicle: true,
            wheelchairSpace: { available: true, count: 1 },
            prioritySeats: { available: true, count: 4 },
        });

        const keys = describeAccessibilityFacilities(equipped).items.map((item) => item.key);

        expect(keys).toEqual(
            expect.arrayContaining([
                'wheelchairRamp',
                'prioritySeats',
                'wheelchairSpace',
                'audioAnnouncement',
                'lowFloorVehicle',
            ])
        );
    });

    it('still shows the facilities beyond those five that the fleet records', () => {
        // Walking assistance, guardian seats and elderly seats predate MOV-107
        // and are not dropped because the story lists five.
        const equipped = facilities({
            walkingAssistance: true,
            guardianSeats: { available: true, count: 2 },
            elderlySeats: { available: true, count: 4 },
        });

        const keys = describeAccessibilityFacilities(equipped).items.map((item) => item.key);

        expect(keys).toEqual(
            expect.arrayContaining(['walkingAssistance', 'guardianSeats', 'elderlySeats'])
        );
    });

    it('describes each vehicle from its own record', () => {
        const ramped = facilities({ wheelchairRamp: true });
        const audible = facilities({ audioAnnouncement: true });

        expect(describeAccessibilityFacilities(ramped).items.map((item) => item.key)).toEqual([
            'wheelchairRamp',
        ]);
        expect(describeAccessibilityFacilities(audible).items.map((item) => item.key)).toEqual([
            'audioAnnouncement',
        ]);
    });

    it('never invents a facility that was not recorded', () => {
        const rampOnly = describeAccessibilityFacilities(facilities({ wheelchairRamp: true }));

        expect(rampOnly.items).toHaveLength(1);
        expect(rampOnly.items[0]).toEqual({ key: 'wheelchairRamp', label: 'Wheelchair ramp' });
    });
});
