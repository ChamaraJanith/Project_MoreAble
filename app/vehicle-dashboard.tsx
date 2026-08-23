// This is for Vehicle Operations Console View (Bus Conductor & Driver Dashboard)
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

import { LocationStatusCard } from '../src/features/driver/ui/LocationStatusCard';
import { PassengerManifestTab } from '../src/features/driver/ui/PassengerManifestTab';
import { TripInfoTab } from '../src/features/driver/ui/TripInfoTab';
import { describeBusSession } from '../src/features/driver/utils/busSessionView';
import { BusSession, clearBusSession, getBusSession } from '../src/shared/utils/busSession';

type VehicleTab = 'PASSENGERS' | 'LOCATION' | 'TRIP';

export default function VehicleDashboardScreen() {
    const [session, setSession] = useState<BusSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [exitError, setExitError] = useState('');
    const [activeTab, setActiveTab] = useState<VehicleTab>('PASSENGERS');

    useFocusEffect(
        useCallback(() => {
            let active = true;

            (async () => {
                setIsLoading(true);
                const stored = await getBusSession();

                if (!active) return;

                setSession(stored);
                setIsLoading(false);
            })();

            return () => {
                active = false;
            };
        }, [])
    );

    const handleExit = useCallback(async () => {
        setExitError('');

        try {
            await clearBusSession();
        } catch {
            setExitError('Could not sign this bus out. Please try again.');
            return;
        }

        setSession(null);
        router.replace('/(auth)');
    }, []);

    const identity = describeBusSession(session);

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />

            {/* Top Navigation Bar */}
            <View style={styles.header}>
                <View style={styles.headerTitleGroup}>
                    <View style={styles.busIconBox}>
                        <Ionicons name="bus" size={20} color="#0066CC" />
                    </View>
                    <View>
                        <Text style={styles.headerTitle}>Transit Console</Text>
                        <Text style={styles.headerSubtitle}>
                            {identity.signedIn ? identity.numberPlate : 'Not Signed In'}
                        </Text>
                    </View>
                </View>

                <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={handleExit}
                    accessibilityRole="button"
                    accessibilityLabel="Sign this bus out"
                >
                    <Ionicons name="log-out-outline" size={18} color="#0066CC" />
                    <Text style={styles.logoutText}>Exit Bus</Text>
                </TouchableOpacity>
            </View>

            {/* Main Console Content */}
            <View style={styles.container}>
                {!!exitError && (
                    <View style={styles.exitErrorRow} accessibilityLiveRegion="polite">
                        <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                        <Text style={styles.exitErrorText}>{exitError}</Text>
                    </View>
                )}

                {isLoading ? (
                    <View style={styles.loadingBox}>
                        <ActivityIndicator size="large" color="#0066CC" />
                        <Text style={styles.loadingText}>Loading vehicle console session...</Text>
                    </View>
                ) : !identity.signedIn ? (
                    /* Unauthenticated Bus Screen */
                    <View style={styles.signInCard}>
                        <Ionicons name="lock-closed-outline" size={48} color="#94A3B8" />
                        <Text style={styles.signInTitle}>Vehicle Console Locked</Text>
                        <Text style={styles.signInDesc}>
                            Please sign in with your bus device credentials to access the Passenger Manifest & Conductor Console.
                        </Text>

                        <TouchableOpacity
                            style={styles.signInBtn}
                            onPress={() => router.replace('/(auth)/device-login' as any)}
                        >
                            <Text style={styles.signInBtnText}>SIGN IN TO BUS DEVICE</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    /* Authenticated Bus Console */
                    <View style={{ flex: 1 }}>
                        {/* Operations Tab Switcher Bar */}
                        <View style={styles.tabBar}>
                            <TouchableOpacity
                                style={[styles.tabItem, activeTab === 'PASSENGERS' && styles.tabItemActive]}
                                onPress={() => setActiveTab('PASSENGERS')}
                            >
                                <Ionicons
                                    name="people"
                                    size={18}
                                    color={activeTab === 'PASSENGERS' ? '#0066CC' : '#64748B'}
                                />
                                <Text
                                    style={[
                                        styles.tabText,
                                        activeTab === 'PASSENGERS' && styles.tabTextActive,
                                    ]}
                                >
                                    Passengers & Assistance
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.tabItem, activeTab === 'LOCATION' && styles.tabItemActive]}
                                onPress={() => setActiveTab('LOCATION')}
                            >
                                <Ionicons
                                    name="location"
                                    size={18}
                                    color={activeTab === 'LOCATION' ? '#0066CC' : '#64748B'}
                                />
                                <Text
                                    style={[
                                        styles.tabText,
                                        activeTab === 'LOCATION' && styles.tabTextActive,
                                    ]}
                                >
                                    GPS Location
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.tabItem, activeTab === 'TRIP' && styles.tabItemActive]}
                                onPress={() => setActiveTab('TRIP')}
                            >
                                <Ionicons
                                    name="information-circle"
                                    size={18}
                                    color={activeTab === 'TRIP' ? '#0066CC' : '#64748B'}
                                />
                                <Text
                                    style={[
                                        styles.tabText,
                                        activeTab === 'TRIP' && styles.tabTextActive,
                                    ]}
                                >
                                    Trip Info
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {/* Active Tab View */}
                        <View style={styles.tabContent}>
                            {activeTab === 'PASSENGERS' && (
                                <PassengerManifestTab busId={session?.busId} numberPlate={session?.numberPlate} />
                            )}

                            {activeTab === 'LOCATION' && (
                                <View style={{ flex: 1, paddingVertical: 10 }}>
                                    <LocationStatusCard />
                                </View>
                            )}

                            {activeTab === 'TRIP' && (
                                <TripInfoTab busId={session?.busId} numberPlate={session?.numberPlate} />
                            )}
                        </View>
                    </View>
                )}
            </View>
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
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 12,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },
    headerTitleGroup: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    busIconBox: {
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: '#EBF3FA',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0F172A',
    },
    headerSubtitle: {
        fontSize: 11,
        color: '#64748B',
    },
    logoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#CBD5E1',
    },
    logoutText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#0066CC',
        marginLeft: 4,
    },
    container: {
        flex: 1,
        padding: 16,
    },
    exitErrorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF2F2',
        padding: 10,
        borderRadius: 10,
        marginBottom: 12,
    },
    exitErrorText: {
        color: '#D32F2F',
        fontSize: 12,
        marginLeft: 8,
    },
    loadingBox: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 10,
    },
    signInCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 30,
        alignItems: 'center',
        marginTop: 40,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    signInTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0F172A',
        marginTop: 12,
    },
    signInDesc: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        marginTop: 6,
        lineHeight: 18,
    },
    signInBtn: {
        backgroundColor: '#0066CC',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 12,
        marginTop: 20,
    },
    signInBtnText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 13,
    },
    tabBar: {
        flexDirection: 'row',
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 4,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginBottom: 14,
    },
    tabItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        borderRadius: 10,
    },
    tabItemActive: {
        backgroundColor: '#EBF3FA',
    },
    tabText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
        marginLeft: 6,
    },
    tabTextActive: {
        color: '#0066CC',
    },
    tabContent: {
        flex: 1,
    },
});
