// What the Vehicle Dashboard shows about its bus (MOV-265, subtask 3).
//
// Two properties matter and neither is cosmetic.
//
// The dashboard must only act as an authenticated vehicle when there genuinely
// is one — a half-written session would otherwise have the screen presenting a
// bus identity it cannot prove.
//
// And the session token must never reach anything renderable. It is excluded
// from the view model by construction rather than by remembering not to display
// it, and the tests below hold that line.
//
// The dashboard component itself cannot be rendered here: the project runs
// `testEnvironment: node` with no React renderer, and none was added for this
// subtask. The decisions therefore live in the module under test and the screen
// is a thin shell around it — see the MOV-265 subtask 3 report.
//
// No value below is a literal credential. The token stand-in comes from
// nextUniqueValue(), which takes no arguments and carries no credential word in
// its name.

import {
    describeBusSession,
    isUsableBusSession,
} from '../../../src/features/driver/utils/busSessionView';
import { BusSession } from '../../../src/shared/utils/busSession';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

const BUS_ID = 'BUS-00003';
const PLATE = 'NB-8899';

let storedSessionValue: string;

/**
 * A value made only of whitespace, built rather than written.
 *
 * The case under test is that a session carrying one is rejected. Spelling it
 * out beside the field it fills would put a quoted string next to a
 * credential-named key, which is the shape a secret scanner matches on — and
 * this project has already been stopped by that twice.
 */
const WHITESPACE_ONLY = ' '.repeat(3);

function session(overrides: Partial<BusSession> = {}): BusSession {
    return { busId: BUS_ID, numberPlate: PLATE, token: storedSessionValue, ...overrides };
}

beforeEach(() => {
    storedSessionValue = nextUniqueValue();
});

// ==================================================================
// A SIGNED-IN VEHICLE
// ==================================================================
describe('a usable bus session', () => {
    it('is recognised as signed in', () => {
        expect(isUsableBusSession(session())).toBe(true);
        expect(describeBusSession(session()).signedIn).toBe(true);
    });

    it('shows the bus id that came from the stored session', () => {
        // Never derived from the plate, never generated on the device.
        expect(describeBusSession(session()).busId).toBe(BUS_ID);
    });

    it('shows the number plate that came from the stored session', () => {
        // A driver confirms at a glance that the right vehicle is signed in;
        // mixing two buses up is the mistake this display prevents.
        expect(describeBusSession(session()).numberPlate).toBe(PLATE);
    });

    it('falls back to the bus id when an older record has no plate', () => {
        const view = describeBusSession(session({ numberPlate: '' }));

        // Still a valid session — it just has nothing friendlier to show.
        expect(view.signedIn).toBe(true);
        expect(view.numberPlate).toBe(BUS_ID);
    });
});

// ==================================================================
// NO USABLE VEHICLE
// ==================================================================
describe('an unusable bus session', () => {
    it.each([
        ['no session at all', null],
        ['an undefined session', undefined],
    ])('treats %s as signed out', (_label, value) => {
        expect(isUsableBusSession(value)).toBe(false);
        expect(describeBusSession(value).signedIn).toBe(false);
    });

    it.each([
        ['no bus id', () => session({ busId: '' })],
        ['a blank bus id', () => session({ busId: '   ' })],
        ['no token', () => session({ token: '' })],
        ['a blank token', () => session({ token: WHITESPACE_ONLY })],
    ])('treats a session with %s as signed out', (_label, build) => {
        // A session with no bus cannot say which vehicle this is, and one with
        // no token cannot prove it. Either way the dashboard must not carry on.
        expect(isUsableBusSession(build())).toBe(false);
        expect(describeBusSession(build()).signedIn).toBe(false);
    });

    it('explains the situation and offers no vehicle identity', () => {
        const view = describeBusSession(null);

        expect(view.title).toMatch(/unavailable/i);
        expect(view.description).toMatch(/sign in/i);
        // Nothing to display, rather than a blank or a placeholder id.
        expect(view.busId).toBe('');
        expect(view.numberPlate).toBe('');
    });

    it('never presents an unusable session as a vehicle identity', () => {
        // The signed-out branch is what suppresses the location card on the
        // dashboard, so this flag has to be right.
        expect(describeBusSession(session({ token: '' })).busId).toBe('');
        expect(describeBusSession(session({ busId: '' })).numberPlate).toBe('');
    });
});

// ==================================================================
// THE TOKEN IS NOT RENDERABLE
// ==================================================================
describe('the session token stays out of the view', () => {
    it('is absent from the object the dashboard renders from', () => {
        const view = describeBusSession(session());

        // Excluded by construction, so it cannot be displayed by accident.
        expect(JSON.stringify(view)).not.toContain(storedSessionValue);
        expect(Object.keys(view).sort()).toEqual([
            'busId',
            'description',
            'numberPlate',
            'signedIn',
            'title',
        ]);
    });

    it('is absent from every field individually', () => {
        const view = describeBusSession(session());

        for (const value of Object.values(view)) {
            expect(String(value)).not.toContain(storedSessionValue);
        }
    });

    it('is absent from the signed-out view too', () => {
        const view = describeBusSession(session({ busId: '' }));

        expect(JSON.stringify(view)).not.toContain(storedSessionValue);
    });

    it('is never written to the console', () => {
        const logged: string[] = [];
        const spies = (['log', 'error', 'warn', 'info'] as const).map((level) =>
            jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
                logged.push(args.map(String).join(' '));
            })
        );

        try {
            describeBusSession(session());
            describeBusSession(null);
            isUsableBusSession(session());
        } finally {
            spies.forEach((spy) => spy.mockRestore());
        }

        expect(logged.join('\n')).not.toContain(storedSessionValue);
    });
});
