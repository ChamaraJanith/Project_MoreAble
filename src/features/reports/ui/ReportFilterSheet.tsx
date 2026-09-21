import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AdminSelectModal, AdminSelectOption } from '../../admin/ui/AdminSelectModal';
import { adminColors } from '../../admin/ui/adminTheme';
import {
    DEFAULT_REPORT_FILTERS,
    REPORT_SORT_OPTIONS,
    REPORT_STATUS_FILTERS,
    REPORT_TYPE_FILTERS,
    ReportFilterOption,
    ReportListFilters,
    ReportTypeFilter,
    reportCategoryFilterOptions,
} from '../utils/reportSearch';

/** The picker row that means "no narrowing". Never stored as a filter value. */
const ALL_VALUE = '__ALL__';

type OpenPicker = 'category' | 'route' | 'sort' | null;

interface ReportFilterSheetProps {
    /** The filters currently applied to the list; the sheet edits a copy. */
    filters: ReportListFilters;
    /** The routes the loaded reports name — see reportRouteFilterOptions. */
    routeOptions: ReportFilterOption[];
    onApply: (filters: ReportListFilters) => void;
    onClose: () => void;
}

/**
 * The passenger list's filter sheet.
 *
 * Mounted only while open, so each opening starts from the filters that are
 * applied and nothing chosen here touches the list until Apply — closing with
 * the X or the backdrop throws the draft away.
 */
export function ReportFilterSheet({ filters, routeOptions, onApply, onClose }: ReportFilterSheetProps) {
    const insets = useSafeAreaInsets();
    const [draft, setDraft] = useState<ReportListFilters>(filters);
    const [openPicker, setOpenPicker] = useState<OpenPicker>(null);

    const categoryOptions = useMemo(() => reportCategoryFilterOptions(draft.type), [draft.type]);

    const changeType = (type: ReportTypeFilter) => {
        // A category from the other list cannot match anything of this type,
        // so it is dropped rather than left to empty the list silently.
        const keepsCategory =
            !draft.category || reportCategoryFilterOptions(type).some((o) => o.value === draft.category);

        setDraft({ ...draft, type, category: keepsCategory ? draft.category : null });
    };

    const labelFor = (options: ReportFilterOption[], value: string | null, fallback: string) =>
        options.find((option) => option.value === value)?.label ?? fallback;

    const withAll = (label: string, options: ReportFilterOption[]): AdminSelectOption[] => [
        { value: ALL_VALUE, label },
        ...options,
    ];

    return (
        <Modal visible transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <TouchableOpacity
                    style={StyleSheet.absoluteFill}
                    activeOpacity={1}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close filters"
                />

                <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
                    <View style={styles.handle} />

                    <View style={styles.header}>
                        <Text style={styles.title} accessibilityRole="header">
                            Filter Reports
                        </Text>
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.closeButton}
                            accessibilityRole="button"
                            accessibilityLabel="Close filters"
                        >
                            <Ionicons name="close" size={24} color={adminColors.textPrimary} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
                        <SectionLabel text="Report Type" />
                        <Segmented
                            options={REPORT_TYPE_FILTERS}
                            value={draft.type}
                            onChange={changeType}
                            groupLabel="Report type"
                        />

                        <SectionLabel text="Category" />
                        <Dropdown
                            label="Category"
                            value={labelFor(categoryOptions, draft.category, 'All Categories')}
                            onPress={() => setOpenPicker('category')}
                        />

                        <SectionLabel text="Route" />
                        <Dropdown
                            label="Route"
                            value={labelFor(routeOptions, draft.routeId, 'All Routes')}
                            onPress={() => setOpenPicker('route')}
                        />

                        <SectionLabel text="Status" />
                        <Segmented
                            options={REPORT_STATUS_FILTERS}
                            value={draft.status}
                            onChange={(status) => setDraft({ ...draft, status })}
                            groupLabel="Status"
                        />

                        <SectionLabel text="Sort By" />
                        <Dropdown
                            label="Sort by"
                            value={labelFor(REPORT_SORT_OPTIONS, draft.sort, 'Newest First')}
                            onPress={() => setOpenPicker('sort')}
                        />
                    </ScrollView>

                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={styles.resetButton}
                            onPress={() => setDraft(DEFAULT_REPORT_FILTERS)}
                            accessibilityRole="button"
                            accessibilityLabel="Reset filters"
                        >
                            <Text style={styles.resetText}>Reset</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.applyButton}
                            onPress={() => onApply(draft)}
                            accessibilityRole="button"
                            accessibilityLabel="Apply Filters"
                        >
                            <Text style={styles.applyText}>Apply Filters</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* Rendered inside this Modal so each picker presents over the
                sheet rather than behind it. */}
            <AdminSelectModal
                visible={openPicker === 'category'}
                title="Category"
                options={withAll('All Categories', categoryOptions)}
                selectedValue={draft.category ?? ALL_VALUE}
                emptyMessage="No categories are available."
                onClose={() => setOpenPicker(null)}
                onSelect={(value) => {
                    setDraft({ ...draft, category: value === ALL_VALUE ? null : value });
                    setOpenPicker(null);
                }}
            />

            <AdminSelectModal
                visible={openPicker === 'route'}
                title="Route"
                options={withAll('All Routes', routeOptions)}
                selectedValue={draft.routeId ?? ALL_VALUE}
                emptyMessage="No routes are named on these reports."
                onClose={() => setOpenPicker(null)}
                onSelect={(value) => {
                    setDraft({ ...draft, routeId: value === ALL_VALUE ? null : value });
                    setOpenPicker(null);
                }}
            />

            <AdminSelectModal
                visible={openPicker === 'sort'}
                title="Sort By"
                options={REPORT_SORT_OPTIONS}
                selectedValue={draft.sort}
                emptyMessage="No sort orders are available."
                onClose={() => setOpenPicker(null)}
                onSelect={(value) => {
                    setDraft({ ...draft, sort: value as ReportListFilters['sort'] });
                    setOpenPicker(null);
                }}
            />
        </Modal>
    );
}

function SectionLabel({ text }: { text: string }) {
    return <Text style={styles.sectionLabel}>{text.toUpperCase()}</Text>;
}

/** A row of pill buttons, one of which is selected. Wraps on a narrow phone. */
function Segmented<T extends string>({
    options,
    value,
    onChange,
    groupLabel,
}: {
    options: ReportFilterOption<T>[];
    value: T;
    onChange: (value: T) => void;
    groupLabel: string;
}) {
    return (
        <View style={styles.pillRow} accessibilityRole="radiogroup" accessibilityLabel={groupLabel}>
            {options.map((option) => {
                const isSelected = option.value === value;

                return (
                    <TouchableOpacity
                        key={option.value}
                        style={[styles.pill, isSelected && styles.pillSelected]}
                        onPress={() => onChange(option.value)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isSelected, checked: isSelected }}
                        accessibilityLabel={`${groupLabel}: ${option.label}`}
                    >
                        <Text style={[styles.pillText, isSelected && styles.pillTextSelected]}>
                            {option.label}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

function Dropdown({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
    return (
        <TouchableOpacity
            style={styles.dropdown}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityValue={{ text: value }}
            accessibilityHint="Double tap to choose an option"
        >
            <Text style={styles.dropdownText} numberOfLines={1}>
                {value}
            </Text>
            <Ionicons name="chevron-down" size={18} color={adminColors.textMuted} />
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
    },
    sheet: {
        maxHeight: '88%',
        backgroundColor: adminColors.surface,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingHorizontal: 20,
        paddingTop: 8,
    },
    handle: {
        alignSelf: 'center',
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: adminColors.border,
        marginBottom: 6,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    title: { fontSize: 18, fontWeight: '800', color: adminColors.textPrimary },
    closeButton: {
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    scroll: { flexGrow: 0 },

    sectionLabel: {
        fontSize: 12,
        fontWeight: '800',
        color: adminColors.textMuted,
        letterSpacing: 0.8,
        marginTop: 16,
        marginBottom: 8,
    },

    pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: {
        minHeight: 40,
        paddingHorizontal: 16,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surfaceMuted,
        justifyContent: 'center',
        alignItems: 'center',
    },
    pillSelected: { backgroundColor: adminColors.primary, borderColor: adminColors.primary },
    pillText: { fontSize: 14, fontWeight: '700', color: adminColors.textSecondary },
    pillTextSelected: { color: '#FFFFFF' },

    dropdown: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 48,
        borderWidth: 1,
        borderColor: adminColors.border,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 12,
        paddingHorizontal: 14,
    },
    dropdownText: {
        flex: 1,
        fontSize: 15,
        fontWeight: '600',
        color: adminColors.textPrimary,
        marginRight: 8,
    },

    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 20,
    },
    resetButton: {
        minHeight: 50,
        paddingHorizontal: 18,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: adminColors.border,
    },
    resetText: { fontSize: 15, fontWeight: '700', color: adminColors.textSecondary },
    applyButton: {
        flex: 1,
        minHeight: 50,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 12,
        backgroundColor: adminColors.primary,
    },
    applyText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.4 },
});
