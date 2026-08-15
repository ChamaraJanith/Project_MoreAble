import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { JourneySearchResults } from '../../../src/features/journey/ui/JourneySearchResults';

export default function JourneyResultsScreen() {
    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />

            {/* Render Journey Search Results UI */}
            <JourneySearchResults />

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },
});
