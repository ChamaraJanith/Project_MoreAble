import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { RouteDetailsScreen } from '../../../src/features/journey/ui/RouteDetailsScreen';

export default function JourneyRouteDetailsScreen() {
    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />

            {/* Render Route Details UI for the selected recommended route */}
            <RouteDetailsScreen />

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },
});
