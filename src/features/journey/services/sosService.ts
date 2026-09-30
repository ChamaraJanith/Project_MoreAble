import * as Location from 'expo-location';
import { useJourneyStore } from '../../../shared/store/journeyStore';
import { createEmergencyRequestApi } from '../../admin/api/emergencyAdminApi';

export const triggerSOSAlert = async () => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Location permission is required for SOS.');
    }

    const location = await Location.getCurrentPositionAsync({});
    
    const { bookingId, vehicleDetails, passengerDetails, caregiverId, driverId } = useJourneyStore.getState();

    const sosData = {
      timestamp: new Date().toISOString(),
      bookingId,
      passenger: passengerDetails,
      vehicle: vehicleDetails,
      location: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      },
      alertRecipients: {
        caregiver: caregiverId,
        driver: driverId,
        admin: 'ADMIN_TOPIC',
      },
      status: 'ACTIVE'
    };

    console.log("SOS Alert Triggered!", sosData);
    
    // Trigger local state update for driver/vehicle dashboard
    useJourneyStore.getState().triggerLocalSOS();

    // Save to Firebase or your backend API here
    try {
      await createEmergencyRequestApi(sosData as any);
    } catch (apiErr) {
      console.warn("Could not save to remote backend, local SOS active:", apiErr);
    }

    return { success: true, message: 'Emergency SOS Sent Successfully!' };
  } catch (error: any) {
    console.error("SOS Trigger Failed: ", error);
    return { success: false, message: error.message || 'Failed to send SOS' };
  }
};
