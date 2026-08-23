import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Linking,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { runPublishCycle } from '../utils/locationPublishCycle';
import {
    PhoneLocationAction,
    PhoneLocationState,
    describePhoneLocationState,
    initialPhoneLocationState,
    isLocationRequestInFlight,
} from '../utils/phoneLocationState';

/**
 * Location sharing status on the vehicle dashboard (MOV-264).
 *
 * A deliberately thin shell: every decision about what to say and which button
 * to offer lives in `phoneLocationState`, which is covered by tests. This holds
 * the state and renders the result.
 *
 * Nothing runs on mount or on focus. The driver presses a button, so opening
 * the dashboard never sets off a permission prompt or a network request by
 * itself — and nothing here repeats on a timer. The periodic loop exists
 * (`locationTracker`, via `usePhoneLocationTracking`) but this card does not
 * start it: turning tracking on from the dashboard is MOV-268.
 *
 * One press does the whole manual flow: read the phone's position, look up the
 * signed-in bus, and send the reading to that bus's location endpoint.
 */
export function LocationStatusCard() {
    const [state, setState] = useState<PhoneLocationState>(initialPhoneLocationState);

    const requestLocation = useCallback(async () => {
        // One attempt at a time, covering both halves. Without this a second
        // press would start another permission prompt on top of the first, or
        // send the same position twice.
        if (isLocationRequestInFlight(state)) return;

        // Read the phone's position, look up the signed-in bus, publish to it.
        // The sequence lives in `locationPublishCycle` because MOV-267 repeats
        // exactly this on a timer, and two copies of it would drift apart.
        await runPublishCycle(setState);
    }, [state]);

    const openSettings = useCallback(async () => {
        try {
            await Linking.openSettings();
        } catch {
            // Some platforms and configurations have no settings screen to
            // open. Failing quietly leaves the card and its other action
            // intact, which is better than crashing the dashboard.
        }
    }, []);

    const runAction = useCallback(
        (action: PhoneLocationAction) => {
            if (action.kind === 'OPEN_SETTINGS') {
                openSettings();
                return;
            }
            if (action.kind === 'SIGN_IN') {
                router.replace('/(auth)/device-login' as any);
                return;
            }
            requestLocation();
        },
        [openSettings, requestLocation]
    );

    const view = describePhoneLocationState(state);
    const toneStyles = TONE_STYLES[view.tone];

    return (
        <View style={styles.card}>
            <View style={styles.headingRow}>
                <View style={[styles.iconBadge, toneStyles.badge]}>
                    {view.isBusy ? (
                        <ActivityIndicator size="small" color={toneStyles.iconColor} />
                    ) : (
                        <Ionicons name={view.icon} size={20} color={toneStyles.iconColor} />
                    )}
                </View>

                <View style={styles.headingTextGroup}>
                    <Text style={[styles.title, toneStyles.title]}>{view.title}</Text>
                    <Text style={styles.description}>{view.description}</Text>
                </View>
            </View>

            {/* The coordinates are shown so the driver can see the phone really
                did get a fix. Nothing is sent anywhere yet. */}
            {(state.status === 'AVAILABLE' || state.status === 'PUBLISHED') && state.location && (
                <View
                    style={styles.readingRow}
                    accessible
                    accessibilityLabel="Last location reading from this phone"
                >
                    <Reading label="Latitude" value={state.location.latitude.toFixed(5)} />
                    <Reading label="Longitude" value={state.location.longitude.toFixed(5)} />
                </View>
            )}

            {!!view.primaryAction && (
                <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={() => runAction(view.primaryAction!)}
                    accessibilityRole="button"
                    accessibilityLabel={view.primaryAction.label}
                >
                    <Text style={styles.primaryButtonText}>{view.primaryAction.label}</Text>
                </TouchableOpacity>
            )}

            {!!view.secondaryAction && (
                <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => runAction(view.secondaryAction!)}
                    accessibilityRole="button"
                    accessibilityLabel={view.secondaryAction.label}
                >
                    <Text style={styles.secondaryButtonText}>{view.secondaryAction.label}</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

function Reading({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.reading}>
            <Text style={styles.readingLabel}>{label}</Text>
            <Text style={styles.readingValue}>{value}</Text>
        </View>
    );
}

/**
 * Colour follows the state; it never carries it on its own. Each state also has
 * its own icon and its own title, so the card reads the same to someone who
 * cannot distinguish the tones.
 */
const TONE_STYLES = {
    neutral: {
        badge: { backgroundColor: '#EBF3FA' },
        iconColor: '#0066CC',
        title: { color: '#1A2530' },
    },
    success: {
        badge: { backgroundColor: '#D1FAE5' },
        iconColor: '#047857',
        title: { color: '#065F46' },
    },
    warning: {
        badge: { backgroundColor: '#FEF3C7' },
        iconColor: '#B45309',
        title: { color: '#92400E' },
    },
} as const;

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 20,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#1A2530',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 3,
    },
    headingRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    iconBadge: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    headingTextGroup: {
        flex: 1,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
    },
    description: {
        fontSize: 15,
        color: '#5A6E7F',
        lineHeight: 21,
        marginTop: 4,
    },

    readingRow: {
        flexDirection: 'row',
        backgroundColor: '#F4F7FB',
        borderRadius: 14,
        paddingVertical: 12,
        paddingHorizontal: 14,
        marginTop: 16,
    },
    reading: {
        flex: 1,
    },
    readingLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: '#5A6E7F',
    },
    readingValue: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1A2530',
        marginTop: 2,
    },

    primaryButton: {
        backgroundColor: '#0066CC',
        // Large enough to hit comfortably, including with reduced dexterity.
        minHeight: 52,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
        marginTop: 18,
    },
    primaryButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
    secondaryButton: {
        minHeight: 48,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
        marginTop: 10,
    },
    secondaryButtonText: {
        color: '#0066CC',
        fontSize: 15,
        fontWeight: '700',
    },
});
