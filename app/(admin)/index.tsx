import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function AdminDashboard() {
    const handleLogout = () => {
        router.replace('/(auth)');
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Admin Dashboard</Text>
                <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
                    <Ionicons name="log-out-outline" size={24} color="#D32F2F" />
                    <Text style={styles.logoutText}>Logout</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.content}>
                <Text style={styles.welcomeText}>Welcome, Admin!</Text>
                <Text style={styles.subtitle}>You are successfully logged in as the hardcoded admin.</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F4F7FB',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#FFFFFF',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
        paddingTop: 50, // for status bar roughly
    },
    title: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#1A2530',
    },
    logoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    logoutText: {
        color: '#D32F2F',
        marginLeft: 4,
        fontWeight: '600',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    welcomeText: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#1A2530',
        marginBottom: 10,
    },
    subtitle: {
        fontSize: 16,
        color: '#5A6E7F',
        textAlign: 'center',
    },
});
