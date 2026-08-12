import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Home</Text>
      <Text style={styles.subtitle}>Welcome to MoreAble Application</Text>

      <TouchableOpacity
        style={styles.planButton}
        onPress={() => router.push('/journey' as any)}
        accessibilityRole="button"
        accessibilityLabel="Plan a Journey"
        accessibilityHint="Double tap to open the journey planner"
      >
        <Ionicons name="navigate-outline" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
        <Text style={styles.planButtonText}>Plan a Journey</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 28,
  },
  planButton: {
    flexDirection: 'row',
    backgroundColor: '#0066CC',
    minHeight: 56,
    borderRadius: 16,
    paddingHorizontal: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  planButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
