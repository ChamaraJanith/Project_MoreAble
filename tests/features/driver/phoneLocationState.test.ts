// The location states a bus driver sees (MOV-264).
//
// Two things matter here and neither is cosmetic. First, the three failures
// must stay told apart: a driver sent to the wrong settings screen, or asked to
// grant a permission they already granted, cannot get the bus tracking again.
// Second, nothing internal may reach the screen — not a reason code, not a
// native error string.
//
// The card itself is a thin shell around these functions. It cannot be rendered
// in tests: the project runs `testEnvironment: node` with no React renderer
// configured, and one was not added for this story. So the decisions live here
// where they can be covered, and the untested part is kept as small as
// possible. See the MOV-264 report.
//
// Coordinates below are ordinary geographic test data, not credentials.

import { PublishLocationError } from '../../../src/features/driver/api/busLocationApi';
import {
    PhoneLocationState,
    busNotSignedIn,
    describePhoneLocationState,
    initialPhoneLocationState,
    isLocationRequestInFlight,
    locationPublishFailed,
    locationPublishStarted,
    locationPublished,
    locationReceived,
    locationRequestFailed,
    locationRequestStarted,
} from '../../../src/features/driver/utils/phoneLocationState';
import { PhoneLocation, PhoneLocationError } from '../../../src/shared/utils/phoneLocation';

// PhoneLocationError is a real class here — the state functions use `instanceof`
// to tell a classified failure from anything else — and importing it pulls in
// expo-location, which is native ESM that Jest cannot load. Stubbed at the same
// module boundary the MOV-263 suite uses. Nothing in this file calls it.
// PublishLocationError is a real class here — the publish transition uses
// `instanceof` — and its module reads API_BASE_URL, which imports
// expo-constants. Stubbed the same way the busLocationApi suite does.
jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: jest.fn(),
    hasServicesEnabledAsync: jest.fn(),
    getCurrentPositionAsync: jest.fn(),
    Accuracy: { High: 4 },
}));

const READING: PhoneLocation = {
    latitude: 6.9,
    longitude: 79.9,
    recordedAt: '2026-08-20T09:05:00.000Z',
};

/** Every word the card can put on screen, for the "nothing internal" checks. */
function allCopy(state: PhoneLocationState): string {
    const view = describePhoneLocationState(state);
    return [
        view.title,
        view.description,
        view.primaryAction?.label ?? '',
        view.secondaryAction?.label ?? '',
    ].join(' ');
}

const EVERY_STATE: PhoneLocationState[] = [
    initialPhoneLocationState,
    locationRequestStarted(initialPhoneLocationState),
    locationReceived(READING),
    locationRequestFailed(new PhoneLocationError('PERMISSION_DENIED', { canAskAgain: true })),
    locationRequestFailed(new PhoneLocationError('PERMISSION_DENIED', { canAskAgain: false })),
    locationRequestFailed(new PhoneLocationError('LOCATION_SERVICES_DISABLED')),
    locationRequestFailed(new PhoneLocationError('POSITION_UNAVAILABLE')),
    locationRequestFailed(new Error('something else entirely')),
    locationPublishStarted(locationReceived(READING)),
    locationPublished(locationReceived(READING)),
    locationPublishFailed(locationReceived(READING), new PublishLocationError('PUBLISH_FAILED')),
    busNotSignedIn(locationReceived(READING)),
];

// ==================================================================
// PUBLISHING (MOV-265)
// ==================================================================
describe('publishing the reading', () => {
    const withReading = locationReceived(READING);

    it('keeps the position on screen while it is being sent', () => {
        const state = locationPublishStarted(withReading);

        // The position was really obtained; only the sharing of it is still in
        // doubt, so it stays visible.
        expect(state.status).toBe('PUBLISHING');
        expect(state.location).toEqual(READING);
        expect(isLocationRequestInFlight(state)).toBe(true);
    });

    it('refuses a second attempt while one is already publishing', () => {
        // The in-flight guard has to cover this half of the flow too, or a
        // second tap sends the same position twice.
        expect(isLocationRequestInFlight(locationPublishStarted(withReading))).toBe(true);
        expect(describePhoneLocationState(locationPublishStarted(withReading)).primaryAction)
            .toBeUndefined();
    });

    it('confirms to the driver when passengers can see the bus', () => {
        const view = describePhoneLocationState(locationPublished(withReading));

        expect(view.tone).toBe('success');
        expect(view.title).toMatch(/shared/i);
        expect(view.primaryAction?.kind).toBe('REQUEST');
    });

    it('offers a retry when sending failed', () => {
        const state = locationPublishFailed(withReading, new PublishLocationError('PUBLISH_FAILED'));
        const view = describePhoneLocationState(state);

        expect(state.status).toBe('PUBLISH_FAILED');
        expect(view.primaryAction?.kind).toBe('REQUEST');
        // Said plainly, so a driver does not assume the bus is being tracked.
        expect(view.description).toMatch(/not see it|could not be sent/i);
    });

    it('sends the driver back to sign in when the session has gone, not to a retry', () => {
        const state = locationPublishFailed(
            withReading,
            new PublishLocationError('NOT_AUTHENTICATED')
        );
        const view = describePhoneLocationState(state);

        // Retrying can never fix a signed-out bus, so no retry is offered.
        expect(state.status).toBe('NOT_SIGNED_IN');
        expect(view.primaryAction?.kind).toBe('SIGN_IN');
    });

    it('treats a phone with no bus session the same way', () => {
        expect(busNotSignedIn(withReading).status).toBe('NOT_SIGNED_IN');
        expect(
            describePhoneLocationState(busNotSignedIn(withReading)).primaryAction?.kind
        ).toBe('SIGN_IN');
    });

    it('never reports a location problem when publishing was what failed', () => {
        const view = describePhoneLocationState(
            locationPublishFailed(withReading, new PublishLocationError('NETWORK_UNAVAILABLE'))
        );

        // The GPS worked. Blaming permissions or the signal would send the
        // driver to fix something that is not broken.
        expect(view.description).not.toMatch(/permission|gps signal|location services/i);
    });
});

// ==================================================================
// TRANSITIONS
// ==================================================================
describe('location state transitions', () => {
    it('starts with nothing requested, so opening the screen prompts nobody', () => {
        // The dashboard must not set off a permission dialog just by being
        // opened; the driver presses a button first.
        expect(initialPhoneLocationState).toEqual({ status: 'IDLE', location: null });
        expect(describePhoneLocationState(initialPhoneLocationState).isBusy).toBe(false);
    });

    it('marks a request as in flight', () => {
        const state = locationRequestStarted(initialPhoneLocationState);

        expect(state.status).toBe('REQUESTING');
        expect(isLocationRequestInFlight(state)).toBe(true);
        expect(describePhoneLocationState(state).isBusy).toBe(true);
    });

    it('keeps the previous reading on screen while a new one is fetched', () => {
        const refreshing = locationRequestStarted(locationReceived(READING));

        // Blanking the card during a refresh would be a worse experience than
        // leaving the last known reading visible.
        expect(refreshing.location).toEqual(READING);
    });

    it('holds the reading that arrived, unchanged', () => {
        const state = locationReceived(READING);

        expect(state.status).toBe('AVAILABLE');
        expect(state.location).toEqual(READING);
    });

    it('offers no action at all while a request is running', () => {
        const view = describePhoneLocationState(locationRequestStarted(initialPhoneLocationState));

        // Nothing to press means no second permission prompt on top of the
        // first, whatever the driver does.
        expect(view.primaryAction).toBeUndefined();
        expect(view.secondaryAction).toBeUndefined();
    });

    it('drops the previous reading once a request fails', () => {
        const failed = locationRequestFailed(new PhoneLocationError('POSITION_UNAVAILABLE'));

        // The bus may have moved since. Showing the old position as if it were
        // current is exactly what live status must never do.
        expect(failed.location).toBeNull();
    });
});

// ==================================================================
// THE THREE FAILURES STAY TOLD APART
// ==================================================================
describe('failures map to their own state', () => {
    it.each([
        ['PERMISSION_DENIED', 'PERMISSION_DENIED'],
        ['LOCATION_SERVICES_DISABLED', 'LOCATION_SERVICES_DISABLED'],
        ['POSITION_UNAVAILABLE', 'POSITION_UNAVAILABLE'],
    ] as const)('turns %s into the matching state', (reason, expected) => {
        expect(locationRequestFailed(new PhoneLocationError(reason)).status).toBe(expected);
    });

    it('never reports a permission problem the driver does not have', () => {
        const servicesOff = locationRequestFailed(
            new PhoneLocationError('LOCATION_SERVICES_DISABLED')
        );
        const noFix = locationRequestFailed(new PhoneLocationError('POSITION_UNAVAILABLE'));

        expect(servicesOff.status).not.toBe('PERMISSION_DENIED');
        expect(noFix.status).not.toBe('PERMISSION_DENIED');
        expect(allCopy(servicesOff)).not.toMatch(/permission/i);
        expect(allCopy(noFix)).not.toMatch(/permission/i);
    });

    it('gives each failure its own words, so two states never read alike', () => {
        const titles = [
            allCopy(locationRequestFailed(new PhoneLocationError('PERMISSION_DENIED'))),
            allCopy(locationRequestFailed(new PhoneLocationError('LOCATION_SERVICES_DISABLED'))),
            allCopy(locationRequestFailed(new PhoneLocationError('POSITION_UNAVAILABLE'))),
        ];

        expect(new Set(titles).size).toBe(3);
    });

    it('falls back to a general failure rather than guessing a cause', () => {
        const state = locationRequestFailed(new Error('unclassified'));

        expect(state.status).toBe('UNKNOWN_ERROR');
        expect(describePhoneLocationState(state).primaryAction?.kind).toBe('REQUEST');
    });

    it.each([
        ['a thrown string', 'not an error object'],
        ['null', null],
        ['undefined', undefined],
    ])('survives %s being thrown', (_label, thrown) => {
        // A caller must never be able to crash the dashboard by rejecting with
        // something unexpected.
        expect(() => locationRequestFailed(thrown)).not.toThrow();
        expect(locationRequestFailed(thrown).status).toBe('UNKNOWN_ERROR');
    });
});

// ==================================================================
// WHICH BUTTON ACTUALLY HELPS
// ==================================================================
describe('the offered action matches what will work', () => {
    it('offers to ask again while the system will still prompt', () => {
        const view = describePhoneLocationState(
            locationRequestFailed(new PhoneLocationError('PERMISSION_DENIED', { canAskAgain: true }))
        );

        expect(view.primaryAction?.kind).toBe('REQUEST');
        // Settings stays available as a way through if the prompt is dismissed.
        expect(view.secondaryAction?.kind).toBe('OPEN_SETTINGS');
    });

    it('offers only settings once the system will not prompt again', () => {
        const view = describePhoneLocationState(
            locationRequestFailed(
                new PhoneLocationError('PERMISSION_DENIED', { canAskAgain: false })
            )
        );

        // An "Allow" button here would do literally nothing when pressed.
        expect(view.primaryAction?.kind).toBe('OPEN_SETTINGS');
        expect(view.secondaryAction).toBeUndefined();
        expect(view.description).toMatch(/settings/i);
    });

    it('assumes the prompt is still possible when the platform did not say', () => {
        // canAskAgain is passed through from the platform and may be absent.
        // Only an explicit `false` removes the option to ask again.
        const view = describePhoneLocationState(
            locationRequestFailed(new PhoneLocationError('PERMISSION_DENIED'))
        );

        expect(view.primaryAction?.kind).toBe('REQUEST');
    });

    it('sends the driver to settings when location is off device-wide', () => {
        const view = describePhoneLocationState(
            locationRequestFailed(new PhoneLocationError('LOCATION_SERVICES_DISABLED'))
        );

        expect(view.primaryAction?.kind).toBe('OPEN_SETTINGS');
        // And back again afterwards without leaving the screen.
        expect(view.secondaryAction?.kind).toBe('REQUEST');
        expect(view.description).toMatch(/phone setting/i);
    });

    it('offers a plain retry when only the fix failed', () => {
        const view = describePhoneLocationState(
            locationRequestFailed(new PhoneLocationError('POSITION_UNAVAILABLE'))
        );

        // Nothing is misconfigured, so sending the driver to settings would
        // waste their time.
        expect(view.primaryAction?.kind).toBe('REQUEST');
        expect(view.secondaryAction).toBeUndefined();
    });

    it('lets a working location be refreshed', () => {
        const view = describePhoneLocationState(locationReceived(READING));

        expect(view.tone).toBe('success');
        expect(view.primaryAction?.kind).toBe('REQUEST');
    });
});

// ==================================================================
// WHAT REACHES THE DRIVER
// ==================================================================
describe('nothing internal is shown to the driver', () => {
    it.each(EVERY_STATE)('keeps reason codes out of state %#', (state) => {
        const copy = allCopy(state);

        expect(copy).not.toMatch(/PERMISSION_DENIED/);
        expect(copy).not.toMatch(/LOCATION_SERVICES_DISABLED/);
        expect(copy).not.toMatch(/POSITION_UNAVAILABLE/);
        expect(copy).not.toMatch(/UNKNOWN_ERROR/);
        expect(copy).not.toMatch(/_/);
    });

    it('never surfaces the native error text', () => {
        const native = new Error('kCLErrorDomain error 1');
        const state = locationRequestFailed(
            new PhoneLocationError('POSITION_UNAVAILABLE', { cause: native })
        );

        expect(allCopy(state)).not.toContain('kCLErrorDomain');
    });

    it.each(EVERY_STATE)('always gives state %# something to read', (state) => {
        const view = describePhoneLocationState(state);

        expect(view.title.length).toBeGreaterThan(0);
        expect(view.description.length).toBeGreaterThan(0);
    });

    it.each(EVERY_STATE)('always offers a way forward from state %#, unless busy', (state) => {
        const view = describePhoneLocationState(state);

        // A driver must never be left looking at a message with no button.
        expect(view.isBusy || !!view.primaryAction).toBe(true);
    });

    it('distinguishes states by icon and title, not by colour alone', () => {
        const failures = EVERY_STATE.map(describePhoneLocationState).filter(
            (view) => view.tone === 'warning'
        );

        // Every warning shares a tone, so the tone cannot be what tells them
        // apart — each still needs its own wording.
        expect(failures.length).toBeGreaterThan(1);
        expect(new Set(failures.map((view) => view.title)).size).toBe(failures.length);
        expect(failures.every((view) => view.icon.length > 0)).toBe(true);
    });
});
