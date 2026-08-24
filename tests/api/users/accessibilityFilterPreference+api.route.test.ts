// Remembering which accessibility filters a passenger applied (MOV-93).
//
// MOV-91 built the controls and MOV-92 made the search obey them; both are
// covered by their own suites and nothing here repeats them. What this file is
// about is the part that only exists between sessions: a selection that is
// written down, read back unchanged, never leaks between passengers, and never
// turns a stray stored value into a filter.
//
// The preference lives on the passenger's EXISTING accessibility profile
// record, so these tests drive the real `/api/accessibility-profile` handlers
// against the shared fake Firestore — and the integration case finishes at the
// real journey search, so "restored" is proven to mean "actually filters".
//
// No password, token, key or other credential-shaped value appears anywhere in
// this file. None is needed: these endpoints take an identifier and nothing
// else.

import {
    GET as getAccessibilityProfile,
    POST as saveAccessibilityProfile,
} from '../../../app/api/accessibility-profile/index+api';
import { POST as searchJourneys } from '../../../app/api/journeys/search+api';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import {
    FULLY_EQUIPPED,
    makeBus,
    makeRoute,
    makeStop,
    makeTrip,
    NOT_EQUIPPED,
} from '../../testUtils/journeyFixtures';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// The journey search pulls in the map providers; they have no part in a saved
// preference and are never allowed to make a real request.
jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(),
    getRouteThroughCoordinates: jest.fn(),
}));

const mockGeocodeLocation = geocodeLocation as jest.MockedFunction<typeof geocodeLocation>;
const mockGetRoute = getRouteBetweenCoordinates as jest.MockedFunction<
    typeof getRouteBetweenCoordinates
>;
const mockGetRouteThrough = getRouteThroughCoordinates as jest.MockedFunction<
    typeof getRouteThroughCoordinates
>;

// ------------------------------------------------------------------
// Two passengers, so "only your own preference" can mean something.
// ------------------------------------------------------------------
const PASSENGER_A = 'PAS-2026-00012';
const PASSENGER_B = 'PAS-2026-00099';
const PROFILE_A = 'ACC-2026-00012';
const PROFILE_B = 'ACC-2026-00099';

function storedUser(passengerId: string, profileId: string | null, overrides: any = {}) {
    return {
        id: passengerId,
        uid: `UID-${passengerId}`,
        passengerId,
        userName: passengerId === PASSENGER_A ? 'Sunil Perera' : 'Nimali Fernando',
        accessibilityProfileId: profileId,
        hasAccessibilityNeeds: true,
        isWheelchairUser: true,
        isLowVisionPerson: false,
        ...overrides,
    };
}

function storedProfile(profileId: string, passengerId: string, overrides: any = {}) {
    return {
        id: profileId,
        accessibilityProfileId: profileId,
        userId: `UID-${passengerId}`,
        passengerId,
        hasAccessibilityNeeds: true,
        accessibilityNeeds: ['wheelchair', 'low_vision'],
        otherDescription: null,
        requestedServices: {
            wheelchairRamp: true,
            wheelchairSpace: true,
            prioritySeats: true,
            clearAnnouncements: true,
            vibratedDevices: false,
            visualAnnouncements: true,
        },
        createdAt: '2026-08-01T10:00:00.000Z',
        updatedAt: '2026-08-01T10:00:00.000Z',
        ...overrides,
    };
}

// A small network for the integration case: one accessible departure, one not.
const ROUTE_ID = 'ROUTE-177';
const STOPS = ['Kaduwela', 'Malabe', 'Battaramulla', 'Borella'];

function journeyData() {
    return {
        routes: [makeRoute(ROUTE_ID, STOPS, { routeNumber: '177', distanceKm: 20 })],
        buses: [
            makeBus('BUS-ACCESSIBLE', 'NB-2001', FULLY_EQUIPPED),
            makeBus('BUS-PLAIN', 'NB-2002', NOT_EQUIPPED),
        ],
        trips: [
            makeTrip('T-ACCESSIBLE', ROUTE_ID, 'BUS-ACCESSIBLE', '07:00'),
            makeTrip('T-PLAIN', ROUTE_ID, 'BUS-PLAIN', '07:30'),
        ],
        stops: [
            makeStop('Kaduwela', 6.9333, 79.9833),
            makeStop('Malabe', 6.9061, 79.9558),
            makeStop('Battaramulla', 6.8994, 79.9186),
            makeStop('Borella', 6.9147, 79.8778),
        ],
    };
}

/** One store shared by both endpoints, as one deployment would have. */
function seedStore(options: { users?: any[]; profiles?: any[] } = {}) {
    const store = createFakeFirestore({
        users: options.users ?? [
            storedUser(PASSENGER_A, PROFILE_A),
            storedUser(PASSENGER_B, PROFILE_B),
        ],
        accessibility_needs_persons: options.profiles ?? [
            storedProfile(PROFILE_A, PASSENGER_A),
            storedProfile(PROFILE_B, PASSENGER_B),
        ],
        ...journeyData(),
    });

    mockGetAdminDb.mockReturnValue(store);
    return store;
}

/** Reads a document straight out of the fake store, to check what was written. */
async function storedDoc(store: any, collection: string, id: string) {
    const snapshot = await store.collection(collection).doc(id).get();
    return snapshot.exists ? snapshot.data() : null;
}

async function savePreference(passengerId: string, requirements: unknown) {
    const response = await saveAccessibilityProfile(
        new Request('http://localhost/api/accessibility-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passengerId, journeyAccessibilityRequirements: requirements }),
        })
    );

    return { response, json: await response.json() };
}

async function readProfile(passengerId: string) {
    const response = await getAccessibilityProfile(
        new Request(
            `http://localhost/api/accessibility-profile?passengerId=${encodeURIComponent(passengerId)}`
        )
    );

    return { response, json: await response.json() };
}

/** The requirements a returning passenger would restore. */
async function restoredRequirements(passengerId: string): Promise<string[]> {
    const { json } = await readProfile(passengerId);
    return json?.profile?.journeyAccessibilityRequirements ?? [];
}

async function runJourneySearch(accessibilityRequirements: string[]) {
    const response = await searchJourneys(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origin: 'Kaduwela',
                destination: 'Borella',
                travelDate: '2026-08-25',
                travelTime: '05:00',
                accessibilityRequirements,
            }),
        })
    );

    const json = await response.json();

    return {
        json,
        tripIds: (json.routes ?? []).flatMap((route: any) =>
            (route.trips ?? []).map((option: any) => option.trip.tripId)
        ),
    };
}

beforeEach(() => {
    jest.clearAllMocks();

    mockGeocodeLocation.mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    mockGetRoute.mockResolvedValue({ distanceKm: 20, durationMinutes: 60 });
    mockGetRouteThrough.mockResolvedValue({ distanceKm: 20, durationMinutes: 60 });
});

// ==================================================================
// A. A PASSENGER WHO HAS NEVER SAVED ONE
// ==================================================================
describe('a passenger with no saved preference', () => {
    it('restores an empty selection', async () => {
        seedStore();

        const { response, json } = await readProfile(PASSENGER_A);

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.profile.journeyAccessibilityRequirements).toEqual([]);
    });

    it('searches exactly as before, with nothing filtered out', async () => {
        seedStore();

        const restored = await restoredRequirements(PASSENGER_A);
        const { tripIds } = await runJourneySearch(restored);

        expect(restored).toEqual([]);
        expect(tripIds).toEqual(['T-ACCESSIBLE', 'T-PLAIN']);
    });

    it('leaves the rest of an existing profile untouched by being read', async () => {
        const store = seedStore();

        await readProfile(PASSENGER_A);

        expect(await storedDoc(store, 'accessibility_needs_persons', PROFILE_A)).toMatchObject({
            accessibilityNeeds: ['wheelchair', 'low_vision'],
            requestedServices: { wheelchairRamp: true, vibratedDevices: false },
        });
    });
});

// ==================================================================
// B–E. SAVING, READING BACK, AND CLEARING
// ==================================================================
describe('saving and restoring a preference', () => {
    it('persists the selected requirements', async () => {
        const store = seedStore();

        const { response, json } = await savePreference(PASSENGER_A, [
            'wheelchairRamp',
            'prioritySeats',
        ]);

        expect(response.status).toBe(200);
        expect(json.success).toBe(true);
        expect(json.journeyAccessibilityRequirements).toEqual(['wheelchairRamp', 'prioritySeats']);

        const stored = await storedDoc(store, 'accessibility_needs_persons', PROFILE_A);
        expect(stored?.journeyAccessibilityRequirements).toEqual([
            'wheelchairRamp',
            'prioritySeats',
        ]);
    });

    it('restores what was saved on a later visit', async () => {
        seedStore();

        await savePreference(PASSENGER_A, ['audioAnnouncement']);

        expect(await restoredRequirements(PASSENGER_A)).toEqual(['audioAnnouncement']);
    });

    it('survives all five being selected', async () => {
        seedStore();

        await savePreference(PASSENGER_A, [
            'walkingAssistance',
            'lowFloorVehicle',
            'audioAnnouncement',
            'prioritySeats',
            'wheelchairRamp',
        ]);

        // Canonical order, so the same five always read back the same way.
        expect(await restoredRequirements(PASSENGER_A)).toEqual([
            'wheelchairRamp',
            'prioritySeats',
            'audioAnnouncement',
            'lowFloorVehicle',
            'walkingAssistance',
        ]);
    });

    it('replaces the previous selection rather than accumulating', async () => {
        seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp', 'prioritySeats']);
        await savePreference(PASSENGER_A, ['lowFloorVehicle']);

        expect(await restoredRequirements(PASSENGER_A)).toEqual(['lowFloorVehicle']);
    });

    it('persists a cleared selection as a preference of its own', async () => {
        const store = seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp']);
        const { response } = await savePreference(PASSENGER_A, []);

        expect(response.status).toBe(200);
        // Written, not skipped: "I cleared my filters" has to survive leaving
        // the screen just as a selection does.
        expect(
            (await storedDoc(store, 'accessibility_needs_persons', PROFILE_A))
                ?.journeyAccessibilityRequirements
        ).toEqual([]);
        expect(await restoredRequirements(PASSENGER_A)).toEqual([]);
    });

    it('normalizes duplicates and ordering before storing', async () => {
        const store = seedStore();

        await savePreference(PASSENGER_A, [
            'prioritySeats',
            'wheelchairRamp',
            'prioritySeats',
            'wheelchairRamp',
        ]);

        expect(
            (await storedDoc(store, 'accessibility_needs_persons', PROFILE_A))
                ?.journeyAccessibilityRequirements
        ).toEqual(['wheelchairRamp', 'prioritySeats']);
    });

    it('creates the profile record and links it when the passenger has none yet', async () => {
        const store = seedStore({
            users: [storedUser(PASSENGER_A, null)],
            profiles: [],
        });

        const { response, json } = await savePreference(PASSENGER_A, ['wheelchairRamp']);

        expect(response.status).toBe(200);

        const user = await storedDoc(store, 'users', PASSENGER_A);
        // Without the pointer, the preference would live in a document nothing
        // could find again.
        expect(user?.accessibilityProfileId).toBe(json.profileId);
        expect(String(json.profileId)).toMatch(/^ACC-/);

        expect(await restoredRequirements(PASSENGER_A)).toEqual(['wheelchairRamp']);
    });

    it('does not disturb the passenger accessibility flags when saving a preference', async () => {
        const store = seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp']);

        expect(await storedDoc(store, 'users', PASSENGER_A)).toMatchObject({
            hasAccessibilityNeeds: true,
            isWheelchairUser: true,
            isLowVisionPerson: false,
        });
    });
});

// ==================================================================
// G. WHAT MAY NOT BE STORED
// ==================================================================
describe('requirements that are not recognised', () => {
    it('rejects an unknown key instead of storing it', async () => {
        const store = seedStore();

        const { response, json } = await savePreference(PASSENGER_A, ['wheelChairRamp']);

        expect(response.status).toBe(400);
        expect(json.success).toBe(false);
        expect(json.message).toMatch(/wheelChairRamp/);

        const stored = await storedDoc(store, 'accessibility_needs_persons', PROFILE_A);
        expect(stored?.journeyAccessibilityRequirements).toBeUndefined();
    });

    it('rejects the whole request rather than storing the recognised part', async () => {
        const store = seedStore();

        const { response } = await savePreference(PASSENGER_A, ['wheelchairRamp', 'teleporter']);

        expect(response.status).toBe(400);
        expect(
            (await storedDoc(store, 'accessibility_needs_persons', PROFILE_A))
                ?.journeyAccessibilityRequirements
        ).toBeUndefined();
    });

    it('rejects a value that is not a list', async () => {
        const store = seedStore();

        const { response, json } = await savePreference(PASSENGER_A, { wheelchairRamp: true });

        expect(response.status).toBe(400);
        expect(json.message).toMatch(/journeyAccessibilityRequirements/);
        expect(
            (await storedDoc(store, 'accessibility_needs_persons', PROFILE_A))
                ?.journeyAccessibilityRequirements
        ).toBeUndefined();
    });

    it('rejects entries that are not strings at all', async () => {
        seedStore();

        const { response } = await savePreference(PASSENGER_A, [42, null, { a: 1 }]);

        expect(response.status).toBe(400);
    });
});

// ==================================================================
// H. WHAT MAY ALREADY BE STORED
// ==================================================================
describe('a stored preference that is malformed', () => {
    const cases: [string, unknown][] = [
        ['a bare string', 'wheelchairRamp'],
        ['an object', { wheelchairRamp: true }],
        ['a number', 7],
        ['null', null],
        ['an empty object', {}],
    ];

    it.each(cases)('reads %s as no preference at all', async (_label, stored) => {
        seedStore({
            users: [storedUser(PASSENGER_A, PROFILE_A)],
            profiles: [
                storedProfile(PROFILE_A, PASSENGER_A, {
                    journeyAccessibilityRequirements: stored,
                }),
            ],
        });

        const { response, json } = await readProfile(PASSENGER_A);

        expect(response.status).toBe(200);
        expect(json.profile.journeyAccessibilityRequirements).toEqual([]);
    });

    it('keeps the recognised entries and drops the rest', async () => {
        seedStore({
            users: [storedUser(PASSENGER_A, PROFILE_A)],
            profiles: [
                storedProfile(PROFILE_A, PASSENGER_A, {
                    journeyAccessibilityRequirements: [
                        'wheelchairRamp',
                        'brailleSignage',
                        42,
                        'prioritySeats',
                    ],
                }),
            ],
        });

        const { json } = await readProfile(PASSENGER_A);

        expect(json.profile.journeyAccessibilityRequirements).toEqual([
            'wheelchairRamp',
            'prioritySeats',
        ]);
    });

    it('never lets a malformed entry become an active filter', async () => {
        seedStore({
            users: [storedUser(PASSENGER_A, PROFILE_A)],
            profiles: [
                storedProfile(PROFILE_A, PASSENGER_A, {
                    journeyAccessibilityRequirements: ['notARealFacility'],
                }),
            ],
        });

        const restored = await restoredRequirements(PASSENGER_A);
        const { tripIds } = await runJourneySearch(restored);

        expect(restored).toEqual([]);
        // Unfiltered, because nothing valid was ever asked for — not "filtered
        // by a requirement no vehicle can satisfy", which would show nothing.
        expect(tripIds).toEqual(['T-ACCESSIBLE', 'T-PLAIN']);
    });
});

// ==================================================================
// I. ONE PASSENGER, ONE PREFERENCE
// ==================================================================
describe('keeping preferences to their own passenger', () => {
    it('writes only to the profile of the passenger named in the request', async () => {
        const store = seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp', 'prioritySeats']);

        expect(
            (await storedDoc(store, 'accessibility_needs_persons', PROFILE_B))
                ?.journeyAccessibilityRequirements
        ).toBeUndefined();
    });

    it('returns each passenger only their own preference', async () => {
        seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp']);
        await savePreference(PASSENGER_B, ['audioAnnouncement', 'lowFloorVehicle']);

        expect(await restoredRequirements(PASSENGER_A)).toEqual(['wheelchairRamp']);
        expect(await restoredRequirements(PASSENGER_B)).toEqual([
            'audioAnnouncement',
            'lowFloorVehicle',
        ]);
    });

    it('resolves the record through the named passenger own profile pointer', async () => {
        // Passenger B's document points at B's profile, so a read for B can
        // only ever reach B's record however A's is written.
        const store = seedStore();

        await savePreference(PASSENGER_A, ['walkingAssistance']);

        const userB = await storedDoc(store, 'users', PASSENGER_B);
        expect(userB?.accessibilityProfileId).toBe(PROFILE_B);
        expect(await restoredRequirements(PASSENGER_B)).toEqual([]);
    });

    it('does not put a saved preference into the journey search response', async () => {
        seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp']);
        // A search that states nothing gets nothing back about anyone's saved
        // preference: the endpoint echoes only what this request asked for.
        const { json } = await runJourneySearch([]);

        expect(json.searchCriteria.accessibilityRequirements).toEqual([]);
        expect(JSON.stringify(json)).not.toContain('journeyAccessibilityRequirements');
    });
});

// ==================================================================
// J. THE RESTORED PREFERENCE ACTUALLY FILTERS
// ==================================================================
describe('a restored preference reaching the journey search', () => {
    it('filters the search the passenger runs next', async () => {
        seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp']);

        const restored = await restoredRequirements(PASSENGER_A);
        const { tripIds } = await runJourneySearch(restored);

        expect(restored).toEqual(['wheelchairRamp']);
        expect(tripIds).toEqual(['T-ACCESSIBLE']);
    });

    it('is accepted by the search exactly as a hand-made selection is', async () => {
        seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp', 'walkingAssistance']);

        const fromStorage = await runJourneySearch(await restoredRequirements(PASSENGER_A));
        const byHand = await runJourneySearch(['wheelchairRamp', 'walkingAssistance']);

        expect(fromStorage.tripIds).toEqual(byHand.tripIds);
        expect(fromStorage.json.searchCriteria.accessibilityRequirements).toEqual(
            byHand.json.searchCriteria.accessibilityRequirements
        );
    });

    it('stops filtering once the passenger clears it', async () => {
        seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp']);
        await savePreference(PASSENGER_A, []);

        const { tripIds } = await runJourneySearch(await restoredRequirements(PASSENGER_A));

        expect(tripIds).toEqual(['T-ACCESSIBLE', 'T-PLAIN']);
    });

    it('leaves the accessibility score and journey data alone', async () => {
        seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp']);

        const filtered = await runJourneySearch(await restoredRequirements(PASSENGER_A));
        const unfiltered = await runJourneySearch([]);

        const accessibleAfter = filtered.json.routes[0].trips[0];
        const accessibleBefore = unfiltered.json.routes[0].trips.find(
            (option: any) => option.trip.tripId === 'T-ACCESSIBLE'
        );

        expect(accessibleAfter).toEqual(accessibleBefore);
    });
});

// ==================================================================
// K. THE PROFILE THIS PREFERENCE LIVES ON
// ==================================================================
describe('living alongside the rest of the accessibility profile', () => {
    it('does not clear the profile when only the preference is saved', async () => {
        const store = seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp']);

        // The journey screen holds a filter selection, not a profile. It must
        // not be able to blank what the profile screen owns.
        expect(await storedDoc(store, 'accessibility_needs_persons', PROFILE_A)).toMatchObject({
            hasAccessibilityNeeds: true,
            accessibilityNeeds: ['wheelchair', 'low_vision'],
            requestedServices: { wheelchairRamp: true, vibratedDevices: false },
        });
    });

    it('does not clear the preference when the full profile is saved', async () => {
        const store = seedStore();

        await savePreference(PASSENGER_A, ['wheelchairRamp', 'lowFloorVehicle']);

        // Exactly the request the accessibility profile screen already sends —
        // it knows nothing about journey filters.
        const response = await saveAccessibilityProfile(
            new Request('http://localhost/api/accessibility-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    passengerId: PASSENGER_A,
                    userId: `UID-${PASSENGER_A}`,
                    accessibilityProfileId: PROFILE_A,
                    accessibilityNeeds: ['wheelchair'],
                    requestedServices: { wheelchairRamp: true, prioritySeats: false },
                }),
            })
        );

        expect(response.status).toBe(200);

        const stored = await storedDoc(store, 'accessibility_needs_persons', PROFILE_A);
        expect(stored?.accessibilityNeeds).toEqual(['wheelchair']);
        expect(stored?.journeyAccessibilityRequirements).toEqual([
            'wheelchairRamp',
            'lowFloorVehicle',
        ]);
    });

    it('still saves a full profile that does state the preference', async () => {
        const store = seedStore();

        const response = await saveAccessibilityProfile(
            new Request('http://localhost/api/accessibility-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    passengerId: PASSENGER_A,
                    userId: `UID-${PASSENGER_A}`,
                    accessibilityProfileId: PROFILE_A,
                    accessibilityNeeds: ['wheelchair'],
                    journeyAccessibilityRequirements: ['prioritySeats', 'prioritySeats'],
                }),
            })
        );

        expect(response.status).toBe(200);
        expect(
            (await storedDoc(store, 'accessibility_needs_persons', PROFILE_A))
                ?.journeyAccessibilityRequirements
        ).toEqual(['prioritySeats']);
    });
});
