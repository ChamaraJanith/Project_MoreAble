/**
 * Community feedback on an accessibility report: the server half (MOV-145).
 *
 * MOV-144 built the controls — Agree, Disagree, a comment box — over local
 * state that a passenger lost the moment they left the screen. This is what
 * makes them persistent, and it is shared by both feedback routes so that the
 * rules they have in common are written once:
 *
 *   - who is asking (the verified token, never a body field),
 *   - which report they mean, and whether it exists,
 *   - that one passenger is one vote,
 *   - what counts as a comment worth storing.
 *
 * Two collections, deliberately not fields on the report. A vote belongs to the
 * passenger who cast it and has to be findable as theirs; a report that
 * collects fifty comments must not become a fifty-comment document that every
 * list screen downloads to draw a card.
 */

import {
    MAX_REPORT_COMMENT_LENGTH,
    REPORT_ADMIN_REVIEW_AGREE_THRESHOLD,
    REPORT_ADMIN_ROLE,
    REPORT_PASSENGER_ROLE,
    ReportCommentRecord,
    ReportVoteChoice,
    canViewReport,
    isReportVoteChoice,
} from '../../entities/report/model/types';
import { authenticateRequest, unauthorizedResponse } from '../api/authMiddleware';
import { getAdminDb } from '../config/firebaseAdmin';
import { JwtPayload } from '../config/jwt';
import { normalizeCommentImageUrl } from './reportPhotos';

// Re-exported so a route takes the cap and the threshold from the module that
// enforces them rather than restating either number.
export { MAX_REPORT_COMMENT_LENGTH, REPORT_ADMIN_REVIEW_AGREE_THRESHOLD };

export const REPORTS_COLLECTION = 'reports';
export const REPORT_VOTES_COLLECTION = 'votes';
export const REPORT_COMMENTS_COLLECTION = 'comments';

export const feedbackCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * The headers for one comment's own route, which edits and removes it.
 *
 * Kept apart from feedbackCorsHeaders because the vote route and the thread
 * route answer GET and POST only, and advertising PATCH or DELETE on them would
 * describe methods they do not have.
 */
export const commentCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function feedbackErrorResponse(
    status: number,
    message: string,
    headers: Record<string, string> = feedbackCorsHeaders
): Response {
    return Response.json(
        { success: false, message },
        { status, headers }
    );
}

export type FeedbackValidation<T> = { ok: true; value: T } | { ok: false; message: string };

// ------------------------------------------------------------------
// Identity of the thing being voted on or commented on
// ------------------------------------------------------------------

/**
 * The report id out of /api/reports/:reportId/vote (or /comments).
 *
 * Read from the router's params where they are given and from the path
 * otherwise, because the handlers are also called directly with a plain params
 * object — the same arrangement /api/reports/[reportId] uses. In the path the
 * id is the second-to-last segment, which is how /api/buses/:busId/location
 * reads its own.
 */
export type ReportSubrouteSegment = 'vote' | 'comments' | 'review';

export function extractFeedbackReportId(
    request: Request,
    context: any,
    segment: ReportSubrouteSegment
): string {
    if (context?.params?.reportId) return String(context.params.reportId).trim();
    if (context?.reportId) return String(context.reportId).trim();

    try {
        const url = new URL(request.url);
        const parts = url.pathname.split('/').filter(Boolean);
        const segmentIndex = parts.lastIndexOf(segment);
        const candidate = segmentIndex > 0 ? parts[segmentIndex - 1] : '';

        if (candidate && candidate !== 'reports') return decodeURIComponent(candidate).trim();
    } catch {
        // A malformed url simply yields no id, and the caller answers 400.
    }

    return '';
}

/**
 * One passenger's vote on one report, as a Firestore document id.
 *
 * This is the whole of the "one vote per passenger" rule. Writing to a derived
 * key means a second Agree overwrites the first rather than adding to the
 * tally, and it holds even if two presses arrive at once — there is no read
 * that a concurrent write could get in front of, because the key itself is the
 * constraint. A uniqueness query would only make the same promise on a good
 * day.
 */
export function reportVoteDocumentId(reportId: string, passengerId: string): string {
    return `${reportId}__${passengerId}`;
}

/**
 * The comment id out of /api/reports/:reportId/comments/:commentId.
 *
 * Read the same way as the report id: from the router's params where they are
 * given, and from the path otherwise — here the segment straight after
 * `comments`.
 */
export function extractFeedbackCommentId(request: Request, context: any): string {
    if (context?.params?.commentId) return String(context.params.commentId).trim();
    if (context?.commentId) return String(context.commentId).trim();

    try {
        const url = new URL(request.url);
        const parts = url.pathname.split('/').filter(Boolean);
        const segmentIndex = parts.lastIndexOf('comments');
        const candidate = segmentIndex >= 0 ? parts[segmentIndex + 1] : '';

        if (candidate) return decodeURIComponent(candidate).trim();
    } catch {
        // A malformed url simply yields no id, and the caller answers 400.
    }

    return '';
}

export interface FeedbackContext {
    /** The verified passenger. Never a value taken from the request body. */
    passengerId: string;
    /** Whether the verified session is an admin's. Never read from the body. */
    isAdmin: boolean;
    reportId: string;
    reportRef: any;
    report: Record<string, any>;
    adminDb: any;
}

/**
 * What a feedback request is about to do, which decides who may make it.
 *
 *   read      any session that can see the report — unchanged since MOV-145
 *   write     a genuine passenger only: casting a vote, writing a comment,
 *             editing one's own comment
 *   moderate  a genuine passenger (for their own comment) or an admin (for
 *             any comment) — removing a comment
 */
export type FeedbackAccess = 'read' | 'write' | 'moderate';

/**
 * Whether this session is a passenger speaking for themselves.
 *
 * Community feedback is one passenger's voice, attributed by the passengerId on
 * the verified token. A bus device session carries no passenger at all, a
 * journey-sharing credential is narrowed (`scope`) to reporting one bus's
 * position and carries the bus's id where a passenger's would be, and an admin
 * decides reports rather than taking a side on them — none of them is a
 * passenger whose vote or comment it would be.
 */
export function isPassengerSession(user: JwtPayload | null | undefined): boolean {
    return (
        user?.role === REPORT_PASSENGER_ROLE &&
        !user.scope &&
        typeof user.passengerId === 'string' &&
        user.passengerId.trim().length > 0
    );
}

/** Whether this session is an unscoped admin's. */
export function isAdminSession(user: JwtPayload | null | undefined): boolean {
    return user?.role === REPORT_ADMIN_ROLE && !user.scope;
}

function canTakeFeedbackAction(user: JwtPayload, access: FeedbackAccess): boolean {
    if (access === 'read') return true;
    if (access === 'write') return isPassengerSession(user);

    return isPassengerSession(user) || isAdminSession(user);
}

/**
 * Authenticates the caller and loads the report they are addressing.
 *
 * Shared by every feedback handler so 401 / 400 / 403 / 404 mean the same thing
 * on each, and so no route can forget to check that the report exists before
 * writing a vote or a comment against its id.
 *
 * Reading feedback is open to any authenticated session that can see the
 * report, matching GET /api/reports/[reportId]: a report in the public feed,
 * the caller's own report in any status, or any report for an admin. Community
 * feedback is the one part of a report that is explicitly not the author's
 * alone.
 *
 * Writing it is narrower (see `access`): only a genuine passenger votes or
 * comments, and is refused with 403 before the report is even looked up — so a
 * session that may not write learns nothing about which reports exist.
 */
export async function loadFeedbackContext(
    request: Request,
    context: any,
    segment: ReportSubrouteSegment,
    options: { access?: FeedbackAccess; headers?: Record<string, string> } = {}
): Promise<{ ok: true; value: FeedbackContext } | { ok: false; response: Response }> {
    const access = options.access ?? 'read';
    const headers = options.headers ?? feedbackCorsHeaders;

    const user = await authenticateRequest(request);

    if (!user) {
        return {
            ok: false,
            response: unauthorizedResponse('Authentication required.', headers),
        };
    }

    if (!canTakeFeedbackAction(user, access)) {
        return {
            ok: false,
            response: feedbackErrorResponse(
                403,
                'Only passengers can vote on or comment on accessibility reports.',
                headers
            ),
        };
    }

    const reportId = extractFeedbackReportId(request, context, segment);

    if (!reportId) {
        return { ok: false, response: feedbackErrorResponse(400, 'Report ID is required.', headers) };
    }

    const adminDb = getAdminDb();
    const reportRef = adminDb.collection(REPORTS_COLLECTION).doc(reportId);
    const reportDoc = await reportRef.get();

    const report = reportDoc.exists ? reportDoc.data() ?? {} : null;

    // A report this session cannot see is answered exactly as one that does not
    // exist: votes and comments on somebody else's PENDING or REJECTED issue
    // are neither readable nor writable, the same visibility the report itself
    // has (`canViewReport`).
    if (!report || !canViewReport(report, user)) {
        return { ok: false, response: feedbackErrorResponse(404, 'Report not found.', headers) };
    }

    return {
        ok: true,
        value: {
            passengerId: user.passengerId,
            isAdmin: isAdminSession(user),
            reportId,
            reportRef,
            report,
            adminDb,
        },
    };
}

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------

/** The vote in a request body, or why it is not one. */
export function readVoteChoice(input: unknown): FeedbackValidation<ReportVoteChoice> {
    if (input === undefined || input === null || input === '') {
        return { ok: false, message: 'A vote is required.' };
    }

    if (!isReportVoteChoice(input)) {
        return { ok: false, message: 'Vote must be either AGREE or DISAGREE.' };
    }

    return { ok: true, value: input };
}

/**
 * The comment in a request body, trimmed, or why it cannot be stored.
 *
 * Whitespace is not a comment: a composer that lets a stray space through must
 * not put an empty row in the thread. The cap is the one the input already
 * enforces, so the API can only ever refuse what the app could not have sent.
 */
export function normalizeReportComment(input: unknown): FeedbackValidation<string> {
    if (typeof input !== 'string') {
        return { ok: false, message: 'Comment cannot be empty.' };
    }

    const trimmed = input.trim();

    if (!trimmed) {
        return { ok: false, message: 'Comment cannot be empty.' };
    }

    if (trimmed.length > MAX_REPORT_COMMENT_LENGTH) {
        return {
            ok: false,
            message: `A comment can be at most ${MAX_REPORT_COMMENT_LENGTH} characters.`,
        };
    }

    return { ok: true, value: trimmed };
}

/** What a new comment or reply says: its text, its photo, or both. */
export interface ReportCommentContent {
    /** Trimmed. Empty only when a photo carries the comment on its own. */
    text: string;
    imageUrl: string | null;
}

/**
 * The text and photo in a request body, or why they cannot be stored.
 *
 * A comment has to say something, but a photo is a way of saying it: text or a
 * photo is required, and either on its own is enough. Text that is present is
 * held to exactly the rules `normalizeReportComment` applies, so a comment with
 * a photo cannot be used to slip past the length cap.
 */
export function normalizeReportCommentContent(
    body: Record<string, any>
): FeedbackValidation<ReportCommentContent> {
    const image = normalizeCommentImageUrl(body.imageUrl);

    if (!image.ok) return image;

    const rawText = body.comment;
    const hasText = typeof rawText === 'string' && rawText.trim().length > 0;

    if (!hasText) {
        if (rawText !== undefined && rawText !== null && typeof rawText !== 'string') {
            return { ok: false, message: 'Comment cannot be empty.' };
        }

        return image.value
            ? { ok: true, value: { text: '', imageUrl: image.value } }
            : { ok: false, message: 'Add a comment or attach a photo.' };
    }

    const text = normalizeReportComment(rawText);

    if (!text.ok) return text;

    return { ok: true, value: { text: text.value, imageUrl: image.value } };
}

/**
 * The comment a reply is being attached to, or why it cannot be.
 *
 * Absent means a top-level comment. Present, it must name a comment that
 * exists, sits under the same report as the reply, is itself top-level (one
 * level of replies, never a reply to a reply) and has not been deleted. A
 * parent under another report is answered exactly as one that does not exist,
 * so a reply cannot be used to probe which comments other reports carry.
 */
export async function resolveReplyParent(
    adminDb: any,
    reportId: string,
    input: unknown
): Promise<{ ok: true; value: string | null } | { ok: false; status: number; message: string }> {
    if (input === undefined || input === null || input === '') return { ok: true, value: null };

    if (typeof input !== 'string' || !input.trim() || input.includes('/')) {
        return { ok: false, status: 400, message: 'The comment being replied to is not valid.' };
    }

    const parentCommentId = input.trim();
    const parentDoc = await adminDb
        .collection(REPORT_COMMENTS_COLLECTION)
        .doc(parentCommentId)
        .get();
    const parent = parentDoc.exists ? parentDoc.data() ?? null : null;

    if (!parent || parent.reportId !== reportId) {
        return { ok: false, status: 404, message: 'The comment being replied to was not found.' };
    }

    if (parent.parentCommentId) {
        return { ok: false, status: 400, message: 'Replies can only be added to a top-level comment.' };
    }

    if (parent.deleted) {
        return { ok: false, status: 400, message: 'That comment has been deleted.' };
    }

    return { ok: true, value: parentCommentId };
}

/** The replies stored under one top-level comment. */
async function readReplyDocs(adminDb: any, parentCommentId: string): Promise<any[]> {
    // Single equality filter: answered by Firestore's automatic single-field
    // index, no composite index needed.
    const snapshot = await adminDb
        .collection(REPORT_COMMENTS_COLLECTION)
        .where('parentCommentId', '==', parentCommentId)
        .get();

    return snapshot.docs;
}

/** What deleting one comment actually did to the thread. */
export interface CommentRemovalOutcome {
    /**
     * Comments that left the thread besides the requested one: a deleted
     * placeholder parent whose last reply this was.
     */
    alsoRemovedCommentIds: string[];
    /**
     * The requested comment, kept as a placeholder because other passengers'
     * replies still hang off it; null when it was removed outright.
     */
    placeholder: ReportCommentRecord | null;
}

/**
 * Deletes a comment, keeping the thread's shape honest.
 *
 * - A comment with no replies is deleted outright, as it always was.
 * - A top-level comment with replies is emptied into a `deleted` placeholder
 *   rather than deleted: the replies were written by other passengers, and
 *   deleting one's own comment must never delete somebody else's.
 * - A reply is deleted outright, and if that leaves a placeholder parent with
 *   no replies at all, the placeholder goes too — it was only kept for them.
 *
 * Authorisation is the caller's job; this only applies the thread rules.
 */
export async function removeReportComment(
    adminDb: any,
    commentRef: any,
    comment: Record<string, any>,
    commentId: string
): Promise<CommentRemovalOutcome> {
    const parentCommentId =
        typeof comment.parentCommentId === 'string' && comment.parentCommentId
            ? comment.parentCommentId
            : null;

    if (!parentCommentId) {
        const replies = await readReplyDocs(adminDb, commentId);

        if (replies.length > 0) {
            const update = {
                deleted: true,
                text: '',
                imageUrl: null,
                updatedAt: new Date().toISOString(),
            };

            await commentRef.update(update);

            return {
                alsoRemovedCommentIds: [],
                placeholder: serializeReportComment({ ...comment, ...update }, commentId),
            };
        }

        await commentRef.delete();

        return { alsoRemovedCommentIds: [], placeholder: null };
    }

    await commentRef.delete();

    const alsoRemovedCommentIds: string[] = [];
    const parentRef = adminDb.collection(REPORT_COMMENTS_COLLECTION).doc(parentCommentId);
    const parentDoc = await parentRef.get();
    const parent = parentDoc.exists ? parentDoc.data() ?? null : null;

    if (parent?.deleted) {
        const remaining = (await readReplyDocs(adminDb, parentCommentId)).filter(
            (doc: any) => doc.id !== commentId
        );

        if (remaining.length === 0) {
            await parentRef.delete();
            alsoRemovedCommentIds.push(parentCommentId);
        }
    }

    return { alsoRemovedCommentIds, placeholder: null };
}

// ------------------------------------------------------------------
// Tallies and the admin review flag
// ------------------------------------------------------------------

export interface ReportVoteCounts {
    agreeCount: number;
    disagreeCount: number;
}

/**
 * How the report stands after whatever was just written.
 *
 * Counted from the votes themselves rather than by incrementing a number on the
 * report, because the stored votes are the record: a tally that drifts from
 * them is a claim about the community that nobody actually made. The equality
 * filter is answered by Firestore's automatic single-field index, and the split
 * by side happens here — one query, no composite index.
 */
/**
 * How many comments each report carries, as one map.
 *
 * Built for the list endpoint, which needs a number for every report it is
 * about to return. One query answers all of them: asking per report would make
 * a thirty-report list thirty round trips, and asking from the app would make
 * it thirty requests.
 *
 * `select('reportId')` keeps it cheap in the only way that matters at this
 * size — the documents come back carrying one field instead of every comment
 * body on the system. It still reads one document per comment; a stored counter
 * would be the next step if comment volume ever makes that read expensive, and
 * it would have to be backfilled for comments already written.
 *
 * A report with no comments is simply absent from the map, and the caller reads
 * that as the zero it is.
 */
export async function countCommentsByReport(adminDb: any): Promise<Map<string, number>> {
    const collection = adminDb.collection(REPORT_COMMENTS_COLLECTION);

    const snapshot = await collection.select('reportId', 'deleted').get();

    const counts = new Map<string, number>();

    snapshot.docs.forEach((doc: any) => {
        const reportId = doc.data()?.reportId;

        if (typeof reportId !== 'string' || !reportId) return;

        // A deleted comment kept only as a placeholder for its replies is not
        // a comment anybody is still making.
        if (doc.data()?.deleted) return;

        counts.set(reportId, (counts.get(reportId) ?? 0) + 1);
    });

    return counts;
}

export async function countReportVotes(adminDb: any, reportId: string): Promise<ReportVoteCounts> {
    const snapshot = await adminDb
        .collection(REPORT_VOTES_COLLECTION)
        .where('reportId', '==', reportId)
        .get();

    let agreeCount = 0;
    let disagreeCount = 0;

    snapshot.docs.forEach((doc: any) => {
        const vote = doc.data()?.vote;

        if (vote === 'AGREE') agreeCount += 1;
        else if (vote === 'DISAGREE') disagreeCount += 1;
    });

    return { agreeCount, disagreeCount };
}

/** Whether this many agreeing passengers is an admin's problem. */
export function shouldRequireAdminReview(agreeCount: number): boolean {
    return agreeCount >= REPORT_ADMIN_REVIEW_AGREE_THRESHOLD;
}

/**
 * Writes the counts back onto the report and raises or clears the review flag.
 *
 * `status` is not touched. Five passengers agreeing is a reason for an admin to
 * look at the report, not a finding about it — moving it to VERIFIED here would
 * let a report verify itself, which is exactly what an admin is for.
 *
 * The flag tracks the count in both directions. A passenger who switches Agree
 * to Disagree takes their support back with them, and a report sitting in an
 * admin's queue on the strength of five agreements that are now four is a queue
 * entry nobody stands behind. `adminReviewFlaggedAt` is left as it was when the
 * flag comes down, so a report that has been over the line before still says
 * when.
 */
export async function applyVoteCountsToReport(
    reportRef: any,
    counts: ReportVoteCounts
): Promise<boolean> {
    const requiresAdminReview = shouldRequireAdminReview(counts.agreeCount);

    await reportRef.update({
        agreeCount: counts.agreeCount,
        disagreeCount: counts.disagreeCount,
        requiresAdminReview,
        ...(requiresAdminReview ? { adminReviewFlaggedAt: new Date().toISOString() } : {}),
    });

    return requiresAdminReview;
}

// ------------------------------------------------------------------
// Serialisation
// ------------------------------------------------------------------

/**
 * A stored timestamp as an ISO 8601 string.
 *
 * Firestore hands back a Timestamp, a route called directly in a test hands
 * back the Date it wrote, and a record written by an older path may carry a
 * string. All three have to reach the app as the one thing its date formatter
 * understands.
 */
export function toIsoString(value: any): string {
    if (!value) return '';

    const date = value?.toDate ? value.toDate() : new Date(value);
    const time = date instanceof Date ? date.getTime() : NaN;

    return Number.isNaN(time) ? String(value) : date.toISOString();
}

/**
 * A comment as the thread renders it: who said it, what they said, and when.
 *
 * `passengerId` travels with it so the app can tell a passenger their own
 * comment apart from everybody else's without a second request.
 */
export function serializeReportComment(
    data: Record<string, any>,
    documentId: string
): ReportCommentRecord {
    return {
        commentId: data.commentId ?? documentId,
        reportId: data.reportId,
        passengerId: data.passengerId,
        authorName: data.authorName || 'Passenger',
        text: data.text,
        createdAt: toIsoString(data.createdAt),
        // Only on a comment that has actually been edited, so an unedited one
        // reads exactly as it always has.
        ...(data.editedAt ? { editedAt: toIsoString(data.editedAt) } : {}),
        // The thread additions are likewise only present when they apply, so a
        // plain top-level comment with no photo reads exactly as before.
        ...(typeof data.imageUrl === 'string' && data.imageUrl ? { imageUrl: data.imageUrl } : {}),
        ...(typeof data.parentCommentId === 'string' && data.parentCommentId
            ? { parentCommentId: data.parentCommentId }
            : {}),
        ...(data.deleted ? { deleted: true } : {}),
    };
}

/** A comment's createdAt as a sortable number; an unreadable one sorts last. */
function commentSortableTime(value: unknown): number {
    const time = new Date(toIsoString(value)).getTime();

    return Number.isNaN(time) ? -Infinity : time;
}

/**
 * One report's whole thread, newest first.
 *
 * Shared by the passenger thread and by the admin review view, so both read the
 * same comments in the same order — an admin deciding a report sees exactly
 * what the passengers arguing about it see.
 *
 * The filter alone goes to Firestore. An equality filter combined with orderBy
 * on a different field needs a composite index, and without one the query fails
 * outright rather than coming back unordered — the same reason GET /api/reports
 * sorts a filtered scope after the fact. The filter stays in the query, which
 * is the part that must not be done here.
 */
export async function readReportComments(
    adminDb: any,
    reportId: string
): Promise<ReportCommentRecord[]> {
    const snapshot = await adminDb
        .collection(REPORT_COMMENTS_COLLECTION)
        .where('reportId', '==', reportId)
        .get();

    return snapshot.docs
        .map((doc: any) => serializeReportComment(doc.data() ?? {}, doc.id))
        .sort(
            (first: ReportCommentRecord, second: ReportCommentRecord) =>
                commentSortableTime(second.createdAt) - commentSortableTime(first.createdAt)
        );
}

/**
 * The name to show on a comment, read from the user record once and stored with
 * it.
 *
 * Snapshotted the way a report snapshots the bus and the route it names:
 * drawing a thread must not cost one user lookup per row, and a comment has to
 * keep reading correctly afterwards. Falls back rather than failing — an
 * unnamed passenger is a comment attributed to "Passenger", not a lost comment.
 */
export async function resolveCommentAuthorName(
    adminDb: any,
    passengerId: string
): Promise<string> {
    try {
        const userDoc = await adminDb.collection('users').doc(passengerId).get();

        if (!userDoc.exists) return 'Passenger';

        const name = userDoc.data()?.userName;

        return typeof name === 'string' && name.trim() ? name.trim() : 'Passenger';
    } catch {
        return 'Passenger';
    }
}

/**
 * The next comment id: CMT-00001, CMT-00002, ...
 *
 * The counter transaction reports already use for REP- ids, against its own
 * counter document — readable in the console, and sequential rather than
 * random, which is what makes a thread's write order visible at a glance.
 */
export async function nextReportCommentId(adminDb: any): Promise<string> {
    const counterRef = adminDb.collection('counters').doc('reportComments');

    return adminDb.runTransaction(async (transaction: any) => {
        const counterDoc = await transaction.get(counterRef);

        let nextNumber = 1;

        if (counterDoc.exists) {
            nextNumber = Number(counterDoc.data()?.lastNumber || 0) + 1;
        }

        transaction.set(
            counterRef,
            { lastNumber: nextNumber, updatedAt: new Date() },
            { merge: true }
        );

        return `CMT-${String(nextNumber).padStart(5, '0')}`;
    });
}
