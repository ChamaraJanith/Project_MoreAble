import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import {
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
                >
                    <Ionicons
                        name="log-out-outline"
                        size={22}
                        color="#D32F2F"
                    />
                    <Text style={styles.logoutText}>Logout</Text>
                </TouchableOpacity>
            </View>

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {/* Welcome */}
                <View style={styles.welcomeSection}>
                    <Text style={styles.welcomeText}>
                        Welcome, Admin!
                    </Text>

                    <Text style={styles.subtitle}>
                        Manage transport services and accessibility
                        information from here.
                    </Text>
                </View>

                {/* Statistics */}
                <Text style={styles.sectionTitle}>Overview</Text>

                <View style={styles.statsContainer}>
                    <View style={styles.statCard}>
                        <Ionicons
                            name="bus-outline"
                            size={28}
                            color="#1976D2"
                        />
                        <Text style={styles.statNumber}>0</Text>
                        <Text style={styles.statLabel}>
                            Total Vehicles
                        </Text>
                    </View>

                    <View style={styles.statCard}>
                        <Ionicons
                            name="map-outline"
                            size={28}
                            color="#388E3C"
                        />
                        <Text style={styles.statNumber}>0</Text>
                        <Text style={styles.statLabel}>
                            Total Routes
                        </Text>
                    </View>

                    <View style={styles.statCard}>
                        <Ionicons
                            name="alert-circle-outline"
                            size={28}
                            color="#F57C00"
                        />
                        <Text style={styles.statNumber}>0</Text>
                        <Text style={styles.statLabel}>
                            Reports
                        </Text>
                    </View>

                    <View style={styles.statCard}>
                        <Ionicons
                            name="people-outline"
                            size={28}
                            color="#7B1FA2"
                        />
                        <Text style={styles.statNumber}>0</Text>
                        <Text style={styles.statLabel}>
                            Users
                        </Text>
                    </View>
                </View>

                {/* Management */}
                <Text style={styles.sectionTitle}>Management</Text>

                <TouchableOpacity style={styles.managementCard}>
                    <View style={styles.iconContainer}>
                        <Ionicons
                            name="bus-outline"
                            size={30}
                            color="#1976D2"
                        />
                    </View>

                    <View style={styles.cardTextContainer}>
                        <Text style={styles.cardTitle}>
                            Vehicles
                        </Text>

                        <Text style={styles.cardDescription}>
                            Add, update and remove transport vehicles
                        </Text>
                    </View>

                    <Ionicons
                        name="chevron-forward"
                        size={24}
                        color="#7A8793"
                    />
                </TouchableOpacity>

                <TouchableOpacity style={styles.managementCard}>
                    <View style={styles.iconContainer}>
                        <Ionicons
                            name="navigate-outline"
                            size={30}
                            color="#388E3C"
                        />
                    </View>

                    <View style={styles.cardTextContainer}>
                        <Text style={styles.cardTitle}>
                            Routes
                        </Text>

                        <Text style={styles.cardDescription}>
                            Manage transport routes and stops
                        </Text>
                    </View>

                    <Ionicons
                        name="chevron-forward"
                        size={24}
                        color="#7A8793"
                    />
                </TouchableOpacity>

                <TouchableOpacity style={styles.managementCard}>
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

                <TouchableOpacity style={styles.managementCard}>
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
                <Text style={styles.sectionTitle}>Quick Actions</Text>

                <View style={styles.quickActions}>
                    <TouchableOpacity style={styles.quickAction}>
                        <Ionicons
                            name="add-circle-outline"
                            size={26}
                            color="#1976D2"
                        />
                        <Text style={styles.quickActionText}>
                            Add Vehicle
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.quickAction}>
                        <Ionicons
                            name="add-circle-outline"
                            size={26}
                            color="#388E3C"
                        />
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

    quickActionText: {
        marginTop: 8,
        fontSize: 13,
        fontWeight: '600',
        color: '#1A2530',
    },
});