// POST /api/reports — accessibility report submission (MOV-142).
//
// Two things this endpoint has to get right, and both are covered below.
//
// The report is filed by whoever the token says it is. passengerId is taken
// from the verified session and never from the request, so a client that sends
// somebody else's passengerId cannot file a report in their name.
//
// And the bus and route references are real. Both stay optional — a passenger
// who does not know which vehicle they were on must still be able to report the
// issue — but a reference that IS supplied is resolved against the fleet before
// anything is written, and the report keeps a snapshot of what it resolved to,
// because a report is a historical record that has to survive the bus being
// retired or the route being renamed.

import { POST as createReport } from '../../../app/api/reports/index+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

// jest.mock is hoisted above the imports by ts-jest, so the route module
// resolves these to the mocks before it runs. No real Firestore is touched.
jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// Only the signature check is stubbed. authenticateRequest itself — the
// Authorization header parsing and the Bearer prefix — runs for real, so the
// unauthenticated cases below exercise the actual middleware.
jest.mock('../../../src/shared/config/jwt', () => ({
    verifyToken: (token: string) => mockVerifyToken(token),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const PASSENGER_A = 'PSG-00001';
const PASSENGER_B = 'PSG-00002';

const SESSION_A = 'session-passenger-a';
const SESSION_B = 'session-passenger-b';
const SESSION_ADMIN = 'session-admin';

const BUS_ID = 'BUS-00007';
const ROUTE_ID = 'R-138-OUT';

/** Verified session payloads, keyed by the token they belong to. */
const SESSIONS: Record<string, Record<string, string>> = {
    [SESSION_A]: {
        uid: 'UID-A',
        passengerId: PASSENGER_A,
        role: 'PASSENGER',
        email: 'passenger.a@example.com',
    },
    [SESSION_B]: {
        uid: 'UID-B',
        passengerId: PASSENGER_B,
        role: 'PASSENGER',
        email: 'passenger.b@example.com',
    },
    [SESSION_ADMIN]: {
        uid: 'UID-ADMIN',
        passengerId: 'ADM-00001',
        role: 'ADMIN',
        email: 'admin@example.com',
    },
};

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

function storedRoute(overrides: Record<string, any> = {}) {
    return {
        id: ROUTE_ID,
        routeId: ROUTE_ID,
        routeNumber: '138',
        routeName: 'Colombo - Kandy',
        direction: 'OUTBOUND',
        startLocation: 'Colombo',
        endLocation: 'Kandy',
        status: 'ACTIVE',
        ...overrides,
    };
}

/** A Firestore double holding the fleet the report form would have offered. */
function seededFirestore(seed: Record<string, any[]> = {}) {
    return createFakeFirestore({
        buses: [storedBus()],
        routes: [storedRoute()],
        reports: [],
        counters: [],
        ...seed,
    });
}

function reportRequest(body: unknown, token?: string): Request {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (token) headers.Authorization = `Bearer ${token}`;

    return new Request('http://localhost/api/reports', {
        method: 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

/** A valid submission carrying nothing optional. */
function validPayload(overrides: Record<string, any> = {}) {
    return {
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        ...overrides,
    };
}

/** The report as it was actually written to Firestore. */
async function storedReport(firestore: any, reportId: string) {
    const doc = await firestore.collection('reports').doc(reportId).get();
    return doc.data();
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
});

// ==================================================================
// Authentication
// ==================================================================
describe('POST /api/reports - authentication', () => {
    it('rejects a request with no Authorization header', async () => {
        mockGetAdminDb.mockReturnValue(seededFirestore());

        const response = await createReport(reportRequest(validPayload()));
        const json = await response.json();

        expect(response.status).toBe(401);
        expect(json.success).toBe(false);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('rejects a token that does not verify', async () => {
        mockGetAdminDb.mockReturnValue(seededFirestore());

        const response = await createReport(reportRequest(validPayload(), 'forged-session'));

        expect(response.status).toBe(401);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
    });

    it('rejects an authenticated caller who is not a passenger', async () => {
        mockGetAdminDb.mockReturnValue(seededFirestore());

        const response = await createReport(reportRequest(validPayload(), SESSION_ADMIN));
        const json = await response.json();

        expect(response.status).toBe(403);
        expect(json.message).toMatch(/only passengers/i);
    });
});

// ==================================================================
// Ownership — the security rule this endpoint exists to hold
// ==================================================================
describe('POST /api/reports - passenger identity', () => {
    it('files the report under the authenticated passenger', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(reportRequest(validPayload(), SESSION_A));
        const json = await response.json();

        expect(response.status).toBe(201);
        expect(json.report.passengerId).toBe(PASSENGER_A);
        expect((await storedReport(firestore, json.report.reportId)).passengerId).toBe(
            PASSENGER_A
        );
    });

    it('ignores a passengerId supplied in the request body', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        // Passenger A's session, claiming to be passenger B.
        const response = await createReport(
            reportRequest(validPayload({ passengerId: PASSENGER_B }), SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(201);
        expect(json.report.passengerId).toBe(PASSENGER_A);

        const stored = await storedReport(firestore, json.report.reportId);
        expect(stored.passengerId).toBe(PASSENGER_A);
        expect(stored.passengerId).not.toBe(PASSENGER_B);
    });
});

// ==================================================================
// Existing behaviour — unchanged by MOV-142
// ==================================================================
describe('POST /api/reports - required fields', () => {
    it('creates a report with neither a bus nor a route', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(reportRequest(validPayload(), SESSION_A));
        const json = await response.json();

        expect(response.status).toBe(201);
        expect(json.success).toBe(true);
        expect(json.report.reportId).toBe('REP-00001');
        expect(json.report.issueCategory).toBe('BROKEN_RAMP');

        // Nothing optional is invented for a report that named neither.
        const stored = await storedReport(firestore, 'REP-00001');
        expect(stored).not.toHaveProperty('busId');
        expect(stored).not.toHaveProperty('vehicle');
        expect(stored).not.toHaveProperty('routeId');
        expect(stored).not.toHaveProperty('route');
    });

    it('defaults the status to PENDING and stamps both timestamps', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(reportRequest(validPayload(), SESSION_A));
        const json = await response.json();

        expect(json.report.status).toBe('PENDING');

        const stored = await storedReport(firestore, 'REP-00001');
        expect(stored.status).toBe('PENDING');
        expect(stored.createdAt).toBeInstanceOf(Date);
        expect(stored.updatedAt).toBeInstanceOf(Date);
    });

    it('rejects a missing issue category', async () => {
        mockGetAdminDb.mockReturnValue(seededFirestore());

        const response = await createReport(
            reportRequest({ description: 'The ramp was broken.' }, SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/required/i);
    });

    it('rejects an unknown issue category', async () => {
        mockGetAdminDb.mockReturnValue(seededFirestore());

        const response = await createReport(
            reportRequest(validPayload({ issueCategory: 'SOMETHING_ELSE' }), SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/invalid issue category/i);
    });

    it('rejects a missing description', async () => {
        mockGetAdminDb.mockReturnValue(seededFirestore());

        const response = await createReport(
            reportRequest({ issueCategory: 'BROKEN_RAMP' }, SESSION_A)
        );

        expect(response.status).toBe(400);
    });

    it('rejects a description that is only whitespace', async () => {
        mockGetAdminDb.mockReturnValue(seededFirestore());

        const response = await createReport(
            reportRequest(validPayload({ description: '    ' }), SESSION_A)
        );

        expect(response.status).toBe(400);
    });

    it('trims the stored description', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        await createReport(
            reportRequest(validPayload({ description: '  The ramp was broken.  ' }), SESSION_A)
        );

        expect((await storedReport(firestore, 'REP-00001')).description).toBe(
            'The ramp was broken.'
        );
    });
});

// ==================================================================
// Bus reference + snapshot
// ==================================================================
describe('POST /api/reports - bus reference', () => {
    it('stores the canonical busId and a snapshot of the vehicle', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(
            reportRequest(validPayload({ busId: BUS_ID }), SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(201);

        const stored = await storedReport(firestore, json.report.reportId);
        expect(stored.busId).toBe(BUS_ID);
        expect(stored.vehicle).toEqual({
            numberPlate: 'NB-1234',
            busModel: 'Ashok Leyland Viking',
            manufacturer: 'Ashok Leyland',
        });
    });

    it('keeps the snapshot readable after the bus record changes', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(
            reportRequest(validPayload({ busId: BUS_ID }), SESSION_A)
        );
        const json = await response.json();

        // The plate is reassigned to another vehicle after the report is filed.
        await firestore.collection('buses').doc(BUS_ID).update({ numberPlate: 'XX-9999' });

        // The report still describes the bus as it was on the day.
        expect((await storedReport(firestore, json.report.reportId)).vehicle.numberPlate).toBe(
            'NB-1234'
        );
    });

    it('omits snapshot fields the fleet record does not hold', async () => {
        const firestore = seededFirestore({
            buses: [storedBus({ busModel: '', manufacturer: undefined })],
        });
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(
            reportRequest(validPayload({ busId: BUS_ID }), SESSION_A)
        );
        const json = await response.json();

        const stored = await storedReport(firestore, json.report.reportId);
        expect(stored.vehicle).toEqual({ numberPlate: 'NB-1234' });
    });

    it('rejects a busId that does not exist', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(
            reportRequest(validPayload({ busId: 'BUS-99999' }), SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/bus was not found/i);

        // Nothing was written — an unresolvable reference never becomes a report.
        expect((await firestore.collection('reports').get()).docs).toHaveLength(0);
    });

    it('rejects a malformed busId with 400', async () => {
        mockGetAdminDb.mockReturnValue(seededFirestore());

        const response = await createReport(
            reportRequest(validPayload({ busId: 'buses/BUS-00007' }), SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/invalid bus reference/i);
    });

    it('treats an empty busId as no bus rather than an error', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(
            reportRequest(validPayload({ busId: '' }), SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(201);
        expect(await storedReport(firestore, json.report.reportId)).not.toHaveProperty('busId');
    });
});

// ==================================================================
// Route reference + snapshot
// ==================================================================
describe('POST /api/reports - route reference', () => {
    it('stores the canonical routeId and a snapshot of the route', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(
            reportRequest(validPayload({ routeId: ROUTE_ID }), SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(201);

        const stored = await storedReport(firestore, json.report.reportId);
        expect(stored.routeId).toBe(ROUTE_ID);
        expect(stored.route).toEqual({
            routeNumber: '138',
            routeName: 'Colombo - Kandy',
            direction: 'OUTBOUND',
        });
    });

    it('omits a direction the route record never had', async () => {
        const firestore = seededFirestore({
            routes: [storedRoute({ direction: undefined })],
        });
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(
            reportRequest(validPayload({ routeId: ROUTE_ID }), SESSION_A)
        );
        const json = await response.json();

        const stored = await storedReport(firestore, json.report.reportId);
        expect(stored.route).toEqual({ routeNumber: '138', routeName: 'Colombo - Kandy' });
    });

    it('rejects a routeId that does not exist', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(
            reportRequest(validPayload({ routeId: 'R-999-OUT' }), SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(404);
        expect(json.message).toMatch(/route was not found/i);
        expect((await firestore.collection('reports').get()).docs).toHaveLength(0);
    });

    it('rejects a malformed routeId with 400', async () => {
        mockGetAdminDb.mockReturnValue(seededFirestore());

        const response = await createReport(
            reportRequest(validPayload({ routeId: 'routes/R-138-OUT' }), SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/invalid route reference/i);
    });
});

// ==================================================================
// Both references together
// ==================================================================
describe('POST /api/reports - bus and route together', () => {
    it('stores both references and both snapshots', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(
            reportRequest(validPayload({ busId: BUS_ID, routeId: ROUTE_ID }), SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(201);

        const stored = await storedReport(firestore, json.report.reportId);
        expect(stored.busId).toBe(BUS_ID);
        expect(stored.routeId).toBe(ROUTE_ID);
        expect(stored.vehicle.numberPlate).toBe('NB-1234');
        expect(stored.route.routeNumber).toBe('138');

        // The response the app renders carries them too.
        expect(json.report.vehicle.numberPlate).toBe('NB-1234');
        expect(json.report.route.routeNumber).toBe('138');
    });

    it('rejects the whole submission when only one reference is bad', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(
            reportRequest(validPayload({ busId: BUS_ID, routeId: 'R-999-OUT' }), SESSION_A)
        );

        expect(response.status).toBe(404);
        expect((await firestore.collection('reports').get()).docs).toHaveLength(0);
    });
});

// ==================================================================
// Photo evidence — not stored yet, and must never be stored as a device path
// ==================================================================
describe('POST /api/reports - photo fields', () => {
    it('submits successfully while ignoring photo fields it cannot store yet', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(
            reportRequest(
                validPayload({
                    photos: [
                        { uri: 'file:///data/user/0/photo-1.jpg', fileName: 'photo-1.jpg' },
                        { uri: 'content://media/external/images/42' },
                    ],
                }),
                SESSION_A
            )
        );
        const json = await response.json();

        expect(response.status).toBe(201);

        // A device uri is meaningless off the device, so none of it reaches
        // Firestore — not as photoUrls, and not anywhere else on the document.
        const stored = await storedReport(firestore, json.report.reportId);
        expect(stored).not.toHaveProperty('photos');
        expect(stored).not.toHaveProperty('photoUrls');
        expect(JSON.stringify(stored)).not.toMatch(/file:\/\/|content:\/\//);
    });
});

// ==================================================================
// Report id generation
// ==================================================================
describe('POST /api/reports - report ids', () => {
    it('continues the existing REP- counter rather than restarting it', async () => {
        const firestore = seededFirestore({
            counters: [{ id: 'reports', lastNumber: 41 }],
        });
        mockGetAdminDb.mockReturnValue(firestore);

        const response = await createReport(reportRequest(validPayload(), SESSION_A));
        const json = await response.json();

        expect(json.report.reportId).toBe('REP-00042');
    });

    it('gives consecutive submissions distinct ids', async () => {
        const firestore = seededFirestore();
        mockGetAdminDb.mockReturnValue(firestore);

        const first = await createReport(reportRequest(validPayload(), SESSION_A));
        const second = await createReport(
            reportRequest(validPayload({ busId: BUS_ID }), SESSION_B)
        );

        expect((await first.json()).report.reportId).toBe('REP-00001');
        expect((await second.json()).report.reportId).toBe('REP-00002');
        expect((await firestore.collection('reports').get()).docs).toHaveLength(2);
    });
});

// ==================================================================
// Failure handling
// ==================================================================
describe('POST /api/reports - failures', () => {
    it('answers 500 without leaking the Firestore error when the lookup fails', async () => {
        mockGetAdminDb.mockReturnValue({
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({
                    get: jest.fn().mockRejectedValue(new Error('Firestore unavailable')),
                })),
            })),
        });

        const response = await createReport(
            reportRequest(validPayload({ busId: BUS_ID }), SESSION_A)
        );
        const json = await response.json();

        expect(response.status).toBe(500);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/failed to create/i);
    });
});
