import { AppText as Text } from '../../../shared/ui/AppText';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
    AdminEmptyState,
    AdminErrorState,
    AdminListSkeleton,
    ConfirmDialog,
} from '../../admin/ui/AdminStates';
import {
    loadFavouriteRoutes,
    removeFavouriteRoute,
    useFavouriteRoutes,
} from '../store/favouriteRoutesStore';
import {
    FavouriteRoute,
    favouriteChangeAnnouncement,
    favouriteRouteJourneyLabel,
    favouriteRoutesCountLabel,
} from '../utils/favouriteRoutes';
import { JOURNEY_PLANNER_PATH, journeyPrefillParams } from '../utils/journeyNavigation';
import { AdminScreenHeader } from '../../admin/ui/AdminScreenHeader';
import { FavouriteRouteCard } from './FavouriteRouteCard';

/**
 * Favourite Routes — the screen where saved journeys are managed (MOV-99).
 *
 * Reached from Profile > Account Options, and from the planner's "View all
 * favourites". The planner shows a short list for speed; this is where the
 * whole collection lives and where one is removed.
 *
 * A favourite is never dropped because no bus currently runs it. The pair is
 * what the passenger saved, and whether anything serves it today is a question
 * for the search they run with it — which answers it with its own "no routes
 * found" state. So every saved pair stays tappable, always.
 */
export function FavouriteRoutesScreen() {
    const { t } = useTranslation();
    const { favourites, status, errorMessage } = useFavouriteRoutes();

    /** The favourite awaiting confirmation, or null when nothing is pending. */
    const [pendingRemoval, setPendingRemoval] = useState<FavouriteRoute | null>(null);
    const [announcement, setAnnouncement] = useState('');

    // Refreshed whenever the screen is returned to, so a journey starred on the
    // results screen is already here. A no-op against the in-memory store; it
    // is where MOV-101's GET goes.
    useFocusEffect(
        useCallback(() => {
            loadFavouriteRoutes();
        }, [])
    );

    const goToPlanner = () => router.navigate(JOURNEY_PLANNER_PATH as any);

    /**
     * Plan a saved journey.
     *
     * `navigate` rather than `push`, so returning to the planner reuses the
     * screen the passenger already has rather than stacking a second copy of it
     * behind this one. Only the pair travels — the date and time stay for them
     * to choose.
     */
    const handleUseFavourite = (favourite: FavouriteRoute) => {
        router.navigate({
            pathname: JOURNEY_PLANNER_PATH,
            params: journeyPrefillParams(favourite.origin, favourite.destination),
        } as any);
    };

    const handleConfirmRemoval = () => {
        if (!pendingRemoval) return;

        removeFavouriteRoute(pendingRemoval.favouriteId);
        setAnnouncement(favouriteChangeAnnouncement(false, pendingRemoval));
        setPendingRemoval(null);
    };

    const renderBody = () => {
        if (status === 'loading') return <AdminListSkeleton count={3} />;

        // Both branches below are unreachable while favourites are held in
        // memory — nothing fetches and nothing fails. They are here so that
        // MOV-101 only has to set the state, not build the screen for it.
        if (status === 'error') {
            return (
                <AdminErrorState
                    title={t('journey.favourites.errorTitle', 'Unable to load favourite routes')}
                    message={
                        errorMessage ??
                        'Your favourite routes could not be loaded. Please check your connection and try again.'
                    }
                    retryLabel={t('journey.tryAgain', 'Try Again')}
                    onRetry={loadFavouriteRoutes}
                />
            );
        }

        if (favourites.length === 0) {
            return (
                <AdminEmptyState
                    icon="star-outline"
                    actionIcon="search"
                    title={t('journey.favourites.emptyTitle', 'No favourite routes yet')}
                    description={t(
                        'journey.favourites.emptyDescription',
                        'Save a route from your journey search results and it will appear here, ready to plan again in one tap.'
                    )}
                    secondaryDescription={t(
                        'journey.favourites.emptyHint',
                        'Search for a journey, then tap Save on the summary at the top of the results.'
                    )}
                    actionLabel={t('journey.favourites.emptyAction', 'Plan a journey')}
                    onAction={goToPlanner}
                />
            );
        }

        return (
            <>
                <Text style={styles.countText}>{favouriteRoutesCountLabel(favourites.length)}</Text>

                {favourites.map((favourite) => (
                    <FavouriteRouteCard
                        key={favourite.favouriteId}
                        favourite={favourite}
                        onPress={() => handleUseFavourite(favourite)}
                        onRemove={() => setPendingRemoval(favourite)}
                    />
                ))}
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader
                tone="brand"
                title={t('journey.favourites.title', 'Favourite Routes')}
                subtitle={t(
                    'journey.favourites.screenSubtitle',
                    'Journeys you have saved for quick planning'
                )}
            />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {/* The project has no toast or snackbar, so a removal is
                    confirmed in place — read out politely, and visible. */}
                {!!announcement && (
                    <Text style={styles.announcement} accessibilityLiveRegion="polite">
                        {announcement}
                    </Text>
                )}

                {renderBody()}
            </ScrollView>

            <ConfirmDialog
                visible={pendingRemoval !== null}
                title={t('journey.favourites.removeTitle', 'Remove favourite route?')}
                message={
                    pendingRemoval
                        ? `${favouriteRouteJourneyLabel(pendingRemoval)} will be removed from your favourite routes. You can save it again at any time.`
                        : ''
                }
                confirmLabel={t('journey.favourites.removeConfirm', 'Remove')}
                destructive
                onCancel={() => setPendingRemoval(null)}
                onConfirm={handleConfirmRemoval}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },
    content: {
        flexGrow: 1,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 32,
    },
    countText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#64748B',
        marginBottom: 12,
    },
    announcement: {
        fontSize: 14,
        fontWeight: '600',
        color: '#059669',
        backgroundColor: '#ECFDF5',
        borderWidth: 1,
        borderColor: '#A7F3D0',
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
        marginBottom: 16,
        lineHeight: 20,
    },
});
