//device Login page 
import React from 'react';
import { StatusBar, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BusDeviceLoginForm } from '../../src/features/auth/ui/BusDeviceLoginForm';

export default function DeviceLoginScreen() {
    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />

            {/* Render Bus Device Login UI */}
            <BusDeviceLoginForm />

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F4F7FB',
    },
});
