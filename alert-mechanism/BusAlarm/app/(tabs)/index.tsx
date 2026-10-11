import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline } from '@/components/CustomMapView';

// ------------------------------------------------------------------
// GLOBAL CONFIGURATIONS & BACKGROUND TASKS
// ------------------------------------------------------------------
const BACKGROUND_LOCATION_TASK = 'background-location-task';
let globalSound: Audio.Sound | null = null; // Global variable to hold sound in background

interface BusStop {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
}

// Helper function to calculate distance in meters
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371e3;
  const toRadians = (degree: number) => degree * (Math.PI / 180);
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Global function to play alarm (accessible by background task)
const playGlobalAlarm = async () => {
  try {
    const isRinging = await AsyncStorage.getItem('isRinging');
    if (isRinging === 'true') return; // Prevent multiple audio instances

    await AsyncStorage.setItem('isRinging', 'true');

    // Trigger haptic vibration feedback
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Configure audio to play even when the phone is on silent or in background
    await Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
    });

    const { sound } = await Audio.Sound.createAsync(
      require('../../assets/images/ringtone.mp3')
    );
    globalSound = sound;
    await sound.setIsLoopingAsync(true);
    await sound.playAsync();
  } catch (error) {
    console.log("Error playing global audio:", error);
  }
};

// Define the background task (Must be outside the React component)
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error("Background task error:", error);
    return;
  }
  if (data) {
    const { locations } = data as any;
    const currentLocation = locations[0].coords;

    try {
      // Read target location and distance from storage
      const targetStr = await AsyncStorage.getItem('targetLocation');
      const distStr = await AsyncStorage.getItem('triggerDistance');
      const isRinging = await AsyncStorage.getItem('isRinging');

      if (targetStr && distStr && isRinging !== 'true') {
        const target = JSON.parse(targetStr);
        const triggerDistance = parseInt(distStr, 10);

        const distance = calculateDistance(
          currentLocation.latitude,
          currentLocation.longitude,
          target.latitude,
          target.longitude
        );

        console.log(`[Background] Distance to get-off stop: ${Math.round(distance)}m`);

        // If within trigger distance, ring alarm!
        if (distance <= triggerDistance) {
          playGlobalAlarm();
        }
      }
    } catch (err) {
      console.log("Error reading storage in background", err);
    }
  }
});

// ------------------------------------------------------------------
// MAIN APP COMPONENT
// ------------------------------------------------------------------
export default function App() {
  const [initialRegion, setInitialRegion] = useState<any>(null);
  const [stops, setStops] = useState<BusStop[]>([]);
  const [getOffStopId, setGetOffStopId] = useState<string | null>(null);
  const [currentDistance, setCurrentDistance] = useState<number | null>(null);
  const [isTracking, setIsTracking] = useState<boolean>(false);

  // Alarm Trigger Distance (Default: 500m)
  const [triggerDistance, setTriggerDistance] = useState<number>(500);

  const mapRef = useRef<any>(null);
  const locationSubscription = useRef<any>(null);

  // 1. On App Start: Get Current Location and set map region
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permission Denied", "Need location access to show you on the map.");
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      const region = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };

      setInitialRegion(region);

      if (mapRef.current) {
        mapRef.current.animateToRegion(region, 1000);
      }

      await AsyncStorage.setItem('isRinging', 'false');
    })();
  }, []);

  // Update AsyncStorage whenever triggerDistance changes
  useEffect(() => {
    AsyncStorage.setItem('triggerDistance', triggerDistance.toString());
  }, [triggerDistance]);

  // Update targetLocation in AsyncStorage whenever getOffStop changes
  useEffect(() => {
    const getOffStop = stops.find((s) => s.id === getOffStopId);
    if (getOffStop) {
      AsyncStorage.setItem(
        'targetLocation',
        JSON.stringify({ latitude: getOffStop.latitude, longitude: getOffStop.longitude, name: getOffStop.name })
      );
    }
  }, [getOffStopId, stops]);

  const handleMapPress = async (event: any) => {
    if (isTracking) {
      Alert.alert("Tracking Active", "Please stop tracking before modifying your bus stops.");
      return;
    }

    const coordinate = event.nativeEvent.coordinate;

    // Check if user tapped near an existing bus stop to select it as destination
    const existingStop = stops.find((s) => {
      const d = calculateDistance(s.latitude, s.longitude, coordinate.latitude, coordinate.longitude);
      return d <= 250; // Within 250m of an existing stop
    });

    if (existingStop) {
      setGetOffStopId(existingStop.id);
    } else {
      // Add a new Bus Stop along the route
      const newStopId = Date.now().toString();
      const newStop: BusStop = {
        id: newStopId,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        name: `Bus Stop ${stops.length + 1}`,
      };

      const updatedStops = [...stops, newStop];
      setStops(updatedStops);

      // Automatically default the get-off destination to the latest added bus stop
      setGetOffStopId(newStopId);
    }
  };

  const removeStop = (id: string) => {
    if (isTracking) {
      Alert.alert("Tracking Active", "Stop tracking to edit stops.");
      return;
    }
    const filtered = stops.filter((s) => s.id !== id);
    const renumbered = filtered.map((s, idx) => ({
      ...s,
      name: s.name.startsWith('Bus Stop ') ? `Bus Stop ${idx + 1}` : s.name,
    }));
    setStops(renumbered);

    if (getOffStopId === id || !renumbered.some((s) => s.id === getOffStopId)) {
      setGetOffStopId(renumbered.length > 0 ? renumbered[renumbered.length - 1].id : null);
    }
  };

  const clearAllStops = () => {
    if (isTracking) {
      Alert.alert("Tracking Active", "Stop tracking to clear stops.");
      return;
    }
    setStops([]);
    setGetOffStopId(null);
  };

  const stopAlarm = async () => {
    await AsyncStorage.setItem('isRinging', 'false');
    if (globalSound) {
      await globalSound.stopAsync();
      await globalSound.unloadAsync();
      globalSound = null;
    }
  };

  const startTrackingLocation = async () => {
    if (stops.length === 0) {
      Alert.alert("No Bus Stops", "Tap on the map to add your bus stops first!");
      return;
    }

    const targetStop = stops.find((s) => s.id === getOffStopId);
    if (!targetStop) {
      Alert.alert("No Destination Stop", "Please select your target get-off bus stop!");
      return;
    }

    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      Alert.alert("Error", "Foreground location permission is required.");
      return;
    }

    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus !== 'granted') {
      Alert.alert(
        "Background Permission",
        "Without 'Allow all the time' location permission, the alarm won't ring if the app is closed.",
        [{ text: "OK" }]
      );
    }

    setIsTracking(true);

    // Start Foreground Location Watcher
    locationSubscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 3000,
        distanceInterval: 5,
      },
      (location) => {
        const { latitude, longitude } = location.coords;
        const dist = calculateDistance(
          latitude,
          longitude,
          targetStop.latitude,
          targetStop.longitude
        );
        setCurrentDistance(Math.round(dist));

        if (dist <= triggerDistance) {
          playGlobalAlarm();
        }
      }
    );

    // Start Background Location Updates
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 10000,
      distanceInterval: 20,
      deferredUpdatesInterval: 10000,
      showsBackgroundLocationIndicator: true,
    });
  };

  const stopTrackingLocation = async () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }

    const hasTask = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
    if (hasTask) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }

    setIsTracking(false);
    setCurrentDistance(null);
    stopAlarm();
  };

  const getOffStop = stops.find((s) => s.id === getOffStopId);

  return (
    <View style={styles.container}>
      {/* Map Section */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={true}
        showsMyLocationButton={true}
        onPress={handleMapPress}
      >
        {/* Draw Bus Route Polyline */}
        {stops.length > 1 && (
          <Polyline
            coordinates={stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))}
            strokeColor="#2563eb"
            strokeWidth={4}
            lineDashPattern={[2, 2]}
          />
        )}

        {/* Display Bus Stop Markers */}
        {stops.map((stop, idx) => {
          const isTarget = stop.id === getOffStopId;
          return (
            <Marker
              key={stop.id}
              coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
              title={isTarget ? `🚨 ${stop.name} (Get-Off)` : stop.name}
              description={isTarget ? "Target Get-Off Bus Stop (Alarm location)" : `Bus Stop #${idx + 1}`}
              pinColor={isTarget ? "red" : "blue"}
              onPress={() => !isTracking && setGetOffStopId(stop.id)}
            />
          );
        })}
      </MapView>

      {/* Control Panel Section */}
      <View style={styles.controls}>
        <View style={styles.headerRow}>
          <Text style={styles.stepTitle}>🚌 Bus Route Stops</Text>
          {stops.length > 0 && !isTracking && (
            <TouchableOpacity onPress={clearAllStops} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>Clear Route</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.instructionText}>
          Tap map to add bus stops. Tap any bus stop below to set where you get off.
        </Text>

        {/* Alarm Radius Selector */}
        <Text style={styles.subTitle}>Alarm Trigger Radius:</Text>
        <View style={styles.distanceSelector}>
          {[500, 1000, 2000].map((dist) => (
            <TouchableOpacity
              key={dist}
              style={[styles.distButton, triggerDistance === dist && styles.distButtonActive]}
              onPress={() => setTriggerDistance(dist)}
              disabled={isTracking}
            >
              <Text style={[styles.distText, triggerDistance === dist && styles.distTextActive]}>
                {dist >= 1000 ? `${dist / 1000} km` : `${dist} m`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Live Tracking Distance Display */}
        {currentDistance !== null && getOffStop && (
          <View style={styles.distanceBadge}>
            <Text style={styles.distanceStatusText}>
              Distance to {getOffStop.name}:
            </Text>
            <Text style={styles.distanceValueText}>{currentDistance} meters</Text>
          </View>
        )}

        {/* Bus Stops List */}
        <Text style={styles.sectionLabel}>
          Route Bus Stops ({stops.length}):
        </Text>

        <ScrollView style={styles.stopList} nestedScrollEnabled={true}>
          {stops.length === 0 ? (
            <Text style={styles.emptyText}>Tap on the map above to add bus stops along your route.</Text>
          ) : (
            stops.map((stop, index) => {
              const isSelected = stop.id === getOffStopId;
              return (
                <TouchableOpacity
                  key={stop.id}
                  style={[styles.stopCard, isSelected && styles.stopCardTarget]}
                  onPress={() => !isTracking && setGetOffStopId(stop.id)}
                >
                  <View style={styles.stopInfo}>
                    <Text style={[styles.stopBadge, isSelected && styles.stopBadgeTarget]}>
                      {index + 1}
                    </Text>
                    <View style={styles.stopTextContainer}>
                      <Text style={styles.stopTitle}>{stop.name}</Text>
                      {isSelected ? (
                        <Text style={styles.getOffLabel}>🚨 Selected Get-Off Bus Stop (Bahinna Thana)</Text>
                      ) : (
                        <Text style={styles.intermediateLabel}>Tap to select as get-off stop</Text>
                      )}
                    </View>
                  </View>

                  {!isTracking && (
                    <TouchableOpacity onPress={() => removeStop(stop.id)} style={styles.deleteBtn}>
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>

        {/* Action Buttons */}
        <View style={styles.buttonRow}>
          {!isTracking ? (
            <TouchableOpacity
              style={[styles.actionBtn, styles.startBtn]}
              onPress={startTrackingLocation}
            >
              <Text style={styles.actionBtnText}>Start Tracking</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, styles.stopBtn]}
              onPress={stopTrackingLocation}
            >
              <Text style={styles.actionBtnText}>Stop Tracking</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.actionBtn, styles.alarmOffBtn]}
            onPress={stopAlarm}
          >
            <Text style={styles.actionBtnText}>Stop Alarm</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.42,
  },
  controls: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: -12,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#2563eb',
  },
  tabText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#475569',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  instructionText: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 8,
  },
  clearBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: '#fee2e2',
    borderRadius: 6,
  },
  clearBtnText: {
    color: '#dc2626',
    fontSize: 12,
    fontWeight: 'bold',
  },
  subTitle: {
    fontSize: 13,
    color: '#6c757d',
    marginTop: 4,
    marginBottom: 4,
  },
  distanceSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 10,
  },
  distButton: {
    flex: 1,
    marginHorizontal: 3,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2563eb',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  distButtonActive: {
    backgroundColor: '#2563eb',
  },
  distText: {
    color: '#2563eb',
    fontWeight: 'bold',
    fontSize: 13,
  },
  distTextActive: {
    color: '#fff',
  },
  distanceBadge: {
    backgroundColor: '#e0f2fe',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  distanceStatusText: {
    fontSize: 12,
    color: '#0369a1',
  },
  distanceValueText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0284c7',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 4,
  },
  stopList: {
    maxHeight: 120,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 15,
  },
  stopCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  stopCardTarget: {
    borderColor: '#ef4444',
    backgroundColor: '#fef2f2',
  },
  stopInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  stopBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: 'bold',
    fontSize: 12,
    marginRight: 10,
  },
  stopBadgeTarget: {
    backgroundColor: '#ef4444',
  },
  stopTextContainer: {
    flex: 1,
  },
  stopTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1e293b',
  },
  getOffLabel: {
    fontSize: 11,
    color: '#dc2626',
    fontWeight: 'bold',
  },
  intermediateLabel: {
    fontSize: 11,
    color: '#64748b',
  },
  deleteBtn: {
    padding: 6,
    marginLeft: 6,
  },
  deleteBtnText: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: 'bold',
  },
  nextStepBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 'auto',
  },
  nextStepBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 'auto',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 3,
  },
  startBtn: {
    backgroundColor: '#2563eb',
  },
  stopBtn: {
    backgroundColor: '#64748b',
  },
  alarmOffBtn: {
    backgroundColor: '#dc2626',
  },
  actionBtnText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
});