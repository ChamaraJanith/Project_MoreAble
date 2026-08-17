// Reading the live vehicle block for the passenger UI (MOV-119).
//
// The backend (MOV-120) reports where a bus last said it was and how old that
// report is, and nothing more. It deliberately does not provide a delay, a live
// arrival time or a moving/stopped state, so nothing here derives one — these
// helpers only decide how to phrase, and whether to trust, what did arrive.

import { JourneyLiveStatus } from '../../../entities/route/model/types';

export interface VehiclePosition {
    latitude: number;
    longitude: number;
}

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;

function plural(count: number, singular: string, pluralForm: string): string {
    return `${count} ${count === 1 ? singular : pluralForm} ago`;
}

/**
 * How recently the bus reported, in words a passenger can read at a glance.
 *
 * Returns null when there is no usable age, so the caller can leave the line out
 * rather than print a placeholder.
 *
 * Anything under a minute — including a negative age, which means the bus's
 * phone clock is running ahead of the server's — reads as "just now". A
 * passenger has no use for a clock-skew figure, and "Updated -2 mins ago" would
 * only be alarming.
 */
export function formatLocationAge(ageSeconds?: number | null): string | null {
    if (typeof ageSeconds !== 'number' || !Number.isFinite(ageSeconds)) {
        return null;
    }

    if (ageSeconds < SECONDS_PER_MINUTE) {
        return 'Updated just now';
    }

    if (ageSeconds < SECONDS_PER_HOUR) {
        return `Updated ${plural(Math.floor(ageSeconds / SECONDS_PER_MINUTE), 'min', 'mins')}`;
    }

    if (ageSeconds < SECONDS_PER_DAY) {
        return `Updated ${plural(Math.floor(ageSeconds / SECONDS_PER_HOUR), 'hour', 'hours')}`;
    }

    return `Updated ${plural(Math.floor(ageSeconds / SECONDS_PER_DAY), 'day', 'days')}`;
}

function isPlottable(latitude: unknown, longitude: unknown): boolean {
    return (
        typeof latitude === 'number' &&
        typeof longitude === 'number' &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180
    );
}

/**
 * The coordinate to draw the bus at, or null when there is nothing to draw.
 *
 * Null covers every way the data can fall short: no live block at all, a bus
 * that has never reported, an `available` flag with no position behind it, and
 * a position that is not a real point on the Earth. In every one of those cases
 * the map simply shows no vehicle — a stop, a route point or an endpoint is
 * never substituted, because none of them is where the bus is.
 */
export function resolveVehiclePosition(
    liveStatus?: JourneyLiveStatus | null
): VehiclePosition | null {
    const location = liveStatus?.available ? liveStatus.location : undefined;

    if (!location || !isPlottable(location.latitude, location.longitude)) {
        return null;
    }

    return { latitude: location.latitude, longitude: location.longitude };
}
