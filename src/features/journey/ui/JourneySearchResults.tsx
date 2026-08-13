import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { JourneySearchMatch } from '../../../entities/route/model/types';
import { searchJourneys } from '../api/journeySearchApi';
import { formatFriendlyDate, formatFriendlyTime, parseApiDateString, parseApiTimeString } from '../utils/dateTime';
import { RouteResultCard } from './RouteResultCard';

type ResultsStatus = 'loading' | 'success' | 'empty' | 'error';

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
            setRoutes(response.routes);
            setStatus(response.routes.length > 0 ? 'success' : 'empty');
        } catch (error: any) {
            setErrorMessage(error?.message || 'Something went wrong while searching for routes.');
            setStatus('error');
        }
    }, [origin, destination, travelDate, travelTime]);

    useEffect(() => {
        runSearch();
    }, [runSearch]);

    const handleEditSearch = () => {
        router.back();
    };

    const friendlyDate = travelDate ? formatFriendlyDate(parseApiDateString(travelDate)) : '';
    const friendlyTime = travelTime ? formatFriendlyTime(parseApiTimeString(travelTime)) : '';

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
                            onPress={handleEditSearch}
                            accessibilityRole="button"
                            accessibilityLabel="Edit Search"
                            accessibilityHint="Double tap to go back and change your search"
                        >
                            <Text style={styles.editSearchText}>Edit Search</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Content */}
                {status === 'loading' && (
                    <View style={styles.stateContainer} accessibilityLiveRegion="polite">
                        <ActivityIndicator size="large" color="#0066CC" />
                        <Text style={styles.stateText}>Searching for accessible routes…</Text>
                    </View>
                )}

                {status === 'empty' && (
                    <View style={styles.stateContainer} accessibilityLiveRegion="polite">
                        <View style={styles.stateIconBadge}>
                            <Ionicons name="search-outline" size={32} color="#94A3B8" />
                        </View>
                        <Text style={styles.stateTitle}>No routes found</Text>
                        <Text style={styles.stateDescription}>
                            We couldn&apos;t find a route from {origin} to {destination}. Try a nearby location or double-check your search.
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

                {status === 'success' && (
                    <>
                        <Text style={styles.resultsCountText}>
                            {routes.length} route{routes.length > 1 ? 's' : ''} found
                        </Text>
                        {routes.map((route) => (
                            <RouteResultCard key={route.routeId} route={route} />
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
