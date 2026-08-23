// Ordering journey options for a passenger (MOV-87).
//
// The story asks for routes "ranked according to accessibility score". This
// module owns that ORDERING and nothing else.
//
// WHAT THIS DELIBERATELY DOES NOT DO.
// It does not calculate an accessibility score. Deciding what a score is made
// of — vehicle facilities, community reports, user ratings, delay history,
// reliability — is MOV-79, a later story with its own subtasks. Inventing a
// figure here would mean a second, competing definition of the same number,
// and the one that shipped first would be the one nobody could safely change.
//
// So the score arrives as an INPUT. A caller says what each option's score is;
// this decides what order they go in. When MOV-79 produces the real score, the
// only thing that changes is where the caller reads it from — this file does
// not.
//
// It is also not a weighting system. There is no formula combining several
// factors into one number: the rules below are applied strictly in order, and a
// later rule is consulted only when every earlier one has tied. That keeps the
// result explainable to a passenger — "these are sorted by accessibility, and
// equally accessible buses by departure time" — and keeps any future change to
// the ordering a visible edit rather than a silent shift in a coefficient.
//
// Pure and dependency-free, in keeping with the rest of `shared/utils`, so it
// can be used by the search API and by a screen alike.

/**
 * What ordering is decided from.
 *
 * Every field is optional because a real journey option can be missing any of
 * them — a trip with no bus has no score, and a malformed record may have no
 * usable time. Missing is handled explicitly rather than assumed away.
 */
export interface JourneyRankingFacts {
    /**
     * The accessibility score for this option, when one is known.
     *
     * Never computed here. Higher is better; the scale is whatever MOV-79
     * defines, so nothing in this file assumes a range, a maximum, or that the
     * value is a percentage.
     */
    accessibilityScore?: number | null;

    /**
     * Scheduled departure, as stored: zero-padded `HH:MM`.
     *
     * Compared as text, which is chronological for that format — the same
     * assumption `selectUpcomingTrips` already makes when it orders departures.
     * Reusing it keeps one definition of "earlier" in the project.
     */
    departureTime?: string | null;

    /** Stable identity, used only to make ties reproducible. */
    routeId?: string | null;
    tripId?: string | null;
}

/** A number that can actually be ordered. */
function usableScore(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A non-empty string. An empty or blank id orders nothing. */
function usableText(value: string | null | undefined): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Orders two values where one may be unknown.
 *
 * Unknown always sorts last. An option whose score could not be established
 * must never be presented above one that was measured — "we do not know" is
 * not evidence of being good, and a passenger choosing on accessibility would
 * be misled by the opposite rule.
 *
 * Returns 0 when the two cannot be told apart, so the caller moves on to its
 * next rule.
 */
function compareKnownFirst<V>(
    a: V | null,
    b: V | null,
    compare: (first: V, second: V) => number
): number {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;

    return compare(a, b);
}

/**
 * The ordering rule, applied to two options.
 *
 * Strictly in this order, each consulted only when the one above it tied:
 *
 *   1. Accessibility score, highest first. This is the story's requirement.
 *      A known score of zero still ranks above an unknown one: zero is a
 *      measurement, absence is not.
 *   2. Earliest departure. Equally accessible buses are ranked the way this
 *      project already ranks departures, so a passenger who saw "soonest
 *      first" before still sees the soonest of the equally suitable options.
 *      Journey duration is deliberately not used — the only parser for it is
 *      private to a formatting helper, and duplicating that here to gain a
 *      third tiebreak would put two definitions of journey length in the
 *      codebase.
 *   3. Route id, then trip id. Not a preference, only a guarantee: without it
 *      two options alike in every meaningful way would fall back on whatever
 *      order the database happened to return, and the same search could be
 *      ordered differently twice.
 *
 * Suitable for `Array.prototype.sort`.
 */
export function compareJourneyOptions(
    a: JourneyRankingFacts,
    b: JourneyRankingFacts
): number {
    const byScore = compareKnownFirst(
        usableScore(a.accessibilityScore),
        usableScore(b.accessibilityScore),
        // Descending: the higher score comes first.
        (first, second) => second - first
    );
    if (byScore !== 0) return byScore;

    const byDeparture = compareKnownFirst(
        usableText(a.departureTime),
        usableText(b.departureTime),
        (first, second) => first.localeCompare(second)
    );
    if (byDeparture !== 0) return byDeparture;

    const byRoute = compareKnownFirst(
        usableText(a.routeId),
        usableText(b.routeId),
        (first, second) => first.localeCompare(second)
    );
    if (byRoute !== 0) return byRoute;

    return compareKnownFirst(
        usableText(a.tripId),
        usableText(b.tripId),
        (first, second) => first.localeCompare(second)
    );
}

/**
 * Puts journey options into recommended order.
 *
 * Generic over the item, with `describe` saying where the ranking facts live on
 * it. That is the seam this whole subtask exists to provide: the search API can
 * rank its own option objects without reshaping them, and when MOV-79 supplies
 * a real accessibility score, only `describe` changes.
 *
 * Ranking is a reordering and never a filter: every option given comes back,
 * exactly once and unmodified. An option with no score is ranked last rather
 * than dropped — a passenger is still entitled to see a departure the project
 * could not assess.
 *
 * The input array is not mutated. Options that no rule can tell apart keep the
 * order they arrived in, so the result never depends on the sort's own
 * stability.
 */
export function rankJourneyOptions<T>(
    options: readonly T[],
    describe: (option: T) => JourneyRankingFacts
): T[] {
    if (!Array.isArray(options)) return [];

    return options
        // Facts are read once per option rather than on every comparison, and
        // the position is carried so an unbreakable tie is settled explicitly.
        .map((option, position) => ({ option, facts: describe(option), position }))
        .sort((a, b) => compareJourneyOptions(a.facts, b.facts) || a.position - b.position)
        .map((entry) => entry.option);
}
