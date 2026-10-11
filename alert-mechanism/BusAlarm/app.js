import { Audio } from 'expo-av';
import { useEffect, useRef, useState } from 'react';
import { Button, StyleSheet, Text, Vibration, View } from 'react-native';

export default function App() {
  const [sound, setSound] = useState();
  const vibrationInterval = useRef(null);

  const startAlarm = async () => {
    try {
      // 1. Play the audio file continuously
      const { sound } = await Audio.Sound.createAsync(
        require('../BusAlarm/assets/images/ringtone.mp3')
      );
      setSound(sound);

      await sound.setIsLoopingAsync(true);
      await sound.playAsync();

      // 2. Start aggressive vibration pattern (Works well in Standalone APK)
      // 0ms delay -> Vibrate for 2000ms -> Pause for ONLY 100ms -> Repeat
      const aggressivePattern = [0, 2000, 100];
      Vibration.vibrate(aggressivePattern, true);

    } catch (error) {
      console.log("Error playing audio:", error);
    }
  };

  const stopAlarm = async () => {
    // Stop the sound
    if (sound) {
      await sound.stopAsync();
      await sound.unloadAsync();
      setSound(undefined);
    }

    Vibration.cancel();
  };

  // Cleanup resources when the app is closed
  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
      Vibration.cancel();
    };
  }, [sound]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bus Stop Alarm</Text>

      <View style={styles.buttonContainer}>
        <Button title="Test Alarm" onPress={startAlarm} color="green" />
      </View>

      <View style={styles.buttonContainer}>
        <Button title="Stop Alarm" onPress={stopAlarm} color="red" />
      </View>
    </View>
  );
}
//this is for the hardware testing only `
const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    marginBottom: 30,
    fontWeight: 'bold',
  },
  buttonContainer: {
    margin: 10,
    width: '80%',
  }
});