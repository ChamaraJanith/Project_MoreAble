import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface RouteStopTimelineProps {
    /** Stops in travel order; the first is boarded and the last is alighted. */
    stops: string[];
    boardLabel?: string;
    alightLabel?: string;
}

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

                return (
                    <View
                        key={`${stop}-${index}`}
                        style={styles.row}
                        accessible
                        accessibilityLabel={
                            endpointNote
                                ? `${stop}, ${endpointNote}`
                                : `${stop}, stop ${index + 1} of ${stops.length}`
                        }
                    >
                        <View style={styles.markerColumn}>
                            <View style={[styles.dot, isEndpoint && styles.dotEndpoint]} />
                            {!isLast && <View style={styles.line} />}
                        </View>

                        <View style={styles.textColumn}>
                            <Text style={[styles.stopText, isEndpoint && styles.stopTextEndpoint]}>
                                {stop}
                            </Text>
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
    emptyText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#64748B',
    },
});
