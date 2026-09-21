// When a started journey counts as running (MOV-294).
//
// A journey is started by a bus with Start Journey and persisted on its trip
// (trips/{tripId}.journey). It stays running until one of exactly two things
// happens:
//
//   - the device presses End Journey, or
//   - the scheduled service it belongs to is over: the trip's scheduled
//     arrival plus a grace period.
//
// Nothing else ends it. In particular the device signing out does not: the bus
// session and the journey are separate, and a driver who logs out mid-trip has
// not ended the trip.
//
// A trip is a daily timetable slot ('HH:MM' times, Sri Lanka local time). Start
// Journey belongs to the next service of that slot that has not yet finished,
// and the record keeps that service's scheduled times. `startedAt` — when Start
// Journey was pressed, stamped by the server — only records the actual start
// and identifies the exact run; it never moves the end. A 06:00 -> 07:10 trip
// started early at 02:52 is still the 06:00 service, and runs until 07:40.
//
// A service runs once. When it has ended — by End Journey or by its expiry — a
// new Start Journey goes to the NEXT occurrence of the slot (tomorrow's 06:00),
// never back to the finished one, and gets its own startedAt (its own run).
//
// Shared by the server (starting, ending, and telling passengers) and the
// clients (Trip Control, Activities), so "running" means the same everywhere.

/** How long after the scheduled arrival a journey nobody ended keeps running. */
export const JOURNEY_END_GRACE_MINUTES = 30;

/** Timetable times are Sri Lanka local time: UTC+05:30 all year, no DST. */
export const SERVICE_UTC_OFFSET_MINUTES = 5 * 60 + 30;

const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;
const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;
const SERVICE_OFFSET_MS = SERVICE_UTC_OFFSET_MINUTES * MS_PER_MINUTE;

export type TripJourneyStatus = 'STARTED' | 'ENDED';

/** The journey record persisted on a trip document. Latest run only. */
export interface TripJourneyRecord {
    status: TripJourneyStatus;
    /** ISO 8601, server time when Start Journey was pressed. Identifies the run. */
    startedAt: string;
    /** ISO 8601, server time when End Journey was pressed; null while started. */
    endedAt: string | null;
    /** The bus that started it — the trip's bus at that moment. */
    busId: string;
    /** ISO 8601, scheduled departure of the service this run belongs to. */
    scheduledDepartureAt: string;
    /** ISO 8601, scheduled arrival of that service. */
    scheduledArrivalAt: string;
    /** ISO 8601, scheduled arrival + grace: when it stops running if nobody ends it. */
    expiresAt: string;
}

/** The scheduled times a trip's timetable slot has on one service day. */
export interface TripSchedule {
    departureTime?: unknown; // 'HH:MM' (24-hour)
    estimatedArrivalTime?: unknown; // 'HH:MM' (24-hour)
}

export interface ScheduledService {
    departureAt: Date;
    arrivalAt: Date;
    /** arrivalAt + JOURNEY_END_GRACE_MINUTES. */
    expiresAt: Date;
}

function parseTime(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

/** Minutes after midnight for 'HH:MM', or null when unreadable. */
function clockMinutes(value: unknown): number | null {
    const match = typeof value === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
    if (!match) return null;

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/**
 * The service of a trip's timetable slot that a Start Journey at `startedAt`
 * belongs to: the first one that has not finished (arrival + grace) by then,
 * and that departs after `lastRunDepartureAt` — the scheduled departure of the
 * service the trip last ran, if any.
 *
 * So a start ahead of the scheduled departure — however early — joins that
 * day's service, and a start after a service has finished joins the next day's.
 * A service that already ran (ended by End Journey or by its expiry) is never
 * started again: the start goes to the next occurrence instead. An arrival
 * earlier in the day than the departure runs past midnight. Null when the
 * trip's times are unreadable.
 */
export function scheduledServiceFor(
    trip: TripSchedule | null | undefined,
    startedAt: Date,
    lastRunDepartureAt: Date | null = null
): ScheduledService | null {
    const departure = clockMinutes(trip?.departureTime);
    const arrival = clockMinutes(trip?.estimatedArrivalTime);
    const started = startedAt.getTime();
    const lastRun = lastRunDepartureAt ? lastRunDepartureAt.getTime() : Number.NaN;

    if (departure === null || arrival === null || Number.isNaN(started)) {
        return null;
    }

    const arrivalOffset = arrival < departure ? arrival + MINUTES_PER_DAY : arrival;
    // Midnight, Sri Lanka time, of the day the start falls on — as a UTC instant.
    const startDay = Math.floor((started + SERVICE_OFFSET_MS) / MS_PER_DAY) * MS_PER_DAY - SERVICE_OFFSET_MS;

    // Yesterday's service may still be running if it crosses midnight. Each
    // later day departs later, so the loop always reaches one that qualifies.
    for (let day = -1; ; day++) {
        const midnight = startDay + day * MS_PER_DAY;
        const departureAt = midnight + departure * MS_PER_MINUTE;
        const expiresAt = midnight + (arrivalOffset + JOURNEY_END_GRACE_MINUTES) * MS_PER_MINUTE;

        if (expiresAt > started && !(departureAt <= lastRun)) {
            return {
                departureAt: new Date(departureAt),
                arrivalAt: new Date(midnight + arrivalOffset * MS_PER_MINUTE),
                expiresAt: new Date(expiresAt),
            };
        }
    }
}

/** When a journey stops counting as running if nobody ends it, or null if unreadable. */
export function journeyExpiresAt(journey: Pick<TripJourneyRecord, 'expiresAt'> | null | undefined): Date | null {
    const expires = parseTime(journey?.expiresAt);
    return expires === null ? null : new Date(expires);
}

/**
 * Whether a persisted journey is running at `now`.
 *
 * Running means: started, not ended, and `now` before its scheduled service's
 * end (expiresAt). An unreadable record — including one with no scheduled end —
 * is never running: a journey nobody can date is not shown to passengers.
 *
 * There is no lower bound on purpose: a journey may be started well before its
 * scheduled departure, and a phone whose clock runs a little behind the server
 * must still see a journey started just now.
 */
export function isJourneyActive(journey: unknown, now: Date = new Date()): journey is TripJourneyRecord {
    const record = journey as Partial<TripJourneyRecord> | null | undefined;

    if (!record || record.status !== 'STARTED' || record.endedAt) {
        return false;
    }

    const started = parseTime(record.startedAt);
    const expires = parseTime(record.expiresAt);

    if (started === null || expires === null) {
        return false;
    }

    return now.getTime() < expires;
}
