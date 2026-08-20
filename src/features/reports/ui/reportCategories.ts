import { Ionicons } from '@expo/vector-icons';
import { ReportIssueCategory } from '../../../entities/report/model/types';

export interface ReportCategoryOption {
    value: ReportIssueCategory;
    /** Full wording, used in the category picker. */
    label: string;
    /** Trimmed wording for list cards, where the row is shared with a badge. */
    shortLabel: string;
    icon: keyof typeof Ionicons.glyphMap;
}

// Single source of truth for issue categories so the form and the list screen
// can never drift apart on wording or iconography.
export const REPORT_CATEGORY_OPTIONS: ReportCategoryOption[] = [
    {
        value: 'BROKEN_RAMP',
        label: 'Broken Wheelchair Ramp',
        shortLabel: 'Broken Wheelchair Ramp',
        icon: 'construct-outline',
    },
    {
        value: 'LIFT_NOT_WORKING',
        label: 'Accessibility Lift Not Working',
        shortLabel: 'Lift Not Working',
        icon: 'arrow-up-circle-outline',
    },
    {
        value: 'PRIORITY_SEAT_MISUSE',
        label: 'Priority Seat Misuse',
        shortLabel: 'Priority Seat Misuse',
        icon: 'person-remove-outline',
    },
    {
        value: 'BUS_OVERCROWDED',
        label: 'Bus Overcrowded',
        shortLabel: 'Bus Overcrowded',
        icon: 'people-outline',
    },
    {
        value: 'DRIVER_DID_NOT_ASSIST',
        label: 'Driver Did Not Provide Assistance',
        shortLabel: "Driver Didn't Assist",
        icon: 'warning-outline',
    },
    {
        value: 'AUDIO_ANNOUNCEMENT_NOT_WORKING',
        label: 'Audio Announcement Not Working',
        shortLabel: 'Audio Announcement Not Working',
        icon: 'volume-mute-outline',
    },
];

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
