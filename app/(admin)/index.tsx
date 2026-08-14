import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Bus } from '../../src/entities/bus/model/types';
import { Route } from '../../src/entities/route/model/types';
import { getBuses } from '../../src/features/admin/api/busAdminApi';
import { getRoutes } from '../../src/features/admin/api/routeAdminApi';

export default function AdminDashboard() {
    const [buses, setBuses] = useState<Bus[] | null>(null);
    const [routes, setRoutes] = useState<Route[] | null>(null);
    const [isLoadingOverview, setIsLoadingOverview] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [overviewError, setOverviewError] = useState('');

    const loadOverview = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
        if (mode === 'refresh') setIsRefreshing(true);
        else setIsLoadingOverview(true);
        setOverviewError('');

        try {
            const [busList, routeList] = await Promise.all([getBuses(), getRoutes()]);
            setBuses(busList);
            setRoutes(routeList);
        } catch (error: any) {
            setOverviewError(error?.message || 'Unable to load dashboard data.');
        } finally {
            setIsLoadingOverview(false);
            setIsRefreshing(false);
        }
    }, []);

    // Refresh whenever the dashboard regains focus so counts stay accurate
    // after adding or editing a bus or route.
    useFocusEffect(
        useCallback(() => {
            loadOverview();
        }, [loadOverview])
    );

    const busBreakdown = useMemo(() => {
        if (!buses) return null;
        return {
            active: buses.filter((bus) => bus.status === 'ACTIVE').length,
            inactive: buses.filter((bus) => bus.status === 'INACTIVE').length,
            maintenance: buses.filter((bus) => bus.status === 'MAINTENANCE').length,
        };
    }, [buses]);

    const routeBreakdown = useMemo(() => {
        if (!routes) return null;
        return {
            active: routes.filter((route) => route.status === 'ACTIVE').length,
            inactive: routes.filter((route) => route.status === 'INACTIVE').length,
        };
    }, [routes]);

    const handleLogout = () => {
        router.replace('/(auth)');
    };

    const handleBuses = () => {
        router.push('/(admin)/buses');
    };

    const handleAddBus = () => {
        router.push('/(admin)/buses/add');
    };

    const handleRoutes = () => {
        router.push('/(admin)/routes');
    };

    const handleAddRoute = () => {
        router.push('/(admin)/routes/add');
    };

    // Trips (bus turns) — connected to the Add Trip screen.
    const handleTrips = () => {
        router.push('/(admin)/trips/add');
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
                refreshControl={
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={() => loadOverview('refresh')}
                    />
                }
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

                {!!overviewError && (
                    <View style={styles.overviewErrorBanner} accessibilityLiveRegion="assertive">
                        <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                        <Text style={styles.overviewErrorText}>{overviewError}</Text>
                        <TouchableOpacity
                            onPress={() => loadOverview()}
                            style={styles.overviewRetryButton}
                            accessibilityRole="button"
                            accessibilityLabel="Retry loading dashboard data"
                        >
                            <Text style={styles.overviewRetryText}>Retry</Text>
                        </TouchableOpacity>
                    </View>
                )}

                <View style={styles.statsContainer}>
                    {/* Total Buses */}
                    <TouchableOpacity
                        style={styles.statCard}
                        onPress={handleBuses}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityLabel={
                            busBreakdown
                                ? `Total buses ${buses?.length ?? 0}. ${busBreakdown.active} active.`
                                : 'Total buses, loading'
                        }
                    >
                        <View style={styles.statIconBlue}>
                            <Ionicons name="bus-outline" size={28} color="#1976D2" />
                        </View>

                        {isLoadingOverview ? (
                            <ActivityIndicator
                                size="small"
                                color="#1976D2"
                                style={styles.statLoader}
                            />
                        ) : (
                            <Text style={styles.statNumber}>
                                {overviewError ? '—' : buses?.length ?? 0}
                            </Text>
                        )}

                        <Text style={styles.statLabel}>Total Buses</Text>

                        {!isLoadingOverview && !overviewError && busBreakdown && (
                            <Text style={styles.statBreakdown} numberOfLines={2}>
                                {busBreakdown.active} active
                                {busBreakdown.inactive > 0 ? ` · ${busBreakdown.inactive} inactive` : ''}
                                {busBreakdown.maintenance > 0
                                    ? ` · ${busBreakdown.maintenance} in maintenance`
                                    : ''}
                            </Text>
                        )}
                    </TouchableOpacity>

                    {/* Total Routes */}
                    <TouchableOpacity
                        style={styles.statCard}
                        onPress={handleRoutes}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityLabel={
                            routeBreakdown
                                ? `Total routes ${routes?.length ?? 0}. ${routeBreakdown.active} active.`
                                : 'Total routes, loading'
                        }
                    >
                        <View style={styles.statIconGreen}>
                            <Ionicons name="map-outline" size={28} color="#388E3C" />
                        </View>

                        {isLoadingOverview ? (
                            <ActivityIndicator
                                size="small"
                                color="#388E3C"
                                style={styles.statLoader}
                            />
                        ) : (
                            <Text style={styles.statNumber}>
                                {overviewError ? '—' : routes?.length ?? 0}
                            </Text>
                        )}

                        <Text style={styles.statLabel}>Total Routes</Text>

                        {!isLoadingOverview && !overviewError && routeBreakdown && (
                            <Text style={styles.statBreakdown} numberOfLines={2}>
                                {routeBreakdown.active} active
                                {routeBreakdown.inactive > 0 ? ` · ${routeBreakdown.inactive} inactive` : ''}
                            </Text>
                        )}
                    </TouchableOpacity>

                    {/* Reports — no backend yet */}
                    <View style={[styles.statCard, styles.statCardUnavailable]}>
                        <View style={styles.statIconOrange}>
                            <Ionicons name="alert-circle-outline" size={28} color="#F57C00" />
                        </View>

                        <Text style={styles.statNumberUnavailable}>—</Text>
                        <Text style={styles.statLabel}>Reports</Text>
                        <Text style={styles.statBreakdown}>Not available yet</Text>
                    </View>

                    {/* Users — no backend yet */}
                    <View style={[styles.statCard, styles.statCardUnavailable]}>
                        <View style={styles.statIconPurple}>
                            <Ionicons name="people-outline" size={28} color="#7B1FA2" />
                        </View>

                        <Text style={styles.statNumberUnavailable}>—</Text>
                        <Text style={styles.statLabel}>Users</Text>
                        <Text style={styles.statBreakdown}>Not available yet</Text>
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

                {/* Trips */}
                <TouchableOpacity
                    style={styles.managementCard}
                    onPress={handleTrips}
                    activeOpacity={0.75}
                >
                    <View style={styles.iconContainer}>
                        <Ionicons
                            name="time-outline"
                            size={30}
                            color="#0288D1"
                        />
                    </View>

                    <View style={styles.cardTextContainer}>
                        <Text style={styles.cardTitle}>
                            Trips
                        </Text>

                        <Text style={styles.cardDescription}>
                            Schedule bus turns for each route
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
                        onPress={handleAddRoute}
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

                    {/* Add Trip */}
                    <TouchableOpacity
                        style={styles.quickAction}
                        onPress={handleTrips}
                        activeOpacity={0.75}
                    >
                        <View style={styles.quickIconCyan}>
                            <Ionicons
                                name="add"
                                size={28}
                                color="#0288D1"
                            />
                        </View>

                        <Text style={styles.quickActionText}>
                            Add Trip
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

    statLoader: {
        marginTop: 12,
        marginBottom: 6,
        alignSelf: 'flex-start',
    },

    statCardUnavailable: {
        opacity: 0.85,
    },

    statNumberUnavailable: {
        fontSize: 24,
        fontWeight: '700',
        color: '#9AA7B2',
        marginTop: 8,
    },

    statBreakdown: {
        fontSize: 11,
        color: '#7A8793',
        marginTop: 4,
        lineHeight: 15,
    },

    overviewErrorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF4F4',
        borderWidth: 1,
        borderColor: '#F7D4D4',
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
    },

    overviewErrorText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: '#D32F2F',
        marginLeft: 8,
        lineHeight: 18,
    },

    overviewRetryButton: {
        minHeight: 36,
        justifyContent: 'center',
        paddingHorizontal: 12,
    },

    overviewRetryText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#D32F2F',
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
        flexWrap: 'wrap',
        justifyContent: 'space-between',
    },

    quickAction: {
        width: '48%',
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
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

    quickIconCyan: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#E5F4FB',
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