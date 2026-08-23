/**
 * What a report actually puts on screen — as data, not as JSX.
 *
 * The list card and the details screen both read a report and decide what to
 * show of it: which chips a card carries, whether a bus was named at all,
 * whether there are photos. Deriving that here rather than inside the
 * components is what lets it be tested at all, since this project's Jest setup
 * is node-only with no React renderer.
 *
 * It also makes one rule checkable rather than merely intended: the report id
 * is used for navigation, update and delete, and never appears in anything
 * these functions return. See reportCardVisibleText.
 */

import { AccessibilityReport } from '../../../entities/report/model/types';
import { reportCategoryIcon, reportCategoryLabel } from '../ui/reportCategories';
import { formatCommentCount } from './reportFeedback';
import { formatPhotoCount, formatReportDateTime } from './reportFormat';

/** The icons the card's chips use. A closed set, so the UI can pass them on. */
export type ReportChipIcon =
    | 'bus-outline'
    | 'git-branch-outline'
    | 'images-outline'
    | 'person-circle-outline';

export interface ReportChip {
    icon: ReportChipIcon;
    label: string;
    /** Drawn in the accent colour — used for "Your report". */
    highlighted?: boolean;
}

const DIRECTION_LABELS: Record<string, string> = {
    OUTBOUND: 'Outbound',
    RETURN: 'Return',
};

// ------------------------------------------------------------------
// List card
// ------------------------------------------------------------------

/**
 * The three tallies a card shows: 💬 2  👍 18  👎 1.
 *
 * All three are always numbers. The votes come off the report document, where
 * the vote route writes them, and the comment count is derived per request by
 * GET /api/reports — so a report nobody has answered has all three at zero
 * rather than some of them missing.
 */
export interface ReportCardFeedbackCounts {
    commentCount: number;
    agreeCount: number;
    disagreeCount: number;
}

export interface ReportCardSummary {
    icon: ReturnType<typeof reportCategoryIcon>;
    /** The issue category, in the wording the picker offered it in. */
    title: string;
    description: string;
    chips: ReportChip[];
    submittedLabel: string;
    /**
     * Community feedback on the report, as the list response carried it.
     * Never fetched per card — see reportCardFeedbackCounts.
     */
    feedbackCounts: ReportCardFeedbackCounts;
    /**
     * What a screen reader announces for the whole card.
     *
     * The card is one control — tapping anywhere on it opens the report — so
     * it needs one label rather than a heap of separate readable fragments.
     */
    accessibilityLabel: string;
}

/**
 * Everything the card shows about a report.
 *
 * Notably not the report id. It reads as a reference number a passenger is
 * expected to quote, which is not how this feature works — the card is opened,
 * not looked up — so it is carried in the navigation path instead.
 */
export function reportCardSummary(
    report: AccessibilityReport,
    options: { isOwnReport?: boolean } = {}
): ReportCardSummary {
    const chips: ReportChip[] = [];

    // Prefer the display snapshot taken when the report was filed; fall back to
    // the raw id so a report whose snapshot is missing still identifies its bus.
    const busLabel = report.vehicle?.numberPlate ?? report.busId;
    const routeLabel = report.route?.routeNumber
        ? `Route ${report.route.routeNumber}`
        : report.routeId;

    if (busLabel) chips.push({ icon: 'bus-outline', label: busLabel });
    if (routeLabel) chips.push({ icon: 'git-branch-outline', label: routeLabel });

    // The stored URLs are the count: a report with no photos has no photoUrls
    // at all, so the chip is simply absent rather than reading "0 photos".
    const photoCount = report.photoUrls?.length ?? 0;

    if (photoCount > 0) {
        chips.push({ icon: 'images-outline', label: formatPhotoCount(photoCount) });
    }

    if (options.isOwnReport) {
        chips.push({ icon: 'person-circle-outline', label: 'Your report', highlighted: true });
    }

    const title = reportCategoryLabel(report.issueCategory);

    // Everything the feedback row shows, all of it off the list response.
    // Nothing is fetched for a card: the list is one request, and a lookup per
    // row would make it as many requests as there are reports.
    const feedbackCounts = reportCardFeedbackCounts(report);

    const feedbackLabel =
        `, ${formatCommentCount(feedbackCounts.commentCount)}` +
        `, ${feedbackCounts.agreeCount} agree` +
        `, ${feedbackCounts.disagreeCount} disagree`;

    return {
        icon: reportCategoryIcon(report.issueCategory),
        title,
        description: report.description,
        chips,
        submittedLabel: `Submitted ${formatReportDateTime(report.createdAt)}`,
        feedbackCounts,
        accessibilityLabel: `View accessibility report: ${title}${feedbackLabel}`,
    };
}

/**
 * What the community has made of this report.
 *
 * Every count is read as a number or as zero, never as absent: the votes are
 * stored on the report only once somebody has voted, and `commentCount` is
 * attached by GET /api/reports rather than stored at all — so a card built from
 * a report that predates either must still draw a row rather than a gap.
 *
 * Zero is a real answer here. It says nobody has agreed, disagreed or commented
 * yet, which is exactly what a freshly filed report deserves to show.
 */
export function reportCardFeedbackCounts(
    report: AccessibilityReport
): ReportCardFeedbackCounts {
    return {
        commentCount: countOrZero(report.commentCount),
        agreeCount: countOrZero(report.agreeCount),
        disagreeCount: countOrZero(report.disagreeCount),
    };
}

/** A stored tally, or zero for anything that is not a usable number. */
function countOrZero(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : 0;
}

/**
 * Every string the card puts in front of a passenger, on screen or through a
 * screen reader.
 *
 * Exists for the assertion that the report id is not among them — a check worth
 * having as code, because putting it back is a one-line change.
 */
export function reportCardVisibleText(summary: ReportCardSummary): string[] {
    return [
        summary.title,
        summary.description,
        summary.submittedLabel,
        summary.accessibilityLabel,
        ...summary.chips.map((chip) => chip.label),
    ];
}

// ------------------------------------------------------------------
// Journey details
// ------------------------------------------------------------------

export type ReportJourneyIcon = 'bus-outline' | 'git-branch-outline';

export interface ReportJourneyEntry {
    icon: ReportJourneyIcon;
    label: string;
    /**
     * The headline value, or null when the report was filed without this half
     * of the journey — which is a normal report, not a broken one, so the
     * screen says "Not provided" rather than leaving a gap.
     */
    primary: string | null;
    /** Supporting line, present only where the snapshot holds more. */
    secondary?: string;
}

/**
 * The bus and the route, always both, in the order the form asks for them.
 *
 * Returned as a fixed pair rather than "whatever was filled in" so the details
 * screen shows a stable shape: a report without a bus reads as a report whose
 * bus was not recorded, which is what it is.
 */
export function reportJourneyEntries(report: AccessibilityReport): ReportJourneyEntry[] {
    const numberPlate = report.vehicle?.numberPlate ?? report.busId ?? null;
    const busDetail = [report.vehicle?.busModel, report.vehicle?.manufacturer]
        .filter(Boolean)
        .join(' · ');

    const routeNumber = report.route?.routeNumber;
    const routeName = report.route?.routeName;

    const routePrimary = routeNumber
        ? [routeNumber, routeName].filter(Boolean).join(' · ')
        : (report.routeId ?? null);

    const direction = report.route?.direction;

    return [
        {
            icon: 'bus-outline',
            label: 'Bus / Vehicle',
            primary: numberPlate,
            ...(busDetail ? { secondary: busDetail } : {}),
        },
        {
            icon: 'git-branch-outline',
            label: 'Route',
            primary: routePrimary,
            ...(direction
                ? { secondary: DIRECTION_LABELS[direction] ?? direction }
                : {}),
        },
    ];
}

// ------------------------------------------------------------------
// Timeline
// ------------------------------------------------------------------

export type ReportTimelineIcon = 'calendar-outline' | 'refresh-outline';

export interface ReportTimelineRow {
    icon: ReportTimelineIcon;
    label: string;
    value: string;
}

/**
 * When the report was filed, and when it was last changed.
 *
 * The second row appears only once the two differ: on a report nobody has
 * edited they are the same moment, and showing it twice reads as an event that
 * did not happen.
 */
export function reportTimelineRows(report: AccessibilityReport): ReportTimelineRow[] {
    const rows: ReportTimelineRow[] = [
        {
            icon: 'calendar-outline',
            label: 'Submitted',
            value: formatReportDateTime(report.createdAt),
        },
    ];

    if (report.updatedAt && report.updatedAt !== report.createdAt) {
        rows.push({
            icon: 'refresh-outline',
            label: 'Last Updated',
            value: formatReportDateTime(report.updatedAt),
        });
    }

    return rows;
}

/** Whether the report has been edited since it was filed. */
export function hasBeenEdited(report: AccessibilityReport): boolean {
    return !!report.updatedAt && report.updatedAt !== report.createdAt;
}

// ------------------------------------------------------------------
// Photo gallery
// ------------------------------------------------------------------

export interface ReportGalleryPhoto {
    /** The Cloudinary secure URL the report was filed with. */
    url: string;
    /** 1-based, for the label and for the full-screen viewer's counter. */
    position: number;
    total: number;
    accessibilityLabel: string;
}

/**
 * Every photo on the report, in the order it was filed with.
 *
 * All of them: the gallery is the evidence, and a grid that quietly stopped at
 * four would be hiding the fifth from the reviewer who needs it.
 */
export function reportGalleryPhotos(report: AccessibilityReport): ReportGalleryPhoto[] {
    const urls = report.photoUrls ?? [];

    return urls.map((url, index) => ({
        url,
        position: index + 1,
        total: urls.length,
        accessibilityLabel: `Photo evidence ${index + 1} of ${urls.length}. Tap to view full screen.`,
    }));
}

/**
 * How many columns the gallery grid uses at this width.
 *
 * Three on an ordinary phone, two on a narrow one, where three tiles would each
 * be too small to make out what the photo shows.
 */
export function galleryColumnsForWidth(width: number): number {
    return width >= 360 ? 3 : 2;
}
