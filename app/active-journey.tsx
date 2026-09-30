import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SOSButton } from '../src/features/journey/components/SOSButton';
import { useJourneyStore } from '../src/shared/store/journeyStore';
import { BusSession, getBusSession } from '../src/shared/utils/busSession';

export default function ActiveJourneyScreen() {
  const { isJourneyStarted } = useJourneyStore();
  const [session, setSession] = useState<BusSession | null>(null);

  useEffect(() => {
    getBusSession().then(setSession);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Active Journey</Text>

      <View style={styles.content}>
        {isJourneyStarted ? (
          <>
            <Text style={styles.startedLabel}>Your journey has been started</Text>
          </>
        ) : (
          <Text style={{ color: '#666' }}>Waiting for journey to start...</Text>
        )}
      </View>

      {/* SOS Button integrated here, only visible if journey started */}
      {isJourneyStarted && (
        <View style={styles.sosContainer}>
          <SOSButton />
        </View>
      )}
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
  startedLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#047857',
    marginBottom: 10,
  },
  sosContainer: {
    paddingBottom: 40, // Keeps it above bottom tabs if any
  },
});
