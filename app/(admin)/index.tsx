import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

export default function AdminDashboard() {
    const handleLogout = () => {
        router.replace('/(auth)');
    };

    // Temporary handlers
    // We will connect these to real screens after creating them.
    const handleBuses = () => {
        Alert.alert(
            'Bus Management',
            'Bus Management screen will be connected next.'
        );
    };

    const handleAddBus = () => {
        Alert.alert(
            'Add Bus',
            'Add Bus screen will be created next.'
        );
    };

    const handleRoutes = () => {
        Alert.alert(
            'Bus Routes',
            'Bus Routes screen will be connected next.'
        );
    };

    const handleReports = () => {
        Alert.alert(
            'Accessibility Reports',
            'Accessibility Reports screen will be connected next.'
        );
    };

    const handleUsers = () => {
        Alert.alert(
            'User Management',
            'User Management screen will be connected next.'
        );
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <View>
                    <Text style={styles.title}>Admin Dashboard</Text>

                    <Text style={styles.headerSubtitle}>
                        Manage MoveAble
                    </Text>
                </View>

                <TouchableOpacity
                    onPress={handleLogout}
                    style={styles.logoutButton}
                    activeOpacity={0.7}
                >
                    <Ionicons
                        name="log-out-outline"
                        size={22}
                        color="#D32F2F"
                    />

                    <Text style={styles.logoutText}>
                        Logout
                    </Text>
                </TouchableOpacity>
            </View>

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {/* Welcome Section */}
                <View style={styles.welcomeSection}>
                    <Text style={styles.welcomeText}>
                        Welcome, Admin!
                    </Text>

                    <Text style={styles.subtitle}>
                        Manage buses, routes and accessibility
                        information from here.
                    </Text>
                </View>

                {/* Overview */}
                <Text style={styles.sectionTitle}>
                    Overview
                </Text>

                <View style={styles.statsContainer}>
                    {/* Total Buses */}
                    <View style={styles.statCard}>
                        <View style={styles.statIconBlue}>
                            <Ionicons
                                name="bus-outline"
                                size={28}
                                color="#1976D2"
                            />
                        </View>

                        <Text style={styles.statNumber}>
                            0
                        </Text>

                        <Text style={styles.statLabel}>
                            Total Buses
                        </Text>
                    </View>

                    {/* Total Routes */}
                    <View style={styles.statCard}>
                        <View style={styles.statIconGreen}>
                            <Ionicons
                                name="map-outline"
                                size={28}
                                color="#388E3C"
                            />
                        </View>

                        <Text style={styles.statNumber}>
                            0
                        </Text>

                        <Text style={styles.statLabel}>
                            Total Routes
                        </Text>
                    </View>

                    {/* Reports */}
                    <View style={styles.statCard}>
                        <View style={styles.statIconOrange}>
                            <Ionicons
                                name="alert-circle-outline"
                                size={28}
                                color="#F57C00"
                            />
                        </View>

                        <Text style={styles.statNumber}>
                            0
                        </Text>

                        <Text style={styles.statLabel}>
                            Reports
                        </Text>
                    </View>

                    {/* Users */}
                    <View style={styles.statCard}>
                        <View style={styles.statIconPurple}>
                            <Ionicons
                                name="people-outline"
                                size={28}
                                color="#7B1FA2"
                            />
                        </View>

                        <Text style={styles.statNumber}>
                            0
                        </Text>

                        <Text style={styles.statLabel}>
                            Users
                        </Text>
                    </View>
                </View>

                {/* Management */}
                <Text style={styles.sectionTitle}>
                    Management
                </Text>

                {/* Buses */}
                <TouchableOpacity
                    style={styles.managementCard}
                    onPress={handleBuses}
                    activeOpacity={0.75}
                >
                    <View style={styles.iconContainer}>
                        <Ionicons
                            name="bus-outline"
                            size={30}
                            color="#1976D2"
                        />
                    </View>

                    <View style={styles.cardTextContainer}>
                        <Text style={styles.cardTitle}>
                            Buses
                        </Text>

                        <Text style={styles.cardDescription}>
                            Add, update and remove transport buses
                        </Text>
                    </View>

                    <Ionicons
                        name="chevron-forward"
                        size={24}
                        color="#7A8793"
                    />
                </TouchableOpacity>

                {/* Bus Routes */}
                <TouchableOpacity
                    style={styles.managementCard}
                    onPress={handleRoutes}
                    activeOpacity={0.75}
                >
                    <View style={styles.iconContainer}>
                        <Ionicons
                            name="navigate-outline"
                            size={30}
                            color="#388E3C"
                        />
                    </View>

                    <View style={styles.cardTextContainer}>
                        <Text style={styles.cardTitle}>
                            Bus Routes
                        </Text>

                        <Text style={styles.cardDescription}>
                            Manage bus routes and stops
                        </Text>
                    </View>

                    <Ionicons
                        name="chevron-forward"
                        size={24}
                        color="#7A8793"
                    />
                </TouchableOpacity>

                {/* Accessibility Reports */}
                <TouchableOpacity
                    style={styles.managementCard}
                    onPress={handleReports}
                    activeOpacity={0.75}
                >
                    <View style={styles.iconContainer}>
                        <Ionicons
                            name="accessibility-outline"
                            size={30}
                            color="#7B1FA2"
                        />
                    </View>

                    <View style={styles.cardTextContainer}>
                        <Text style={styles.cardTitle}>
                            Accessibility Reports
                        </Text>

                        <Text style={styles.cardDescription}>
                            Review reported accessibility issues
                        </Text>
                    </View>

                    <Ionicons
                        name="chevron-forward"
                        size={24}
                        color="#7A8793"
                    />
                </TouchableOpacity>

                {/* Users */}
                <TouchableOpacity
                    style={styles.managementCard}
                    onPress={handleUsers}
                    activeOpacity={0.75}
                >
                    <View style={styles.iconContainer}>
                        <Ionicons
                            name="people-outline"
                            size={30}
                            color="#F57C00"
                        />
                    </View>

                    <View style={styles.cardTextContainer}>
                        <Text style={styles.cardTitle}>
                            Users
                        </Text>

                        <Text style={styles.cardDescription}>
                            Manage registered users
                        </Text>
                    </View>

                    <Ionicons
                        name="chevron-forward"
                        size={24}
                        color="#7A8793"
                    />
                </TouchableOpacity>

                {/* Quick Actions */}
                <Text style={styles.sectionTitle}>
                    Quick Actions
                </Text>

                <View style={styles.quickActions}>
                    {/* Add Bus */}
                    <TouchableOpacity
                        style={styles.quickAction}
                        onPress={handleAddBus}
                        activeOpacity={0.75}
                    >
                        <View style={styles.quickIconBlue}>
                            <Ionicons
                                name="add"
                                size={28}
                                color="#1976D2"
                            />
                        </View>

                        <Text style={styles.quickActionText}>
                            Add Bus
                        </Text>
                    </TouchableOpacity>

                    {/* Add Route */}
                    <TouchableOpacity
                        style={styles.quickAction}
                        onPress={handleRoutes}
                        activeOpacity={0.75}
                    >
                        <View style={styles.quickIconGreen}>
                            <Ionicons
                                name="add"
                                size={28}
                                color="#388E3C"
                            />
                        </View>

                        <Text style={styles.quickActionText}>
                            Add Route
                        </Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F4F7FB',
    },

    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 50,
        paddingBottom: 16,
        backgroundColor: '#FFFFFF',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.08,
        shadowRadius: 4,
        elevation: 3,
    },

    title: {
        fontSize: 22,
        fontWeight: '700',
        color: '#1A2530',
    },

    headerSubtitle: {
        marginTop: 3,
        fontSize: 13,
        color: '#7A8793',
    },

    logoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
    },

    logoutText: {
        color: '#D32F2F',
        marginLeft: 4,
        fontWeight: '600',
    },

    content: {
        padding: 20,
        paddingBottom: 40,
    },

    welcomeSection: {
        marginBottom: 24,
    },

    welcomeText: {
        fontSize: 24,
        fontWeight: '700',
        color: '#1A2530',
        marginBottom: 6,
    },

    subtitle: {
        fontSize: 14,
        color: '#667784',
        lineHeight: 20,
    },

    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#1A2530',
        marginBottom: 12,
        marginTop: 8,
    },

    statsContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        marginBottom: 24,
    },

    statCard: {
        width: '48%',
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 4,
        shadowOffset: {
            width: 0,
            height: 2,
        },
    },

    statIconBlue: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#EEF5FF',
        justifyContent: 'center',
        alignItems: 'center',
    },

    statIconGreen: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#EEF8EF',
        justifyContent: 'center',
        alignItems: 'center',
    },

    statIconOrange: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#FFF5E8',
        justifyContent: 'center',
        alignItems: 'center',
    },

    statIconPurple: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#F5EEFA',
        justifyContent: 'center',
        alignItems: 'center',
    },

    statNumber: {
        fontSize: 24,
        fontWeight: '700',
        color: '#1A2530',
        marginTop: 8,
    },

    statLabel: {
        fontSize: 13,
        color: '#6B7785',
        marginTop: 2,
    },

    managementCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 4,
        shadowOffset: {
            width: 0,
            height: 2,
        },
    },

    iconContainer: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
    },

    cardTextContainer: {
        flex: 1,
        marginLeft: 14,
    },

    cardTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1A2530',
        marginBottom: 4,
    },

    cardDescription: {
        fontSize: 13,
        color: '#71808D',
        lineHeight: 18,
    },

    quickActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },

    quickAction: {
        width: '48%',
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        alignItems: 'center',
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 4,
        shadowOffset: {
            width: 0,
            height: 2,
        },
    },

    quickIconBlue: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#EEF5FF',
        justifyContent: 'center',
        alignItems: 'center',
    },

    quickIconGreen: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#EEF8EF',
        justifyContent: 'center',
        alignItems: 'center',
    },

    quickActionText: {
        marginTop: 8,
        fontSize: 14,
        fontWeight: '600',
        color: '#1A2530',
    },
});