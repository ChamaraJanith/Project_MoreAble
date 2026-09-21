// When a started journey counts as running (MOV-294).
//
// A journey is started by a bus with Start Journey and persisted on its trip
// (trips/{tripId}.journey). It stays running until one of exactly two things
// happens:
//
//   - the device presses End Journey, or
//   - the active window, measured from the ACTUAL start, runs out.
//
// Nothing else ends it. In particular the device signing out does not: the bus
// session and the journey are separate, and a driver who logs out mid-trip has
// not ended the trip.
//
// The window runs from `startedAt` — when Start Journey was pressed, stamped by
// the server — and never from the trip's scheduled departure. A 06:00 trip
// started at 20:35 is running from 20:35 until 19:35 the next day.
//
// Shared by the server (starting, ending, and telling passengers) and the
// clients (Trip Control, Activities), so "running" means the same everywhere.

/** How long a started journey stays running without an End Journey. For testing. */
export const JOURNEY_ACTIVE_WINDOW_HOURS = 23;

const MS_PER_HOUR = 60 * 60 * 1000;

export type TripJourneyStatus = 'STARTED' | 'ENDED';

/** The journey record persisted on a trip document. Latest run only. */
export interface TripJourneyRecord {
    status: TripJourneyStatus;
    /** ISO 8601, server time when Start Journey was pressed. */
    startedAt: string;
    /** ISO 8601, server time when End Journey was pressed; null while started. */
    endedAt: string | null;
    /** The bus that started it — the trip's bus at that moment. */
    busId: string;
}

function parseTime(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

/** When a journey stops counting as running if nobody ends it, or null if unreadable. */
export function journeyExpiresAt(journey: Pick<TripJourneyRecord, 'startedAt'> | null | undefined): Date | null {
    const started = parseTime(journey?.startedAt);
    return started === null ? null : new Date(started + JOURNEY_ACTIVE_WINDOW_HOURS * MS_PER_HOUR);
}

/**
 * Whether a persisted journey is running at `now`.
 *
 * Running means: started, not ended, and `now` before startedAt + window. An
 * unreadable record is never running — a journey nobody can date is not shown
 * to passengers.
 *
 * There is no lower bound on purpose: `startedAt` is server time, and a phone
 * whose clock runs a little behind must still see a journey started just now.
 */
export function isJourneyActive(journey: unknown, now: Date = new Date()): journey is TripJourneyRecord {
    const record = journey as Partial<TripJourneyRecord> | null | undefined;

    if (!record || record.status !== 'STARTED' || record.endedAt) {
        return false;
    }

    const started = parseTime(record.startedAt);

    if (started === null) {
        return false;
    }

    return now.getTime() < started + JOURNEY_ACTIVE_WINDOW_HOURS * MS_PER_HOUR;
}
