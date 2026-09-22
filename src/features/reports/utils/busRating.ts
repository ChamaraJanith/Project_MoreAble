// The Rate this bus screen's rules, kept apart from the screen so each can be
// tested without a renderer: which stars exist, how they are read aloud, what
// the bus is called, and what a refused submission tells the passenger.

import { BUS_RATING_MAX, BUS_RATING_MIN, BusRatingContext, BusRatingValue } from '../../../entities/rating/model/types';

/** The stars the passenger can choose, lowest first. There is no 0: that is Skip. */
export const BUS_RATING_STARS: BusRatingValue[] = Array.from(
    { length: BUS_RATING_MAX - BUS_RATING_MIN + 1 },
    (_, index) => (BUS_RATING_MIN + index) as BusRatingValue
);

/** '1 star', '4 stars'. */
export function starLabel(stars: number): string {
    return `${stars} star${stars === 1 ? '' : 's'}`;
}

/** A word for each rating, shown beside the stars once one is chosen. */
export function ratingDescription(stars: BusRatingValue | null): string | null {
    switch (stars) {
        case 1:
            return 'Very poor';
        case 2:
            return 'Poor';
        case 3:
            return 'Okay';
        case 4:
            return 'Good';
        case 5:
            return 'Excellent';
        default:
            return null;
    }
}

/**
 * The bus's name and details, from what the record actually holds.
 *
 * The number plate is the bus's identity; model and manufacturer follow when
 * known. Nothing is filled in that the record does not contain.
 */
export function describeRatedBus(bus: BusRatingContext['bus']): { title: string; details: string | null } {
    const details = [bus.busModel, bus.manufacturer].filter(Boolean).join(' · ');
    return { title: bus.numberPlate ?? 'Your bus', details: details || null };
}

export type RatingSubmitFailure = {
    /** The rating for this journey is already stored: nothing more to do here. */
    alreadyRated: boolean;
    message: string;
};

/**
 * What a refused submission means for the passenger.
 *
 * Whatever went wrong, their journey is already completed and stays that way;
 * the screen always lets them leave for Activities.
 */
export function describeRatingFailure(status: number | null, code: string | null, apiMessage: string): RatingSubmitFailure {
    if (code === 'ALREADY_RATED') {
        return { alreadyRated: true, message: 'You have already rated the bus for this journey.' };
    }
    if (status === 401 || status === 403) {
        return { alreadyRated: false, message: 'Please sign in again to rate this bus. Your journey is still completed.' };
    }
    if (status === 400 || status === 404 || status === 409) {
        return { alreadyRated: false, message: apiMessage };
    }
    return {
        alreadyRated: false,
        message: 'Your rating could not be saved. Your journey is still completed — you can try again or skip.',
    };
}
