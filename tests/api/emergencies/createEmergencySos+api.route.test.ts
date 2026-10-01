// POST /api/emergencies — a passenger's SOS, as the server trusts it.
//
// Drives the real route against a seeded database. Who the passenger is comes
// from the verified PASSENGER session (authoriseOngoingJourneyAccess) and that
// passenger's own user document; which journey comes only from
// loadPassengerOngoingJourneys. Nothing the body says about the passenger,
// booking, trip, bus, vehicle or recipients is believed.
//
// SOS without a verified ongoing journey is still an emergency: it is
// recorded, without journey identity, never with a guessed booking.
//
// Real: the route, authenticateRequest, authoriseOngoingJourneyAccess,
// loadPassengerOngoingJourneys, createEmergency. Stubbed: the Firebase handle,
// the push dispatcher (to see who would be alerted) and verifyToken — which,
// as in the ongoing route's tests, maps opaque session strings to a payload.
// An invalid or expired token maps to null, exactly what the real verifyToken
// returns when jose rejects its signature or `exp`. No credential appears.

import { POST as postEmergency } from '../../../app/api/emergencies/index+api';
import { dispatchEmergencySOSAlert } from '../../../src/shared/services/pushNotificationDispatcher';
import { SeedBooking, seedOngoingJourneys } from '../../testUtils/ongoingJourneySeed';

const mockGetAdminDb = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

jest.mock('../../../src/shared/config/jwt', () => ({
    JOURNEY_SHARING_SCOPE: 'JOURNEY_LOCATION',
    verifyToken: (token: string) => mockVerifyToken(token),
}));

jest.mock('../../../src/shared/services/pushNotificationDispatcher', () => ({
    dispatchEmergencySOSAlert: jest.fn(async () => ({ sent: 0 })),
}));

const pushes = dispatchEmergencySOSAlert as jest.Mock;

// ------------------------------------------------------------------
// Two passengers. A rides TRIP-00004 (running) on BUS-8899 / NB-8899.
// Every contact detail is fictional.
// ------------------------------------------------------------------
const PASSENGER_A = 'PAS-2026-00001';
const PASSENGER_B = 'PAS-2026-00002';

const USER_A = {
    passengerId: PASSENGER_A,
    uid: 'uid-a',
    userName: 'Passenger A',
    email: 'passenger-a@example.test',
    phoneNumber: '0700000101',
    isWheelchairUser: true,
    accessibilityNeeds: ['Low Step Entry'],
    guardianDetails: { fullName: 'Guardian A', mobileNo: '0700000191' },
};

const USER_B = {
    passengerId: PASSENGER_B,
    uid: 'uid-b',
    userName: 'Passenger B',
    email: 'passenger-b@example.test',
    phoneNumber: '0700000202',
    isLowVisionPerson: true,
    guardianDetails: { fullName: 'Guardian B', mobileNo: '0700000292' },
};

const A_RUNNING: SeedBooking = { bookingId: 'BK-A', userId: PASSENGER_A, tripId: 'TRIP-00004', busId: 'BUS-8899', trip: 'running' };
const B_RUNNING: SeedBooking = { bookingId: 'BK-B', userId: PASSENGER_B, tripId: 'TRIP-00005', busId: 'BUS-7777', trip: 'running' };

/** Every identifier of B's, for "none of this reached A's emergency" checks. */
const B_TRACES = /PAS-2026-00002|Passenger B|passenger-b@|0700000202|0700000292|BK-B\b|TRIP-00005|BUS-7777|NB-7777|Low Vision/;
const DEMO_VALUES = /BKG-998877|PAS-554|WP-CBA-1234|WP-ND-4521|Toyota Prius|Nimal Silva|DRV-112|CG-887/;

// Opaque session strings -> what verifyToken would return for them.
const SESSIONS: Record<string, unknown> = {
    'session-a': { uid: 'uid-a', passengerId: PASSENGER_A, role: 'PASSENGER', email: 'passenger-a@example.test' },
    'session-b': { uid: 'uid-b', passengerId: PASSENGER_B, role: 'PASSENGER', email: 'passenger-b@example.test' },
    'session-bus': { uid: 'BUS-8899', passengerId: '', role: 'BUS', email: '', busId: 'BUS-8899' },
    'session-admin': { uid: 'uid-admin', passengerId: '', role: 'ADMIN', email: 'admin@example.test' },
    'session-sharing': { uid: 'uid-a', passengerId: PASSENGER_A, role: 'PASSENGER', email: '', scope: 'JOURNEY_LOCATION', tripId: 'TRIP-00004' },
    'session-guest': { uid: 'uid-guest', passengerId: 'GUEST', role: 'PASSENGER', email: '' },
};

const LOCATION = { latitude: 6.9271, longitude: 79.8612 };

function seed(bookings: SeedBooking[] = [A_RUNNING, B_RUNNING], users: Record<string, unknown>[] = [USER_A, USER_B]) {
    return seedOngoingJourneys(bookings, { users: users.map((user: any) => ({ id: user.passengerId, ...user })), emergencies: [] });
}

let db: any;

function useDb(next: any) {
    db = next;
    mockGetAdminDb.mockReturnValue(db);
}

async function post(session: string | null, body: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session) headers.Authorization = `Bearer ${session}`;
    const response = await postEmergency(
        new Request('http://localhost/api/emergencies', { method: 'POST', headers, body: JSON.stringify(body) })
    );
    return { status: response.status, body: await response.json() };
}

/** The one emergency written to the database. */
async function stored() {
    const snapshot = await db.collection('emergencies').get();
    expect(snapshot.docs).toHaveLength(1);
    return snapshot.docs[0].data();
}

/** No journey identity was attached: no bookingId, tripId or busId on the record. */
function expectNoJourney(record: any) {
    expect(record.bookingId).toBeUndefined();
    expect(record.tripId).toBeUndefined();
    expect(record.busId).toBeUndefined();
}

beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyToken.mockImplementation(async (token: string) => SESSIONS[token] ?? null);
    useDb(seed());
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ------------------------------------------------------------------
describe('authentication', () => {
    it.each([
        ['1. no token', null],
        ['2. an invalid token', 'not-a-valid-session'],
        ['3. an expired token', 'session-expired'],
    ])('%s -> 401, nothing read or written', async (_label, session) => {
        const { status, body } = await post(session, { bookingId: 'BK-A', location: LOCATION, passenger: { id: PASSENGER_A } });

        expect(status).toBe(401);
        expect(body.success).toBe(false);
        expect(body.emergency).toBeUndefined();
        expect(mockGetAdminDb).not.toHaveBeenCalled();
        expect(pushes).not.toHaveBeenCalled();
    });

    it.each([
        ['4. a BUS session', 'session-bus'],
        ['5. an ADMIN session', 'session-admin'],
        ['a journey-sharing (scoped) credential', 'session-sharing'],
        ['a GUEST passenger session', 'session-guest'],
    ])('%s -> 403, nothing read or written', async (_label, session) => {
        const { status, body } = await post(session, { bookingId: 'BK-A', location: LOCATION });

        expect(status).toBe(403);
        expect(body.success).toBe(false);
        expect(mockGetAdminDb).not.toHaveBeenCalled();
        expect(pushes).not.toHaveBeenCalled();
    });

    it('6. a PASSENGER session -> 201', async () => {
        const { status, body } = await post('session-a', { location: LOCATION });

        expect(status).toBe(201);
        expect(body.success).toBe(true);
        expect(body.emergency.status).toBe('PENDING');
    });
});

// ------------------------------------------------------------------
describe('passenger identity comes from the session', () => {
    it("7/9. another passenger's id in the body is ignored", async () => {
        await post('session-a', { location: LOCATION, passenger: { id: PASSENGER_B, name: 'Passenger B', phone: '0700000202' } });

        const record = await stored();
        expect(record.passenger).toEqual({
            id: PASSENGER_A,
            name: 'Passenger A',
            phone: '0700000101',
            email: 'passenger-a@example.test',
            specialAssistance: 'Wheelchair Assistance, Low Step Entry',
        });
        expect(JSON.stringify(record)).not.toMatch(B_TRACES);
    });

    it("8/28. another passenger's email in the body is never looked up", async () => {
        // A has no user document: an email lookup would have found B.
        useDb(seed([A_RUNNING, B_RUNNING], [USER_B]));

        const { status } = await post('session-a', { location: LOCATION, passenger: { email: 'passenger-b@example.test' } });

        expect(status).toBe(201);
        const record = await stored();
        expect(record.passenger).toMatchObject({ id: PASSENGER_A, name: 'passenger-a@example.test', phone: 'Not on file' });
        expect(JSON.stringify(record)).not.toMatch(B_TRACES);
    });

    it('9. a name or phone in the body never replaces the stored profile', async () => {
        await post('session-a', { location: LOCATION, passenger: { name: 'Someone Else', phone: '0700000999', specialAssistance: 'None' } });

        const record = await stored();
        expect(record.passenger).toMatchObject({ name: 'Passenger A', phone: '0700000101', specialAssistance: 'Wheelchair Assistance, Low Step Entry' });
        expect(JSON.stringify(record)).not.toMatch(/Someone Else|0700000999/);
    });

    it('10. the response holds only the caller\'s own data', async () => {
        const { body } = await post('session-b', {
            bookingId: 'BK-A',
            location: LOCATION,
            passenger: { id: PASSENGER_A, email: 'passenger-a@example.test' },
            alertRecipients: { caregiver: 'uid-a' },
        });

        const response = JSON.stringify(body);
        expect(response).not.toMatch(/PAS-2026-00001|Passenger A|passenger-a@|0700000101|0700000191|BK-A\b|TRIP-00004|BUS-8899|NB-8899|Wheelchair/);
        expect(body.emergency.passenger.id).toBe(PASSENGER_B);
    });
});

// ------------------------------------------------------------------
describe('booking security — only a verified ongoing journey of the caller', () => {
    it("11. B sending A's running bookingId gets no booking attached", async () => {
        useDb(seed([A_RUNNING, { ...B_RUNNING, trip: 'not-started' }]));

        await post('session-b', { bookingId: 'BK-A', tripId: 'TRIP-00004', busId: 'BUS-8899', location: LOCATION });

        const record = await stored();
        expectNoJourney(record);
        expect(record.vehicle.plateNumber).toBe('UNKNOWN-VEHICLE');
        expect(JSON.stringify(record)).not.toMatch(/BK-A\b|TRIP-00004|BUS-8899|NB-8899/);
    });

    it.each([
        ['12. a future booking', { bookingId: 'BK-A-FUTURE', userId: PASSENGER_A, tripId: 'TRIP-00009', busId: 'BUS-5555', trip: 'not-started' as const }],
        ['13. a completed booking', { bookingId: 'BK-A-DONE', userId: PASSENGER_A, tripId: 'TRIP-00009', busId: 'BUS-5555', trip: 'ended' as const }],
        ['14. a cancelled booking on a running trip', { bookingId: 'BK-A-CANCELLED', userId: PASSENGER_A, tripId: 'TRIP-00009', busId: 'BUS-5555', trip: 'running' as const, status: 'CANCELLED' as const }],
    ])('%s is not attached', async (_label, booking) => {
        useDb(seed([booking]));

        const { status } = await post('session-a', { bookingId: booking.bookingId, location: LOCATION });

        expect(status).toBe(201);
        const record = await stored();
        expectNoJourney(record);
        expect(JSON.stringify(record)).not.toMatch(/BK-A-|TRIP-00009|BUS-5555|NB-5555/);
    });

    it('15/23. no bookingId: no newest-booking fallback, even with several bookings', async () => {
        useDb(
            seed([
                { bookingId: 'BK-A-OLD', userId: PASSENGER_A, tripId: 'TRIP-00007', busId: 'BUS-3333', trip: 'ended', createdAt: '2026-09-01T08:00:00.000Z' },
                { bookingId: 'BK-A-NEWEST', userId: PASSENGER_A, tripId: 'TRIP-00008', busId: 'BUS-4444', trip: 'not-started', createdAt: '2026-09-30T08:00:00.000Z' },
                { bookingId: 'BK-A-CANCELLED', userId: PASSENGER_A, tripId: 'TRIP-00009', busId: 'BUS-5555', trip: 'not-started', status: 'CANCELLED', createdAt: '2026-09-29T08:00:00.000Z' },
            ])
        );

        await post('session-a', { location: LOCATION });

        const record = await stored();
        expectNoJourney(record);
        expect(JSON.stringify(record)).not.toMatch(/BK-A-|TRIP-0000|BUS-[345]{4}|NB-/);
    });

    it('no bookingId while a journey IS running: still nothing guessed', async () => {
        await post('session-a', { location: LOCATION, tripId: 'TRIP-00004', busId: 'BUS-8899' });

        expectNoJourney(await stored());
    });
});

// ------------------------------------------------------------------
describe('a verified ongoing journey — identity from the server', () => {
    it('16-19. attaches the booking with its server-derived trip, bus, vehicle and route', async () => {
        const { status, body } = await post('session-a', { bookingId: 'BK-A', location: LOCATION });

        expect(status).toBe(201);
        const record = await stored();
        expect(record).toMatchObject({
            bookingId: 'BK-A',
            tripId: 'TRIP-00004',
            busId: 'BUS-8899',
            vehicle: { plateNumber: 'NB-8899', model: 'Viking', routeNumber: '177', driverId: 'BUS-8899' },
        });
        expect(body.emergency).toMatchObject({ bookingId: 'BK-A', tripId: 'TRIP-00004', busId: 'BUS-8899' });
    });

    it('20/21. a wrong client tripId and busId are ignored; the SOS is not rejected', async () => {
        const { status } = await post('session-a', {
            bookingId: 'BK-A',
            tripId: 'TRIP-WRONG',
            busId: 'BUS-WRONG',
            vehicle: { plateNumber: 'NB-WRONG', model: 'Wrong', routeNumber: '999', driverId: 'DRV-WRONG' },
            location: LOCATION,
        });

        expect(status).toBe(201);
        const record = await stored();
        expect(record).toMatchObject({ tripId: 'TRIP-00004', busId: 'BUS-8899', vehicle: { plateNumber: 'NB-8899', routeNumber: '177' } });
        expect(JSON.stringify(record)).not.toContain('WRONG');
    });

    it('22. no ongoing journey: the SOS is still created, without journey identity', async () => {
        useDb(seed([{ ...A_RUNNING, trip: 'not-started' }]));

        const { status, body } = await post('session-a', { bookingId: 'BK-A', location: LOCATION });

        expect(status).toBe(201);
        expect(body.success).toBe(true);
        const record = await stored();
        expectNoJourney(record);
        expect(record).toMatchObject({ status: 'PENDING', passenger: { id: PASSENGER_A } });
        expect(record.vehicle).toEqual({ plateNumber: 'UNKNOWN-VEHICLE', model: 'Transit Bus' });
    });
});

// ------------------------------------------------------------------
describe('no demo or random fallbacks', () => {
    it('24. the passenger id is the session\'s, never a random PAS-xxx', async () => {
        useDb(seed([A_RUNNING], []));

        await post('session-a', { location: LOCATION });

        const record = await stored();
        expect(record.passenger.id).toBe(PASSENGER_A);
        expect(record.passenger.id).not.toMatch(/^PAS-\d{3}$/);
    });

    it('25-27. demo booking, passenger and vehicle values are neither honoured nor substituted', async () => {
        await post('session-a', {
            bookingId: 'BKG-998877',
            passenger: { id: 'PAS-554', name: 'Nimal Silva', phone: '0700000555' },
            vehicle: { plateNumber: 'WP-CBA-1234', model: 'Toyota Prius', driverId: 'DRV-112' },
            alertRecipients: { caregiver: 'CG-887', driver: 'DRV-112' },
            location: LOCATION,
        });

        const record = await stored();
        expect(JSON.stringify(record)).not.toMatch(DEMO_VALUES);
        expectNoJourney(record);
        expect(record.vehicle).toEqual({ plateNumber: 'UNKNOWN-VEHICLE', model: 'Transit Bus' });
    });

    it('a demo plate on a real journey is not swapped for another made-up plate', async () => {
        await post('session-a', { bookingId: 'BK-A', vehicle: { plateNumber: 'WP-CBA-1234', model: 'Toyota Prius' }, location: LOCATION });

        const record = await stored();
        expect(record.vehicle.plateNumber).toBe('NB-8899');
        expect(JSON.stringify(record)).not.toMatch(DEMO_VALUES);
    });
});

// ------------------------------------------------------------------
describe('alert recipients come from the server', () => {
    it('29/30. caregiver from the passenger\'s own profile, driver from the verified journey\'s bus', async () => {
        await post('session-a', { bookingId: 'BK-A', location: LOCATION });

        expect((await stored()).alertRecipients).toEqual({ caregiver: '0700000191', driver: 'BUS-8899', admin: 'ADMIN_TOPIC' });
        expect(pushes).toHaveBeenCalledTimes(1);
        expect(pushes.mock.calls[0][0]).toEqual(['0700000191', 'BUS-8899']);
    });

    it('31. the client cannot choose who is alerted', async () => {
        await post('session-a', {
            bookingId: 'BK-A',
            location: LOCATION,
            alertRecipients: { caregiver: 'uid-b', driver: 'uid-admin', admin: 'SOMEONE_ELSE' },
        });

        expect((await stored()).alertRecipients).toEqual({ caregiver: '0700000191', driver: 'BUS-8899', admin: 'ADMIN_TOPIC' });
        expect(pushes.mock.calls[0][0]).not.toEqual(expect.arrayContaining(['uid-b']));
        expect(pushes.mock.calls[0][0]).not.toEqual(expect.arrayContaining(['uid-admin']));
    });

    it('32. no ongoing journey: no driver recipient', async () => {
        await post('session-a', { location: LOCATION, alertRecipients: { driver: 'BUS-8899' } });

        expect((await stored()).alertRecipients).toEqual({ caregiver: '0700000191', driver: null, admin: 'ADMIN_TOPIC' });
        expect(pushes.mock.calls[0][0]).toEqual(['0700000191']);
    });

    it('no guardian on the profile: no caregiver recipient, whatever the body says', async () => {
        useDb(seed([A_RUNNING], [{ ...USER_A, guardianDetails: null }]));

        await post('session-a', { bookingId: 'BK-A', location: LOCATION, alertRecipients: { caregiver: '0700000888' } });

        expect((await stored()).alertRecipients).toEqual({ caregiver: null, driver: 'BUS-8899', admin: 'ADMIN_TOPIC' });
    });
});

// ------------------------------------------------------------------
describe('robustness', () => {
    /** Makes every read of the bookings collection fail, as an outage would. */
    function failBookingReads() {
        const collection = db.collection;
        db.collection = jest.fn((name: string) => {
            if (name !== 'bookings') return collection(name);
            const failing = { get: async () => Promise.reject(new Error('bookings unavailable')) };
            return { where: () => failing, doc: () => failing, get: failing.get };
        });
    }

    it('33/34. a journey read failure still creates the SOS — with no booking, unrelated or otherwise', async () => {
        useDb(
            seed([
                A_RUNNING,
                { bookingId: 'BK-A-NEWEST', userId: PASSENGER_A, tripId: 'TRIP-00008', busId: 'BUS-4444', trip: 'not-started', createdAt: '2026-09-30T08:00:00.000Z' },
            ])
        );
        failBookingReads();

        const { status, body } = await post('session-a', { bookingId: 'BK-A', location: LOCATION });

        expect(status).toBe(201);
        expect(body.success).toBe(true);
        const record = await stored();
        expectNoJourney(record);
        expect(record).toMatchObject({ passenger: { id: PASSENGER_A, name: 'Passenger A' } });
        expect(JSON.stringify(record)).not.toMatch(/BK-A|TRIP-0000|BUS-|NB-/);
        expect(record.alertRecipients.driver).toBeNull();
    });

    it('a profile read failure still creates the SOS with the session identity', async () => {
        const collection = db.collection;
        db.collection = jest.fn((name: string) =>
            name === 'users' ? { doc: () => ({ get: async () => Promise.reject(new Error('users unavailable')) }) } : collection(name)
        );

        const { status } = await post('session-a', { bookingId: 'BK-A', location: LOCATION, passenger: { name: 'Passenger B', phone: '0700000202' } });

        expect(status).toBe(201);
        const record = await stored();
        expect(record.passenger).toEqual({ id: PASSENGER_A, name: 'passenger-a@example.test', phone: 'Not on file', email: 'passenger-a@example.test' });
        expect(record).toMatchObject({ bookingId: 'BK-A', tripId: 'TRIP-00004' });
        expect(JSON.stringify(record)).not.toMatch(B_TRACES);
    });

    it('still requires a valid location', async () => {
        const { status } = await post('session-a', { bookingId: 'BK-A' });

        expect(status).toBe(400);
    });
});
