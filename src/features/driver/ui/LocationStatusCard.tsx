import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import {
    ActivityIndicator,
    Linking,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { PhoneLocation } from '../../../shared/utils/phoneLocation';
import { describeBusMap, nextLastKnownLocation } from '../utils/busMapView';
import { PhoneLocationAction } from '../utils/phoneLocationState';
import { describeTrackingCard } from '../utils/trackingCardView';
import { BusLocationMap } from './BusLocationMap';
import { usePhoneLocationTracking } from './usePhoneLocationTracking';

/**
 * How tall the map sits inside the card.
 *
 * Big enough to read which road the bus is on at a glance, small enough that
 * the tracking state and the stop control are still on screen with it — this is
 * a status card with a map in it, not a map screen.
 */
const MAP_HEIGHT = 190;

/**
 * Location sharing on the vehicle dashboard (MOV-264, MOV-268).
 *
 * A deliberately thin shell. Every decision about what to say and which button
 * to offer lives in `trackingCardView`, which is covered by tests; the loop
 * behind it lives in `locationTracker` (MOV-267). This renders the result and
 * forwards presses.
 *
 * Nothing starts on mount or on focus. Tracking begins only when the driver
 * presses the button, so opening the dashboard never sets off a permission
 * prompt or a network request by itself. There is no timer here — the periodic
 * publishing, and the retrying after a failure, both belong to the tracker.
 */
export function LocationStatusCard() {
    const { state, isTracking, startTracking, stopTracking, publishOnce } =
        usePhoneLocationTracking();

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
            switch (action.kind) {
                case 'START_TRACKING':
                    // Pressing again while it is already on does nothing: the
                    // tracker itself refuses a second loop.
                    startTracking();
                    return;
                case 'STOP_TRACKING':
                    // Safe to press repeatedly; stopping something already
                    // stopped is a no-op.
                    stopTracking();
                    return;
                case 'OPEN_SETTINGS':
                    openSettings();
                    return;
                case 'SIGN_IN':
                    router.replace('/(auth)/device-login' as any);
                    return;
                default:
                    // 'REQUEST' — one reading, published once. Offered only as
                    // recovery from a failure while tracking is off, so it must
                    // stay a single attempt rather than quietly turning
                    // continuous sharing on behind the driver's back.
                    publishOnce();
            }
        },
        [openSettings, publishOnce, startTracking, stopTracking]
    );

    const view = describeTrackingCard(state, isTracking);
    const toneStyles = TONE_STYLES[view.tone];

    // The state model drops its reading when a GPS request fails, so the last
    // real fix is kept here beside it — and cleared the moment tracking stops
    // or the bus signs out. `nextLastKnownLocation` owns both rules; this is
    // only where the value is held between renders.
    const lastKnown = useRef<PhoneLocation | null>(null);
    lastKnown.current = nextLastKnownLocation(lastKnown.current, state, isTracking);

    const map = describeBusMap(state, isTracking, lastKnown.current);

    // The numbers must never be worse off than the picture: wherever the map
    // draws a marker the coordinates are readable too, so the position is not
    // available only to someone who can see the map. Outside tracking this is
    // exactly the reading the card has always shown.
    const readout =
        map.marker ??
        (state.status === 'AVAILABLE' || state.status === 'PUBLISHED' ? state.location : null);

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

                {/* Announced as one phrase when it changes, so a driver using a
                    screen reader hears the new state without hunting for it. */}
                <View
                    style={styles.headingTextGroup}
                    accessible
                    accessibilityRole="text"
                    accessibilityLiveRegion="polite"
                    accessibilityLabel={`${view.title}. ${view.description}`}
                >
                    <Text style={[styles.title, toneStyles.title]}>{view.title}</Text>
                    <Text style={styles.description}>{view.description}</Text>
                </View>
            </View>

            {/* Shown so the driver can see the phone really did get a fix. */}
            {!!readout && (
                <View
                    style={styles.readingRow}
                    accessible
                    accessibilityLabel={
                        map.freshness === 'LAST_KNOWN' && map.visible
                            ? 'Last known location reading from this phone'
                            : 'Last location reading from this phone'
                    }
                >
                    <Reading label="Latitude" value={readout.latitude.toFixed(5)} />
                    <Reading label="Longitude" value={readout.longitude.toFixed(5)} />
                </View>
            )}

            {/* Visualisation only. Every rule about whether a bus may be drawn
                at all lives in `busMapView`; this passes the answer through. */}
            {map.visible && (
                <BusLocationMap
                    marker={map.marker}
                    freshness={map.freshness}
                    caption={map.caption}
                    accessibilityLabel={map.accessibilityLabel}
                    height={MAP_HEIGHT}
                />
            )}

            {/* The tracking control comes first: it is the one thing on this
                card a driver presses as part of their shift. It is never
                disabled while a round is in flight — turning sharing off has to
                work at any moment, and a button that greys out every thirty
                seconds would be worse than useless. */}
            {!!view.trackingAction && (
                <TouchableOpacity
                    style={[
                        styles.primaryButton,
                        view.trackingAction.kind === 'STOP_TRACKING' && styles.stopButton,
                    ]}
                    onPress={() => runAction(view.trackingAction!)}
                    accessibilityRole="button"
                    accessibilityLabel={view.trackingAction.label}
                    accessibilityHint={
                        view.trackingAction.kind === 'STOP_TRACKING'
                            ? 'Stops sending this bus location to passengers'
                            : 'Starts sending this bus location to passengers every 30 seconds'
                    }
                    accessibilityState={{ selected: isTracking }}
                >
                    <Text
                        style={[
                            styles.primaryButtonText,
                            view.trackingAction.kind === 'STOP_TRACKING' && styles.stopButtonText,
                        ]}
                    >
                        {view.trackingAction.label}
                    </Text>
                </TouchableOpacity>
            )}

            {!!view.primaryAction && (
                <TouchableOpacity
                    style={view.trackingAction ? styles.secondaryButton : styles.primaryButton}
                    onPress={() => runAction(view.primaryAction!)}
                    accessibilityRole="button"
                    accessibilityLabel={view.primaryAction.label}
                >
                    <Text
                        style={
                            view.trackingAction
                                ? styles.secondaryButtonText
                                : styles.primaryButtonText
                        }
                    >
                        {view.primaryAction.label}
                    </Text>
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
    /**
     * Stopping is an outlined button rather than a filled one, so "on" and
     * "off" are not the same shape in two colours. The label changes too, so
     * the difference never rests on the styling alone.
     */
    stopButton: {
        backgroundColor: '#FFFFFF',
        borderWidth: 2,
        borderColor: '#0066CC',
    },
    stopButtonText: {
        color: '#0066CC',
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
