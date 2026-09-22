/**
 * The system statistics the Admin Dashboard Overview states (MOV-134).
 *
 *   Total Users      — every registered account, whatever its role.
 *   Active Trips     — scheduled turns that are enabled.
 *   Total Reports    — every accessibility report filed.
 *   Active Vehicles  — buses in service.
 *   Verified Reports — reports an admin has upheld.
 *
 * Four of the five were already on the dashboard before this story: the Reports
 * card states the total, and the Buses and Trips cards state their active
 * counts in the quiet line under the number. This module does not add a screen
 * or a card for any of them — it is where the arithmetic behind them lives, so
 * that "an active vehicle" or "a verified report" means one thing, in one
 * place, that can actually be tested. The cards go on rendering exactly as they
 * did.
 *
 * Pure, and deliberately so. Nothing here fetches: the dashboard already loads
 * the users, trips, buses and the admin review queue for its own cards, and a
 * statistic derived from a second copy of that data is one that can disagree
 * with the screen it sits on. This module is handed what has already arrived
 * and does arithmetic on it — which is also the only way any of it can be
 * tested, Jest here being node-only with no React renderer (see
 * reportCountState for the same reasoning).
 *
 * Two conventions run through the module:
 *
 * 1. `null` and `0` are different answers. `null` is "not known" — nothing has
 *    loaded, or the read failed; `0` is "none exist". Collapsing them would
 *    make an empty platform look like a broken dashboard, so an input that is
 *    not a list yields null and an empty list yields 0.
 *
 * 2. Every count is derived from what was actually returned. Nothing reads a
 *    stored total, and nothing reads the `counters` collection — those are ID
 *    sequences that only ever increment, and they do not come back down when a
 *    record is removed.
 *
 * The statuses are compared against the values the entity models define
 * (BusStatus, TripStatus, ReportStatus), restated here as constants so the
 * module stays free of every other module: it is fed plain arrays and answers
 * with plain numbers.
 */

// ------------------------------------------------------------------
// What each statistic counts
// ------------------------------------------------------------------

/** A bus is an active vehicle when it is in service — not INACTIVE, not MAINTENANCE. */
export const ACTIVE_VEHICLE_STATUS = 'ACTIVE';

/**
 * A trip is active when its schedule is enabled.
 *
 * This is the trip's own `status`, NOT whether a bus has a journey running on
 * it right now. The two are different questions, and the project already has a
 * separate answer for the second one (`isJourneyActive`). MOV-134 asks how much
 * of the timetable is enabled, which is this — and it is also what the Trips
 * card has always shown.
 */
export const ACTIVE_TRIP_STATUS = 'ACTIVE';

/**
 * A report counts as verified once an admin has upheld it.
 *
 * Only VERIFIED. PENDING is undecided, REJECTED is a report that was found not
 * to hold, and REVIEWED/RESOLVED are later states rather than a finding that
 * the report was true.
 *
 * A report with no stored status reads as PENDING everywhere else in this
 * project (`reportDecisionStatus`), and a direct comparison treats it the same
 * way — as not verified — without this module having to import that rule.
 */
export const VERIFIED_REPORT_STATUS = 'VERIFIED';

// ------------------------------------------------------------------
// The shapes this module is fed
//
// Structural rather than the entity interfaces, for the reason reportCountState
// gives: it keeps the module free of the API clients that produce them, and it
// lets a test hand it a plain object instead of building a whole Bus. The real
// AdminUserSummary, Trip, Bus and AdminReviewReport all satisfy these.
// ------------------------------------------------------------------

/** Enough of a stored user to be counted. */
export interface CountableUser {
    role?: unknown;
    accountStatus?: unknown;
}

/** Enough of a trip to tell an enabled schedule from a disabled one. */
export interface CountableTrip {
    status?: unknown;
}

/** Enough of a bus to tell one in service from one that is not. */
export interface CountableBus {
    status?: unknown;
}

/** Enough of a report to tell an upheld one from the rest. */
export interface CountableReport {
    status?: unknown;
}

/** The five statistics, each either known or not. */
export interface SystemStatistics {
    totalUsers: number | null;
    activeTrips: number | null;
    totalReports: number | null;
    activeVehicles: number | null;
    verifiedReports: number | null;
}

/** What the dashboard has loaded so far. Any of it may still be absent. */
export interface SystemStatisticsInput {
    users?: readonly CountableUser[] | null;
    trips?: readonly CountableTrip[] | null;
    buses?: readonly CountableBus[] | null;
    /** The admin review queue, which is every report — see countTotalReports. */
    reports?: readonly CountableReport[] | null;
}

// ------------------------------------------------------------------
// Counting
// ------------------------------------------------------------------

/**
 * The size of a list, or null when there is no list to size.
 *
 * Anything that is not an array is "not known": null and undefined are what the
 * dashboard holds before a load finishes and after one fails, and a value of
 * some other shape is a caller passing something this module cannot count —
 * neither of which is zero of anything.
 */
function countTotal(items: unknown): number | null {
    return Array.isArray(items) ? items.length : null;
}

/** How many of a list match, or null when there is no list to match against. */
function countWhere<T>(items: unknown, matches: (item: T) => boolean): number | null {
    if (!Array.isArray(items)) return null;

    return (items as T[]).filter((item) => matches(item)).length;
}

/** Whether a record carries exactly this status. */
function hasStatus(record: { status?: unknown } | null | undefined, status: string): boolean {
    return record?.status === status;
}

/**
 * Every registered account, across PASSENGER, GUARDIAN and ADMIN.
 *
 * The caller has to have asked for all of them: `getUsers()` defaults to
 * PASSENGER, so the dashboard reads this statistic with `getUsers('ALL')`. This
 * function counts what it is given and cannot tell one list from the other.
 *
 * A SUSPENDED account is still a registered user and is counted. Suspension is
 * an administrative state an admin can lift, not a deletion, and a total that
 * silently dropped suspended accounts would fall when an admin suspended
 * somebody — a different statistic than the one being claimed.
 */
export function countTotalUsers(users: unknown): number | null {
    return countTotal(users);
}

/** Trips whose schedule is enabled. See ACTIVE_TRIP_STATUS. */
export function countActiveTrips(trips: unknown): number | null {
    return countWhere<CountableTrip>(trips, (trip) => hasStatus(trip, ACTIVE_TRIP_STATUS));
}

/** Buses in service. See ACTIVE_VEHICLE_STATUS. */
export function countActiveVehicles(buses: unknown): number | null {
    return countWhere<CountableBus>(buses, (bus) => hasStatus(bus, ACTIVE_VEHICLE_STATUS));
}

/**
 * Every accessibility report filed.
 *
 * The list this is given has to be the admin review queue
 * (`GET /api/reports?scope=review`), which is the only slice holding all of
 * them. The browsable feed (`scope=all`) drops REJECTED reports, so counting
 * that one would state a total that quietly falls every time an admin rejects
 * something.
 */
export function countTotalReports(reports: unknown): number | null {
    return countTotal(reports);
}

/** Reports an admin has upheld. See VERIFIED_REPORT_STATUS. */
export function countVerifiedReports(reports: unknown): number | null {
    return countWhere<CountableReport>(reports, (report) =>
        hasStatus(report, VERIFIED_REPORT_STATUS)
    );
}

/**
 * All five statistics from what the dashboard currently holds.
 *
 * Each is independent: a failed reports read leaves the user, trip and vehicle
 * numbers exactly as they were, which is the behaviour the dashboard already
 * has and the reason the review queue is loaded apart from the rest.
 */
export function systemStatistics(input: SystemStatisticsInput = {}): SystemStatistics {
    return {
        totalUsers: countTotalUsers(input.users),
        activeTrips: countActiveTrips(input.trips),
        totalReports: countTotalReports(input.reports),
        activeVehicles: countActiveVehicles(input.buses),
        verifiedReports: countVerifiedReports(input.reports),
    };
}
