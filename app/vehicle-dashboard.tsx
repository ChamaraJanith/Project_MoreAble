//This is for Vehicle Dashboard View
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LocationStatusCard } from '../src/features/driver/ui/LocationStatusCard';

export default function VehicleDashboardScreen() {
    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={() => router.replace('/(auth)')}
                    accessibilityRole="button"
                    accessibilityLabel="Logout"
                >
                    <Ionicons name="log-out-outline" size={22} color="#0066CC" />
                    <Text style={styles.logoutText}>Exit</Text>
                </TouchableOpacity>
            </View>

            <ScrollView
                contentContainerStyle={styles.container}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.iconContainer}>
                    <Ionicons name="bus-outline" size={64} color="#0066CC" />
                </View>
                <Text style={styles.title}>Vehicle Dashboard</Text>
                <Text style={styles.subtitle}>MoreAble Transit Console Active</Text>

                {/* Location sharing status (MOV-264). */}
                <View style={styles.locationSection}>
                    <LocationStatusCard />
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F4F7FB',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 20,
        paddingTop: 10,
    },
    logoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#CBD5E1',
    },
    logoutText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#0066CC',
        marginLeft: 6,
    },
    container: {
        flexGrow: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingBottom: 32,
    },
    locationSection: {
        alignSelf: 'stretch',
        marginTop: 28,
    },
    iconContainer: {
        width: 110,
        height: 110,
        borderRadius: 55,
        backgroundColor: '#EBF3FA',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
        borderWidth: 2,
        borderColor: '#BAE6FD',
    },
    title: {
        fontSize: 32,
        fontWeight: 'bold',
        color: '#1A2530',
        textAlign: 'center',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: '#5A6E7F',
        textAlign: 'center',
    },
});
