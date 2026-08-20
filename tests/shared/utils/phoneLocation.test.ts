// The driver's phone as a GPS source (MOV-263).
//
// This module is the only thing standing between the location hardware and a
// bus position a passenger will eventually see, so what matters is what it does
// when the hardware does NOT cooperate: it must fail, distinguishably, and it
// must never invent a coordinate to fill the gap.
//
// expo-location is mocked at the module boundary. It is a native module and
// cannot load under this project's `testEnvironment: node`, and none of these
// need a real handset.
//
// The coordinates below are ordinary geographic test data, not credentials.

import { PhoneLocationError, getCurrentPhoneLocation } from '../../../src/shared/utils/phoneLocation';

const mockRequestPermissions = jest.fn();
const mockHasServicesEnabled = jest.fn();
const mockGetCurrentPosition = jest.fn();

jest.mock('expo-location', () => ({
    requestForegroundPermissionsAsync: () => mockRequestPermissions(),
    hasServicesEnabledAsync: () => mockHasServicesEnabled(),
    getCurrentPositionAsync: (options: unknown) => mockGetCurrentPosition(options),
    Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
}));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
const FIX_TIME = Date.parse('2026-08-20T09:05:00.000Z');

/** A reading shaped exactly as expo-location returns one. */
function deviceReading(overrides: Record<string, any> = {}) {
    return {
        coords: {
            latitude: 6.9,
            longitude: 79.9,
            accuracy: 8,
            altitude: 12,
            altitudeAccuracy: 5,
            heading: 90,
            speed: 7.5,
            ...(overrides.coords ?? {}),
        },
        // `in` rather than an undefined check, so a test can genuinely remove
        // the timestamp instead of silently getting the default back.
        timestamp: 'timestamp' in overrides ? overrides.timestamp : FIX_TIME,
    };
}

/** Everything working: permission granted, services on, a valid fix. */
function deviceReady(reading = deviceReading()) {
    mockRequestPermissions.mockResolvedValue({ granted: true, status: 'granted', canAskAgain: true });
    mockHasServicesEnabled.mockResolvedValue(true);
    mockGetCurrentPosition.mockResolvedValue(reading);
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ==================================================================
// A SUCCESSFUL READING
// ==================================================================
describe('getCurrentPhoneLocation - a reading from the handset', () => {
    it('returns the position the device reported', async () => {
        deviceReady();

        await expect(getCurrentPhoneLocation()).resolves.toEqual({
            latitude: 6.9,
            longitude: 79.9,
            recordedAt: '2026-08-20T09:05:00.000Z',
        });
    });

    it('returns exactly the three fields the ingestion endpoint accepts', async () => {
        deviceReady();

        const location = await getCurrentPhoneLocation();

        // Speed, heading, altitude and accuracy are all available from the
        // device and all deliberately dropped: the stored vehicle location has
        // no place for them, so carrying them further would be dead weight.
        expect(Object.keys(location).sort()).toEqual(['latitude', 'longitude', 'recordedAt']);
    });

    it('timestamps the fix, not the moment the reading was asked for', async () => {
        // The backend measures how current a position is from recordedAt, so
        // this has to be when the satellite fix happened.
        deviceReady(deviceReading({ timestamp: Date.parse('2026-08-20T08:30:00.000Z') }));

        const { recordedAt } = await getCurrentPhoneLocation();

        expect(recordedAt).toBe('2026-08-20T08:30:00.000Z');
    });

    it('falls back to the current time when the device reports no fix time', async () => {
        deviceReady(deviceReading({ timestamp: undefined }));

        const before = Date.now();
        const { recordedAt } = await getCurrentPhoneLocation();
        const after = Date.now();

        // A stand-in for a moment that has just happened — never applied to the
        // coordinates themselves.
        const recorded = Date.parse(recordedAt);
        expect(recorded).toBeGreaterThanOrEqual(before);
        expect(recorded).toBeLessThanOrEqual(after);
    });

    it('asks for a road-vehicle accuracy rather than the navigation profile', async () => {
        deviceReady();

        await getCurrentPhoneLocation();

        // Accuracy.High (4) — about ten metres. BestForNavigation (6) would
        // drain a phone that has to last a whole shift.
        expect(mockGetCurrentPosition).toHaveBeenCalledWith({ accuracy: 4 });
    });

    it('requests foreground permission only, never background', async () => {
        deviceReady();

        await getCurrentPhoneLocation();

        expect(mockRequestPermissions).toHaveBeenCalledTimes(1);
        // Continuous and background tracking belong to MOV-262; asking for that
        // permission here would prompt the driver for access this feature does
        // not use.
        expect(jest.requireMock('expo-location')).not.toHaveProperty(
            'requestBackgroundPermissionsAsync'
        );
    });
});

// ==================================================================
// WHEN THE PHONE WILL NOT SAY
// ==================================================================
describe('getCurrentPhoneLocation - failures', () => {
    it('reports denied permission distinguishably', async () => {
        mockRequestPermissions.mockResolvedValue({
            granted: false,
            status: 'denied',
            canAskAgain: false,
        });

        await expect(getCurrentPhoneLocation()).rejects.toMatchObject({
            name: 'PhoneLocationError',
            reason: 'PERMISSION_DENIED',
        });

        // Nothing further is attempted once permission is refused.
        expect(mockGetCurrentPosition).not.toHaveBeenCalled();
    });

    it('reports location services being switched off separately from permission', async () => {
        mockRequestPermissions.mockResolvedValue({ granted: true, status: 'granted' });
        mockHasServicesEnabled.mockResolvedValue(false);

        // Two different problems the driver fixes in two different places, so
        // they cannot share one reason code.
        await expect(getCurrentPhoneLocation()).rejects.toMatchObject({
            reason: 'LOCATION_SERVICES_DISABLED',
        });
        expect(mockGetCurrentPosition).not.toHaveBeenCalled();
    });

    it('reports a position that could not be obtained', async () => {
        mockRequestPermissions.mockResolvedValue({ granted: true, status: 'granted' });
        mockHasServicesEnabled.mockResolvedValue(true);
        mockGetCurrentPosition.mockRejectedValue(new Error('Location request timed out'));

        await expect(getCurrentPhoneLocation()).rejects.toMatchObject({
            reason: 'POSITION_UNAVAILABLE',
        });
    });

    it('survives the permission prompt itself throwing', async () => {
        mockRequestPermissions.mockRejectedValue(new Error('Location services unavailable'));

        // An unsupported platform or a missing native config must surface as a
        // handled failure, not as an unrecognised crash in the caller.
        await expect(getCurrentPhoneLocation()).rejects.toBeInstanceOf(PhoneLocationError);
    });

    it('survives the services check itself throwing', async () => {
        mockRequestPermissions.mockResolvedValue({ granted: true, status: 'granted' });
        mockHasServicesEnabled.mockRejectedValue(new Error('not implemented'));

        await expect(getCurrentPhoneLocation()).rejects.toMatchObject({
            reason: 'LOCATION_SERVICES_DISABLED',
        });
    });

    it.each([
        ['no coords object at all', {}],
        ['a missing latitude', { coords: { latitude: undefined, longitude: 79.9 } }],
        ['a NaN latitude', { coords: { latitude: Number.NaN, longitude: 79.9 } }],
        ['an infinite longitude', { coords: { latitude: 6.9, longitude: Number.POSITIVE_INFINITY } }],
        ['a latitude past the pole', { coords: { latitude: 91, longitude: 79.9 } }],
        ['a longitude past the meridian', { coords: { latitude: 6.9, longitude: 181 } }],
    ])('refuses a reading with %s', async (_label, reading) => {
        mockRequestPermissions.mockResolvedValue({ granted: true, status: 'granted' });
        mockHasServicesEnabled.mockResolvedValue(true);
        mockGetCurrentPosition.mockResolvedValue(reading);

        // A value that is not a real point on the Earth is not a position, and
        // must not travel any further towards a passenger's map.
        await expect(getCurrentPhoneLocation()).rejects.toMatchObject({
            reason: 'POSITION_UNAVAILABLE',
        });
    });

    it('never substitutes a coordinate when it cannot get one', async () => {
        mockRequestPermissions.mockResolvedValue({ granted: false, status: 'denied' });

        // The one behaviour this module exists to guarantee: a failure is a
        // failure. Nothing resolves with a stand-in position.
        const outcome = await getCurrentPhoneLocation().then(
            (value) => ({ resolved: true, value }),
            () => ({ resolved: false, value: undefined })
        );

        expect(outcome.resolved).toBe(false);
    });
});

// ==================================================================
// WHAT A CALLER CAN DO WITH A FAILURE
// ==================================================================
describe('PhoneLocationError', () => {
    it('carries a message safe to show a driver, not the native one', async () => {
        const nativeError = new Error('kCLErrorDomain error 1');
        mockRequestPermissions.mockResolvedValue({ granted: true, status: 'granted' });
        mockHasServicesEnabled.mockResolvedValue(true);
        mockGetCurrentPosition.mockRejectedValue(nativeError);

        const error = await getCurrentPhoneLocation().catch((caught) => caught);

        expect(error).toBeInstanceOf(PhoneLocationError);
        expect(error.message).not.toContain('kCLErrorDomain');
        expect(error.message).toMatch(/location/i);
        // The native error is kept for diagnostics, just not shown.
        expect(error.cause).toBe(nativeError);
    });

    it('is an ordinary Error, so existing catch handling still works', async () => {
        mockRequestPermissions.mockResolvedValue({ granted: false, status: 'denied' });

        const error = await getCurrentPhoneLocation().catch((caught) => caught);

        expect(error).toBeInstanceOf(Error);
        expect(typeof error.message).toBe('string');
        expect(error.message.length).toBeGreaterThan(0);
    });

    it('gives each failure its own reason code for the states UI to branch on', async () => {
        const reasons = new Set<string>();

        mockRequestPermissions.mockResolvedValue({ granted: false, status: 'denied' });
        reasons.add((await getCurrentPhoneLocation().catch((e) => e)).reason);

        mockRequestPermissions.mockResolvedValue({ granted: true, status: 'granted' });
        mockHasServicesEnabled.mockResolvedValue(false);
        reasons.add((await getCurrentPhoneLocation().catch((e) => e)).reason);

        mockHasServicesEnabled.mockResolvedValue(true);
        mockGetCurrentPosition.mockRejectedValue(new Error('no signal'));
        reasons.add((await getCurrentPhoneLocation().catch((e) => e)).reason);

        // MOV-264 needs to tell these three apart to tell the driver what to do.
        expect([...reasons].sort()).toEqual([
            'LOCATION_SERVICES_DISABLED',
            'PERMISSION_DENIED',
            'POSITION_UNAVAILABLE',
        ]);
    });
});
