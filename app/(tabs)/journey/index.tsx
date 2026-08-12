import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { JourneyPlannerForm } from '../../../src/features/journey/ui/JourneyPlannerForm';

export default function JourneyPlannerScreen() {
    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />

            {/* Render Journey Planner UI */}
            <JourneyPlannerForm />

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },
});
