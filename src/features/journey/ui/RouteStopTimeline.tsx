import { AppText as Text } from '../../../shared/ui/AppText';
import { VEHICLE_MARKER_COLOR } from '../../../shared/ui/mapTheme';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet,  View } from 'react-native';

interface RouteStopTimelineProps {
    /** Stops in travel order; the first is boarded and the last is alighted. */
    stops: string[];
    boardLabel?: string;
    alightLabel?: string;
    /**
     * Where the live bus is relative to each stop (MOV-297), one entry per
     * stop. Omitted on planning screens, which then render exactly as before.
     */
    stopStates?: TimelineStopState[] | null;
}

export type TimelineStopState = 'PASSED' | 'CURRENT' | 'NEXT' | 'UPCOMING';

const STATE_NOTES: Record<TimelineStopState, string> = {
    PASSED: 'Passed',
    CURRENT: 'Bus is here',
    NEXT: 'Next stop',
    UPCOMING: '',
};

/**
 * Vertical timeline of the stops on a journey, in travel order.
 *
 * Endpoints are distinguished by a larger filled marker AND by a written label,
 * never by colour alone, so the boarding and alighting points remain clear to
 * passengers who cannot rely on colour.
 */
export function RouteStopTimeline({
    stops,
    boardLabel = 'Board here',
    alightLabel = 'Get off here',
    stopStates,
}: RouteStopTimelineProps) {
    if (stops.length === 0) {
        return <Text style={styles.emptyText}>Stop details are not available for this route.</Text>;
    }

    return (
        <View>
            {stops.map((stop, index) => {
                const isFirst = index === 0;
                const isLast = index === stops.length - 1;
                const isEndpoint = isFirst || isLast;
                const endpointNote = isFirst ? boardLabel : isLast ? alightLabel : '';
                const state = stopStates?.length === stops.length ? stopStates[index] : undefined;
                const stateNote = state ? STATE_NOTES[state] : '';
                const isPassed = state === 'PASSED';
                const isBusHere = state === 'CURRENT';

                return (
                    <View
                        key={`${stop}-${index}`}
                        style={styles.row}
                        accessible
                        accessibilityLabel={
                            [
                                stop,
                                endpointNote || `stop ${index + 1} of ${stops.length}`,
                                stateNote,
                            ]
                                .filter(Boolean)
                                .join(', ')
                        }
                    >
                        <View style={styles.markerColumn}>
                            {isBusHere ? (
                                <View style={styles.busDot}>
                                    <Ionicons name="bus" size={11} color="#FFFFFF" />
                                </View>
                            ) : (
                                <View
                                    style={[
                                        styles.dot,
                                        isEndpoint && styles.dotEndpoint,
                                        isPassed && styles.dotPassed,
                                    ]}
                                />
                            )}
                            {!isLast && <View style={[styles.line, isPassed && styles.linePassed]} />}
                        </View>

                        <View style={styles.textColumn}>
                            <Text
                                style={[
                                    styles.stopText,
                                    isEndpoint && styles.stopTextEndpoint,
                                    isPassed && styles.stopTextPassed,
                                ]}
                            >
                                {stop}
                            </Text>
                            {/* Written out, never colour alone. */}
                            {!!stateNote && (
                                <View
                                    style={[
                                        styles.notePill,
                                        isPassed ? styles.statePillPassed : styles.statePillLive,
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.noteText,
                                            isPassed ? styles.stateTextPassed : styles.stateTextLive,
                                        ]}
                                    >
                                        {stateNote}
                                    </Text>
                                </View>
                            )}
                            {!!endpointNote && (
                                <View
                                    style={[
                                        styles.notePill,
                                        isLast ? styles.notePillEnd : styles.notePillStart,
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.noteText,
                                            isLast ? styles.noteTextEnd : styles.noteTextStart,
                                        ]}
                                    >
                                        {endpointNote}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    markerColumn: {
        alignItems: 'center',
        width: 20,
        alignSelf: 'stretch',
    },
    dot: {
        width: 9,
        height: 9,
        borderRadius: 4.5,
        backgroundColor: '#CBD5E1',
        marginTop: 6,
    },
    dotEndpoint: {
        width: 13,
        height: 13,
        borderRadius: 6.5,
        backgroundColor: '#0066CC',
        marginTop: 4,
    },
    line: {
        width: 2,
        flex: 1,
        minHeight: 22,
        backgroundColor: '#E2E8F0',
        marginVertical: 3,
    },
    textColumn: {
        flex: 1,
        marginLeft: 12,
        paddingBottom: 16,
    },
    stopText: {
        fontSize: 15,
        fontWeight: '500',
        color: '#475569',
    },
    stopTextEndpoint: {
        fontSize: 16,
        fontWeight: '800',
        color: '#0F172A',
    },
    notePill: {
        alignSelf: 'flex-start',
        borderRadius: 8,
        paddingHorizontal: 9,
        paddingVertical: 4,
        marginTop: 6,
    },
    notePillStart: {
        backgroundColor: '#EBF3FA',
    },
    notePillEnd: {
        backgroundColor: '#F1F5F9',
    },
    noteText: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    noteTextStart: {
        color: '#0066CC',
    },
    noteTextEnd: {
        color: '#334155',
    },
    dotPassed: {
        backgroundColor: '#94A3B8',
    },
    busDot: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: VEHICLE_MARKER_COLOR,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 2,
    },
    linePassed: {
        backgroundColor: '#94A3B8',
    },
    stopTextPassed: {
        color: '#64748B',
    },
    statePillPassed: {
        backgroundColor: '#F1F5F9',
    },
    statePillLive: {
        backgroundColor: '#ECFDF5',
    },
    stateTextPassed: {
        color: '#475569',
    },
    stateTextLive: {
        color: '#065F46',
    },
    emptyText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#64748B',
    },
});
