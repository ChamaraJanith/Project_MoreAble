// Live transport data retrieval (MOV-120).
//
// The one thing that must never go wrong here is association: a passenger
// looking at a departure must be shown the position of the vehicle actually
// operating it, and never another vehicle's. These drive the real search
// endpoint against a database seeded with two buses and two positions, so the
// association is proved end to end rather than asserted on a helper.
//
// The rest covers the honest-absence behaviour: a bus that has never reported
// yields an explicit unavailable state, not a guess.

import { POST } from '../../../app/api/journeys/search+api';
import {
    buildLiveStatus,
    loadVehicleLocation,
    locationAgeSeconds,
} from '../../../src/shared/server/vehicleLocations';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

// The map providers are not part of live vehicle retrieval; the geo block is
// best-effort and unrelated to this data.
jest.mock('../../../src/shared/api/locationService', () => ({
    geocodeLocation: jest.fn(async () => null),
}));

jest.mock('../../../src/shared/api/routingService', () => ({
    getRouteBetweenCoordinates: jest.fn(async () => null),
    getRouteThroughCoordinates: jest.fn(async () => null),
}));

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------
const BUS_A = 'BUS-00001';
const BUS_B = 'BUS-00002';

function searchRequest(): Request {
    return new Request('http://localhost/api/journeys/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            origin: 'Kaduwela',
            destination: 'Borella',
            travelDate: '2026-08-20',
            travelTime: '08:30',
        }),
    });
}

const route = {
    id: '177_KADUWELA_KOLLUPITIYA',
    routeId: '177_KADUWELA_KOLLUPITIYA',
    routeNumber: '177',
    routeName: 'Kaduwela - Kollupitiya',
    startLocation: 'Kaduwela',
    endLocation: 'Kollupitiya',
    stops: ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella', 'Kollupitiya'],
    distanceKm: 22.5,
    estimatedDuration: '1h 15m',
    status: 'ACTIVE',
};

function bus(busId: string, numberPlate: string) {
    return {
        id: busId,
        busId,
        numberPlate,
        chassisNumber: 'CHS-0001',
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities: {
            wheelchairRamp: true,
            audioAnnouncement: true,
            lowFloorVehicle: true,
            walkingAssistance: false,
            wheelchairSpace: { available: true, count: 2 },
            guardianSeats: { available: true, count: 2 },
            prioritySeats: { available: true, count: 4 },
            elderlySeats: { available: true, count: 4 },
        },
        status: 'ACTIVE',
    };
}

function trip(tripId: string, busId: string, departureTime: string) {
    return {
        id: tripId,
        tripId,
        routeId: route.routeId,
        busId,
        departureTime,
        estimatedArrivalTime: '10:10',
        turnNumber: 1,
        status: 'ACTIVE',
    };
}

/** A position on the corridor. Only ever a value a device actually reported. */
function position(busId: string, latitude: number, longitude: number, recordedAt: string) {
    return { id: busId, busId, latitude, longitude, recordedAt };
}

const POSITION_A = position(BUS_A, 6.9061, 79.9558, '2026-08-20T09:05:00.000Z');
const POSITION_B = position(BUS_B, 6.9147, 79.8778, '2026-08-20T09:06:00.000Z');

/** Two departures on two different vehicles, each with its own position. */
function twoVehicleDb() {
    return createFakeFirestore({
        routes: [route],
        buses: [bus(BUS_A, 'NB-1234'), bus(BUS_B, 'NB-5678')],
        trips: [trip('TRIP-00001', BUS_A, '09:00'), trip('TRIP-00002', BUS_B, '09:30')],
        vehicleLocations: [POSITION_A, POSITION_B],
    });
}

async function search(db: ReturnType<typeof createFakeFirestore>) {
    mockGetAdminDb.mockReturnValue(db);
    return (await POST(searchRequest())).json();
}

/** The option for one trip, out of the single matched route. */
function optionFor(json: any, tripId: string) {
    return json.routes[0].trips.find((option: any) => option.trip.tripId === tripId);
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ==================================================================
// ASSOCIATION — the invariant
// ==================================================================
describe('live location is associated through the trip own busId', () => {
    it('gives each departure the position of the vehicle operating it', async () => {
        const json = await search(twoVehicleDb());

        const first = optionFor(json, 'TRIP-00001');
        const second = optionFor(json, 'TRIP-00002');

        expect(first.bus.busId).toBe(BUS_A);
        expect(first.liveStatus.location).toEqual({
            busId: BUS_A,
            latitude: 6.9061,
            longitude: 79.9558,
            recordedAt: '2026-08-20T09:05:00.000Z',
        });

        expect(second.bus.busId).toBe(BUS_B);
        expect(second.liveStatus.location).toEqual({
            busId: BUS_B,
            latitude: 6.9147,
            longitude: 79.8778,
            recordedAt: '2026-08-20T09:06:00.000Z',
        });
    });

    it('never lets one vehicle position reach another vehicle trip', async () => {
        const json = await search(twoVehicleDb());

        for (const option of json.routes[0].trips) {
            // The bus shown and the position shown are the same vehicle, always.
            expect(option.liveStatus.location.busId).toBe(option.bus.busId);
        }
    });

    it('reports only the position of the one bus that is reporting', async () => {
        // BUS-00002 has never reported; BUS-00001 has.
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus(BUS_A, 'NB-1234'), bus(BUS_B, 'NB-5678')],
            trips: [trip('TRIP-00001', BUS_A, '09:00'), trip('TRIP-00002', BUS_B, '09:30')],
            vehicleLocations: [POSITION_A],
        });

        const json = await search(db);

        expect(optionFor(json, 'TRIP-00001').liveStatus.available).toBe(true);
        expect(optionFor(json, 'TRIP-00002').liveStatus.available).toBe(false);
        expect(optionFor(json, 'TRIP-00002').liveStatus.location).toBeUndefined();
    });
});

// ==================================================================
// MISSING DATA — absence is a real answer
// ==================================================================
describe('a vehicle that has never reported', () => {
    it('returns an explicit unavailable state rather than omitting the block', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus(BUS_A, 'NB-1234')],
            trips: [trip('TRIP-00001', BUS_A, '09:00')],
        });

        const { liveStatus } = optionFor(await search(db), 'TRIP-00001');

        expect(liveStatus).toEqual({
            available: false,
            message: 'Live location is not available for this vehicle yet.',
        });
    });

    it('invents no coordinates from the stops the route passes through', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus(BUS_A, 'NB-1234')],
            trips: [trip('TRIP-00001', BUS_A, '09:00')],
            // Stop coordinates exist and are used for the map — they must never
            // stand in for where the vehicle is.
            stops: [
                { id: 'kaduwela', name: 'Kaduwela', latitude: 6.9333, longitude: 79.9833 },
                { id: 'borella', name: 'Borella', latitude: 6.9147, longitude: 79.8778 },
            ],
        });

        const { liveStatus } = optionFor(await search(db), 'TRIP-00001');

        expect(liveStatus.available).toBe(false);
        expect(liveStatus.location).toBeUndefined();
        expect(liveStatus.locationAgeSeconds).toBeUndefined();
    });
});

// ==================================================================
// EXISTING BEHAVIOUR
// ==================================================================
describe('the rest of journey search is unaffected', () => {
    it('still returns the route, scheduled times, bus and accessibility data', async () => {
        const json = await search(twoVehicleDb());

        expect(json.success).toBe(true);
        expect(json.count).toBe(1);

        const match = json.routes[0];
        expect(match.routeId).toBe(route.routeId);
        expect(match.routeNumber).toBe('177');
        // The partial journey stays partial: only the travelled segment.
        expect(match.journeyStops).toEqual([
            'Kaduwela',
            'Malabe',
            'Battaramulla',
            'Rajagiriya',
            'Borella',
        ]);
        expect(match.trips).toHaveLength(2);

        const first = optionFor(json, 'TRIP-00001');
        // Scheduled times keep their meaning and their names.
        expect(first.trip.departureTime).toBe('09:00');
        expect(first.trip.estimatedArrivalTime).toBe('10:10');
        expect(first.bus.numberPlate).toBe('NB-1234');
        expect(first.bus.accessibilityFacilities.wheelchairRamp).toBe(true);
    });

    it('exposes no fleet or administrative data through the live block', async () => {
        const { liveStatus } = optionFor(await search(twoVehicleDb()), 'TRIP-00001');

        expect(Object.keys(liveStatus).sort()).toEqual([
            'available',
            'location',
            'locationAgeSeconds',
        ]);
        expect(Object.keys(liveStatus.location).sort()).toEqual([
            'busId',
            'latitude',
            'longitude',
            'recordedAt',
        ]);
    });
});

// ==================================================================
// READS
// ==================================================================
describe('vehicle location reads', () => {
    it('reads the position once when two departures share a vehicle', async () => {
        const db = createFakeFirestore({
            routes: [route],
            buses: [bus(BUS_A, 'NB-1234')],
            trips: [trip('TRIP-00001', BUS_A, '09:00'), trip('TRIP-00002', BUS_A, '11:00')],
            vehicleLocations: [POSITION_A],
        });

        // Counts reads of the location document itself, not of the collection.
        let locationReads = 0;
        const realCollection = db.collection;
        db.collection = jest.fn((name: string) => {
            const handle = realCollection(name);
            if (name !== 'vehicleLocations') return handle;

            return {
                ...handle,
                doc: jest.fn((id: string) => {
                    const docHandle = handle.doc(id);
                    return {
                        ...docHandle,
                        get: jest.fn(async () => {
                            locationReads += 1;
                            return docHandle.get();
                        }),
                    };
                }),
            };
        }) as any;

        const json = await search(db);

        expect(json.routes[0].trips).toHaveLength(2);
        expect(locationReads).toBe(1);
    });

    it('returns the stored position for the requested bus', async () => {
        const db = createFakeFirestore({ vehicleLocations: [POSITION_A, POSITION_B] });

        expect(await loadVehicleLocation(db, BUS_B)).toEqual({
            busId: BUS_B,
            latitude: 6.9147,
            longitude: 79.8778,
            recordedAt: '2026-08-20T09:06:00.000Z',
        });
    });

    it('returns null for a bus with no position, an empty id, or a broken record', async () => {
        const db = createFakeFirestore({
            vehicleLocations: [
                POSITION_A,
                // Reached the collection some other way — unusable, so it counts
                // as no position rather than reaching a passenger as NaN.
                { id: 'BUS-00009', busId: 'BUS-00009', latitude: 'north', longitude: 79.9 },
            ],
        });

        expect(await loadVehicleLocation(db, 'BUS-00404')).toBeNull();
        expect(await loadVehicleLocation(db, '')).toBeNull();
        expect(await loadVehicleLocation(db, 'BUS-00009')).toBeNull();
    });

    it('survives a Firestore failure without failing the caller', async () => {
        const failingDb = {
            collection: () => ({
                doc: () => ({ get: async () => { throw new Error('Firestore unavailable'); } }),
            }),
        };

        expect(await loadVehicleLocation(failingDb, BUS_A)).toBeNull();
    });
});

// ==================================================================
// FIX AGE
// ==================================================================
describe('how old the reported fix is', () => {
    const now = new Date('2026-08-20T09:07:30.000Z');

    it('measures from the GPS fix time, not the database write time', () => {
        // The fix was taken at 09:05:00; 150 seconds before `now`.
        expect(locationAgeSeconds('2026-08-20T09:05:00.000Z', now)).toBe(150);
    });

    it('reports a device clock that runs ahead rather than hiding it', () => {
        expect(locationAgeSeconds('2026-08-20T09:08:00.000Z', now)).toBe(-30);
    });

    it('returns null for a timestamp it cannot read', () => {
        expect(locationAgeSeconds('yesterday morning', now)).toBeNull();
    });

    it('carries the age alongside the position, applying no threshold to it', () => {
        const status = buildLiveStatus(
            {
                busId: BUS_A,
                latitude: 6.9061,
                longitude: 79.9558,
                recordedAt: '2026-08-20T09:05:00.000Z',
            },
            now
        );

        expect(status).toEqual({
            available: true,
            location: {
                busId: BUS_A,
                latitude: 6.9061,
                longitude: 79.9558,
                recordedAt: '2026-08-20T09:05:00.000Z',
            },
            locationAgeSeconds: 150,
        });

        // No live/stale verdict is reached here — that threshold is a business
        // decision the project has not made. See the MOV-120 report.
        expect(status).not.toHaveProperty('stale');
        expect(status).not.toHaveProperty('live');
    });

    it('measures every departure in one response against the same clock', async () => {
        const json = await search(twoVehicleDb());

        const ages = json.routes[0].trips.map((option: any) => option.liveStatus.locationAgeSeconds);

        // The two fixes are exactly 60 seconds apart, so their ages must differ
        // by exactly 60 — not by 60 plus however long the response took.
        expect(ages[0] - ages[1]).toBe(60);
    });
});
