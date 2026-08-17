// The GPS ingestion endpoint (MOV-121).
//
// This is the only way a vehicle position enters the system, so what it accepts
// defines whether the live data downstream can be trusted. These cover the
// contract: who may write, what a valid observation is, and that a position is
// stored against the right bus and replaces that bus's previous one.

import {
    PUT as reportLocation,
    isValidLatitude,
    isValidLongitude,
    normaliseRecordedAt,
} from '../../../app/api/buses/[busId]/location+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// Only the token check is stubbed; the header parsing in authMiddleware and the
// 401 helper both run for real.
jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
const BUS_ID = 'BUS-00001';

const OPERATOR = {
    uid: 'firebase-uid-admin',
    passengerId: 'ADM-2026-00001',
    role: 'ADMIN',
    email: 'admin@moreable.lk',
};

const PASSENGER = { ...OPERATOR, role: 'PASSENGER', passengerId: 'PAS-2026-00002' };

/** A position somewhere on the Kaduwela - Kollupitiya corridor. */
const validLocation = {
    latitude: 6.9061,
    longitude: 79.9558,
    recordedAt: '2026-08-17T09:05:00.000Z',
};

function locationRequest(
    body: unknown,
    { busId = BUS_ID, authenticated = true }: { busId?: string; authenticated?: boolean } = {}
): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authenticated) headers.Authorization = 'Bearer test-token';

    return new Request(`http://localhost/api/buses/${busId}/location`, {
        method: 'PUT',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

const putContext = (busId: string = BUS_ID) => ({ params: { busId } });

function storedBus(overrides: Record<string, any> = {}) {
    return {
        id: BUS_ID,
        busId: BUS_ID,
        numberPlate: 'NB-1234',
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        seatCapacity: 54,
        status: 'ACTIVE',
        ...overrides,
    };
}

/** Reads a position back through the fake's own API. */
async function readStoredLocation(db: any, busId: string = BUS_ID) {
    const doc = await db.collection('vehicleLocations').doc(busId).get();
    return doc.data();
}

const seededDb = () => createFakeFirestore({ buses: [storedBus()] });

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockResolvedValue(OPERATOR);
});

// ==================================================================
// ACCEPTING A POSITION
// ==================================================================
describe('PUT /api/buses/:busId/location - accepting a report', () => {
    it('accepts a valid position from an operator', async () => {
        mockGetAdminDb.mockReturnValue(seededDb());

        const response = await reportLocation(locationRequest(validLocation), putContext());
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.location).toEqual({
            busId: BUS_ID,
            latitude: 6.9061,
            longitude: 79.9558,
            recordedAt: '2026-08-17T09:05:00.000Z',
        });
    });

    it('stores the position against that bus', async () => {
        const db = seededDb();
        mockGetAdminDb.mockReturnValue(db);

        await reportLocation(locationRequest(validLocation), putContext());

        expect(await readStoredLocation(db)).toMatchObject({
            busId: BUS_ID,
            latitude: 6.9061,
            longitude: 79.9558,
        });
    });

    it('replaces the previous position rather than accumulating history', async () => {
        const db = seededDb();
        mockGetAdminDb.mockReturnValue(db);

        await reportLocation(locationRequest(validLocation), putContext());
        await reportLocation(
            locationRequest({
                latitude: 6.9147,
                longitude: 79.8778,
                recordedAt: '2026-08-17T09:20:00.000Z',
            }),
            putContext()
        );

        const stored = await readStoredLocation(db);
        expect(stored.latitude).toBe(6.9147);
        expect(stored.recordedAt).toBe('2026-08-17T09:20:00.000Z');

        const snapshot = await db.collection('vehicleLocations').get();
        expect(snapshot.docs).toHaveLength(1);
    });

    it('keeps each bus position separate', async () => {
        const db = createFakeFirestore({
            buses: [storedBus(), storedBus({ id: 'BUS-00002', busId: 'BUS-00002' })],
        });
        mockGetAdminDb.mockReturnValue(db);

        await reportLocation(locationRequest(validLocation), putContext());
        await reportLocation(
            locationRequest(
                { latitude: 6.9333, longitude: 79.9833, recordedAt: '2026-08-17T09:06:00.000Z' },
                { busId: 'BUS-00002' }
            ),
            putContext('BUS-00002')
        );

        expect((await readStoredLocation(db)).latitude).toBe(6.9061);
        expect((await readStoredLocation(db, 'BUS-00002')).latitude).toBe(6.9333);
    });

    it('stores the position only, never a copy of the vehicle record', async () => {
        const db = seededDb();
        mockGetAdminDb.mockReturnValue(db);

        await reportLocation(locationRequest(validLocation), putContext());

        const stored = await readStoredLocation(db);

        // The fleet record stays the single source of truth for the vehicle, so
        // the position references it by id and copies nothing from it.
        expect(stored.numberPlate).toBeUndefined();
        expect(stored.busModel).toBeUndefined();
        expect(stored.manufacturer).toBeUndefined();
        expect(stored.seatCapacity).toBeUndefined();
        expect(stored.status).toBeUndefined();
        expect(stored).toMatchObject({
            busId: BUS_ID,
            latitude: 6.9061,
            longitude: 79.9558,
            recordedAt: '2026-08-17T09:05:00.000Z',
        });
    });

    it('normalises the reported fix time to ISO 8601', async () => {
        const db = seededDb();
        mockGetAdminDb.mockReturnValue(db);

        await reportLocation(
            locationRequest({ ...validLocation, recordedAt: '2026-08-17T09:05:00Z' }),
            putContext()
        );

        expect((await readStoredLocation(db)).recordedAt).toBe('2026-08-17T09:05:00.000Z');
    });

    it('leaves the vehicle record untouched', async () => {
        const db = seededDb();
        mockGetAdminDb.mockReturnValue(db);

        await reportLocation(locationRequest(validLocation), putContext());

        const bus = (await db.collection('buses').doc(BUS_ID).get()).data() ?? {};
        expect(bus.numberPlate).toBe('NB-1234');
        expect(bus.status).toBe('ACTIVE');
        expect(bus.latitude).toBeUndefined();
    });
});

// ==================================================================
// AUTHORISATION
// ==================================================================
describe('PUT /api/buses/:busId/location - authorisation', () => {
    it('rejects an unauthenticated report', async () => {
        mockGetAdminDb.mockReturnValue(seededDb());

        const response = await reportLocation(
            locationRequest(validLocation, { authenticated: false }),
            putContext()
        );

        expect(response.status).toBe(401);
    });

    it('rejects an invalid or expired token', async () => {
        mockVerifyToken.mockResolvedValue(null);
        mockGetAdminDb.mockReturnValue(seededDb());

        const response = await reportLocation(locationRequest(validLocation), putContext());

        expect(response.status).toBe(401);
    });

    it('rejects a passenger trying to move a bus', async () => {
        mockVerifyToken.mockResolvedValue(PASSENGER);
        const db = seededDb();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reportLocation(locationRequest(validLocation), putContext());
        const json = await response.json();

        expect(response.status).toBe(403);
        expect(json.message).toMatch(/operator/i);
        expect(await readStoredLocation(db)).toBeUndefined();
    });
});

// ==================================================================
// VALIDATION
// ==================================================================
describe('PUT /api/buses/:busId/location - validation', () => {
    it.each([
        ['above the pole', 90.1],
        ['below the pole', -90.1],
        ['not a number', '6.9061'],
        ['missing', undefined],
        ['NaN', Number.NaN],
        ['null', null],
    ])('rejects a latitude that is %s', async (_label, latitude) => {
        mockGetAdminDb.mockReturnValue(seededDb());

        const response = await reportLocation(
            locationRequest({ ...validLocation, latitude }),
            putContext()
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/latitude/i);
    });

    it.each([
        ['beyond the meridian', 180.1],
        ['below the meridian', -180.1],
        ['not a number', '79.9558'],
        ['missing', undefined],
        ['Infinity', Number.POSITIVE_INFINITY],
    ])('rejects a longitude that is %s', async (_label, longitude) => {
        mockGetAdminDb.mockReturnValue(seededDb());

        const response = await reportLocation(
            locationRequest({ ...validLocation, longitude }),
            putContext()
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/longitude/i);
    });

    it.each([
        ['missing', undefined],
        ['empty', ''],
        ['unparsable', 'yesterday morning'],
        ['a number', 1755421500000],
    ])('rejects a recordedAt that is %s', async (_label, recordedAt) => {
        mockGetAdminDb.mockReturnValue(seededDb());

        const response = await reportLocation(
            locationRequest({ ...validLocation, recordedAt }),
            putContext()
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/recordedAt/i);
    });

    it('accepts the boundary coordinates', async () => {
        mockGetAdminDb.mockReturnValue(seededDb());

        const response = await reportLocation(
            locationRequest({ ...validLocation, latitude: -90, longitude: 180 }),
            putContext()
        );

        expect(response.status).toBe(200);
    });

    it('rejects a malformed JSON body', async () => {
        mockGetAdminDb.mockReturnValue(seededDb());

        const malformed = new Request(`http://localhost/api/buses/${BUS_ID}/location`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer test-token',
            },
            body: '{"latitude":',
        });

        const response = await reportLocation(malformed, putContext());

        expect(response.status).toBe(400);
    });

    it('writes nothing when validation fails', async () => {
        const db = seededDb();
        mockGetAdminDb.mockReturnValue(db);

        await reportLocation(
            locationRequest({ ...validLocation, latitude: 1000 }),
            putContext()
        );

        expect(await readStoredLocation(db)).toBeUndefined();
    });
});

// ==================================================================
// BUS ASSOCIATION
// ==================================================================
describe('PUT /api/buses/:busId/location - bus association', () => {
    it('refuses a position for a bus that does not exist', async () => {
        const db = seededDb();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reportLocation(
            locationRequest(validLocation, { busId: 'BUS-99999' }),
            putContext('BUS-99999')
        );
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.message).toMatch(/bus not found/i);
        // No orphan record is left behind.
        expect(await readStoredLocation(db, 'BUS-99999')).toBeUndefined();
    });

    it('rejects a missing bus identifier', async () => {
        mockGetAdminDb.mockReturnValue(seededDb());

        const response = await reportLocation(
            new Request('http://localhost/api/buses/location', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer test-token',
                },
                body: JSON.stringify(validLocation),
            })
        );

        expect(response.status).toBe(400);
    });

    it('falls back to the URL path when the router supplies no params', async () => {
        const db = seededDb();
        mockGetAdminDb.mockReturnValue(db);

        const response = await reportLocation(locationRequest(validLocation));

        expect(response.status).toBe(200);
        expect((await readStoredLocation(db)).busId).toBe(BUS_ID);
    });
});

// ==================================================================
// FAILURES
// ==================================================================
describe('PUT /api/buses/:busId/location - failures', () => {
    it('returns 500 when the write fails', async () => {
        mockGetAdminDb.mockReturnValue({
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({ exists: true, data: () => storedBus() }),
                    set: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
                })),
            })),
        });

        const response = await reportLocation(locationRequest(validLocation), putContext());
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.message).toMatch(/failed to update vehicle location/i);
    });
});

// ==================================================================
// VALIDATION HELPERS
// ==================================================================
describe('coordinate and timestamp helpers', () => {
    it('accepts only real latitudes', () => {
        expect(isValidLatitude(0)).toBe(true);
        expect(isValidLatitude(90)).toBe(true);
        expect(isValidLatitude(-90)).toBe(true);
        expect(isValidLatitude(90.0001)).toBe(false);
        expect(isValidLatitude('6.9')).toBe(false);
        expect(isValidLatitude(Number.NaN)).toBe(false);
    });

    it('accepts only real longitudes', () => {
        expect(isValidLongitude(0)).toBe(true);
        expect(isValidLongitude(180)).toBe(true);
        expect(isValidLongitude(-180)).toBe(true);
        expect(isValidLongitude(180.0001)).toBe(false);
        expect(isValidLongitude(Number.NEGATIVE_INFINITY)).toBe(false);
    });

    it('normalises a usable timestamp and rejects the rest', () => {
        expect(normaliseRecordedAt('2026-08-17T09:05:00Z')).toBe('2026-08-17T09:05:00.000Z');
        expect(normaliseRecordedAt('not a time')).toBeNull();
        expect(normaliseRecordedAt('')).toBeNull();
        expect(normaliseRecordedAt(undefined)).toBeNull();
        expect(normaliseRecordedAt(1755421500000)).toBeNull();
    });
});
