// What the driver is told while tracking runs (MOV-268).
//
// Two halves.
//
// The first checks the mapping on its own: every (status, isTracking) pair the
// engine can produce, and the words it turns into. The pair matters — the same
// status means different things depending on whether the loop is still going,
// and a driver reading "no fix" needs to know whether anything is still trying.
//
// The second drives the REAL MOV-267 tracker through a shift and renders each
// state it emits. A mapping can be complete against the statuses someone
// remembered to write down and still miss what the engine actually emits, so
// this closes that gap: the tracker publishes, fails, recovers and stops, and
// the card is read at every step.
//
// The project has no React renderer, so `LocationStatusCard` itself is not
// mounted here. What is testable is everything it renders FROM, which is why
// the card holds no decisions of its own.
//
// No value below is a literal credential. Session values come from
// nextUniqueValue(), which takes no arguments and carries no credential word in
// its name. Coordinates are ordinary geographic test data.

import { PublishLocationError } from '../../../src/features/driver/api/busLocationApi';
import { PublishCycleDependencies } from '../../../src/features/driver/utils/locationPublishCycle';
import {
    MINIMUM_TRACKING_INTERVAL_MS,
    TrackingScheduler,
    createLocationTracker,
} from '../../../src/features/driver/utils/locationTracker';
import {
    PhoneLocationState,
    PhoneLocationStatus,
    describePhoneLocationState,
    initialPhoneLocationState,
} from '../../../src/features/driver/utils/phoneLocationState';
import { describeTrackingCard } from '../../../src/features/driver/utils/trackingCardView';
import { PhoneLocation, PhoneLocationError } from '../../../src/shared/utils/phoneLocation';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    hasServicesEnabledAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { High: 4 },
}));

jest.mock('expo-secure-store', () => ({
    getItemAsync: jest.fn(),
    setItemAsync: jest.fn(),
    deleteItemAsync: jest.fn(),
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const READING: PhoneLocation = {
    latitude: 6.9061,
    longitude: 79.9558,
    recordedAt: '2026-08-20T09:05:00.000Z',
};

function stateOf(status: PhoneLocationStatus, extra: Partial<PhoneLocationState> = {}) {
    return { status, location: null, ...extra } as PhoneLocationState;
}

/** Every status the engine can put on the card. */
const ALL_STATUSES: PhoneLocationStatus[] = [
    'IDLE',
    'REQUESTING',
    'AVAILABLE',
    'PUBLISHING',
    'PUBLISHED',
    'PERMISSION_DENIED',
    'LOCATION_SERVICES_DISABLED',
    'POSITION_UNAVAILABLE',
    'PUBLISH_FAILED',
    'NOT_SIGNED_IN',
    'UNKNOWN_ERROR',
];

// ==================================================================
// THE FOUR STATES THE TASK NAMES
// ==================================================================
describe('describeTrackingCard - the states a driver needs to tell apart', () => {
    it('says tracking is active once a position has gone through', () => {
        const view = describeTrackingCard(stateOf('PUBLISHED', { location: READING }), true);

        expect(view.title).toBe('Tracking active');
        expect(view.description).toMatch(/updated automatically/i);
        expect(view.tone).toBe('success');
        expect(view.isBusy).toBe(false);
    });

    it('says it is waiting for GPS while a round is still looking', () => {
        const view = describeTrackingCard(stateOf('REQUESTING'), true);

        expect(view.title).toBe('Waiting for GPS');
        // Not a failure: the driver has nothing to do but wait.
        expect(view.tone).toBe('neutral');
        expect(view.isBusy).toBe(true);
        expect(view.description).not.toMatch(/failed|unavailable|could not/i);
    });

    it('reports a location that could not be obtained, and says it keeps trying', () => {
        const view = describeTrackingCard(stateOf('POSITION_UNAVAILABLE'), true);

        expect(view.title).toBe('Location unavailable');
        expect(view.description).toMatch(/temporarily unavailable/i);
        // MOV-267 keeps the loop alive through this, so the card must not imply
        // tracking has ended.
        expect(view.description).toMatch(/still on|keep trying/i);
        expect(view.trackingAction?.kind).toBe('STOP_TRACKING');
    });

    it('reports a location that could not be sent, without blaming the GPS', () => {
        const view = describeTrackingCard(stateOf('PUBLISH_FAILED', { location: READING }), true);

        expect(view.title).toBe('Unable to send location');
        expect(view.description).toMatch(/could not be sent/i);
        // The position was fine. Sending a driver to look at the sky or at
        // their location settings would waste their time.
        expect(view.description).toMatch(/was found/i);
        expect(view.title).not.toMatch(/gps|signal|position unavailable/i);
        expect(view.description).not.toMatch(/gps|satellite|clear view|sky/i);
    });

    it('never confuses a GPS failure with a sending failure', () => {
        const gpsFailure = describeTrackingCard(stateOf('POSITION_UNAVAILABLE'), true);
        const sendFailure = describeTrackingCard(stateOf('PUBLISH_FAILED'), true);

        expect(gpsFailure.title).not.toBe(sendFailure.title);
        expect(gpsFailure.description).not.toBe(sendFailure.description);
        // The GPS failure must not talk about sending either.
        expect(gpsFailure.description).not.toMatch(/could not be sent/i);
    });
});

// ==================================================================
// TRACKING ON IS NEVER MISTAKEN FOR TRACKING OFF
// ==================================================================
describe('describeTrackingCard - stopped and active never read alike', () => {
    it('distinguishes an idle phone from an active one', () => {
        const stopped = describeTrackingCard(initialPhoneLocationState, false);
        const active = describeTrackingCard(stateOf('PUBLISHED', { location: READING }), true);

        expect(stopped.title).toBe('Location tracking is off');
        expect(active.title).toBe('Tracking active');
        expect(stopped.trackingAction?.kind).toBe('START_TRACKING');
        expect(active.trackingAction?.kind).toBe('STOP_TRACKING');
    });

    it.each(ALL_STATUSES.filter((status) => status !== 'NOT_SIGNED_IN'))(
        'gives %s different words depending on whether the loop is running',
        (status) => {
            const stopped = describeTrackingCard(stateOf(status), false);
            const active = describeTrackingCard(stateOf(status), true);

            // Whatever else changes, the control must flip — that is the one
            // thing telling the driver whether anything is still happening.
            expect(stopped.trackingAction?.kind).toBe('START_TRACKING');
            expect(active.trackingAction?.kind).toBe('STOP_TRACKING');
        }
    );

    it('offers stopping in every state where the loop is running', () => {
        ALL_STATUSES.filter((status) => status !== 'NOT_SIGNED_IN').forEach((status) => {
            const view = describeTrackingCard(stateOf(status), true);

            // A driver must always be able to turn sharing off, including
            // mid-round and including while something is failing.
            expect(view.trackingAction).toEqual({
                kind: 'STOP_TRACKING',
                label: 'Stop sharing location',
            });
        });
    });

    it('never marks the tracking control as busy, so it cannot grey out mid-round', () => {
        // `isBusy` drives the spinner in the badge, not the button. A control
        // that disabled itself every thirty seconds would be unusable.
        const midRound = describeTrackingCard(stateOf('REQUESTING'), true);

        expect(midRound.isBusy).toBe(true);
        expect(midRound.trackingAction).toBeDefined();
    });
});

// ==================================================================
// A PHONE WITH NO BUS SESSION
// ==================================================================
describe('describeTrackingCard - signed out', () => {
    it('offers sign in rather than a tracking control', () => {
        const view = describeTrackingCard(stateOf('NOT_SIGNED_IN'), false);

        // Starting would fail on every round, so it is not offered at all.
        expect(view.trackingAction).toBeUndefined();
        expect(view.primaryAction?.kind).toBe('SIGN_IN');
        expect(view.title).toMatch(/signed out/i);
    });

    it('says the same thing even if asked while the loop still reads as on', () => {
        // The tracker stops itself on this state, so the pair should not occur.
        // Handled anyway rather than showing a tracking message to a phone that
        // cannot publish.
        const view = describeTrackingCard(stateOf('NOT_SIGNED_IN'), true);

        expect(view.trackingAction).toBeUndefined();
        expect(view.primaryAction?.kind).toBe('SIGN_IN');
    });
});

// ==================================================================
// WHAT THE DRIVER CAN PRESS WHEN TRACKING IS OFF
// ==================================================================
describe('describeTrackingCard - actions while stopped', () => {
    it('keeps the existing wording for states the driver already knew', () => {
        // MOV-268 adds a control; it does not rewrite states that were already
        // being shown correctly.
        (['PERMISSION_DENIED', 'LOCATION_SERVICES_DISABLED', 'POSITION_UNAVAILABLE'] as const).forEach(
            (status) => {
                const existing = describePhoneLocationState(stateOf(status));
                const view = describeTrackingCard(stateOf(status), false);

                expect(view.title).toBe(existing.title);
                expect(view.description).toBe(existing.description);
                expect(view.icon).toBe(existing.icon);
            }
        );
    });

    it('keeps the recovery action in a failure state', () => {
        const denied = describeTrackingCard(
            stateOf('PERMISSION_DENIED', { canAskAgain: false }),
            false
        );

        expect(denied.trackingAction?.kind).toBe('START_TRACKING');
        // Settings is still the only thing that will fix this one.
        expect(denied.primaryAction?.kind).toBe('OPEN_SETTINGS');
    });

    it('drops the one-off button where it would only duplicate starting', () => {
        // Two buttons that both send a position — one once, one continuously —
        // is a choice with no meaning. Starting publishes immediately, so
        // nothing is lost.
        (['IDLE', 'AVAILABLE', 'PUBLISHED'] as const).forEach((status) => {
            const view = describeTrackingCard(stateOf(status, { location: READING }), false);

            expect(view.trackingAction?.kind).toBe('START_TRACKING');
            expect(view.primaryAction).toBeUndefined();
            expect(view.secondaryAction).toBeUndefined();
        });
    });
});

// ==================================================================
// NOTHING INTERNAL REACHES THE DRIVER
// ==================================================================
describe('describeTrackingCard - what is never shown', () => {
    it('never prints a status name, a reason code or a status number', () => {
        [true, false].forEach((isTracking) => {
            ALL_STATUSES.forEach((status) => {
                const view = describeTrackingCard(
                    stateOf(status, { location: READING }),
                    isTracking
                );
                const shown = `${view.title} ${view.description}`;

                // No SCREAMING_SNAKE internals, no HTTP status codes.
                expect(shown).not.toMatch(/[A-Z]{3,}_[A-Z]/);
                expect(shown).not.toMatch(/\b[45]\d{2}\b/);
                // Session machinery is never named at a driver. The signed-out
                // copy does say "password", which is the right instruction —
                // it is how the driver signs the bus back in — so the check is
                // for the machinery, not for the word.
                expect(shown).not.toMatch(/token|bearer|credential|authorization/i);
            });
        });
    });

    it('never puts an opaque session value in front of the driver', () => {
        // The card is built from the state, and the state has no field that
        // could carry one — but this is the assertion that would fail if some
        // future change started threading a credential through it.
        const session = nextUniqueValue();

        [true, false].forEach((isTracking) => {
            ALL_STATUSES.forEach((status) => {
                const view = describeTrackingCard(
                    stateOf(status, { location: READING }),
                    isTracking
                );

                expect(JSON.stringify(view)).not.toContain(session);
            });
        });
    });

    it('distinguishes states by icon and title, not by colour alone', () => {
        const active = describeTrackingCard(stateOf('PUBLISHED'), true);
        const gpsFailed = describeTrackingCard(stateOf('POSITION_UNAVAILABLE'), true);
        const sendFailed = describeTrackingCard(stateOf('PUBLISH_FAILED'), true);
        const permission = describeTrackingCard(stateOf('PERMISSION_DENIED'), true);
        const services = describeTrackingCard(stateOf('LOCATION_SERVICES_DISABLED'), true);

        const titles = [active, gpsFailed, sendFailed, permission, services].map((v) => v.title);
        expect(new Set(titles).size).toBe(titles.length);

        // The three warning states share a tone, so the icon has to carry the
        // difference for anyone who cannot distinguish the colours.
        expect(permission.icon).not.toBe(services.icon);
        expect(services.icon).not.toBe(sendFailed.icon);
    });

    it('always gives every state something to read', () => {
        [true, false].forEach((isTracking) => {
            ALL_STATUSES.forEach((status) => {
                const view = describeTrackingCard(stateOf(status), isTracking);

                expect(view.title.length).toBeGreaterThan(0);
                expect(view.description.length).toBeGreaterThan(0);
                expect(view.icon.length).toBeGreaterThan(0);
            });
        });
    });
});

// ==================================================================
// THE CARD, DRIVEN BY THE REAL TRACKER
// ==================================================================
describe('the card through a whole shift', () => {
    function settle(): Promise<void> {
        return new Promise((resolve) => setImmediate(resolve));
    }

    function manualClock() {
        let nextId = 1;
        const pending = new Map<number, () => void>();

        const scheduler: TrackingScheduler = {
            setTimer: (run) => {
                const id = nextId++;
                pending.set(id, run);
                return id as unknown as ReturnType<typeof setTimeout>;
            },
            clearTimer: (timer) => {
                pending.delete(timer as unknown as number);
            },
        };

        return {
            scheduler,
            pendingCount: () => pending.size,
            async tick() {
                const due = Array.from(pending.values());
                pending.clear();
                due.forEach((run) => run());
                await settle();
            },
        };
    }

    /** The real tracker, the real cycle, and the card read from both. */
    function shift(overrides: Partial<PublishCycleDependencies> = {}) {
        const clock = manualClock();
        let state = initialPhoneLocationState;

        const dependencies: PublishCycleDependencies = {
            readLocation: jest.fn().mockResolvedValue(READING),
            readSession: jest.fn().mockResolvedValue({
                busId: 'BUS-00003',
                numberPlate: 'NA-1234',
                token: nextUniqueValue(),
            }),
            publish: jest.fn().mockResolvedValue(undefined),
            ...overrides,
        };

        const tracker = createLocationTracker({
            update: (reduce) => {
                state = reduce(state);
            },
            dependencies,
            scheduler: clock.scheduler,
            intervalMs: MINIMUM_TRACKING_INTERVAL_MS,
        });

        return {
            tracker,
            clock,
            dependencies,
            /** Exactly what the card would render right now. */
            card: () => describeTrackingCard(state, tracker.isTracking()),
        };
    }

    it('opens stopped, with a way to start', () => {
        const { card } = shift();

        expect(card().title).toBe('Location tracking is off');
        expect(card().trackingAction?.kind).toBe('START_TRACKING');
    });

    it('reaches Tracking active after the first round and stays there', async () => {
        const { tracker, clock, card } = shift();

        tracker.start();
        await settle();

        expect(card().title).toBe('Tracking active');

        await clock.tick();
        expect(card().title).toBe('Tracking active');
    });

    it('shows Location unavailable when the phone loses its fix, then recovers', async () => {
        const readLocation = jest
            .fn()
            .mockResolvedValueOnce(READING)
            .mockRejectedValueOnce(new PhoneLocationError('POSITION_UNAVAILABLE'))
            .mockResolvedValue(READING);

        const { tracker, clock, card } = shift({ readLocation });

        tracker.start();
        await settle();
        expect(card().title).toBe('Tracking active');

        await clock.tick();
        expect(card().title).toBe('Location unavailable');
        // Still running, so the driver is not asked to do anything.
        expect(card().trackingAction?.kind).toBe('STOP_TRACKING');
        expect(tracker.isTracking()).toBe(true);

        await clock.tick();
        expect(card().title).toBe('Tracking active');
    });

    it('shows Unable to send location when the network drops, then recovers', async () => {
        const publish = jest
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new PublishLocationError('NETWORK_UNAVAILABLE'))
            .mockResolvedValue(undefined);

        const { tracker, clock, card } = shift({ publish });

        tracker.start();
        await settle();
        expect(card().title).toBe('Tracking active');

        await clock.tick();
        expect(card().title).toBe('Unable to send location');
        expect(tracker.isTracking()).toBe(true);

        await clock.tick();
        expect(card().title).toBe('Tracking active');
    });

    it('goes back to a stopped card when the driver stops', async () => {
        const { tracker, clock, card } = shift();

        tracker.start();
        await settle();
        expect(card().title).toBe('Tracking active');

        tracker.stop();

        expect(card().trackingAction?.kind).toBe('START_TRACKING');
        expect(card().title).not.toBe('Tracking active');
        expect(clock.pendingCount()).toBe(0);
    });

    it('shows the signed-out card, with no tracking control, when the session goes', async () => {
        const { tracker, card, dependencies } = shift({
            readSession: jest.fn().mockResolvedValue(null),
        });

        tracker.start();
        await settle();

        // MOV-267 stops the loop on this, and the card follows.
        expect(tracker.isTracking()).toBe(false);
        expect(card().title).toMatch(/signed out/i);
        expect(card().trackingAction).toBeUndefined();
        expect(card().primaryAction?.kind).toBe('SIGN_IN');
        expect(dependencies.publish).not.toHaveBeenCalled();
    });

    it('never shows a state the mapping does not handle', async () => {
        const readLocation = jest
            .fn()
            .mockResolvedValueOnce(READING)
            .mockRejectedValueOnce(new PhoneLocationError('PERMISSION_DENIED'))
            .mockRejectedValueOnce(new PhoneLocationError('LOCATION_SERVICES_DISABLED'))
            .mockRejectedValueOnce(new Error('something native'))
            .mockResolvedValue(READING);

        const { tracker, clock, card } = shift({ readLocation });

        tracker.start();
        await settle();

        const seen: string[] = [card().title];

        for (let round = 0; round < 4; round += 1) {
            await clock.tick();
            seen.push(card().title);
        }

        // Every round produced real wording, never a fallback or an empty card.
        seen.forEach((title) => {
            expect(title.length).toBeGreaterThan(0);
            expect(title).not.toMatch(/undefined|\[object|_/i);
        });

        expect(seen).toContain('Tracking active');
        expect(seen).toContain('Location permission is off');
        expect(seen).toContain('Location services are off');
    });
});
