import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { AddTripForm } from '../../../src/features/admin/ui/AddTripForm';

export default function AddTripScreen() {
    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" />

            {/* Render Add Trip UI */}
            <AddTripForm />

        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F4F7FB',
    },
});
