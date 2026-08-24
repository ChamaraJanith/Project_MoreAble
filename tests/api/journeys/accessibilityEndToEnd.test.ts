// The whole accessibility journey, in one chain (MOV-110).
//
// Twelve stories built this feature and each is covered by its own suite. This
// file exists for the thing none of them can prove alone: that the SAME facility
// record travels the entire lifecycle — admin write, Firestore, retrieval,
// score, ranking, filter, saved preference, and finally the chips a passenger
// reads on Route Details — without any layer quietly disagreeing with another.
//
// Deliberately narrow. Nothing here re-tests a rule that already has a home:
//
//   * MOV-92/94 own the filtering rules and the ranking integration.
//   * MOV-93 owns preference persistence and passenger isolation.
//   * MOV-107 owns the display mapping, MOV-108 the read mechanics, MOV-109 the
//     storage fidelity.
//
// What is asserted below is only ever a JOIN between two layers, and the
// invariant that matters most to a passenger is the last one: a departure the
// filter kept because it has a ramp must also SHOW a ramp when they open it.
// Those two answers come from different functions in different layers, and
// nothing until now checked that they agree.
//
// Every fixture is written through the real admin endpoints, so the record under
// test is one the product actually produces. No score is written down; no
// facility rule is re-implemented; no credential literal appears — the one bus
// password is built by the project's existing helper.

import { POST as createBus } from '../../../app/api/buses/index+api';
import {
    GET as getAccessibilityProfile,
    POST as saveAccessibilityProfile,
} from '../../../app/api/accessibility-profile/index+api';
import { POST as searchJourneys } from '../../../app/api/journeys/search+api';
import { POST as createRoute } from '../../../app/api/routes/index+api';
import { POST as createTrip } from '../../../app/api/trips/index+api';
import { describeAccessibilityFacilities } from '../../../src/features/journey/utils/accessibilityFacilities';
import {
    RecommendedJourney,
    toRecommendedJourneys,
} from '../../../src/features/journey/utils/journeyRecommendations';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import {
    AccessibilityRequirementKey,
    computeAccessibilityScore,
} from '../../../src/shared/utils/accessibility';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';
import { FULLY_EQUIPPED, makeStop, PARTLY_EQUIPPED } from '../../testUtils/journeyFixtures';
import { buildTestPassword } from '../../testUtils/testPassword';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

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

const ROUTE_ID = '177_KADUWELA_KOLLUPITIYA';
const STOPS = ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella'];

const STOP_DOCS = [
    makeStop('Kaduwela', 6.9333, 79.9833),
    makeStop('Malabe', 6.9061, 79.9558),
    makeStop('Battaramulla', 6.8994, 79.9186),
    makeStop('Rajagiriya', 6.9094, 79.8944),
    makeStop('Borella', 6.9147, 79.8778),
];

const PASSENGER_ID = 'PAS-2026-00110';
const PROFILE_ID = 'ACC-2026-00110';

function post(path: string, body: unknown): Request {
    return new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function busPayload(numberPlate: string, accessibilityFacilities: unknown) {
    return {
        // Built at run time by the project's helper; never a literal.
        password: buildTestPassword('fleet'),
        numberPlate,
        chassisNumber: `CHS-${numberPlate}`,
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities,
    };
}

/**
 * The whole fleet, written through the real admin endpoints into one database.
 *
 * Two vehicles that differ in exactly the way a passenger cares about: one is
 * fully equipped, the other has a ramp and priority seats and nothing else.
 */
async function seedThroughAdminApi() {
    const db = createFakeFirestore({
        stops: STOP_DOCS,
        users: [
            {
                id: PASSENGER_ID,
                passengerId: PASSENGER_ID,
                uid: `UID-${PASSENGER_ID}`,
                accessibilityProfileId: PROFILE_ID,
                hasAccessibilityNeeds: true,
            },
        ],
        accessibility_needs_persons: [
            {
                id: PROFILE_ID,
                accessibilityProfileId: PROFILE_ID,
                passengerId: PASSENGER_ID,
                userId: `UID-${PASSENGER_ID}`,
                hasAccessibilityNeeds: true,
                accessibilityNeeds: ['wheelchair'],
                createdAt: '2026-08-01T10:00:00.000Z',
                updatedAt: '2026-08-01T10:00:00.000Z',
            },
        ],
    });

    mockGetAdminDb.mockReturnValue(db);

    const equipped = await (
        await createBus(post('/api/buses', busPayload('NB-7001', FULLY_EQUIPPED)))
    ).json();
    const partial = await (
        await createBus(post('/api/buses', busPayload('NB-7002', PARTLY_EQUIPPED)))
    ).json();

    expect(equipped.success).toBe(true);
    expect(partial.success).toBe(true);

    const routeJson = await (
        await createRoute(
            post('/api/routes', {
                routeId: ROUTE_ID,
                routeNumber: '177',
                routeName: 'Kaduwela - Kollupitiya',
                direction: 'OUTBOUND',
                startLocation: 'Kaduwela',
                endLocation: 'Borella',
                startStopId: 'kaduwela',
                endStopId: 'borella',
                stops: STOPS,
                distanceKm: 20,
                estimatedDuration: '1 hr 9 min',
                segmentDurationsMinutes: [8, 6, 12, 15],
                status: 'ACTIVE',
            })
        )
    ).json();

    expect(routeJson.success).toBe(true);

    const equippedTrip = await (
        await createTrip(
            post('/api/trips', {
                routeId: ROUTE_ID,
                busId: equipped.bus.busId,
                departureTime: '08:00',
                estimatedArrivalTime: '09:10',
                turnNumber: 1,
                status: 'ACTIVE',
            })
        )
    ).json();

    const partialTrip = await (
        await createTrip(
            post('/api/trips', {
                routeId: ROUTE_ID,
                busId: partial.bus.busId,
                departureTime: '08:30',
                estimatedArrivalTime: '09:40',
                turnNumber: 2,
                status: 'ACTIVE',
            })
        )
    ).json();

    expect(equippedTrip.success).toBe(true);
    expect(partialTrip.success).toBe(true);

    return {
        db,
        equippedBusId: equipped.bus.busId,
        partialBusId: partial.bus.busId,
        equippedTripId: equippedTrip.trip.tripId,
        partialTripId: partialTrip.trip.tripId,
    };
}

interface SearchOptions {
    requirements?: AccessibilityRequirementKey[];
    origin?: string;
    destination?: string;
}

async function search(options: SearchOptions = {}) {
    const body: Record<string, unknown> = {
        origin: options.origin ?? 'Kaduwela',
        destination: options.destination ?? 'Borella',
        travelDate: '2026-08-25',
        travelTime: '05:00',
    };

    if (options.requirements) body.accessibilityRequirements = options.requirements;

    const response = await searchJourneys(post('/api/journeys/search', body));
    const json = await response.json();

    return { response, json, journeys: toRecommendedJourneys(json.routes ?? []) };
}

const journeyFor = (journeys: RecommendedJourney[], tripId: string) =>
    journeys.find((journey) => journey.option.trip.tripId === tripId);

const orderOf = (journeys: RecommendedJourney[]) =>
    journeys.map((journey) => journey.option.trip.tripId);

/** Saves the passenger's filters exactly as the journey screen does (MOV-93). */
async function savePreference(requirements: AccessibilityRequirementKey[]) {
    const response = await saveAccessibilityProfile(
        post('/api/accessibility-profile', {
            passengerId: PASSENGER_ID,
            journeyAccessibilityRequirements: requirements,
        })
    );

    expect(response.status).toBe(200);
}

/** Restores them the way the screen does on its next visit. */
async function restorePreference(): Promise<AccessibilityRequirementKey[]> {
    const response = await getAccessibilityProfile(
        new Request(
            `http://localhost/api/accessibility-profile?passengerId=${encodeURIComponent(PASSENGER_ID)}`
        )
    );

    const json = await response.json();
    return json?.profile?.journeyAccessibilityRequirements ?? [];
}

beforeEach(() => {
    jest.clearAllMocks();

    mockGeocodeLocation.mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    mockGetRoute.mockResolvedValue({ distanceKm: 20, durationMinutes: 69 });
    mockGetRouteThrough.mockResolvedValue({ distanceKm: 20, durationMinutes: 69 });
});

// ==================================================================
// ADMIN -> DATABASE -> PASSENGER, WITHOUT LOSING ANYTHING
// ==================================================================
describe('the record the admin entered is the record the passenger receives', () => {
    it('delivers each vehicle its own facilities, exactly as recorded', async () => {
        const { equippedTripId, partialTripId } = await seedThroughAdminApi();
        const { journeys } = await search();

        expect(journeyFor(journeys, equippedTripId)?.option.bus?.accessibilityFacilities).toEqual(
            FULLY_EQUIPPED
        );
        expect(journeyFor(journeys, partialTripId)?.option.bus?.accessibilityFacilities).toEqual(
            PARTLY_EQUIPPED
        );
    });

    it('scores each vehicle from the facilities delivered with it', async () => {
        const { equippedTripId, partialTripId } = await seedThroughAdminApi();
        const { journeys } = await search();

        for (const tripId of [equippedTripId, partialTripId]) {
            const journey = journeyFor(journeys, tripId);

            // MOV-79's figure over the record in the same response — never a
            // number this file decides, never another vehicle's record.
            expect(journey?.accessibilityScore).toBe(
                computeAccessibilityScore(journey?.option.bus?.accessibilityFacilities)
            );
        }
    });

    it('leaves the fleet credential behind while carrying the facilities', async () => {
        const { equippedTripId } = await seedThroughAdminApi();
        const { journeys } = await search();

        const vehicle = journeyFor(journeys, equippedTripId)?.option.bus as any;

        expect(vehicle.accessibilityFacilities).toEqual(FULLY_EQUIPPED);
        expect(vehicle.password).toBeUndefined();
        expect(vehicle.passwordHash).toBeUndefined();
    });

    it('recommends the better equipped vehicle first', async () => {
        const { equippedTripId, partialTripId } = await seedThroughAdminApi();
        const { journeys } = await search();

        // Ordering is MOV-87's; this only checks it still acts on the score that
        // travelled with each vehicle.
        expect(orderOf(journeys)).toEqual([equippedTripId, partialTripId]);
    });

    it('measures the passenger own journey, not the whole route', async () => {
        const { equippedTripId } = await seedThroughAdminApi();
        // Boarding and alighting partway along the route (MOV-88).
        const { json, journeys } = await search({
            origin: 'Malabe',
            destination: 'Rajagiriya',
        });

        const journey = journeyFor(journeys, equippedTripId);

        expect(journey?.display.durationLabel).toBe('18m');
        expect(journey?.display.departureLabel).toBe('8:08 AM');
        // The route's own total is 20 km and 1 hr 9 min; neither is borrowed.
        expect(json.routes[0].distanceKm).toBe(20);
        expect(journey?.display.distanceLabel).not.toBe('20 km');
        expect(journey?.display.travelsWholeRoute).toBe(false);
    });
});

// ==================================================================
// THE INVARIANT ACROSS THE LAYERS
//
// The filter decides what a passenger is shown; the facility list decides what
// they read when they open it. Two functions, two layers, one promise.
// ==================================================================
describe('what the filter kept is what the details screen shows', () => {
    const REQUIREMENTS: AccessibilityRequirementKey[] = [
        'wheelchairRamp',
        'prioritySeats',
        'audioAnnouncement',
        'lowFloorVehicle',
        'walkingAssistance',
    ];

    it.each(REQUIREMENTS)(
        'shows %s on every departure the filter kept for it',
        async (requirement) => {
            await seedThroughAdminApi();
            const { journeys } = await search({ requirements: [requirement] });

            expect(journeys.length).toBeGreaterThan(0);

            for (const journey of journeys) {
                const summary = describeAccessibilityFacilities(
                    journey.option.bus?.accessibilityFacilities
                );

                // A departure kept because it has this facility must be able to
                // show it. Anything else would be the search and the screen
                // disagreeing about the same vehicle.
                expect(summary.status).toBe('AVAILABLE');
                expect(summary.items.map((item) => item.key)).toContain(requirement);
            }
        }
    );

    it('never shows a facility on a departure the filter would have excluded', async () => {
        const { partialTripId } = await seedThroughAdminApi();

        // The partially equipped bus has no audio announcements, so it is not
        // offered for that requirement...
        const filtered = await search({ requirements: ['audioAnnouncement'] });
        expect(orderOf(filtered.journeys)).not.toContain(partialTripId);

        // ...and does not claim to have them when it is shown unfiltered.
        const unfiltered = await search();
        const summary = describeAccessibilityFacilities(
            journeyFor(unfiltered.journeys, partialTripId)?.option.bus?.accessibilityFacilities
        );

        expect(summary.items.map((item) => item.key)).not.toContain('audioAnnouncement');
        expect(summary.items.map((item) => item.key)).toEqual(
            expect.arrayContaining(['wheelchairRamp', 'prioritySeats'])
        );
    });

    it('carries a counted facility through to the words the passenger reads', async () => {
        const { equippedTripId } = await seedThroughAdminApi();
        const { journeys } = await search({ requirements: ['prioritySeats'] });

        const facilities = journeyFor(journeys, equippedTripId)?.option.bus
            ?.accessibilityFacilities;

        // Stored as a count on the vehicle, delivered whole, rendered as words.
        expect(facilities?.prioritySeats).toEqual(FULLY_EQUIPPED.prioritySeats);
        expect(describeAccessibilityFacilities(facilities).items.map((item) => item.label)).toEqual(
            expect.arrayContaining(['4 priority seats', '2 wheelchair spaces'])
        );
    });
});

// ==================================================================
// THE SAVED PREFERENCE DRIVES THE SAME JOURNEY
// ==================================================================
describe('a returning passenger', () => {
    it('restores the filters they left and gets the same results', async () => {
        const { equippedTripId } = await seedThroughAdminApi();

        await savePreference(['wheelchairRamp', 'audioAnnouncement']);

        const restored = await restorePreference();
        const fromPreference = await search({ requirements: restored });
        const byHand = await search({
            requirements: ['wheelchairRamp', 'audioAnnouncement'],
        });

        expect(restored).toEqual(['wheelchairRamp', 'audioAnnouncement']);
        expect(orderOf(fromPreference.journeys)).toEqual([equippedTripId]);
        expect(orderOf(fromPreference.journeys)).toEqual(orderOf(byHand.journeys));
    });

    it('sees every departure again after clearing them', async () => {
        const { equippedTripId, partialTripId } = await seedThroughAdminApi();

        await savePreference(['audioAnnouncement']);
        await savePreference([]);

        const { journeys } = await search({ requirements: await restorePreference() });

        expect(orderOf(journeys)).toEqual([equippedTripId, partialTripId]);
    });

    it('keeps the rest of their accessibility profile untouched', async () => {
        const { db } = await seedThroughAdminApi();

        await savePreference(['wheelchairRamp']);

        const profile = (
            await db.collection('accessibility_needs_persons').doc(PROFILE_ID).get()
        ).data();

        // The journey screen saves a filter selection, not a profile.
        expect(profile?.accessibilityNeeds).toEqual(['wheelchair']);
        expect(profile?.hasAccessibilityNeeds).toBe(true);
        expect(profile?.journeyAccessibilityRequirements).toEqual(['wheelchairRamp']);
    });
});
