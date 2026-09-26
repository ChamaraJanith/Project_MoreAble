// This is for Vehicle Operations Console View (Bus Conductor & Driver Dashboard)
import { AppText as Text } from '../src/shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    SafeAreaView,
    StatusBar,
    StyleSheet,
    TouchableOpacity,
    View
} from 'react-native';

import { TripControlTab } from '../src/features/driver/ui/TripControlTab';
import { useTripJourney } from '../src/features/driver/ui/useTripJourney';
import { PassengerManifestTab } from '../src/features/driver/ui/PassengerManifestTab';
import { TripInfoTab } from '../src/features/driver/ui/TripInfoTab';
import { describeBusSession } from '../src/features/driver/utils/busSessionView';
import { BusSession, clearBusSession, getBusSession } from '../src/shared/utils/busSession';

type VehicleTab = 'PASSENGERS' | 'TRIP_CONTROL' | 'TRIP';

export default function VehicleDashboardScreen() {
    const { t } = useTranslation();
    const [session, setSession] = useState<BusSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [exitError, setExitError] = useState('');
    const [activeTab, setActiveTab] = useState<VehicleTab>('PASSENGERS');

    // The bus's trips and running journey, held above the tabs so switching
    // tabs does not reload them (MOV-294). Location sharing is not owned here —
    // it follows the journey, so signing out below never stops it.
    const journey = useTripJourney(session?.busId);

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
                        <Text style={styles.headerTitle}>{t('driver.transitConsole', 'Transit Console')}</Text>
                        <View style={styles.plateRow}>
                            <View style={styles.activeDot} />
                            <Text style={styles.headerSubtitle}>
                                {identity.signedIn ? identity.numberPlate : 'Not Signed In'}
                            </Text>
                            {journey.journey?.trip?.routeNumber && (
                                <View style={styles.headerRouteTag}>
                                    <Text style={styles.headerRouteTagText}>Route {journey.journey.trip.routeNumber}</Text>
                                </View>
                            )}
                        </View>
                    </View>
                </View>

                <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={handleExit}
                    accessibilityRole="button"
                    accessibilityLabel="Sign this bus out"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="log-out-outline" size={16} color="#DC2626" />
                    <Text style={styles.logoutText}>{t('driver.exitBus', 'Exit')}</Text>
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
                        <Text style={styles.loadingText}>{t('driver.loadingConsole', 'Loading vehicle console session...')}</Text>
                    </View>
                ) : !identity.signedIn ? (
                    /* Unauthenticated Bus Screen */
                    <View style={styles.signInCard}>
                        <View style={styles.lockIconCircle}>
                            <Ionicons name="lock-closed-outline" size={42} color="#0066CC" />
                        </View>
                        <Text style={styles.signInTitle}>{t('driver.consoleLocked', 'Vehicle Console Locked')}</Text>
                        <Text style={styles.signInDesc}>
                            Please sign in with your bus device credentials to access the Passenger Manifest & Conductor Console.
                        </Text>

                        <TouchableOpacity
                            style={styles.signInBtn}
                            onPress={() => router.replace('/(auth)/device-login' as any)}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="key-outline" size={18} color="#FFFFFF" />
                            <Text style={styles.signInBtnText}>{t('driver.signInToBus', 'SIGN IN TO BUS DEVICE')}</Text>
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
                                activeOpacity={0.8}
                            >
                                <Ionicons
                                    name="people"
                                    size={16}
                                    color={activeTab === 'PASSENGERS' ? '#0066CC' : '#64748B'}
                                />
                                <Text
                                    style={[
                                        styles.tabText,
                                        activeTab === 'PASSENGERS' && styles.tabTextActive,
                                    ]}
                                >
                                    Manifest
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.tabItem, activeTab === 'TRIP_CONTROL' && styles.tabItemActive]}
                                onPress={() => setActiveTab('TRIP_CONTROL')}
                                activeOpacity={0.8}
                            >
                                <Ionicons
                                    name="navigate"
                                    size={16}
                                    color={activeTab === 'TRIP_CONTROL' ? '#0066CC' : '#64748B'}
                                />
                                <Text
                                    style={[
                                        styles.tabText,
                                        activeTab === 'TRIP_CONTROL' && styles.tabTextActive,
                                    ]}
                                >
                                    Trip Control
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.tabItem, activeTab === 'TRIP' && styles.tabItemActive]}
                                onPress={() => setActiveTab('TRIP')}
                                activeOpacity={0.8}
                            >
                                <Ionicons
                                    name="information-circle"
                                    size={16}
                                    color={activeTab === 'TRIP' ? '#0066CC' : '#64748B'}
                                />
                                <Text
                                    style={[
                                        styles.tabText,
                                        activeTab === 'TRIP' && styles.tabTextActive,
                                    ]}
                                >
                                    Bus Specs
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {/* Active Tab View */}
                        <View style={styles.tabContent}>
                            {activeTab === 'PASSENGERS' && (
                                <PassengerManifestTab
                                    busId={session?.busId}
                                    numberPlate={session?.numberPlate}
                                    activeJourney={journey.journey}
                                    onNavigateToTripControl={() => setActiveTab('TRIP_CONTROL')}
                                />
                            )}

                            {activeTab === 'TRIP_CONTROL' && (
                                <TripControlTab journey={journey} />
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
        paddingHorizontal: 16,
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
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
        borderWidth: 1,
        borderColor: '#DBEAFE',
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '900',
        color: '#0F172A',
        letterSpacing: 0.2,
    },
    plateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 2,
        gap: 6,
    },
    activeDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: '#10B981',
    },
    headerSubtitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#334155',
    },
    headerRouteTag: {
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 6,
        paddingVertical: 1.5,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    headerRouteTagText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#0066CC',
    },
    logoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF2F2',
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#FEE2E2',
        gap: 4,
    },
    logoutText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#DC2626',
    },
    container: {
        flex: 1,
        paddingHorizontal: 12,
        paddingTop: 10,
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
        padding: 28,
        alignItems: 'center',
        marginTop: 40,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 3,
    },
    lockIconCircle: {
        width: 70,
        height: 70,
        borderRadius: 35,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    signInTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0F172A',
        marginTop: 8,
    },
    signInDesc: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        marginTop: 6,
        lineHeight: 19,
    },
    signInBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0066CC',
        paddingHorizontal: 22,
        paddingVertical: 13,
        borderRadius: 12,
        marginTop: 20,
        gap: 8,
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 3,
    },
    signInBtnText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 13,
        letterSpacing: 0.3,
    },
    tabBar: {
        flexDirection: 'row',
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 3,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginBottom: 10,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.03,
        shadowRadius: 2,
        elevation: 1,
    },
    tabItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 9,
        borderRadius: 10,
        gap: 5,
    },
    tabItemActive: {
        backgroundColor: '#EFF6FF',
    },
    tabText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#64748B',
    },
    tabTextActive: {
        color: '#0066CC',
        fontWeight: '800',
    },
    tabContent: {
        flex: 1,
    },
});
