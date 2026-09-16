// Accessibility Preferences Screen
// Accessible from: (1) post-registration flow (with "Skip for Now"), (2) Profile → Account Options
// Route param: from = 'registration' | 'profile'

import { AppText as Text } from '../src/shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
    
    TouchableOpacity,
    View
} from 'react-native';
import { AppPreferences } from '../src/entities/user/model/types';
import { DEFAULT_PREFERENCES, usePreferencesStore } from '../src/shared/store/preferencesStore';

// ─── Types ─────────────────────────────────────────────────────────────────────

type TextSize = AppPreferences['textSize'];
type Language = AppPreferences['language'];

// ─── Constants ─────────────────────────────────────────────────────────────────

const TEXT_SIZE_OPTIONS: { value: TextSize; label: string; sinhala: string }[] = [
    { value: 'default', label: 'Default', sinhala: 'සාමාන්‍ය' },
    { value: 'large', label: 'Large', sinhala: 'විශාල' },
    { value: 'extra_large', label: 'Extra Large', sinhala: 'අතිශය විශාල' },
];

const LANGUAGE_OPTIONS: { value: Language; label: string; native: string }[] = [
    { value: 'english', label: 'English', native: 'English' },
    { value: 'sinhala', label: 'Sinhala', native: 'සිංහල' },
];

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AccessibilityPreferencesScreen() {
    const { t, i18n } = useTranslation();
    const params = useLocalSearchParams();
    const fromRegistration = (params.from as string) === 'registration';

    const { preferences, savePreferences, hydrate, isHydrated } = usePreferencesStore();
    const [isSaving, setIsSaving] = useState(false);

    // Local form state (initialised from store after hydration)
    const [textSize, setTextSize] = useState<TextSize>(DEFAULT_PREFERENCES.textSize);
    const [highContrast, setHighContrast] = useState(DEFAULT_PREFERENCES.highContrast);
    const [voiceGuidance, setVoiceGuidance] = useState(DEFAULT_PREFERENCES.voiceGuidance);
    const [voiceDestReminders, setVoiceDestReminders] = useState(DEFAULT_PREFERENCES.voiceDestinationReminders);
    const [notifVibration, setNotifVibration] = useState(DEFAULT_PREFERENCES.notificationVibration);
    const [notifSound, setNotifSound] = useState(DEFAULT_PREFERENCES.notificationSound);
    const [simpleMode, setSimpleMode] = useState(DEFAULT_PREFERENCES.simpleMode);
    const [language, setLanguage] = useState<Language>(DEFAULT_PREFERENCES.language);

    // Hydrate store then sync local state
    useEffect(() => {
        if (!isHydrated) {
            hydrate();
        }
    }, []);

    useEffect(() => {
        if (isHydrated) {
            setTextSize(preferences.textSize);
            setHighContrast(preferences.highContrast);
            setVoiceGuidance(preferences.voiceGuidance);
            setVoiceDestReminders(preferences.voiceDestinationReminders);
            setNotifVibration(preferences.notificationVibration);
            setNotifSound(preferences.notificationSound);
            setSimpleMode(preferences.simpleMode);
            setLanguage(preferences.language);
        }
    }, [isHydrated]);

    // ── Navigation helpers ──────────────────────────────────────────────────────

    const navigateAway = () => {
        if (fromRegistration) {
            router.replace('/(auth)');
        } else {
            router.back();
        }
    };

    const handleSkip = () => navigateAway();

    // ── Save ────────────────────────────────────────────────────────────────────

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const updated: AppPreferences = {
                textSize,
                highContrast,
                voiceGuidance,
                voiceDestinationReminders: voiceDestReminders,
                notificationVibration: notifVibration,
                notificationSound: notifSound,
                simpleMode,
                language,
            };
            await savePreferences(updated);

            if (fromRegistration) {
                if (Platform.OS === 'web') {
                    window.alert('Preferences saved! You can update them anytime from your profile.');
                } else {
                    Alert.alert(
                        'Preferences Saved',
                        'Your accessibility preferences have been saved. You can update them anytime from your profile.',
                        [{ text: 'OK', onPress: navigateAway }]
                    );
                    return;
                }
            }
            navigateAway();
        } catch (err) {
            console.error('Error saving preferences:', err);
            Alert.alert('Error', 'Failed to save preferences. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    // ── Render helpers ──────────────────────────────────────────────────────────

    const renderSectionHeader = (icon: string, title: string, subtitle?: string) => (
        <View style={styles.sectionHeader}>
            <View style={styles.sectionIconWrap}>
                <Ionicons name={icon as any} size={20} color="#0066CC" />
            </View>
            <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>{title}</Text>
                {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
            </View>
        </View>
    );

    const renderSwitchRow = (
        label: string,
        value: boolean,
        onToggle: (v: boolean) => void,
        description?: string,
        accentColor?: string
    ) => (
        <View style={styles.switchRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.switchLabel}>{label}</Text>
                {description ? <Text style={styles.switchDescription}>{description}</Text> : null}
            </View>
            <Switch
                value={value}
                onValueChange={onToggle}
                trackColor={{ false: '#CBD5E1', true: accentColor ? `${accentColor}66` : '#93C5FD' }}
                thumbColor={value ? (accentColor || '#0066CC') : '#F1F5F9'}
                ios_backgroundColor="#CBD5E1"
                accessibilityRole="switch"
                accessibilityState={{ checked: value }}
            />
        </View>
    );

    const renderSegmentedControl = <T extends string>(
        options: { value: T; label: string }[],
        selected: T,
        onSelect: (v: T) => void,
        accentColor = '#0066CC'
    ) => (
        <View style={styles.segmentedControl}>
            {options.map((opt, idx) => {
                const isSelected = opt.value === selected;
                return (
                    <TouchableOpacity
                        key={opt.value}
                        style={[
                            styles.segmentBtn,
                            idx === 0 && styles.segmentBtnFirst,
                            idx === options.length - 1 && styles.segmentBtnLast,
                            isSelected && { backgroundColor: accentColor, borderColor: accentColor },
                        ]}
                        onPress={() => onSelect(opt.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        accessibilityLabel={opt.label}
                    >
                        <Text style={[styles.segmentBtnText, isSelected && styles.segmentBtnTextSelected]}>
                            {opt.label}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );

    // ── Main render ─────────────────────────────────────────────────────────────

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" backgroundColor="#F0F4F8" />

            {/* ── Top Header Bar ─────────────────────────────────────────────── */}
            <View style={styles.headerBar}>
                {fromRegistration ? (
                    <View style={styles.headerBarLeft} />
                ) : (
                    <TouchableOpacity
                        style={styles.backBtn}
                        onPress={() => router.back()}
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                    >
                        <Ionicons name="arrow-back-outline" size={24} color="#1E293B" />
                    </TouchableOpacity>
                )}

                <Text style={styles.headerTitle} accessibilityRole="header">
                    {fromRegistration ? 'Set Your Preferences' : t('preferences.title')}
                </Text>

                {fromRegistration ? (
                    <TouchableOpacity
                        style={styles.skipBtn}
                        onPress={handleSkip}
                        accessibilityRole="button"
                        accessibilityLabel="Skip for now"
                    >
                        <Text style={styles.skipBtnText}>{t('preferences.skip')}</Text>
                        <Ionicons name="chevron-forward" size={16} color="#64748B" />
                    </TouchableOpacity>
                ) : (
                    <View style={styles.headerBarLeft} />
                )}
            </View>

            {/* ── Registration context banner ─────────────────────────────────── */}
            {fromRegistration && (
                <View style={styles.contextBanner}>
                    <Ionicons name="sparkles-outline" size={20} color="#7C3AED" style={{ marginRight: 10 }} />
                    <View style={{ flex: 1 }}>
                        <Text style={styles.contextBannerTitle}>Personalise Your Experience</Text>
                        <Text style={styles.contextBannerText}>
                            Configure how the app looks, sounds, and behaves for you. These can be changed anytime from your profile.
                        </Text>
                    </View>
                </View>
            )}

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >

                {/* ── Section 1: Text Size ─────────────────────────────────────── */}
                <View style={styles.card}>
                    {renderSectionHeader('text-outline', t('preferences.textSize.title'))}
                    <View style={styles.cardBody}>
                        {renderSegmentedControl<TextSize>(
                            TEXT_SIZE_OPTIONS,
                            textSize,
                            setTextSize,
                            '#0066CC'
                        )}
                        <View style={styles.textSizePreview}>
                            <Text style={[
                                styles.textSizePreviewLabel,
                                textSize === 'large' && { fontSize: 17 },
                                textSize === 'extra_large' && { fontSize: 20 },
                            ]}>
                                {textSize === 'default'
                                    ? t('preferences.textSize.default')
                                    : textSize === 'large'
                                        ? t('preferences.textSize.large')
                                        : t('preferences.textSize.extraLarge')}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* ── Section 2: Display ───────────────────────────────────────── */}
                <View style={styles.card}>
                    {renderSectionHeader('contrast-outline', t('preferences.display.title'))}
                    <View style={styles.cardBody}>
                        {renderSwitchRow(
                            t('preferences.display.highContrast'),
                            highContrast,
                            setHighContrast,
                            t('preferences.display.highContrastDesc'),
                            '#7C3AED'
                        )}
                        <View style={styles.divider} />
                        {renderSwitchRow(
                            t('preferences.display.simpleMode'),
                            simpleMode,
                            setSimpleMode,
                            t('preferences.display.simpleModeDesc'),
                            '#059669'
                        )}
                    </View>
                </View>

                {/* ── Section 3: Voice & Audio ─────────────────────────────────── */}
                <View style={styles.card}>
                    {renderSectionHeader('volume-high-outline', t('preferences.voice.title'))}
                    <View style={styles.cardBody}>
                        {renderSwitchRow(
                            t('preferences.voice.guidance'),
                            voiceGuidance,
                            setVoiceGuidance,
                            t('preferences.voice.guidanceDesc'),
                            '#D97706'
                        )}
                        <View style={styles.divider} />
                        {renderSwitchRow(
                            t('preferences.voice.reminders'),
                            voiceDestReminders,
                            setVoiceDestReminders,
                            t('preferences.voice.remindersDesc'),
                            '#D97706'
                        )}
                    </View>
                </View>

                {/* ── Section 4: Notifications ─────────────────────────────────── */}
                <View style={styles.card}>
                    {renderSectionHeader('notifications-outline', t('preferences.notifications.title'))}
                    <View style={styles.cardBody}>
                        {renderSwitchRow(
                            t('preferences.notifications.vibration'),
                            notifVibration,
                            setNotifVibration,
                            '',
                            '#0066CC'
                        )}
                        <View style={styles.divider} />
                        {renderSwitchRow(
                            t('preferences.notifications.sound'),
                            notifSound,
                            setNotifSound,
                            '',
                            '#0066CC'
                        )}
                    </View>
                </View>

                {/* ── Section 5: Language ──────────────────────────────────────── */}
                <View style={styles.card}>
                    {renderSectionHeader('language-outline', t('preferences.language.title'))}
                    <View style={styles.cardBody}>
                        {renderSegmentedControl<Language>(
                            LANGUAGE_OPTIONS.map(l => ({ value: l.value, label: l.native })),
                            language,
                            setLanguage,
                            '#1D4ED8'
                        )}
                    </View>
                </View>

                {/* ── Save Button ──────────────────────────────────────────────── */}
                <TouchableOpacity
                    style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
                    onPress={handleSave}
                    disabled={isSaving}
                    accessibilityRole="button"
                    accessibilityLabel="Save preferences"
                >
                    {isSaving ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                        <>
                            <Ionicons name="checkmark-circle-outline" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
                            <Text style={styles.saveBtnText}>
                                {fromRegistration ? t('preferences.saveChanges') : t('preferences.saveChanges')}
                            </Text>
                        </>
                    )}
                </TouchableOpacity>

                {fromRegistration && (
                    <TouchableOpacity
                        style={styles.skipBottomBtn}
                        onPress={handleSkip}
                        accessibilityRole="button"
                        accessibilityLabel="Skip and use default preferences"
                    >
                        <Text style={styles.skipBottomBtnText}>{t('preferences.skipUseDefault')}</Text>
                    </TouchableOpacity>
                )}

                <View style={{ height: 32 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },

    // Header Bar
    headerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },
    headerBarLeft: {
        width: 60,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: '#0F172A',
        flex: 1,
        textAlign: 'center',
    },
    backBtn: {
        width: 60,
        height: 36,
        alignItems: 'flex-start',
        justifyContent: 'center',
    },
    skipBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 6,
        width: 60,
        justifyContent: 'flex-end',
    },
    skipBtnText: {
        fontSize: 14,
        color: '#64748B',
        fontWeight: '600',
    },

    // Context Banner (registration only)
    contextBanner: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: '#F5F3FF',
        borderBottomWidth: 1,
        borderBottomColor: '#DDD6FE',
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    contextBannerTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#5B21B6',
        marginBottom: 2,
    },
    contextBannerText: {
        fontSize: 12,
        color: '#6D28D9',
        lineHeight: 17,
    },

    // Scroll & Card
    scrollContent: {
        paddingHorizontal: 16,
        paddingTop: 16,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        marginBottom: 14,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 2,
        overflow: 'hidden',
    },
    cardBody: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },

    // Section Headers
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    sectionIconWrap: {
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    sectionTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#0F172A',
    },
    sectionSubtitle: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 1,
    },

    // Switch Row
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
    },
    switchLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1E293B',
        marginBottom: 2,
    },
    switchDescription: {
        fontSize: 12,
        color: '#64748B',
        lineHeight: 16,
    },

    divider: {
        height: 1,
        backgroundColor: '#F1F5F9',
        marginHorizontal: -16,
    },

    // Segmented Control
    segmentedControl: {
        flexDirection: 'row',
        marginTop: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#CBD5E1',
        overflow: 'hidden',
    },
    segmentBtn: {
        flex: 1,
        paddingVertical: 10,
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderRightWidth: 1,
        borderRightColor: '#CBD5E1',
    },
    segmentBtnFirst: {
        borderTopLeftRadius: 9,
        borderBottomLeftRadius: 9,
    },
    segmentBtnLast: {
        borderTopRightRadius: 9,
        borderBottomRightRadius: 9,
        borderRightWidth: 0,
    },
    segmentBtnText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#475569',
    },
    segmentBtnTextSelected: {
        color: '#FFFFFF',
    },

    // Text Size Preview
    textSizePreview: {
        marginTop: 12,
        backgroundColor: '#F8FAFC',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    textSizePreviewLabel: {
        fontSize: 14,
        color: '#475569',
        lineHeight: 20,
    },

    // Language Note
    langNote: {
        marginTop: 12,
        fontSize: 12,
        color: '#64748B',
        textAlign: 'center',
        fontStyle: 'italic',
    },

    // Save & Skip Buttons
    saveBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0066CC',
        borderRadius: 14,
        paddingVertical: 16,
        marginBottom: 12,
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    saveBtnDisabled: {
        opacity: 0.6,
    },
    saveBtnText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#FFFFFF',
        letterSpacing: 0.3,
    },
    skipBottomBtn: {
        alignItems: 'center',
        paddingVertical: 12,
    },
    skipBottomBtnText: {
        fontSize: 14,
        color: '#94A3B8',
        fontWeight: '500',
    },
});
