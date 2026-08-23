// One publish cycle (MOV-267).
//
// This sequence used to live inside `LocationStatusCard`, where no test could
// reach it — the project has no React renderer, so the card's orchestration was
// the acknowledged gap at the end of MOV-266. MOV-267 needed the same sequence
// on a timer, so it moved into a module, and moving it made it testable.
//
// What is checked here is the ORDER and the DECISIONS: that no position means
// no publish, that the bus id and credential come from the session, that the
// fix time is passed through untouched, and that each ending produces both the
// right driver-facing state and the right outcome for a loop to act on.
//
// The three services themselves are not retested — `phoneLocation`,
// `busSession` and `busLocationApi` each have their own suite, and they are
// injected here rather than mocked so this stays a test of the sequence.
//
// No value below is a literal credential. Session values come from
// nextUniqueValue(), which takes no arguments and carries no credential word in
// its name. Coordinates are ordinary geographic test data.

import { PublishLocationError } from '../../../src/features/driver/api/busLocationApi';
import {
    PublishCycleDependencies,
    runPublishCycle,
} from '../../../src/features/driver/utils/locationPublishCycle';
import {
    PhoneLocationState,
    initialPhoneLocationState,
} from '../../../src/features/driver/utils/phoneLocationState';
import { PhoneLocation, PhoneLocationError } from '../../../src/shared/utils/phoneLocation';
import { nextUniqueValue } from '../../testUtils/uniqueValue';

// `phoneLocation` reaches the device GPS, and `busSession` the device keystore.
// Neither is exercised here — the cycle's dependencies are injected — but both
// modules are imported for their types and load their native package.
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

const BUS_ID = 'BUS-00003';

const READING: PhoneLocation = {
    latitude: 6.9061,
    longitude: 79.9558,
    recordedAt: '2026-08-20T09:05:00.000Z',
};

/**
 * Collects the states the cycle produced, in order, the way React's functional
 * setState would apply them.
 */
function stateRecorder() {
    const seen: PhoneLocationState[] = [];
    let current = initialPhoneLocationState;

    return {
        update: (reduce: (state: PhoneLocationState) => PhoneLocationState) => {
            current = reduce(current);
            seen.push(current);
        },
        statuses: () => seen.map((state) => state.status),
        last: () => seen[seen.length - 1],
    };
}

/** A working phone with a signed-in bus, unless a test says otherwise. */
function workingDependencies(overrides: Partial<PublishCycleDependencies> = {}) {
    const session = {
        busId: BUS_ID,
        numberPlate: 'NA-1234',
        token: nextUniqueValue(),
    };

    const dependencies: PublishCycleDependencies = {
        readLocation: jest.fn().mockResolvedValue(READING),
        readSession: jest.fn().mockResolvedValue(session),
        publish: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };

    return { session, dependencies };
}

// ==================================================================
// THE HAPPY PATH
// ==================================================================
describe('runPublishCycle - a position reaches the backend', () => {
    it('reads, then looks up the bus, then publishes', async () => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies();

        const outcome = await runPublishCycle(recorder.update, dependencies);

        expect(outcome).toBe('PUBLISHED');
        expect(dependencies.readLocation).toHaveBeenCalledTimes(1);
        expect(dependencies.readSession).toHaveBeenCalledTimes(1);
        expect(dependencies.publish).toHaveBeenCalledTimes(1);
    });

    it('publishes as the bus in the session, with that session credential', async () => {
        const recorder = stateRecorder();
        const { session, dependencies } = workingDependencies();

        await runPublishCycle(recorder.update, dependencies);

        // Both come from the session and nowhere else — nothing derives an id
        // from the number plate.
        expect(dependencies.publish).toHaveBeenCalledWith(BUS_ID, READING, session.token);
        expect(dependencies.publish).not.toHaveBeenCalledWith(
            session.numberPlate,
            expect.anything(),
            expect.anything()
        );
    });

    it('passes the reading through untouched, fix time included', async () => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies();

        await runPublishCycle(recorder.update, dependencies);

        const [, published] = (dependencies.publish as jest.Mock).mock.calls[0];
        // The backend reports age from this field, so a fresh clock read here
        // would make every position look newer than the fix actually was.
        expect(published).toEqual(READING);
        expect(published.recordedAt).toBe(READING.recordedAt);
    });

    it('walks the driver through the whole sequence of states', async () => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies();

        await runPublishCycle(recorder.update, dependencies);

        expect(recorder.statuses()).toEqual([
            'REQUESTING',
            'AVAILABLE',
            'PUBLISHING',
            'PUBLISHED',
        ]);
        expect(recorder.last().location).toEqual(READING);
    });
});

// ==================================================================
// NO POSITION MEANS NO PUBLISH
// ==================================================================
describe('runPublishCycle - the phone cannot say where it is', () => {
    it.each([
        ['permission refused', 'PERMISSION_DENIED', 'PERMISSION_DENIED'],
        ['location switched off', 'LOCATION_SERVICES_DISABLED', 'LOCATION_SERVICES_DISABLED'],
        ['no fix', 'POSITION_UNAVAILABLE', 'POSITION_UNAVAILABLE'],
    ] as const)('publishes nothing when %s', async (_label, reason, status) => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies({
            readLocation: jest.fn().mockRejectedValue(new PhoneLocationError(reason)),
        });

        const outcome = await runPublishCycle(recorder.update, dependencies);

        expect(outcome).toBe('LOCATION_UNAVAILABLE');
        expect(recorder.last().status).toBe(status);
        // A failed fix must not become a request. There is no position to send,
        // and no substitute for one.
        expect(dependencies.publish).not.toHaveBeenCalled();
        // It does not even reach the session: nothing to publish means nothing
        // to publish as.
        expect(dependencies.readSession).not.toHaveBeenCalled();
    });

    it('never leaves a stand-in position behind after a failure', async () => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies({
            readLocation: jest.fn().mockRejectedValue(new PhoneLocationError('POSITION_UNAVAILABLE')),
        });

        await runPublishCycle(recorder.update, dependencies);

        expect(recorder.last().location).toBeNull();
    });

    it('does not throw when the location service fails in an unexpected way', async () => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies({
            readLocation: jest.fn().mockRejectedValue(new Error('something native')),
        });

        // A loop must not be killable by one bad tick.
        await expect(runPublishCycle(recorder.update, dependencies)).resolves.toBe(
            'LOCATION_UNAVAILABLE'
        );
        expect(recorder.last().status).toBe('UNKNOWN_ERROR');
        expect(dependencies.publish).not.toHaveBeenCalled();
    });
});

// ==================================================================
// NO SESSION MEANS NO REQUEST
// ==================================================================
describe('runPublishCycle - nothing to publish as', () => {
    it('sends nothing when no bus is signed in', async () => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies({
            readSession: jest.fn().mockResolvedValue(null),
        });

        const outcome = await runPublishCycle(recorder.update, dependencies);

        expect(outcome).toBe('NOT_SIGNED_IN');
        expect(recorder.last().status).toBe('NOT_SIGNED_IN');
        expect(dependencies.publish).not.toHaveBeenCalled();
    });

    it('treats unreadable session storage as no session rather than a crash', async () => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies({
            readSession: jest.fn().mockRejectedValue(new Error('keystore unavailable')),
        });

        await expect(runPublishCycle(recorder.update, dependencies)).resolves.toBe('NOT_SIGNED_IN');
        expect(dependencies.publish).not.toHaveBeenCalled();
    });

    it('keeps the reading on screen — the position was real, only unsendable', async () => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies({
            readSession: jest.fn().mockResolvedValue(null),
        });

        await runPublishCycle(recorder.update, dependencies);

        expect(recorder.last().location).toEqual(READING);
    });
});

// ==================================================================
// A PUBLISH THAT FAILS
// ==================================================================
describe('runPublishCycle - the reading could not be delivered', () => {
    it.each([
        ['NETWORK_UNAVAILABLE'],
        ['PUBLISH_FAILED'],
        ['NOT_AUTHORISED'],
        ['BUS_NOT_FOUND'],
        ['INVALID_LOCATION'],
    ] as const)('reports %s as worth retrying', async (reason) => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies({
            publish: jest.fn().mockRejectedValue(new PublishLocationError(reason)),
        });

        const outcome = await runPublishCycle(recorder.update, dependencies);

        expect(outcome).toBe('PUBLISH_FAILED');
        expect(recorder.last().status).toBe('PUBLISH_FAILED');
    });

    it('separates a signed-out phone, which retrying cannot fix', async () => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies({
            publish: jest.fn().mockRejectedValue(new PublishLocationError('NOT_AUTHENTICATED')),
        });

        const outcome = await runPublishCycle(recorder.update, dependencies);

        // The outcome has to agree with the state, or a loop would keep
        // retrying a request the server will refuse every time.
        expect(outcome).toBe('NOT_SIGNED_IN');
        expect(recorder.last().status).toBe('NOT_SIGNED_IN');
    });

    it('does not throw when publishing fails in an unexpected way', async () => {
        const recorder = stateRecorder();
        const { dependencies } = workingDependencies({
            publish: jest.fn().mockRejectedValue(new Error('unclassified')),
        });

        await expect(runPublishCycle(recorder.update, dependencies)).resolves.toBe('PUBLISH_FAILED');
    });
});
