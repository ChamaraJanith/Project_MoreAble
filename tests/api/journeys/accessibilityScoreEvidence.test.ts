// The accessibility score, end to end, from stored evidence (MOV-79).
//
// Seeds the collections the score actually reads — buses, reports, busRatings —
// in the shapes their own APIs write, then asks every endpoint that reports
// `accessibilityScore` for it. They must all agree, with each other and with
// the shared function, and each bus must be scored from its own evidence only.
//
// No credential appears here: ratings name passengers by plain test ids, and no
// bus record carries a password.

import { GET as getBookingOptions } from '../../../app/api/booking/options+api';
import { GET as getBookingSeats } from '../../../app/api/booking/seats/[tripId]+api';
import { POST as searchJourneys } from '../../../app/api/journeys/search+api';
import { Bus, BusAccessibilityFacilities } from '../../../src/entities/bus/model/types';
import { Route } from '../../../src/entities/route/model/types';
import { Trip } from '../../../src/entities/trip/model/types';
import { geocodeLocation } from '../../../src/shared/api/locationService';
import {
    getRouteBetweenCoordinates,
    getRouteThroughCoordinates,
} from '../../../src/shared/api/routingService';
import { busRatingDocumentId } from '../../../src/shared/server/busRating';
import { loadAccessibilityScoreEvidence } from '../../../src/shared/server/accessibilityScoreEvidence';
import { computeAccessibilityScore } from '../../../src/shared/utils/accessibility';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

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

const ROUTE_ID = '177_KADUWELA_KOLLUPITIYA';

const route: Route & { id: string } = {
    id: ROUTE_ID,
    routeId: ROUTE_ID,
    routeNumber: '177',
    routeName: 'Kaduwela - Kollupitiya',
    startLocation: 'Kaduwela',
    endLocation: 'Kollupitiya',
    stops: ['Kaduwela', 'Malabe', 'Battaramulla', 'Rajagiriya', 'Borella', 'Kollupitiya'],
    distanceKm: 22.5,
    estimatedDuration: '1h 15m',
    status: 'ACTIVE',
};

/** Six of the eight facilities: no walking assistance, no guardian seats. */
const SIX_OF_EIGHT: BusAccessibilityFacilities = {
    wheelchairRamp: true,
    audioAnnouncement: true,
    lowFloorVehicle: true,
    walkingAssistance: false,
    wheelchairSpace: { available: true, count: 2 },
    guardianSeats: { available: false, count: 0 },
    prioritySeats: { available: true, count: 4 },
    elderlySeats: { available: true, count: 4 },
};

function bus(busId: string, numberPlate: string, facilities: BusAccessibilityFacilities): Bus & { id: string } {
    return {
        id: busId,
        busId,
        numberPlate,
        chassisNumber: `CHS-${busId}`,
        busModel: 'Ashok Leyland Viking',
        manufacturer: 'Ashok Leyland',
        manufactureYear: 2025,
        seatCapacity: 54,
        accessibilityFacilities: facilities,
        status: 'ACTIVE',
    };
}

function trip(tripId: string, busId: string, departureTime: string): Trip & { id: string } {
    return {
        id: tripId,
        tripId,
        routeId: ROUTE_ID,
        busId,
        departureTime,
        estimatedArrivalTime: '10:10',
        turnNumber: 1,
        status: 'ACTIVE',
    };
}

let reportSeq = 0;
/** A report as POST /api/reports stores it: POSITIVE carries `type`, an ISSUE does not. */
function report(busId: string | undefined, status: string, positive: boolean) {
    reportSeq += 1;
    const reportId = `REPORT-${reportSeq}`;
    return {
        id: reportId,
        reportId,
        passengerId: `PASSENGER-${reportSeq}`,
        ...(positive ? { type: 'POSITIVE', category: 'HELPFUL_DRIVER' } : { issueCategory: 'BROKEN_RAMP' }),
        description: 'Test report.',
        status,
        ...(busId ? { busId, vehicle: { numberPlate: 'NB-0000' } } : {}),
        createdAt: '2026-09-01T08:00:00.000Z',
        updatedAt: '2026-09-01T08:00:00.000Z',
    };
}

let ratingSeq = 0;
/** A rating as submitBusRating stores it. */
function rating(busId: string, stars: number) {
    ratingSeq += 1;
    const passengerId = `PASSENGER-R${ratingSeq}`;
    const tripId = `TRIP-RUN-${ratingSeq}`;
    const journeyStartedAt = '2026-09-01T08:00:00.000Z';
    const ratingId = busRatingDocumentId(passengerId, tripId, journeyStartedAt);
    return {
        id: ratingId,
        ratingId,
        passengerId,
        bookingId: `BOOKING-${ratingSeq}`,
        busId,
        tripId,
        journeyStartedAt,
        rating: stars,
        createdAt: '2026-09-01T09:00:00.000Z',
    };
}

const repeat = <T>(count: number, make: () => T): T[] => Array.from({ length: count }, make);

/**
 * BUS-RATED: the specification's worked example — 6/8 facilities, 8 verified
 * positive + 2 verified issue, 20 ratings averaging 4.2 — plus evidence that
 * must NOT count. BUS-PLAIN: same facilities, no evidence at all.
 */
function seed() {
    return createFakeFirestore({
        routes: [route],
        buses: [bus('BUS-RATED', 'NB-1111', SIX_OF_EIGHT), bus('BUS-PLAIN', 'NB-2222', SIX_OF_EIGHT)],
        trips: [
            trip('TRIP-RATED-AM', 'BUS-RATED', '09:00'),
            trip('TRIP-RATED-PM', 'BUS-RATED', '11:00'),
            trip('TRIP-PLAIN', 'BUS-PLAIN', '09:30'),
        ],
        reports: [
            ...repeat(8, () => report('BUS-RATED', 'VERIFIED', true)),
            ...repeat(2, () => report('BUS-RATED', 'VERIFIED', false)),
            // None of these may move the score.
            ...repeat(4, () => report('BUS-RATED', 'PENDING', false)),
            ...repeat(4, () => report('BUS-RATED', 'REJECTED', false)),
            ...repeat(3, () => report(undefined, 'VERIFIED', false)),
            ...repeat(3, () => report('BUS-ELSEWHERE', 'VERIFIED', false)),
        ],
        busRatings: [
            // 4 * 5 + 16 * 4 = 84 over 20 ratings: an average of 4.2.
            ...repeat(4, () => rating('BUS-RATED', 5)),
            ...repeat(16, () => rating('BUS-RATED', 4)),
            ...repeat(5, () => rating('BUS-ELSEWHERE', 1)),
        ],
    });
}

const RATED_EVIDENCE = {
    community: { positiveCount: 8, issueCount: 2 },
    ratings: { count: 20, total: 84 },
};

async function search(db: ReturnType<typeof createFakeFirestore>) {
    mockGetAdminDb.mockReturnValue(db);
    const response = await searchJourneys(
        new Request('http://localhost/api/journeys/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                origin: 'Kaduwela',
                destination: 'Borella',
                travelDate: '2026-09-22',
                travelTime: '08:00',
            }),
        })
    );
    return response.json();
}

const searchScoreOf = (json: any, tripId: string) =>
    json.routes[0].trips.find((option: any) => option.trip.tripId === tripId).bus.accessibilityScore;

beforeEach(() => {
    jest.clearAllMocks();
    (geocodeLocation as jest.Mock).mockResolvedValue({
        latitude: 6.9333,
        longitude: 79.9833,
        displayName: 'Mocked Location, Sri Lanka',
    });
    (getRouteBetweenCoordinates as jest.Mock).mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
    (getRouteThroughCoordinates as jest.Mock).mockResolvedValue({ distanceKm: 22.5, durationMinutes: 69 });
});

describe('loading the evidence for one bus', () => {
    it('counts only verified reports and valid ratings of that bus', async () => {
        await expect(loadAccessibilityScoreEvidence(seed(), 'BUS-RATED')).resolves.toEqual(RATED_EVIDENCE);
    });

    it('finds nothing for a bus nobody has reported on or rated', async () => {
        await expect(loadAccessibilityScoreEvidence(seed(), 'BUS-PLAIN')).resolves.toEqual({
            community: { positiveCount: 0, issueCount: 0 },
            ratings: { count: 0, total: 0 },
        });
    });

    it('asks nothing of the database for a trip naming no bus', async () => {
        const db = seed();
        await expect(loadAccessibilityScoreEvidence(db, '  ')).resolves.toEqual({});
        expect(db.collection).not.toHaveBeenCalled();
    });

    it('ignores a stored rating that is not a whole 1–5', async () => {
        const db = createFakeFirestore({
            busRatings: [rating('BUS-X', 5), { ...rating('BUS-X', 5), rating: '5' }, { ...rating('BUS-X', 5), rating: 0 }],
        });
        const evidence = await loadAccessibilityScoreEvidence(db, 'BUS-X');
        expect(evidence.ratings).toEqual({ count: 1, total: 5 });
    });
});

describe('journey search', () => {
    it('scores the worked example as 73', async () => {
        const json = await search(seed());

        expect(searchScoreOf(json, 'TRIP-RATED-AM')).toBe(73);
        expect(searchScoreOf(json, 'TRIP-RATED-AM')).toBe(computeAccessibilityScore(SIX_OF_EIGHT, RATED_EVIDENCE));
    });

    it('scores a bus with no evidence from its facilities and the neutral baseline', async () => {
        const json = await search(seed());

        // 75 * 0.5 + 50 * 0.3 + 50 * 0.2 = 62.5 -> 63
        expect(searchScoreOf(json, 'TRIP-PLAIN')).toBe(63);
        expect(searchScoreOf(json, 'TRIP-PLAIN')).toBe(computeAccessibilityScore(SIX_OF_EIGHT));
    });

    it('gives every departure of one bus the same score, reading its evidence once', async () => {
        const db = seed();
        const json = await search(db);

        expect(searchScoreOf(json, 'TRIP-RATED-PM')).toBe(searchScoreOf(json, 'TRIP-RATED-AM'));

        const reportReads = db.collection.mock.calls.filter(([name]: [string]) => name === 'reports').length;
        const ratingReads = db.collection.mock.calls.filter(([name]: [string]) => name === 'busRatings').length;
        // Two distinct buses on the route: one read of each collection per bus.
        expect(reportReads).toBe(2);
        expect(ratingReads).toBe(2);
    });

    it('never changes the stored bus record', async () => {
        const db = seed();
        await search(db);

        const stored = (await db.collection('buses').doc('BUS-RATED').get()).data();
        expect(stored?.accessibilityFacilities).toEqual(SIX_OF_EIGHT);
    });
});

describe('booking', () => {
    it('reports the same score on the transport options as the search does', async () => {
        const db = seed();
        const expectedRated = searchScoreOf(await search(db), 'TRIP-RATED-AM');

        mockGetAdminDb.mockReturnValue(db);
        const response = await getBookingOptions(
            new Request(`http://localhost/api/booking/options?routeId=${ROUTE_ID}`)
        );
        const json = await response.json();
        const scoreOf = (tripId: string) => json.options.find((o: any) => o.tripId === tripId).accessibilityScore;

        expect(response.status).toBe(200);
        expect(scoreOf('TRIP-RATED-AM')).toBe(expectedRated);
        expect(scoreOf('TRIP-RATED-PM')).toBe(expectedRated);
        expect(scoreOf('TRIP-PLAIN')).toBe(computeAccessibilityScore(SIX_OF_EIGHT));
    });

    it('reports the same score on the seat selection screen', async () => {
        const db = seed();
        mockGetAdminDb.mockReturnValue(db);

        const response = await getBookingSeats(new Request('http://localhost/api/booking/seats/TRIP-RATED-AM'), {
            tripId: 'TRIP-RATED-AM',
        });
        const json = await response.json();

        expect(response.status).toBe(200);
        expect(json.accessibilityScore).toBe(73);
    });
});
