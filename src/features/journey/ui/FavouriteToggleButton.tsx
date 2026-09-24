import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import {
    FavouriteRouteInput,
    favouriteToggleHint,
    favouriteToggleLabel,
    favouriteToggleText,
} from '../utils/favouriteRoutes';

interface FavouriteToggleButtonProps {
    journey: FavouriteRouteInput;
    isSaved: boolean;
    onToggle: () => void;
    disabled?: boolean;
}

/**
 * Save / remove a journey pair, as one control (MOV-99).
 *
 * Sits on the search summary — the one place in the app that shows an origin
 * and a destination WITHOUT a departure attached — and never on a
 * `JourneyOptionCard`, which is a specific trip on a specific bus with its own
 * Book and View details actions. A star there would promise to save that
 * departure, which is precisely what a favourite is not.
 *
 * The state is carried three ways over, so none of them has to be relied on
 * alone:
 *   - the word beside the icon changes, Save -> Saved;
 *   - the star fills, which is a shape change rather than a colour change;
 *   - `accessibilityState.selected` and a label that names the action and the
 *     journey in full.
 *
 * `disabled` is for a screen that has no complete journey to save — a results
 * screen opened with incomplete search details — and never for a "saving now"
 * spinner: the toggle is synchronous today, and when MOV-101 makes it a request
 * the busy state belongs to that story alongside its failure handling.
 */
export function FavouriteToggleButton({
    journey,
    isSaved,
    onToggle,
    disabled = false,
}: FavouriteToggleButtonProps) {
    const { t } = useTranslation();

    return (
        <TouchableOpacity
            style={[
                styles.button,
                isSaved && styles.buttonSaved,
                disabled && styles.buttonDisabled,
            ]}
            onPress={onToggle}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: isSaved, disabled }}
            accessibilityLabel={favouriteToggleLabel(isSaved, journey)}
            accessibilityHint={disabled ? undefined : favouriteToggleHint(isSaved)}
        >
            <Ionicons
                name={isSaved ? 'star' : 'star-outline'}
                size={18}
                color={isSaved ? '#FFFFFF' : '#0066CC'}
                style={styles.icon}
            />
            <Text style={[styles.label, isSaved && styles.labelSaved]} numberOfLines={1}>
                {t(
                    isSaved ? 'journey.favourites.saved' : 'journey.favourites.save',
                    favouriteToggleText(isSaved)
                )}
            </Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        // The journey feature's own minimum touch target, as used by the
        // planner's back and swap controls.
        minHeight: 44,
        paddingHorizontal: 12,
        borderRadius: 22,
        backgroundColor: '#EBF3FA',
        borderWidth: 1,
        borderColor: '#CCE3F8',
        marginLeft: 10,
    },
    buttonSaved: {
        backgroundColor: '#0066CC',
        borderColor: '#0066CC',
    },
    buttonDisabled: {
        opacity: 0.5,
    },
    icon: {
        marginRight: 6,
    },
    label: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0066CC',
    },
    labelSaved: {
        color: '#FFFFFF',
    },
});
