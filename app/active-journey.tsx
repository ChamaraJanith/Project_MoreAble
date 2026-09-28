import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SOSButton } from '../src/features/journey/components/SOSButton';

export default function ActiveJourneyScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Active Journey</Text>
      
      <View style={styles.content}>
        <Text>You are currently on a trip.</Text>
        <Text>Driver: DRV-112</Text>
        <Text>Vehicle: WP-CBA-1234</Text>
      </View>

      {/* SOS Button integrated here */}
      <View style={styles.sosContainer}>
        <SOSButton />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sosContainer: {
    paddingBottom: 40, // Keeps it above bottom tabs if any
  },
});
