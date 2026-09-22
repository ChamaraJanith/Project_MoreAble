// Accessibility score history (MOV-113).
//
// Stores a bus's accessibility score over time, beside the live calculation
// rather than instead of it. Every API still calculates the current score from
// the bus and its evidence (MOV-111); nothing here is read back to answer one.
//
//     accessibilityScoreHistory/{busId}__{000001}   one entry per change, append-only
//     accessibilityScoreLatest/{busId}              the newest entry, for change detection
//
// An entry is written only when the score or one of its three components
// differs from the bus's previous entry, so calling this after any write that
// might have changed the evidence is always safe: a call that changed nothing
// stores nothing.
//
// The arithmetic is MOV-111's, called as it is. This file only decides what is
// read and when an entry is written.

import {
    AccessibilityScoreHistoryEntry,
    AccessibilityScoreLatest,
    AccessibilityScoreValues,
} from '../../entities/bus/model/types';
import {
    computeAccessibilityScore,
    computeCommunityScore,
    computeFacilityScore,
    computeRatingScore,
} from '../utils/accessibility';
import { loadAccessibilityScoreEvidence } from './accessibilityScoreEvidence';

export const ACCESSIBILITY_SCORE_HISTORY_COLLECTION = 'accessibilityScoreHistory';
export const ACCESSIBILITY_SCORE_LATEST_COLLECTION = 'accessibilityScoreLatest';

const SEQUENCE_DIGITS = 6;

/**
 * A history entry's id: `BUS-00001__000001`.
 *
 * The same `a__b` shape as a report vote's and a bus rating's id, zero-padded
 * like the project's counter ids, so a bus's entries sort in order by id.
 */
export function accessibilityScoreHistoryId(busId: string, sequence: number): string {
    return `${busId}__${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`;
}

/** A bus document id this can be keyed on: non-empty, and a single path segment. */
function usableBusId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && !value.includes('/');
}

function sameValues(a: AccessibilityScoreValues, b: AccessibilityScoreValues): boolean {
    return (
        a.accessibilityScore === b.accessibilityScore &&
        a.facilityScore === b.facilityScore &&
        a.communityScore === b.communityScore &&
        a.ratingScore === b.ratingScore
    );
}

/**
 * The sequence the latest document says was used last, 0 when there is none.
 *
 * A latest document that exists but holds no usable sequence was not written
 * here. Guessing a number could land on an existing entry, so it is refused.
 */
function lastSequenceOf(latestSnap: any): number {
    if (!latestSnap?.exists) return 0;

    const lastSequence = latestSnap.data()?.lastSequence;

    if (!Number.isInteger(lastSequence) || lastSequence < 1) {
        throw new Error('accessibilityScoreLatest holds no usable lastSequence.');
    }

    return lastSequence;
}

export type RecordAccessibilityScoreResult =
    /** The score differed from the previous entry, or there was none: a new entry was stored. */
    | { kind: 'RECORDED'; entry: AccessibilityScoreHistoryEntry }
    /** All four values match the previous entry. Nothing was written. */
    | { kind: 'UNCHANGED'; latest: AccessibilityScoreLatest }
    | { kind: 'INVALID_BUS_ID' }
    /** No bus is stored under this id, so it has no score to record. */
    | { kind: 'NO_BUS' };

/**
 * Stores the current accessibility score of `buses/{busId}` as the bus's next
 * history entry, unless it is identical to the previous one.
 *
 * One transaction reads the latest entry, the bus and its evidence, and writes
 * the new entry together with the latest document. So the stored score is the
 * one the evidence produced at that moment, and two calls arriving together
 * cannot both take the same sequence: Firestore retries the one that loses.
 */
export async function recordAccessibilityScore(
    adminDb: any,
    busId: string,
    now: Date = new Date()
): Promise<RecordAccessibilityScoreResult> {
    if (!usableBusId(busId)) return { kind: 'INVALID_BUS_ID' };

    const key = busId.trim();
    const busRef = adminDb.collection('buses').doc(key);
    const latestRef = adminDb.collection(ACCESSIBILITY_SCORE_LATEST_COLLECTION).doc(key);

    return adminDb.runTransaction(async (transaction: any): Promise<RecordAccessibilityScoreResult> => {
        // Every read comes before the first write, as a transaction requires.
        const latestSnap = await transaction.get(latestRef);
        const sequence = lastSequenceOf(latestSnap) + 1;
        const historyId = accessibilityScoreHistoryId(key, sequence);
        const historyRef = adminDb.collection(ACCESSIBILITY_SCORE_HISTORY_COLLECTION).doc(historyId);

        const [busSnap, evidence, existingEntry] = await Promise.all([
            transaction.get(busRef),
            loadAccessibilityScoreEvidence(adminDb, key, undefined, (query) => transaction.get(query)),
            transaction.get(historyRef),
        ]);

        if (!busSnap?.exists) return { kind: 'NO_BUS' };

        const facilities = busSnap.data()?.accessibilityFacilities;
        const values: AccessibilityScoreValues = {
            accessibilityScore: computeAccessibilityScore(facilities, evidence),
            facilityScore: computeFacilityScore(facilities, evidence.unavailableFacilities),
            communityScore: computeCommunityScore(evidence.community),
            ratingScore: computeRatingScore(evidence.ratings),
        };

        if (latestSnap?.exists) {
            const latest = latestSnap.data() as AccessibilityScoreLatest;
            if (sameValues(latest, values)) return { kind: 'UNCHANGED', latest };
        }

        // History is append-only. An entry already under the next id means the
        // latest document is behind; overwriting it would rewrite the past.
        if (existingEntry?.exists) {
            throw new Error(`accessibilityScoreHistory/${historyId} already exists.`);
        }

        const calculatedAt = now.toISOString();
        const entry: AccessibilityScoreHistoryEntry = { historyId, busId: key, sequence, ...values, calculatedAt };
        const latest: AccessibilityScoreLatest = { busId: key, lastSequence: sequence, historyId, ...values, calculatedAt };

        transaction.set(historyRef, entry);
        transaction.set(latestRef, latest);

        return { kind: 'RECORDED', entry };
    });
}

/**
 * `recordAccessibilityScore` for a route that has already done its own job.
 *
 * Called after a bus, report or rating write has succeeded. The history must
 * never undo or fail that write, so an error is logged and the route answers as
 * it would have without this call.
 */
export async function recordAccessibilityScoreSafely(
    adminDb: any,
    busId: string,
    now?: Date
): Promise<RecordAccessibilityScoreResult | null> {
    try {
        return await recordAccessibilityScore(adminDb, busId, now);
    } catch (error: any) {
        console.error('Accessibility Score History Error:', error);
        return null;
    }
}
