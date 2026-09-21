import { Alert, Platform } from 'react-native';
import { END_JOURNEY_DIALOG } from '../utils/completedJourney';

/**
 * Asks the passenger to confirm End Journey (MOV-297). Resolves true only on
 * an explicit "End Journey".
 *
 * The same confirmation the Booking tab uses before cancelling a reservation:
 * the platform's own dialog, which screen readers announce and focus as a
 * dialog, and a browser confirm on web. Dismissing it counts as Cancel.
 */
export function confirmEndJourney(): Promise<boolean> {
    if (Platform.OS === 'web') {
        return Promise.resolve(window.confirm(`${END_JOURNEY_DIALOG.title}\n\n${END_JOURNEY_DIALOG.message}`));
    }

    return new Promise((resolve) => {
        Alert.alert(
            END_JOURNEY_DIALOG.title,
            END_JOURNEY_DIALOG.message,
            [
                { text: END_JOURNEY_DIALOG.cancel, style: 'cancel', onPress: () => resolve(false) },
                { text: END_JOURNEY_DIALOG.confirm, style: 'destructive', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) }
        );
    });
}
