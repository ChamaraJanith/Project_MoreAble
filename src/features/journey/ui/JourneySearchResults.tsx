import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
    JourneyGeoInformation,
    JourneySearchMatch,
    JourneySearchOption,
} from '../../../entities/route/model/types';
import { searchJourneys } from '../api/journeySearchApi';
import { formatFriendlyDate, formatFriendlyTime, parseApiDateString, parseApiTimeString } from '../utils/dateTime';
import { JourneyOptionCard } from './JourneyOptionCard';

type ResultsStatus = 'loading' | 'loaded' | 'error';

interface JourneyOption {
    key: string;
    route: JourneySearchMatch;
    option: JourneySearchOption;
}

// Every trip becomes its own journey option, ordered by departure time across all
// matched routes — so two trips on the same route appear as separate, comparable
// departures rather than being collapsed together.
function toJourneyOptions(routes: JourneySearchMatch[]): JourneyOption[] {
    return routes
        .flatMap((route) =>
            route.trips.map((option) => ({
                key: `${route.routeId}-${option.trip.tripId}`,
                route,
                option,
            }))
        )
        .sort((a, b) => a.option.trip.departureTime.localeCompare(b.option.trip.departureTime));
}

export const JourneySearchResults = () => {
    const params = useLocalSearchParams<{
        origin?: string;
        destination?: string;
        travelDate?: string;
        travelTime?: string;
    }>();

    const { origin, destination, travelDate, travelTime } = params;

    const [status, setStatus] = useState<ResultsStatus>('loading');
    const [routes, setRoutes] = useState<JourneySearchMatch[]>([]);
    // Kept so "View details" can hand the route map data to the details screen.
    const [geo, setGeo] = useState<JourneyGeoInformation | null>(null);
    const [errorMessage, setErrorMessage] = useState('');

    const runSearch = useCallback(async () => {
        if (!origin || !destination || !travelDate || !travelTime) {
            setStatus('error');
            setErrorMessage('Your search details are incomplete. Please go back and search again.');
            return;
        }

        setStatus('loading');

        try {
            const response = await searchJourneys({ origin, destination, travelDate, travelTime });
            setRoutes(Array.isArray(response.routes) ? response.routes : []);
            setGeo(response.geo ?? null);
            setStatus('loaded');
        } catch (error: any) {
            setErrorMessage(error?.message || 'Something went wrong while searching for routes.');
            setStatus('error');
        }
    }, [origin, destination, travelDate, travelTime]);

    useEffect(() => {
        runSearch();
    }, [runSearch]);

    const journeyOptions = useMemo(() => toJourneyOptions(routes), [routes]);

    const handleEditSearch = () => {
        router.back();
    };

    const friendlyDate = travelDate ? formatFriendlyDate(parseApiDateString(travelDate)) : '';
    const friendlyTime = travelTime ? formatFriendlyTime(parseApiTimeString(travelTime)) : '';

    // A route can match without having any upcoming departure, so the two empty
    // cases need different explanations.
    const hasMatchedRoutes = routes.length > 0;
    const isEmpty = status === 'loaded' && journeyOptions.length === 0;

    return (
        <View style={styles.container}>
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Header */}
                <View style={styles.headerRow}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => router.back()}
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                    >
                        <Ionicons name="arrow-back" size={24} color="#0F172A" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle} accessibilityRole="header">
                        Recommended Routes
                    </Text>
                </View>

                {/* Search summary */}
                <View style={styles.summaryCard}>
                    <View style={styles.summaryJourneyRow}>
                        <Text style={styles.summaryLocationText} numberOfLines={1}>
                            {origin || 'Origin'}
                        </Text>
                        <Ionicons name="arrow-forward" size={16} color="#475569" style={styles.summaryArrow} />
                        <Text style={styles.summaryLocationText} numberOfLines={1}>
                            {destination || 'Destination'}
                        </Text>
                    </View>

                    <View style={styles.summaryMetaRow}>
                        <View style={styles.summaryMetaTextGroup}>
                            <Ionicons name="calendar-outline" size={14} color="#64748B" style={styles.summaryMetaIcon} />
                            <Text style={styles.summaryMetaText} numberOfLines={1}>
                                {friendlyDate}{friendlyDate && friendlyTime ? ' · ' : ''}{friendlyTime}
                            </Text>
                        </View>

                        <TouchableOpacity
                            style={styles.editSearchButton}
                            onPress={handleEditSearch}
                            accessibilityRole="button"
                            accessibilityLabel="Edit Search"
                            accessibilityHint="Double tap to go back and change your search"
                        >
                            <Text style={styles.editSearchText}>Edit Search</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Loading */}
                {status === 'loading' && (
                    <View style={styles.stateContainer} accessibilityLiveRegion="polite">
                        <ActivityIndicator size="large" color="#0066CC" />
                        <Text style={styles.stateText}>Finding available departures…</Text>
                    </View>
                )}

                {/* Empty */}
                {isEmpty && (
                    <View style={styles.stateContainer} accessibilityLiveRegion="polite">
                        <View style={styles.stateIconBadge}>
                            <Ionicons
                                name={hasMatchedRoutes ? 'time-outline' : 'search-outline'}
                                size={32}
                                color="#94A3B8"
                            />
                        </View>
                        <Text style={styles.stateTitle}>
                            {hasMatchedRoutes ? 'No departures left' : 'No routes found'}
                        </Text>
                        <Text style={styles.stateDescription}>
                            {hasMatchedRoutes
                                ? `Buses do run between ${origin} and ${destination}, but none are scheduled to depart at or after ${friendlyTime}. Try an earlier time.`
                                : `We couldn't find a route from ${origin} to ${destination}. Try a nearby stop or check the spelling.`}
                        </Text>
                        <TouchableOpacity
                            style={styles.stateButton}
                            onPress={handleEditSearch}
                            accessibilityRole="button"
                            accessibilityLabel="Edit Search"
                        >
                            <Text style={styles.stateButtonText}>EDIT SEARCH</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Error */}
                {status === 'error' && (
                    <View style={styles.stateContainer} accessibilityLiveRegion="assertive">
                        <View style={[styles.stateIconBadge, styles.stateIconBadgeError]}>
                            <Ionicons name="alert-circle-outline" size={32} color="#D32F2F" />
                        </View>
                        <Text style={styles.stateTitle}>Something went wrong</Text>
                        <Text style={styles.stateDescription}>{errorMessage}</Text>
                        <TouchableOpacity
                            style={styles.stateButton}
                            onPress={runSearch}
                            accessibilityRole="button"
                            accessibilityLabel="Try Again"
                        >
                            <Text style={styles.stateButtonText}>TRY AGAIN</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.stateSecondaryButton}
                            onPress={handleEditSearch}
                            accessibilityRole="button"
                            accessibilityLabel="Edit Search"
                        >
                            <Text style={styles.stateSecondaryButtonText}>Edit Search</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Results */}
                {status === 'loaded' && journeyOptions.length > 0 && (
                    <>
                        <Text style={styles.resultsCountText}>
                            {journeyOptions.length} journey option{journeyOptions.length > 1 ? 's' : ''} · soonest first
                        </Text>
                        {journeyOptions.map(({ key, route, option }) => (
                            <JourneyOptionCard
                                key={key}
                                route={route}
                                option={option}
                                geo={geo}
                                travelDate={travelDate}
                                travelTime={travelTime}
                            />
                        ))}
                    </>
                )}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 32,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
    },
    backButton: {
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'flex-start',
        marginRight: 4,
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: '800',
        color: '#0F172A',
        letterSpacing: -0.5,
    },
    summaryCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 18,
        marginBottom: 20,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 4,
    },
    summaryJourneyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
    },
    summaryLocationText: {
        flexShrink: 1,
        fontSize: 17,
        fontWeight: '800',
        color: '#0F172A',
    },
    summaryArrow: {
        marginHorizontal: 8,
    },
    summaryMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    summaryMetaTextGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 1,
    },
    summaryMetaIcon: {
        marginRight: 6,
    },
    summaryMetaText: {
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
    },
    editSearchButton: {
        minHeight: 44,
        justifyContent: 'center',
        paddingLeft: 12,
    },
    editSearchText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0066CC',
    },
    resultsCountText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#64748B',
        marginBottom: 12,
    },
    stateContainer: {
        alignItems: 'center',
        paddingTop: 40,
        paddingHorizontal: 12,
    },
    stateText: {
        marginTop: 16,
        fontSize: 15,
        fontWeight: '600',
        color: '#475569',
    },
    stateIconBadge: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    stateIconBadgeError: {
        backgroundColor: '#FEF2F2',
    },
    stateTitle: {
        fontSize: 19,
        fontWeight: '800',
        color: '#0F172A',
        marginBottom: 8,
        textAlign: 'center',
    },
    stateDescription: {
        fontSize: 14,
        fontWeight: '500',
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 20,
        maxWidth: 320,
    },
    stateButton: {
        backgroundColor: '#0066CC',
        minHeight: 52,
        minWidth: 200,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 4,
    },
    stateButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
    stateSecondaryButton: {
        marginTop: 14,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
    },
    stateSecondaryButtonText: {
        color: '#0066CC',
        fontSize: 15,
        fontWeight: '700',
    },
});
