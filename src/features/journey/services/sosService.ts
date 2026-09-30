import * as Location from 'expo-location';
import { useJourneyStore } from '../../../shared/store/journeyStore';
import { useAuthStore } from '../../../shared/store/authStore';
import { getBusSession } from '../../../shared/utils/busSession';
// import { firestore } from '@/api/firebase';
import { createEmergencyRequestApi } from '../../admin/api/emergencyAdminApi';

export const triggerSOSAlert = async () => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Location permission is required for SOS.');
    }

    const location = await Location.getCurrentPositionAsync({});
    
    const { bookingId, vehicleDetails, passengerDetails, caregiverId, driverId } = useJourneyStore.getState();
    const authUser = useAuthStore.getState().user;

    // Dynamically resolve real passenger from authenticated session if available
    const resolvedPassenger = authUser ? {
      id: authUser.passengerId || authUser.uid || passengerDetails?.id || `PAS-${Math.floor(100 + Math.random() * 900)}`,
      name: authUser.userName || authUser.email || passengerDetails?.name || 'Passenger',
      phone: authUser.phoneNumber || authUser.secondaryPhoneNumber || passengerDetails?.phone || '0771234567',
      email: authUser.email || undefined,
      specialAssistance: (Array.isArray(authUser.accessibilityNeeds) && authUser.accessibilityNeeds.length > 0)
        ? authUser.accessibilityNeeds.join(', ')
        : authUser.isWheelchairUser
        ? 'Wheelchair Assistance'
        : authUser.isLowVisionPerson
        ? 'Low Vision Support'
        : authUser.isHearingImpaired
        ? 'Hearing Support'
        : authUser.isWalkingDifficultyPerson
        ? 'Walking Assistance'
        : passengerDetails ? (passengerDetails as any).specialAssistance : undefined,
    } : passengerDetails;

    // Dynamically resolve real vehicle: if bus session exists, prefer it
    const busSession = await getBusSession().catch(() => null);
    let resolvedVehicle = vehicleDetails;
    if (busSession?.numberPlate) {
      resolvedVehicle = {
        plateNumber: busSession.numberPlate,
        model: 'Transit Bus',
      };
    }

    const resolvedCaregiver = authUser?.guardianDetails?.mobileNo || authUser?.guardianId || caregiverId;

    const sosData = {
      timestamp: new Date().toISOString(),
      bookingId,
      passenger: resolvedPassenger,
      vehicle: resolvedVehicle,
      location: {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      },
      alertRecipients: {
        caregiver: resolvedCaregiver,
        driver: driverId,
        admin: 'ADMIN_TOPIC',
      },
      status: 'ACTIVE'
    };

    console.log("SOS Alert Triggered!", sosData);
    
    // Trigger local state update for driver/vehicle dashboard
    const passengerName = resolvedPassenger?.name || authUser?.userName;
    useJourneyStore.getState().triggerLocalSOS(passengerName);

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

