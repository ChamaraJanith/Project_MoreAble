import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { BusCommunityFeedbackScreen } from '../../../src/features/reports/ui/BusCommunityFeedbackScreen';

// Journey > Results > Route Details > View community feedback (MOV-80).
// A frame of the journey stack, so Back returns to Route Details.
export default function JourneyCommunityFeedbackScreen() {
    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />

            {/* Passenger ratings and verified reports for the selected bus */}
            <BusCommunityFeedbackScreen />

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },
});
