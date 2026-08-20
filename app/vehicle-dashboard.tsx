//This is for Vehicle Dashboard View
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { LocationStatusCard } from '../src/features/driver/ui/LocationStatusCard';
import { describeBusSession } from '../src/features/driver/utils/busSessionView';
import { BusSession, clearBusSession, getBusSession } from '../src/shared/utils/busSession';

export default function VehicleDashboardScreen() {
    const [session, setSession] = useState<BusSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [exitError, setExitError] = useState('');

    // Re-read on every focus rather than once on mount, so returning here after
    // signing in — or after signing out — shows the current state. It runs once
    // per focus; nothing polls.
    useFocusEffect(
        useCallback(() => {
            let active = true;

            (async () => {
                setIsLoading(true);
                const stored = await getBusSession();

                // The screen may have been left before the read finished.
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
            // Only the vehicle session. The passenger/admin session held by
            // tokenStorage is a separate identity and is left alone.
            await clearBusSession();
        } catch {
            // Navigating away now would leave a working bus session on the
            // device for whoever picks the phone up next, so the driver is told
            // instead and can try again.
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
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={handleExit}
                    accessibilityRole="button"
                    accessibilityLabel="Sign this bus out"
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

                {!!exitError && (
                    <View style={styles.exitErrorRow} accessibilityLiveRegion="polite">
                        <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                        <Text style={styles.exitErrorText}>{exitError}</Text>
                    </View>
                )}

                {/* ---------------- Authenticated vehicle (MOV-265) ---------------- */}
                {isLoading ? (
                    <View style={styles.identitySection}>
                        <View style={styles.identityCard}>
                            <ActivityIndicator size="small" color="#0066CC" />
                            <Text style={styles.identityLoadingText}>Checking bus sign in…</Text>
                        </View>
                    </View>
                ) : (
                    <View style={styles.identitySection}>
                        <View style={styles.identityCard}>
                            <View style={styles.identityRow}>
                                <View style={styles.identityBadge}>
                                    <Ionicons
                                        name={identity.signedIn ? 'bus' : 'lock-closed-outline'}
                                        size={20}
                                        color={identity.signedIn ? '#0066CC' : '#5A6E7F'}
                                    />
                                </View>

                                <View style={styles.identityTextGroup}>
                                    <Text style={styles.identityTitle}>{identity.title}</Text>
                                    <Text style={styles.identityDescription}>
                                        {identity.description}
                                    </Text>
                                </View>
                            </View>

                            {/* The plate and id only. The session token is not part
                                of what this screen renders from. */}
                            {identity.signedIn && (
                                <View
                                    style={styles.identityDetails}
                                    accessible
                                    accessibilityLabel={`Signed in as bus ${identity.numberPlate}`}
                                >
                                    <Text style={styles.identityPlate}>{identity.numberPlate}</Text>
                                    <Text style={styles.identityBusId}>{identity.busId}</Text>
                                </View>
                            )}

                            {!identity.signedIn && (
                                <TouchableOpacity
                                    style={styles.signInButton}
                                    onPress={() => router.replace('/(auth)/device-login' as any)}
                                    accessibilityRole="button"
                                    accessibilityLabel="Go to bus sign in"
                                >
                                    <Text style={styles.signInButtonText}>Go to bus sign in</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>
                )}

                {/* Location sharing status (MOV-264). Shown only once a vehicle
                    identity exists, so an unauthenticated device never asks for
                    the driver's location. */}
                {!isLoading && identity.signedIn && (
                    <View style={styles.locationSection}>
                        <LocationStatusCard />
                    </View>
                )}
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
        marginTop: 18,
    },
    identitySection: {
        alignSelf: 'stretch',
        marginTop: 28,
    },
    identityCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 18,
        borderWidth: 1,
        borderColor: '#CBD5E1',
    },
    identityRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    identityBadge: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#EBF3FA',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    identityTextGroup: {
        flex: 1,
    },
    identityTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: '#1A2530',
    },
    identityDescription: {
        fontSize: 14,
        color: '#5A6E7F',
        lineHeight: 20,
        marginTop: 4,
    },
    identityLoadingText: {
        fontSize: 14,
        color: '#5A6E7F',
        marginTop: 10,
        textAlign: 'center',
    },
    identityDetails: {
        backgroundColor: '#F4F7FB',
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginTop: 16,
    },
    identityPlate: {
        fontSize: 20,
        fontWeight: '800',
        color: '#1A2530',
        letterSpacing: 0.5,
    },
    identityBusId: {
        fontSize: 13,
        fontWeight: '600',
        color: '#5A6E7F',
        marginTop: 2,
    },
    signInButton: {
        backgroundColor: '#0066CC',
        minHeight: 52,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
        marginTop: 16,
    },
    signInButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
    exitErrorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'stretch',
        marginTop: 16,
    },
    exitErrorText: {
        flexShrink: 1,
        fontSize: 14,
        fontWeight: '600',
        color: '#D32F2F',
        marginLeft: 6,
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
