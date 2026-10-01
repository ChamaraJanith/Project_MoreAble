import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Button, ActivityIndicator } from 'react-native-paper';
import { triggerSOSAlert } from '../services/sosService';
import { sosButtonStateFor, sosButtonStateForError } from '../utils/sosButtonState';

export const SOSButton = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isSOSActivated, setIsSOSActivated] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSOSPress = () => {
    setShowConfirm(true);
  };

  const executeSOS = async () => {
    setShowConfirm(false);
    setIsLoading(true);
    setErrorMessage('');
    try {
      const result = await triggerSOSAlert();
      setIsLoading(false);

      // Activated only when the server recorded the SOS.
      const state = sosButtonStateFor(result);
      setIsSOSActivated(state.activated);
      setErrorMessage(state.errorMessage);
    } catch (e: unknown) {
      setIsLoading(false);
      const state = sosButtonStateForError(e);
      setIsSOSActivated(state.activated);
      setErrorMessage(state.errorMessage);
    }
  };

  return (
    <View style={styles.container}>
      {isLoading ? (
        <ActivityIndicator animating={true} color="red" size="large" />
      ) : showConfirm ? (
        <View style={styles.confirmContainer}>
          <Button 
            mode="contained" 
            buttonColor="#8b0000"
            style={styles.confirmButton}
            onPress={executeSOS}
          >
            CONFIRM SOS
          </Button>
          <Button 
            mode="text" 
            textColor="#555"
            onPress={() => setShowConfirm(false)}
          >
            Cancel
          </Button>
        </View>
      ) : isSOSActivated ? (
        <Button 
          mode="contained" 
          buttonColor="#8b0000"
          icon="alert-octagon"
          style={styles.activatedButton}
          labelStyle={styles.text}
          onPress={() => {}}
        >
          SOS ACTIVATED
        </Button>
      ) : (
        <Button 
          mode="contained" 
          buttonColor="#ff3333"
          icon="alert-decagram"
          style={styles.button}
          labelStyle={styles.text}
          onPress={handleSOSPress}
        >
          SOS EMERGENCY
        </Button>
      )}
      {!!errorMessage && (
        <View style={{marginTop: 10}} accessibilityRole="alert" accessibilityLiveRegion="assertive">
           <Button textColor="red" onPress={() => setErrorMessage('')}>{errorMessage}</Button>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 15,
    alignItems: 'center',
  },
  button: {
    width: 250,
    borderRadius: 30,
    elevation: 5,
    shadowColor: '#ff0000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  activatedButton: {
    width: 250,
    borderRadius: 30,
    elevation: 5,
    shadowColor: '#8b0000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    borderWidth: 2,
    borderColor: '#ff9999',
  },
  text: {
    fontSize: 18,
    fontWeight: 'bold',
    paddingVertical: 5,
  },
  confirmContainer: {
    alignItems: 'center',
    gap: 10,
  },
  confirmButton: {
    width: 250,
    borderRadius: 30,
    paddingVertical: 5,
  }
});
