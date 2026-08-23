/**
 * What a report actually puts on screen — as data, not as JSX.
 *
 * The list card and the details screen both read a report and decide what to
 * show of it: which chips a card carries, which vehicle lines exist, whether
 * there are photos. Deriving that here rather than inside the components is
 * what lets it be tested at all, since this project's Jest setup is node-only
 * with no React renderer.
 *
 * It also makes one rule checkable rather than merely intended: the report id
 * is used for navigation, update and delete, and never appears in anything
 * these functions return. See reportCardVisibleText.
 */

import { AccessibilityReport } from '../../../entities/report/model/types';
import { reportCategoryIcon, reportCategoryLabel } from '../ui/reportCategories';
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

/** The icons the details screen's rows use. */
export type ReportDetailIcon =
    | 'bus-outline'
    | 'car-outline'
    | 'business-outline'
    | 'git-branch-outline'
    | 'map-outline'
    | 'navigate-outline'
    | 'calendar-outline'
    | 'refresh-outline';

export interface ReportDetailRow {
    icon: ReportDetailIcon;
    label: string;
    value: string;
}

const DIRECTION_LABELS: Record<string, string> = {
    OUTBOUND: 'Outbound',
    RETURN: 'Return',
};

// ------------------------------------------------------------------
// List card
// ------------------------------------------------------------------

export interface ReportCardSummary {
    icon: ReturnType<typeof reportCategoryIcon>;
    /** The issue category, in the wording the picker offered it in. */
    title: string;
    description: string;
    chips: ReportChip[];
    submittedLabel: string;
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

    return {
        icon: reportCategoryIcon(report.issueCategory),
        title: reportCategoryLabel(report.issueCategory),
        description: report.description,
        chips,
        submittedLabel: `Submitted ${formatReportDateTime(report.createdAt)}`,
    };
}

/**
 * Every string the card renders.
 *
 * Exists for the assertion that the report id is not among them — a check worth
 * having as code, because putting it back is a one-line change.
 */
export function reportCardVisibleText(summary: ReportCardSummary): string[] {
    return [
        summary.title,
        summary.description,
        summary.submittedLabel,
        ...summary.chips.map((chip) => chip.label),
    ];
}

// ------------------------------------------------------------------
// Details screen
// ------------------------------------------------------------------

/**
 * The bus lines, or none at all.
 *
 * A report filed without a bus is a normal report — the passenger may not have
 * known which vehicle it was — so an empty list here means the screen shows
 * "No bus details", not that something is missing.
 */
export function reportVehicleRows(report: AccessibilityReport): ReportDetailRow[] {
    const rows: ReportDetailRow[] = [];
    const numberPlate = report.vehicle?.numberPlate ?? report.busId;

    if (numberPlate) {
        rows.push({ icon: 'bus-outline', label: 'Number Plate', value: numberPlate });
    }

    if (report.vehicle?.busModel) {
        rows.push({ icon: 'car-outline', label: 'Model', value: report.vehicle.busModel });
    }

    if (report.vehicle?.manufacturer) {
        rows.push({
            icon: 'business-outline',
            label: 'Manufacturer',
            value: report.vehicle.manufacturer,
        });
    }

    return rows;
}

/** The route lines, by the same rules as the bus. */
export function reportRouteRows(report: AccessibilityReport): ReportDetailRow[] {
    const rows: ReportDetailRow[] = [];
    const routeNumber = report.route?.routeNumber ?? report.routeId;

    if (routeNumber) {
        rows.push({ icon: 'git-branch-outline', label: 'Route Number', value: routeNumber });
    }

    if (report.route?.routeName) {
        rows.push({ icon: 'map-outline', label: 'Route Name', value: report.route.routeName });
    }

    if (report.route?.direction) {
        rows.push({
            icon: 'navigate-outline',
            label: 'Direction',
            value: DIRECTION_LABELS[report.route.direction] ?? report.route.direction,
        });
    }

    return rows;
}

/**
 * When the report was filed, and when it was last changed.
 *
 * The second line appears only once the two differ: on a report nobody has
 * edited they are the same moment, and showing it twice reads as an event that
 * did not happen.
 */
export function reportTimelineRows(report: AccessibilityReport): ReportDetailRow[] {
    const rows: ReportDetailRow[] = [
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
