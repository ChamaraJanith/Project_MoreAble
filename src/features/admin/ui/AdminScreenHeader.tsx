import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet,  TouchableOpacity, View } from 'react-native';
import { adminColors, adminShadow } from './adminTheme';

interface AdminScreenHeaderProps {
    title: string;
    subtitle?: string;
    /** Optional trailing control, e.g. a primary "Add" action. */
    action?: React.ReactNode;
    /**
     * 'brand' draws the header on the MoveAble blue with white title,
     * subtitle and back arrow — used by the passenger feature screens (e.g.
     * Accessibility Reports). 'default' is the white header with dark text
     * the admin screens use.
     */
    tone?: 'default' | 'brand';
}

export function AdminScreenHeader({ title, subtitle, action, tone = 'default' }: AdminScreenHeaderProps) {
    const isBrand = tone === 'brand';

    return (
        <View style={[styles.header, isBrand && styles.headerBrand]}>
            <TouchableOpacity
                onPress={() => router.back()}
                style={styles.backButton}
                accessibilityRole="button"
                accessibilityLabel="Go back"
            >
                <Ionicons
                    name="arrow-back"
                    size={22}
                    color={isBrand ? '#FFFFFF' : adminColors.textPrimary}
                />
            </TouchableOpacity>

            <View style={styles.textGroup}>
                <Text
                    style={[styles.title, isBrand && styles.titleBrand]}
                    accessibilityRole="header"
                    numberOfLines={1}
                >
                    {title}
                </Text>
                {!!subtitle && (
                    <Text style={[styles.subtitle, isBrand && styles.subtitleBrand]} numberOfLines={2}>
                        {subtitle}
                    </Text>
                )}
            </View>

            {action}
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 50,
        paddingBottom: 16,
        backgroundColor: adminColors.surface,
        ...adminShadow.header,
    },
    backButton: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'flex-start',
    },
    textGroup: {
        flex: 1,
        marginRight: 8,
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },
    // Text on the blue header is white; the subtitle slightly softer.
    headerBrand: { backgroundColor: adminColors.primary },
    titleBrand: { color: '#FFFFFF' },
    subtitleBrand: { color: 'rgba(255, 255, 255, 0.88)' },
    subtitle: {
        marginTop: 3,
        fontSize: 13,
        color: adminColors.textMuted,
        lineHeight: 18,
    },
});