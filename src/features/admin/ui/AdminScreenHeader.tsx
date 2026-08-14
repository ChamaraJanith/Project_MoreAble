import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { adminColors, adminShadow } from './adminTheme';

interface AdminScreenHeaderProps {
    title: string;
    subtitle?: string;
    /** Optional trailing control, e.g. a primary "Add" action. */
    action?: React.ReactNode;
}

export function AdminScreenHeader({ title, subtitle, action }: AdminScreenHeaderProps) {
    return (
        <View style={styles.header}>
            <TouchableOpacity
                onPress={() => router.back()}
                style={styles.backButton}
                accessibilityRole="button"
                accessibilityLabel="Go back"
            >
                <Ionicons name="arrow-back" size={22} color={adminColors.textPrimary} />
            </TouchableOpacity>

            <View style={styles.textGroup}>
                <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
                    {title}
                </Text>
                {!!subtitle && (
                    <Text style={styles.subtitle} numberOfLines={2}>
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
    subtitle: {
        marginTop: 3,
        fontSize: 13,
        color: adminColors.textMuted,
        lineHeight: 18,
    },
});