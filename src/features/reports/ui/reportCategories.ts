import { Ionicons } from '@expo/vector-icons';
import {
    REPORT_ISSUE_CATEGORIES,
    ReportIssueCategory,
} from '../../../entities/report/model/types';

export interface ReportCategoryOption {
    value: ReportIssueCategory;
    /** Full wording, used in the category picker. */
    label: string;
    /** Trimmed wording for list cards, where the row is shared with a badge. */
    shortLabel: string;
    icon: keyof typeof Ionicons.glyphMap;
}

// Single source of truth for how a category reads, so the form and the list
// screen can never drift apart on wording or iconography.
//
// Typed as a complete Record rather than an array: the categories themselves
// are defined once, in the entity model, and this file's job is to give each
// one a label. Adding a category there without adding it here is a compile
// error, which is what keeps a category from reaching the picker unnamed.
const CATEGORY_PRESENTATION: Record<
    ReportIssueCategory,
    Omit<ReportCategoryOption, 'value'>
> = {
    BROKEN_RAMP: {
        label: 'Broken Wheelchair Ramp',
        shortLabel: 'Broken Wheelchair Ramp',
        icon: 'construct-outline',
    },
    LIFT_NOT_WORKING: {
        label: 'Accessibility Lift Not Working',
        shortLabel: 'Lift Not Working',
        icon: 'arrow-up-circle-outline',
    },
    PRIORITY_SEAT_MISUSE: {
        label: 'Priority Seat Misuse',
        shortLabel: 'Priority Seat Misuse',
        icon: 'person-remove-outline',
    },
    BUS_OVERCROWDED: {
        label: 'Bus Overcrowded',
        shortLabel: 'Bus Overcrowded',
        icon: 'people-outline',
    },
    DRIVER_DID_NOT_ASSIST: {
        label: 'Driver Did Not Provide Assistance',
        shortLabel: "Driver Didn't Assist",
        icon: 'warning-outline',
    },
    AUDIO_ANNOUNCEMENT_NOT_WORKING: {
        label: 'Audio Announcement Not Working',
        shortLabel: 'Audio Announcement Not Working',
        icon: 'volume-mute-outline',
    },
    OTHER: {
        label: 'Other',
        shortLabel: 'Other',
        icon: 'ellipsis-horizontal-circle-outline',
    },
};

/** The picker's options, in the order the entity model lists the categories. */
export const REPORT_CATEGORY_OPTIONS: ReportCategoryOption[] =
    REPORT_ISSUE_CATEGORIES.map((value) => ({
        value,
        ...CATEGORY_PRESENTATION[value],
    }));

function findOption(category: string): ReportCategoryOption | undefined {
    return REPORT_CATEGORY_OPTIONS.find((option) => option.value === category);
}

/** Falls back to the raw value so an unknown category still reads sensibly. */
export function reportCategoryLabel(category: string): string {
    return findOption(category)?.shortLabel ?? category;
}

export function reportCategoryIcon(category: string): keyof typeof Ionicons.glyphMap {
    return findOption(category)?.icon ?? 'alert-circle-outline';
}
