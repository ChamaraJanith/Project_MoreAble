import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BusRatingContext, BusRatingValue } from '../../../entities/rating/model/types';
import { useAuthStore } from '../../../shared/store/authStore';
import { AppText as Text } from '../../../shared/ui/AppText';
import { describeAccessibilityFacilities } from '../../journey/utils/accessibilityFacilities';
import { getBusRatingContext, submitBusRating } from '../api/busRatingApi';
import {
    BUS_RATING_STARS,
    describeRatedBus,
    describeRatingFailure,
    ratingDescription,
    starLabel,
} from '../utils/busRating';

type LoadState = 'LOADING' | 'READY' | 'UNAUTHORIZED' | 'NOT_FOUND' | 'ERROR';

const STAR_COLOR = '#F59E0B';

/**
 * Both Submit and Skip end here. Replaced rather than pushed, so Back from
 * Activities never reopens this screen or the Live Journey before it.
 */
function goToActivities() {
    router.replace('/activities');
}

/**
 * Rate this bus: Activities > Ongoing > View Journey > End Journey > here.
 *
 * Shown only after the passenger's own journey has completed. It is feedback
 * about the bus, never part of finishing the journey: nothing here can change
 * the completed journey, and every state — loading, failed, already rated —
 * lets the passenger leave for Activities.
 *
 * The bus comes from GET /api/journeys/completed/rating, resolved on the
 * server from the completed booking. The booking id in the URL only picks
 * which of the passenger's own completed journeys it is.
 */
export function BusRatingScreen() {
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const { bookingId } = useLocalSearchParams<{ bookingId?: string }>();
    const token = useAuthStore((store) => store.token);

    const [loadState, setLoadState] = useState<LoadState>('LOADING');
    const [context, setContext] = useState<BusRatingContext | null>(null);
    const [selected, setSelected] = useState<BusRatingValue | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);

    const load = useCallback(
        async (isCurrent: () => boolean) => {
            // A fresh start per visit: this tab screen stays mounted between journeys.
            setSelected(null);
            setSubmitError(null);
            setContext(null);

            if (!token || !bookingId) {
                setLoadState('UNAUTHORIZED');
                return;
            }

            setLoadState('LOADING');
            const result = await getBusRatingContext(token, bookingId);
            if (!isCurrent()) return;

            if (result.ok) {
                setContext(result.value);
                setLoadState('READY');
            } else if (result.status === 401 || result.status === 403) {
                setLoadState('UNAUTHORIZED');
            } else if (result.status === 404 || result.status === 409) {
                setLoadState('NOT_FOUND');
            } else {
                setLoadState('ERROR');
            }
        },
        [bookingId, token]
    );

    useFocusEffect(
        useCallback(() => {
            let current = true;
            load(() => current);
            return () => {
                current = false;
            };
            // `attempt` re-runs the load when the passenger taps Retry.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [load, attempt])
    );

    const handleSubmit = async () => {
        if (!context || !selected || submitting || !token) return;

        setSubmitError(null);
        setSubmitting(true);
        const result = await submitBusRating(token, {
            bookingId: context.journey.bookingId,
            busId: context.bus.busId,
            rating: selected,
        });
        setSubmitting(false);

        if (result.ok) {
            goToActivities();
            return;
        }

        const failure = describeRatingFailure(result.status, result.code, result.message);
        setSubmitError(failure.message);

        if (failure.alreadyRated) {
            // Stored already (an earlier tap got through): show the stored
            // rating, which leaves only Go to Activities.
            const fresh = await getBusRatingContext(token, context.journey.bookingId);
            if (fresh.ok) setContext(fresh.value);
        }
    };

    const containerPadding = {
        paddingTop: insets.top > 0 ? insets.top + 10 : 20,
        paddingBottom: insets.bottom > 0 ? insets.bottom + 32 : 32,
    };

    const header = (
        <View style={styles.headerRow}>
            <TouchableOpacity
                style={styles.backButton}
                onPress={goToActivities}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={t('busRating.back', 'Back to Activities')}
            >
                <Ionicons name="arrow-back" size={24} color="#0F172A" />
            </TouchableOpacity>
            <Text style={styles.headerTitle} accessibilityRole="header">
                {t('busRating.title', 'Rate this bus')}
            </Text>
        </View>
    );

    if (loadState !== 'READY' || !context) {
        const content =
            loadState === 'LOADING'
                ? null
                : {
                      NOT_FOUND: {
                          title: t('busRating.notFoundTitle', 'This journey cannot be rated'),
                          body: t('busRating.notFoundDesc', 'We could not find the bus for this completed journey.'),
                          action: t('busRating.goToActivities', 'GO TO ACTIVITIES'),
                          onPress: goToActivities,
                      },
                      UNAUTHORIZED: {
                          title: t('ongoingJourney.signInTitle', 'Please sign in again'),
                          body: t('busRating.signInDesc', 'Sign in with your passenger account to rate this bus.'),
                          action: t('activities.goToSignIn', 'GO TO SIGN IN'),
                          onPress: () => router.replace('/(auth)'),
                      },
                      ERROR: {
                          title: t('busRating.errorTitle', 'Unable to load this bus'),
                          body: t('ongoingJourney.errorDesc', 'Please check your connection and try again.'),
                          action: t('activities.retryBtn', 'RETRY'),
                          onPress: () => setAttempt((count) => count + 1),
                      },
                      READY: null,
                  }[loadState];

        return (
            <View style={[styles.container, containerPadding, styles.padded]}>
                {header}
                <View style={styles.stateContainer} accessibilityLiveRegion="polite">
                    <View style={styles.completedPill}>
                        <Ionicons name="checkmark-circle" size={14} color="#065F46" />
                        <Text style={styles.completedPillText}>{t('busRating.journeyCompleted', 'Your journey is completed')}</Text>
                    </View>
                    {!content ? (
                        <>
                            <ActivityIndicator size="large" color="#0066CC" />
                            <Text style={styles.stateDescription}>{t('busRating.loading', 'Loading your bus...')}</Text>
                        </>
                    ) : (
                        <>
                            <Text style={styles.stateTitle}>{content.title}</Text>
                            <Text style={styles.stateDescription}>{content.body}</Text>
                            <TouchableOpacity style={styles.primaryButton} onPress={content.onPress} accessibilityRole="button">
                                <Text style={styles.primaryButtonText}>{content.action}</Text>
                            </TouchableOpacity>
                        </>
                    )}
                    {content?.onPress !== goToActivities && (
                        // Never trapped here: rating is optional, the journey is already completed.
                        <TouchableOpacity style={styles.skipButton} onPress={goToActivities} accessibilityRole="button">
                            <Text style={styles.skipButtonText}>{t('busRating.skip', 'Skip')}</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        );
    }

    const { bus, journey, myRating } = context;
    const identity = describeRatedBus(bus);
    const facilities = describeAccessibilityFacilities(bus.accessibilityFacilities);
    const routeLine = [
        journey.routeNumber ? `Route ${journey.routeNumber}` : null,
        journey.origin && journey.destination ? `${journey.origin} → ${journey.destination}` : null,
    ]
        .filter(Boolean)
        .join(' · ');
    const shownRating = myRating?.rating ?? selected;
    const description = ratingDescription(shownRating);

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={[styles.scrollContent, containerPadding]} showsVerticalScrollIndicator={false}>
                {header}

                <View style={styles.completedPill}>
                    <Ionicons name="checkmark-circle" size={14} color="#065F46" />
                    <Text style={styles.completedPillText}>{t('busRating.journeyCompleted', 'Your journey is completed')}</Text>
                </View>

                {/* ---------------- The bus ---------------- */}
                <View style={styles.card}>
                    <View style={styles.busRow} accessible accessibilityLabel={[`Bus ${identity.title}`, identity.details, routeLine].filter(Boolean).join('. ')}>
                        <View style={styles.busIcon}>
                            <Ionicons name="bus" size={26} color="#FFFFFF" />
                        </View>
                        <View style={styles.busText}>
                            <Text style={styles.busTitle}>{identity.title}</Text>
                            {!!identity.details && <Text style={styles.busDetails}>{identity.details}</Text>}
                            {!!routeLine && <Text style={styles.busRoute}>{routeLine}</Text>}
                        </View>
                    </View>
                </View>

                {/* ---------------- Accessibility facilities ---------------- */}
                <View style={styles.card}>
                    <SectionHeading icon="accessibility-outline" title={t('busRating.facilities', 'Accessibility facilities')} />
                    {facilities.status === 'AVAILABLE' ? (
                        <View style={styles.facilityWrap}>
                            {facilities.items.map((facility) => (
                                <View key={facility.key} style={styles.facilityChip} accessible accessibilityLabel={`Available: ${facility.label}`}>
                                    <Ionicons name="checkmark-circle" size={14} color="#0F766E" />
                                    <Text style={styles.facilityChipText}>{facility.label}</Text>
                                </View>
                            ))}
                        </View>
                    ) : (
                        <Text style={styles.mutedText}>
                            {facilities.status === 'NONE_AVAILABLE'
                                ? t('busRating.noFacilities', 'This bus is recorded as having none of the accessibility facilities MoreAble tracks.')
                                : t('busRating.unknownFacilities', 'Accessibility information has not been recorded for this bus yet.')}
                        </Text>
                    )}
                </View>

                {/* ---------------- Rating ---------------- */}
                <View style={styles.card}>
                    <Text style={styles.question} accessibilityRole="header">
                        {t('busRating.question', 'How would you rate your experience with this bus?')}
                    </Text>
                    <Text style={styles.questionHint}>
                        {t('busRating.hint', 'Your rating is about this bus, and helps other passengers choose accessible buses.')}
                    </Text>

                    <View style={styles.starsRow} accessibilityRole="radiogroup">
                        {BUS_RATING_STARS.map((stars) => {
                            const filled = shownRating !== null && stars <= shownRating;
                            return (
                                <TouchableOpacity
                                    key={stars}
                                    style={styles.starButton}
                                    onPress={() => {
                                        setSelected(stars);
                                        setSubmitError(null);
                                    }}
                                    disabled={!!myRating || submitting}
                                    accessibilityRole="radio"
                                    accessibilityLabel={starLabel(stars)}
                                    accessibilityState={{ checked: shownRating === stars, disabled: !!myRating || submitting }}
                                >
                                    <Ionicons name={filled ? 'star' : 'star-outline'} size={38} color={filled ? STAR_COLOR : '#94A3B8'} />
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                    <Text style={styles.ratingCaption} accessibilityLiveRegion="polite">
                        {myRating
                            ? t('busRating.alreadyRated', 'You rated this bus {{stars}}.', { stars: starLabel(myRating.rating) })
                            : description
                              ? `${starLabel(shownRating!)} · ${description}`
                              : t('busRating.choose', 'Tap a star to choose 1 to 5 stars.')}
                    </Text>
                </View>

                {!!submitError && (
                    <View style={styles.errorBox} accessibilityLiveRegion="assertive">
                        <Ionicons name="alert-circle" size={18} color="#B91C1C" />
                        <Text style={styles.errorText}>{submitError}</Text>
                    </View>
                )}

                {myRating ? (
                    <TouchableOpacity style={styles.primaryButtonWide} onPress={goToActivities} accessibilityRole="button">
                        <Text style={styles.primaryButtonText}>{t('busRating.goToActivities', 'GO TO ACTIVITIES')}</Text>
                    </TouchableOpacity>
                ) : (
                    <>
                        <TouchableOpacity
                            style={[styles.primaryButtonWide, (!selected || submitting) && styles.buttonDisabled]}
                            onPress={handleSubmit}
                            disabled={!selected || submitting}
                            accessibilityRole="button"
                            accessibilityLabel={t('busRating.submit', 'Submit Rating')}
                            accessibilityState={{ disabled: !selected || submitting, busy: submitting }}
                        >
                            {submitting ? (
                                <ActivityIndicator color="#FFFFFF" />
                            ) : (
                                <Text style={styles.primaryButtonText}>{t('busRating.submitUpper', 'SUBMIT RATING')}</Text>
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.skipButton}
                            onPress={goToActivities}
                            disabled={submitting}
                            accessibilityRole="button"
                            accessibilityHint={t('busRating.skipHint', 'Goes to Activities without rating this bus')}
                        >
                            <Text style={styles.skipButtonText}>{t('busRating.skip', 'Skip')}</Text>
                        </TouchableOpacity>
                    </>
                )}
            </ScrollView>
        </View>
    );
}

function SectionHeading({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
    return (
        <View style={styles.sectionHeadingRow}>
            <Ionicons name={icon} size={16} color="#0F172A" />
            <Text style={styles.sectionHeadingText} accessibilityRole="header">
                {title}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },
    padded: {
        paddingHorizontal: 20,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 20,
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
        flex: 1,
        fontSize: 22,
        fontWeight: '800',
        color: '#0F172A',
        letterSpacing: -0.5,
    },
    stateContainer: {
        alignItems: 'center',
        paddingTop: 40,
        paddingHorizontal: 16,
    },
    stateTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0F172A',
        textAlign: 'center',
    },
    stateDescription: {
        fontSize: 14,
        color: '#475569',
        textAlign: 'center',
        marginTop: 10,
        marginBottom: 20,
        lineHeight: 20,
    },
    completedPill: {
        flexDirection: 'row',
        alignSelf: 'flex-start',
        alignItems: 'center',
        backgroundColor: '#D1FAE5',
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
        gap: 6,
        marginBottom: 14,
    },
    completedPillText: {
        fontSize: 12,
        fontWeight: '900',
        color: '#065F46',
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 18,
        marginBottom: 14,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 3,
        borderWidth: 1,
        borderColor: '#EEF2F7',
    },
    busRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    busIcon: {
        width: 52,
        height: 52,
        borderRadius: 14,
        backgroundColor: '#0066CC',
        justifyContent: 'center',
        alignItems: 'center',
    },
    busText: {
        flex: 1,
    },
    busTitle: {
        fontSize: 20,
        fontWeight: '900',
        color: '#0F172A',
    },
    busDetails: {
        fontSize: 14,
        fontWeight: '600',
        color: '#475569',
        marginTop: 2,
    },
    busRoute: {
        fontSize: 13,
        fontWeight: '600',
        color: '#64748B',
        marginTop: 4,
    },
    sectionHeadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
        gap: 6,
    },
    sectionHeadingText: {
        fontSize: 13,
        fontWeight: '800',
        color: '#0F172A',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    facilityWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    facilityChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F0FDFA',
        borderWidth: 1,
        borderColor: '#CCFBF1',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    facilityChipText: {
        flexShrink: 1,
        fontSize: 12,
        fontWeight: '600',
        color: '#0F766E',
        marginLeft: 5,
    },
    mutedText: {
        fontSize: 14,
        color: '#64748B',
        lineHeight: 20,
    },
    question: {
        fontSize: 17,
        fontWeight: '800',
        color: '#0F172A',
    },
    questionHint: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 6,
        lineHeight: 18,
    },
    starsRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
        gap: 4,
    },
    starButton: {
        minWidth: 52,
        minHeight: 52,
        justifyContent: 'center',
        alignItems: 'center',
    },
    ratingCaption: {
        fontSize: 14,
        fontWeight: '700',
        color: '#334155',
        textAlign: 'center',
        marginTop: 8,
    },
    errorBox: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        backgroundColor: '#FEF2F2',
        borderWidth: 1,
        borderColor: '#FECACA',
        borderRadius: 12,
        padding: 12,
        marginBottom: 14,
    },
    errorText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: '#B91C1C',
        lineHeight: 20,
    },
    primaryButton: {
        minHeight: 48,
        backgroundColor: '#0066CC',
        paddingHorizontal: 24,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    primaryButtonWide: {
        minHeight: 52,
        backgroundColor: '#0066CC',
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    buttonDisabled: {
        backgroundColor: '#94A3B8',
    },
    primaryButtonText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 14,
    },
    skipButton: {
        minHeight: 48,
        justifyContent: 'center',
        alignItems: 'center',
        alignSelf: 'stretch',
        marginTop: 4,
    },
    skipButtonText: {
        color: '#0066CC',
        fontWeight: '800',
        fontSize: 15,
    },
});
