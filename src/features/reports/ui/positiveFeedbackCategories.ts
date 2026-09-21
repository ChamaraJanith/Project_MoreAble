import { Ionicons } from '@expo/vector-icons';
import {
    POSITIVE_FEEDBACK_CATEGORIES,
    PositiveFeedbackCategory,
} from '../../../entities/report/model/types';

export interface PositiveFeedbackCategoryOption {
    value: PositiveFeedbackCategory;
    /** Wording used in the picker and on the selected field. */
    label: string;
    /** One line under the label in the picker, saying what the category covers. */
    description: string;
    icon: keyof typeof Ionicons.glyphMap;
}

// The positive counterpart of reportCategories.ts, built the same way: a
// complete Record over the entity model's list, so adding a category there
// without wording here is a compile error rather than an unnamed picker row.
const CATEGORY_PRESENTATION: Record<
    PositiveFeedbackCategory,
    Omit<PositiveFeedbackCategoryOption, 'value'>
> = {
    HELPFUL_DRIVER: {
        label: 'Helpful Driver',
        description: 'The driver assisted you or waited patiently',
        icon: 'happy-outline',
    },
    EASY_WHEELCHAIR_BOARDING: {
        label: 'Easy Wheelchair Boarding',
        description: 'The ramp or lift worked and boarding was smooth',
        icon: 'accessibility-outline',
    },
    CLEAR_STOP_ANNOUNCEMENT: {
        label: 'Clear Stop Announcement',
        description: 'Stops were announced clearly by audio or display',
        icon: 'volume-high-outline',
    },
    GOOD_PRIORITY_SEATING: {
        label: 'Good Priority Seating',
        description: 'Priority seats were available and respected',
        icon: 'body-outline',
    },
    ACCESSIBLE_BUS_STOP: {
        label: 'Accessible Bus Stop',
        description: 'The stop was step-free, sheltered or easy to use',
        icon: 'location-outline',
    },
};

/** The picker's options, in the order the entity model lists the categories. */
export const POSITIVE_FEEDBACK_CATEGORY_OPTIONS: PositiveFeedbackCategoryOption[] =
    POSITIVE_FEEDBACK_CATEGORIES.map((value) => ({
        value,
        ...CATEGORY_PRESENTATION[value],
    }));

function findOption(category: string | undefined): PositiveFeedbackCategoryOption | undefined {
    return POSITIVE_FEEDBACK_CATEGORY_OPTIONS.find((option) => option.value === category);
}

/** Falls back to the raw value so an unknown category still reads sensibly. */
export function positiveFeedbackCategoryLabel(category: string): string {
    return findOption(category)?.label ?? category;
}

/** The category's icon, or a thumbs-up for one this build does not know. */
export function positiveFeedbackCategoryIcon(
    category: string | undefined
): keyof typeof Ionicons.glyphMap {
    return findOption(category)?.icon ?? 'thumbs-up-outline';
}
