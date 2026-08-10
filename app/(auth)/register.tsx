import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import { RegistrationForm } from '../../src/features/auth/ui/RegistrationForm';

export default function RegisterScreen() {
    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />

            {/* Render UI */}
            <RegistrationForm />

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#f9f9f9',
    },
});