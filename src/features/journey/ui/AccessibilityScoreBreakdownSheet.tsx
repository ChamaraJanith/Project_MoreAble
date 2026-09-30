import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import React from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { AccessibilityFactorBreakdown, accessibilityScoreColor } from '../../../shared/utils/accessibility';
import { accessibilityScoreBreakdownView } from '../utils/accessibilityScoreBreakdown';

interface AccessibilityScoreBreakdownSheetProps {
    visible: boolean;
    /** The score shown on the card's badge. Printed as it is, never re-derived. */
    score: number | null | undefined;
    /** The three factors the search reported for the same bus. */
    breakdown: AccessibilityFactorBreakdown[] | null | undefined;
    onClose: () => void;
}

// How a journey's accessibility score was reached: the final figure, then the
// three factors it weighs, then why their sum can differ from it by a fraction.
//
// A bottom sheet in the shape TravelTimePickerModal already uses. Every number
// comes from accessibilityScoreBreakdownView, which only formats what the
// search sent; nothing here calculates. When that view is null there is nothing
// true to explain, and the sheet renders nothing.
export function AccessibilityScoreBreakdownSheet({
    visible,
    score,
    breakdown,
    onClose,
}: AccessibilityScoreBreakdownSheetProps) {
    const { t } = useTranslation();
    const view = accessibilityScoreBreakdownView(score, breakdown);

    if (!view) return null;

    const scoreColor = accessibilityScoreColor(view.score);
    const closeLabel = t('journey.scoreBreakdown.closeLabel', 'Close accessibility score breakdown');

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <TouchableOpacity
                    style={StyleSheet.absoluteFill}
                    activeOpacity={1}
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={closeLabel}
                />
                <View style={styles.sheet} accessibilityViewIsModal>
                    <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle} accessibilityRole="header">
                            {t('journey.scoreBreakdown.title', 'Accessibility Score')}
                        </Text>
                        <TouchableOpacity
                            onPress={onClose}
                            style={styles.closeIconButton}
                            accessibilityRole="button"
                            accessibilityLabel={closeLabel}
                        >
                            <Ionicons name="close" size={24} color="#0F172A" />
                        </TouchableOpacity>
                    </View>

                    <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
                        <Text style={styles.introText}>
                            {t(
                                'journey.scoreBreakdown.intro',
                                'This score combines three factors. Each one counts for a fixed share of the total.'
                            )}
                        </Text>

                        {/* The final score: the badge's own figure, in the passenger colour scale. */}
                        <View
                            style={styles.finalScoreCard}
                            accessible
                            accessibilityLabel={t('journey.scoreBreakdown.finalScoreSpoken', {
                                score: view.score,
                                defaultValue: 'Final score {{score}} out of 100',
                            })}
                        >
                            <Ionicons name="accessibility" size={22} color={scoreColor} />
                            <View style={styles.finalScoreTextGroup}>
                                <Text style={styles.finalScoreCaption}>
                                    {t('journey.scoreBreakdown.finalScore', 'Final score')}
                                </Text>
                                <Text style={[styles.finalScoreValue, { color: scoreColor }]}>{view.scoreText}</Text>
                            </View>
                        </View>

                        {/* One card per factor, in the order the score weighs them. */}
                        {view.rows.map((row) => {
                            const label = t(row.labelKey, row.labelFallback);
                            const factorColor = accessibilityScoreColor(row.score);

                            return (
                                <View
                                    key={row.key}
                                    style={styles.factorCard}
                                    accessible
                                    accessibilityLabel={t('journey.scoreBreakdown.factorSpoken', {
                                        factor: label,
                                        score: row.scoreValue,
                                        weight: row.weightValue,
                                        contribution: row.contributionValue,
                                        max: row.maxContributionValue,
                                        defaultValue:
                                            '{{factor}}: score {{score}} out of 100, weight {{weight}} percent, contributes {{contribution}} of {{max}} points',
                                    })}
                                >
                                    <View style={styles.factorHeader}>
                                        <Text style={styles.factorLabel}>{label}</Text>
                                        <Text style={[styles.factorScore, { color: factorColor }]}>
                                            {t('journey.scoreBreakdown.score', {
                                                value: row.scoreText,
                                                defaultValue: 'Score: {{value}}',
                                            })}
                                        </Text>
                                    </View>

                                    {/* Decorative: the figure is printed right above it. */}
                                    <View
                                        style={styles.barTrack}
                                        accessibilityElementsHidden
                                        importantForAccessibility="no-hide-descendants"
                                    >
                                        <View
                                            style={[
                                                styles.barFill,
                                                {
                                                    width: `${Math.round(row.progress * 100)}%` as const,
                                                    backgroundColor: factorColor,
                                                },
                                            ]}
                                        />
                                    </View>

                                    <View style={styles.factorFooter}>
                                        <Text style={styles.factorMeta}>
                                            {t('journey.scoreBreakdown.weight', {
                                                value: row.weightText,
                                                defaultValue: 'Weight: {{value}}',
                                            })}
                                        </Text>
                                        <Text style={styles.factorMeta}>
                                            {t('journey.scoreBreakdown.contributes', {
                                                value: row.contributionText,
                                                defaultValue: 'Contributes: {{value}}',
                                            })}
                                        </Text>
                                    </View>
                                </View>
                            );
                        })}

                        {/*
                          Why 50.0 + 15.0 + 10.8 reads as 76: an approximation,
                          never an exact sum, since the parts are rounded to one
                          decimal place and the score is rounded from their
                          unrounded total.
                        */}
                        <Text
                            style={styles.roundingNote}
                            accessibilityLabel={t('journey.scoreBreakdown.roundingNoteSpoken', {
                                ...view.rounding,
                                defaultValue:
                                    'Each contribution is shown to one decimal place, and their total is rounded to a whole number: {{parts}} is approximately {{score}}.',
                            })}
                        >
                            {t('journey.scoreBreakdown.roundingNote', {
                                ...view.rounding,
                                defaultValue:
                                    'Each contribution is shown to one decimal place, and their total is rounded to a whole number: {{parts}} ≈ {{score}}',
                            })}
                        </Text>

                        <TouchableOpacity
                            style={styles.closeButton}
                            onPress={onClose}
                            accessibilityRole="button"
                            accessibilityLabel={closeLabel}
                        >
                            <Text style={styles.closeButtonText}>{t('journey.scoreBreakdown.close', 'Close')}</Text>
                        </TouchableOpacity>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        paddingBottom: 36,
        maxHeight: '90%',
    },
    sheetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    sheetTitle: {
        flex: 1,
        fontSize: 20,
        fontWeight: '800',
        color: '#0F172A',
    },
    closeIconButton: {
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'center',
    },
    introText: {
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
        lineHeight: 19,
        marginBottom: 16,
    },
    finalScoreCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EBF3FA',
        borderRadius: 16,
        paddingVertical: 14,
        paddingHorizontal: 16,
        marginBottom: 16,
    },
    finalScoreTextGroup: {
        marginLeft: 12,
    },
    finalScoreCaption: {
        fontSize: 12,
        fontWeight: '700',
        color: '#64748B',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    finalScoreValue: {
        fontSize: 26,
        fontWeight: '800',
        letterSpacing: -0.5,
        marginTop: 2,
    },
    factorCard: {
        backgroundColor: '#F8FAFC',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#EEF2F7',
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginBottom: 10,
    },
    factorHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 8,
    },
    factorLabel: {
        fontSize: 15,
        fontWeight: '800',
        color: '#0F172A',
    },
    factorScore: {
        fontSize: 13,
        fontWeight: '800',
    },
    barTrack: {
        height: 8,
        borderRadius: 4,
        backgroundColor: '#E2E8F0',
        overflow: 'hidden',
        marginBottom: 8,
    },
    barFill: {
        height: 8,
        borderRadius: 4,
    },
    factorFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 6,
    },
    factorMeta: {
        fontSize: 12,
        fontWeight: '600',
        color: '#475569',
    },
    roundingNote: {
        fontSize: 12,
        fontWeight: '500',
        color: '#64748B',
        lineHeight: 18,
        marginTop: 6,
        marginBottom: 18,
    },
    closeButton: {
        backgroundColor: '#0066CC',
        borderRadius: 12,
        minHeight: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    closeButtonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },
});
