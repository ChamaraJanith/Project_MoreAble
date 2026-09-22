// The system statistics the Admin Dashboard Overview states (MOV-134).
//
// Four of the five were already on the dashboard — the Reports card's total,
// and the active counts in the Buses and Trips breakdown lines — so most of
// what is covered here is arithmetic the screen was already doing inline and
// could not test. The fifth, Verified Reports, is new.
//
// What can go wrong is all about what is counted and what is said when nothing
// can be counted:
//
//   what counts     — every role for users; only ACTIVE for trips and
//                     vehicles; only VERIFIED for reports;
//   what does not   — INACTIVE and MAINTENANCE buses, inactive trips, and
//                     every report status that is not a finding that the
//                     report held;
//   nothing at all  — an empty platform reads 0, an unloaded or failed one
//                     reads null, because "none" and "not known" are different
//                     answers and a card that confuses them misleads either way.
//
// Nothing here stands up a fetch: the module is pure and is handed the arrays
// the dashboard has already loaded, which is what makes it testable at all
// under a node-only Jest with no React renderer.

import {
    ACTIVE_TRIP_STATUS,
    ACTIVE_VEHICLE_STATUS,
    VERIFIED_REPORT_STATUS,
    countActiveTrips,
    countActiveVehicles,
    countTotalReports,
    countTotalUsers,
    countVerifiedReports,
    systemStatistics,
} from '../../../src/features/admin/utils/systemStatistics';

// ------------------------------------------------------------------
// Fixtures — shaped as the admin API clients actually hand them over.
// ------------------------------------------------------------------

function user(role: string, overrides: Record<string, unknown> = {}) {
    return { role, accountStatus: 'ACTIVE', ...overrides };
}

function bus(status: string) {
    return { busId: `BUS-${status}`, status };
}

function trip(status: string) {
    return { tripId: `TRIP-${status}`, status };
}

function report(status: string) {
    return { reportId: `REP-${status}`, status };
}

// ==================================================================
// 1. Total Users
// ==================================================================
describe('total users', () => {
    it('counts PASSENGER, GUARDIAN and ADMIN accounts alike', () => {
        const users = [
            user('PASSENGER'),
            user('PASSENGER'),
            user('GUARDIAN'),
            user('ADMIN'),
        ];

        // Four accounts, three roles. The statistic is how many people are
        // registered, not how many of them are passengers — which is why the
        // dashboard reads it with getUsers('ALL').
        expect(countTotalUsers(users)).toBe(4);
    });

    it('still counts a suspended account', () => {
        const users = [
            user('PASSENGER'),
            user('PASSENGER', { accountStatus: 'SUSPENDED' }),
            user('ADMIN', { accountStatus: 'SUSPENDED' }),
        ];

        // Suspension is a state an admin can lift, not a deletion. A total that
        // dropped suspended accounts would fall the moment an admin suspended
        // somebody, which is a different statistic than the one being claimed.
        expect(countTotalUsers(users)).toBe(3);
    });

    it('counts an account whose role was never stored', () => {
        // The users endpoint defaults an unreadable role to PASSENGER rather
        // than dropping the record, so the row exists and is a registered user.
        expect(countTotalUsers([user('PASSENGER'), { passengerId: 'PAS-1' }])).toBe(2);
    });
});

// ==================================================================
// 2-4. Active Vehicles
// ==================================================================
describe('active vehicles', () => {
    it('counts only buses that are in service', () => {
        expect(countActiveVehicles([bus('ACTIVE'), bus('ACTIVE'), bus('INACTIVE')])).toBe(2);
    });

    it('excludes INACTIVE buses', () => {
        expect(countActiveVehicles([bus('INACTIVE'), bus('INACTIVE'), bus('ACTIVE')])).toBe(1);
    });

    it('excludes buses in MAINTENANCE', () => {
        // A bus off the road is not an active vehicle, whichever of the two
        // reasons it is off the road for.
        expect(countActiveVehicles([bus('MAINTENANCE'), bus('MAINTENANCE'), bus('ACTIVE')])).toBe(1);
    });

    it('is zero when the whole fleet is off the road', () => {
        expect(countActiveVehicles([bus('INACTIVE'), bus('MAINTENANCE')])).toBe(0);
    });

    it('does not count a bus whose status is missing or unrecognised', () => {
        // Only the stored ACTIVE value counts. Putting a bus on the road is a
        // decision somebody made, and it is written down.
        const buses = [bus('ACTIVE'), { busId: 'BUS-0' }, { busId: 'BUS-X', status: 'RETIRED' }];

        expect(countActiveVehicles(buses)).toBe(1);
    });

    it('counts against the value the entity model defines', () => {
        expect(ACTIVE_VEHICLE_STATUS).toBe('ACTIVE');
    });
});

// ==================================================================
// 5. Active Trips
// ==================================================================
describe('active trips', () => {
    it('counts only trips whose schedule is enabled', () => {
        const trips = [trip('ACTIVE'), trip('ACTIVE'), trip('ACTIVE'), trip('INACTIVE')];

        expect(countActiveTrips(trips)).toBe(3);
    });

    it('excludes inactive trips', () => {
        // Deactivating a trip is how a turn is retired without erasing it, so a
        // deactivated turn must not keep counting as part of the live timetable.
        expect(countActiveTrips([trip('INACTIVE'), trip('INACTIVE')])).toBe(0);
    });

    it('reads the trip status and not a journey running on it', () => {
        // MOV-134 asks how much of the timetable is enabled. A trip that is
        // switched off does not become active because a bus started a journey
        // on it, and an enabled trip counts whether or not one is running.
        const trips = [
            { tripId: 'TRIP-1', status: 'INACTIVE', journey: { status: 'STARTED', endedAt: null } },
            { tripId: 'TRIP-2', status: 'ACTIVE' },
        ];

        expect(countActiveTrips(trips)).toBe(1);
    });

    it('counts against the value the entity model defines', () => {
        expect(ACTIVE_TRIP_STATUS).toBe('ACTIVE');
    });
});

// ==================================================================
// 6-8. Verified Reports
// ==================================================================
describe('verified reports', () => {
    it('counts reports an admin upheld', () => {
        const reports = [report('VERIFIED'), report('VERIFIED'), report('PENDING')];

        expect(countVerifiedReports(reports)).toBe(2);
    });

    it('does not count a PENDING report as verified', () => {
        // Undecided is not upheld. This is the status every report is filed in.
        expect(countVerifiedReports([report('PENDING'), report('PENDING')])).toBe(0);
    });

    it('does not count a REJECTED report as verified', () => {
        // A report an admin found not to hold is the opposite of a verified
        // one, and counting it here would state the reverse of the finding.
        expect(countVerifiedReports([report('REJECTED'), report('VERIFIED')])).toBe(1);
    });

    it('does not count REVIEWED or RESOLVED reports as verified', () => {
        // Looked at, and fixed, are later states rather than a finding that the
        // report was true — only VERIFIED is that.
        expect(
            countVerifiedReports([report('REVIEWED'), report('RESOLVED'), report('VERIFIED')])
        ).toBe(1);
    });

    it('does not count a report whose status was never stored', () => {
        // A report with nothing stored reads as PENDING everywhere in this
        // project, so it is undecided rather than upheld.
        expect(countVerifiedReports([{ reportId: 'REP-0' }, report('VERIFIED')])).toBe(1);
    });

    it('never exceeds the total it is a share of', () => {
        const reports = [report('VERIFIED'), report('PENDING'), report('REJECTED')];

        // Guaranteed by both numbers coming out of one reading of one queue —
        // which is why the verified count is derived rather than fetched.
        expect(countVerifiedReports(reports)).toBeLessThanOrEqual(
            countTotalReports(reports) as number
        );
    });

    it('counts against the value the entity model defines', () => {
        expect(VERIFIED_REPORT_STATUS).toBe('VERIFIED');
    });
});

// ==================================================================
// 9. Total Reports
// ==================================================================
describe('total reports', () => {
    it('is every report in the queue it was given, whatever its status', () => {
        const reports = [
            report('PENDING'),
            report('VERIFIED'),
            report('REJECTED'),
            report('RESOLVED'),
        ];

        // The admin review queue is the only slice holding all of them —
        // including the REJECTED one the passenger-facing feed drops. Counting
        // that feed instead would make the total fall on every rejection.
        expect(countTotalReports(reports)).toBe(4);
    });

    it('is unchanged by how many of the reports were verified', () => {
        expect(countTotalReports([report('VERIFIED'), report('VERIFIED')])).toBe(2);
        expect(countTotalReports([report('PENDING'), report('PENDING')])).toBe(2);
    });
});

// ==================================================================
// 10. Nothing to count
// ==================================================================
describe('an empty platform', () => {
    it('reads every statistic as 0 rather than as unknown', () => {
        // A brand-new deployment has no users, buses, trips or reports. That is
        // a fact about the platform and has to be stated as one.
        expect(systemStatistics({ users: [], trips: [], buses: [], reports: [] })).toEqual({
            totalUsers: 0,
            activeTrips: 0,
            totalReports: 0,
            activeVehicles: 0,
            verifiedReports: 0,
        });
    });
});

describe('an input that cannot be counted', () => {
    it('reads as null for every statistic when nothing has loaded', () => {
        // What the dashboard holds before the first load finishes, and again
        // after one fails. Null is "not known" — the cards print a dash.
        expect(systemStatistics()).toEqual({
            totalUsers: null,
            activeTrips: null,
            totalReports: null,
            activeVehicles: null,
            verifiedReports: null,
        });
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a non-list value', { length: 3 } as unknown],
    ])('reads %s as null rather than as zero', (_label, value) => {
        expect(countTotalUsers(value)).toBeNull();
        expect(countActiveTrips(value)).toBeNull();
        expect(countActiveVehicles(value)).toBeNull();
        expect(countTotalReports(value)).toBeNull();
        expect(countVerifiedReports(value)).toBeNull();
    });

    it('leaves the statistics that did load alone', () => {
        // The reports queue is loaded apart from the rest because it is the one
        // call needing an admin session. A refused one must not blank the
        // numbers no session was needed to read — the behaviour the dashboard
        // already had, and the reason the two are kept separate.
        const stats = systemStatistics({
            users: [user('PASSENGER'), user('ADMIN')],
            trips: [trip('ACTIVE')],
            buses: [bus('ACTIVE'), bus('MAINTENANCE')],
            reports: null,
        });

        expect(stats).toEqual({
            totalUsers: 2,
            activeTrips: 1,
            totalReports: null,
            activeVehicles: 1,
            verifiedReports: null,
        });
    });
});

// ==================================================================
// All five at once
// ==================================================================
describe('the Overview as a whole', () => {
    it('reports all five statistics off one set of loaded arrays', () => {
        const stats = systemStatistics({
            users: [user('PASSENGER'), user('GUARDIAN'), user('ADMIN')],
            trips: [trip('ACTIVE'), trip('ACTIVE'), trip('INACTIVE')],
            buses: [bus('ACTIVE'), bus('INACTIVE'), bus('MAINTENANCE')],
            reports: [report('VERIFIED'), report('PENDING'), report('REJECTED')],
        });

        expect(stats).toEqual({
            totalUsers: 3,
            activeTrips: 2,
            totalReports: 3,
            activeVehicles: 1,
            verifiedReports: 1,
        });
    });
});
