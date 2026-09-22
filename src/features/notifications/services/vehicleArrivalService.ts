/**
 * Vehicle Arrival Alert Engine & Proximity Service (MOV-218 / MOV-219 / MOV-220 / MOV-221)
 *
 * Evaluates real-time bus positions against passenger pickup/boarding stops,
 * dynamically computes ETA and distance, creates persistent in-app notifications,
 * and dispatches high-priority push notifications to passengers awaiting boarding.
 */

import { getAdminDb } from '../../../shared/config/firebaseAdmin';
import { dispatchVehicleArrivalAlert } from '../../../shared/services/pushNotificationDispatcher';
import { Notification } from '../../../entities/notification/model/types';

export const ARRIVAL_DISTANCE_THRESHOLD_METERS = 2000; // 2.0 km (~5 mins at average urban speed)
export const DEFAULT_URBAN_SPEED_KMH = 25; // Standard Sri Lankan urban bus average speed fallback

/**
 * Calculates high-precision great-circle distance between two GPS coordinates in meters.
 */
export function calculateHaversineDistanceMeters(
  loc1: { latitude: number; longitude: number },
  loc2: { latitude: number; longitude: number }
): number {
  if (
    typeof loc1?.latitude !== 'number' ||
    !Number.isFinite(loc1.latitude) ||
    typeof loc1?.longitude !== 'number' ||
    !Number.isFinite(loc1.longitude) ||
    typeof loc2?.latitude !== 'number' ||
    !Number.isFinite(loc2.latitude) ||
    typeof loc2?.longitude !== 'number' ||
    !Number.isFinite(loc2.longitude)
  ) {
    return Infinity;
  }

  const toRad = (value: number) => (value * Math.PI) / 180;
  const R = 6371e3; // Earth radius in meters
  const dLat = toRad(loc2.latitude - loc1.latitude);
  const dLon = toRad(loc2.longitude - loc1.longitude);
  const lat1 = toRad(loc1.latitude);
  const lat2 = toRad(loc2.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Computes dynamic ETA in minutes based on real-time distance and vehicle speed.
 */
export function calculateArrivalEtaMinutes(
  distanceMeters: number,
  currentSpeedKmH?: number
): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return 0;
  }

  // If vehicle is moving at reasonable speed (> 10 km/h), use measured speed with 15% traffic buffer
  const effectiveSpeed =
    typeof currentSpeedKmH === 'number' && currentSpeedKmH >= 10
      ? currentSpeedKmH * 0.85
      : DEFAULT_URBAN_SPEED_KMH;

  const speedMetersPerMinute = (effectiveSpeed * 1000) / 60;
  const etaMinutes = Math.round(distanceMeters / speedMetersPerMinute);

  // Return at least 1 minute unless distance is under 100 meters
  return distanceMeters < 100 ? 0 : Math.max(1, etaMinutes);
}

export interface ArrivalEvaluationResult {
  bookingId: string;
  userId: string;
  vehicleNumber: string;
  routeNumber: string;
  startLocation: string;
  distanceMeters: number;
  etaMinutes: number;
  notified: boolean;
}

/**
 * Evaluates pending bookings for a specific bus and dispatches arrival alerts if within threshold.
 */
export async function processVehicleArrivalAlertsForBus(
  busId: string,
  adminDb = getAdminDb()
): Promise<ArrivalEvaluationResult[]> {
  if (!busId) return [];

  const results: ArrivalEvaluationResult[] = [];
  const nowIso = new Date().toISOString();

  try {
    // 1. Fetch latest vehicle location
    const locDoc = await adminDb.collection('vehicleLocations').doc(busId).get();
    if (!locDoc.exists) return [];

    const vehicleLoc = locDoc.data();
    if (
      !vehicleLoc ||
      typeof vehicleLoc.latitude !== 'number' ||
      typeof vehicleLoc.longitude !== 'number'
    ) {
      return [];
    }

    // 2. Fetch active confirmed bookings for this bus
    const bookingsSnap = await adminDb
      .collection('bookings')
      .where('busId', '==', busId)
      .where('status', '==', 'CONFIRMED')
      .get();

    if (bookingsSnap.empty) return [];

    // In-memory cache for routes to avoid redundant Firestore reads
    const routesCache = new Map<string, any>();
    const busesCache = new Map<string, any>();

    for (const bDoc of bookingsSnap.docs) {
      const booking = bDoc.data();
      const bookingId = booking.bookingId || bDoc.id;

      // Skip already boarded, cancelled, or already alerted bookings
      if (
        booking.boardingStatus === 'BOARDED' ||
        booking.status === 'CANCELLED' ||
        booking.arrivalAlertSent === true
      ) {
        continue;
      }

      const journey = booking.journey || {};
      const routeId = booking.routeId || journey.routeId;
      const startLocation = journey.startLocation || booking.startLocation;
      const userId = booking.userId || booking.passengerId;

      if (!userId || !startLocation) continue;

      // 3. Resolve boarding halt coordinates
      let pickupCoordinate: { latitude: number; longitude: number } | null = null;

      // Check if coordinate is directly present on booking
      if (booking.boardingCoordinate?.latitude && booking.boardingCoordinate?.longitude) {
        pickupCoordinate = booking.boardingCoordinate;
      } else if (routeId) {
        let routeData = routesCache.get(routeId);
        if (routeData === undefined) {
          const routeDoc = await adminDb.collection('routes').doc(routeId).get();
          routeData = routeDoc.exists ? routeDoc.data() : null;
          routesCache.set(routeId, routeData);
        }

        if (routeData?.stops && Array.isArray(routeData.stops)) {
          const stop = routeData.stops.find(
            (s: any) =>
              (s.stopName && s.stopName.toLowerCase() === startLocation.toLowerCase()) ||
              (s.name && s.name.toLowerCase() === startLocation.toLowerCase())
          );
          if (stop?.coordinate?.latitude && stop?.coordinate?.longitude) {
            pickupCoordinate = {
              latitude: stop.coordinate.latitude,
              longitude: stop.coordinate.longitude,
            };
          }
        }
      }

      // If no explicit coordinate found in route, query stops collection directly
      if (!pickupCoordinate) {
        try {
          const stopQuery = await adminDb
            .collection('stops')
            .where('name', '==', startLocation)
            .limit(1)
            .get();
          if (!stopQuery.empty) {
            const sData = stopQuery.docs[0].data();
            if (sData?.coordinate?.latitude && sData?.coordinate?.longitude) {
              pickupCoordinate = sData.coordinate;
            } else if (sData?.latitude && sData?.longitude) {
              pickupCoordinate = { latitude: sData.latitude, longitude: sData.longitude };
            }
          }
        } catch (_) {}
      }

      if (!pickupCoordinate) continue;

      // 4. Calculate Distance
      const distanceMeters = calculateHaversineDistanceMeters(
        { latitude: vehicleLoc.latitude, longitude: vehicleLoc.longitude },
        pickupCoordinate
      );

      // 5. Trigger Arrival Alert if within defined distance threshold
      if (distanceMeters <= ARRIVAL_DISTANCE_THRESHOLD_METERS) {
        // Resolve vehicle plate number
        let vehicleNumber = booking.vehicle?.numberPlate || booking.busRegistrationNumber || 'Bus';
        if (vehicleNumber === 'Bus' && busId) {
          let busData = busesCache.get(busId);
          if (busData === undefined) {
            const bDocRef = await adminDb.collection('buses').doc(busId).get();
            busData = bDocRef.exists ? bDocRef.data() : null;
            busesCache.set(busId, busData);
          }
          vehicleNumber =
            busData?.numberPlate || busData?.registrationNumber || busData?.plateNumber || vehicleNumber;
        }

        const routeNumber = journey.routeNumber || booking.routeNumber || 'Transit';
        const routeName = journey.routeName || booking.routeName || '';
        const etaMinutes = calculateArrivalEtaMinutes(distanceMeters, vehicleLoc.speed);
        const etaDisplay = etaMinutes <= 1 ? 'is arriving now' : `is arriving in ~${etaMinutes} minutes`;

        const notificationId = `notif_arr_${bookingId}`;
        const arrivalNotification: Notification = {
          id: notificationId,
          notificationId,
          userId,
          bookingId,
          type: 'VEHICLE_ARRIVAL',
          title: `Bus Arriving Soon • Route ${routeNumber} 🚍`,
          message: `Bus ${vehicleNumber} for Route ${routeNumber} ${etaDisplay} at ${startLocation}. Please get ready to board!`,
          status: 'UNREAD',
          createdAt: nowIso,
          readAt: null,
          details: {
            bookingId,
            vehicleNumber,
            routeNumber,
            routeName,
            startLocation,
            endLocation: journey.endLocation || booking.endLocation,
            seatNumber: booking.seatNumber || 'Standard',
            journeyDate: booking.journeyDate || journey.departureDate,
            journeyTime: booking.departureTime || journey.departureTime,
            etaMinutes,
            latitude: vehicleLoc.latitude,
            longitude: vehicleLoc.longitude,
          },
        };

        // 6. Save persistent in-app notification in Firestore
        await adminDb.collection('notifications').doc(notificationId).set(arrivalNotification);

        // 7. Update booking idempotency flags
        await adminDb.collection('bookings').doc(bookingId).update({
          arrivalAlertSent: true,
          arrivalAlertSentAt: nowIso,
          arrivalAlertDistanceMeters: Math.round(distanceMeters),
          arrivalAlertEtaMinutes: etaMinutes,
        });

        // 8. Dispatch Push Notification to passenger device
        dispatchVehicleArrivalAlert(userId, {
          vehicleNumber,
          routeNumber,
          routeName,
          arrivalHalt: startLocation,
          etaMinutes,
          bookingId,
        }).catch((pushErr) => {
          console.warn(`[VehicleArrival] Push dispatch warning for user ${userId}:`, pushErr);
        });

        results.push({
          bookingId,
          userId,
          vehicleNumber,
          routeNumber,
          startLocation,
          distanceMeters: Math.round(distanceMeters),
          etaMinutes,
          notified: true,
        });
      }
    }
  } catch (error) {
    console.error(`[VehicleArrival] Error processing arrivals for bus ${busId}:`, error);
  }

  return results;
}

/**
 * Batch processor evaluating all active unboarded bookings against all known active vehicles.
 */
export async function processAllPendingVehicleArrivalAlerts(
  adminDb = getAdminDb()
): Promise<{
  processedBuses: number;
  alertsDispatched: number;
  results: ArrivalEvaluationResult[];
}> {
  const allResults: ArrivalEvaluationResult[] = [];
  const processedBusIds = new Set<string>();

  try {
    const locsSnap = await adminDb.collection('vehicleLocations').get();
    if (!locsSnap.empty) {
      for (const doc of locsSnap.docs) {
        const busId = doc.id;
        if (busId && !processedBusIds.has(busId)) {
          processedBusIds.add(busId);
          const busResults = await processVehicleArrivalAlertsForBus(busId, adminDb);
          allResults.push(...busResults);
        }
      }
    }
  } catch (err) {
    console.error('[VehicleArrival] Batch processor error:', err);
  }

  return {
    processedBuses: processedBusIds.size,
    alertsDispatched: allResults.length,
    results: allResults,
  };
}
