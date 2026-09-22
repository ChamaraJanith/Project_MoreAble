/**
 * Zero-Login Live Caregiver Journey Tracking API (MOV-227 / MOV-230)
 *
 * GET: Public live tracking endpoint used by caregivers when clicking the secure SMS/Email link.
 * Reads live bus GPS from `vehicleLocations/{busId}`, journey status, and route timeline.
 */

import { CaregiverLiveTrackingData } from '../../../src/entities/caregiver/model/types';
import { getRouteThroughCoordinates } from '../../../src/shared/api/routingService';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';
import { sliceJourneyStops } from '../../../src/shared/server/ongoingJourneyRoute';
import { isJourneyActive } from '../../../src/shared/utils/journeyLifecycle';
import { normalizeLocation } from '../../../src/shared/utils/location';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
      return Response.json(
        { success: false, message: 'Secure tracking token is required.' },
        { status: 400, headers: corsHeaders }
      );
    }

    const adminDb = getAdminDb();

    // 1. Search booking by trackingToken or bookingId
    let bookingDoc: any = null;
    let bookingData: any = null;

    const tokenSnap = await adminDb
      .collection('bookings')
      .where('trackingToken', '==', token)
      .limit(1)
      .get();

    if (!tokenSnap.empty) {
      bookingDoc = tokenSnap.docs[0];
      bookingData = bookingDoc.data();
    } else {
      // Fallback: Check if token directly equals bookingId
      const directDoc = await adminDb.collection('bookings').doc(token).get();
      if (directDoc.exists) {
        bookingDoc = directDoc;
        bookingData = directDoc.data();
      }
    }

    if (!bookingData) {
      return Response.json(
        { success: false, message: 'Invalid or expired tracking link.' },
        { status: 404, headers: corsHeaders }
      );
    }

    const passengerId = bookingData.passengerId || bookingData.userId;
    let tripId = bookingData.tripId || bookingData.journey?.tripId;
    let busId = bookingData.busId || bookingData.journey?.busId;
    let routeId = bookingData.routeId || bookingData.journey?.routeId;

    // 2. Fetch Trip Details
    let tripData: any = null;
    if (tripId) {
      try {
        const tripDoc = await adminDb.collection('trips').doc(tripId).get();
        if (tripDoc.exists) {
          tripData = tripDoc.data() || {};
          busId = tripData.busId || tripData.journey?.busId || busId;
          routeId = tripData.routeId || routeId;
        }
      } catch (err) {
        console.error('Trip fetch error:', err);
      }
    }

    // 3. Fetch Passenger Details & Accessibility
    let passengerName = bookingData.passengerName || 'Passenger';
    let accessibilityNeeds: string[] = [];
    let hasAccessibilityNeeds = false;

    if (passengerId && passengerId !== 'GUEST') {
      try {
        let userDoc = await adminDb.collection('users').doc(passengerId).get();
        if (!userDoc.exists) {
          const uSnap = await adminDb.collection('users').where('passengerId', '==', passengerId).limit(1).get();
          if (!uSnap.empty) userDoc = uSnap.docs[0];
        }
        if (userDoc && userDoc.exists) {
          const u = userDoc.data() || {};
          passengerName = u.userName || u.fullName || u.name || passengerName;
          hasAccessibilityNeeds = Boolean(u.hasAccessibilityNeeds);
          if (u.isWheelchairUser) accessibilityNeeds.push('Wheelchair Access');
          if (u.isLowVisionPerson) accessibilityNeeds.push('Low Vision Guidance');
          if (u.isHearingImpaired) accessibilityNeeds.push('Hearing Support');
          if (u.isElderPerson) accessibilityNeeds.push('Priority Elder Seating');
        }
      } catch (err) {
        console.error('User fetch error:', err);
      }
    }

    // 4. Fetch Route Details
    let routeNumber = bookingData.journey?.routeNumber || 'Route';
    let routeName = bookingData.journey?.routeName || '';
    let routeStops: string[] = [];
    let segmentDurations: number[] = [];

    if (routeId) {
      try {
        const routeDoc = await adminDb.collection('routes').doc(routeId).get();
        if (routeDoc.exists) {
          const r = routeDoc.data() || {};
          routeNumber = r.routeNumber || routeNumber;
          routeName = r.name || r.routeName || (r.origin && r.destination ? `${r.origin} - ${r.destination}` : routeName);
          if (Array.isArray(r.stops)) {
            routeStops = r.stops.filter((s: any) => typeof s === 'string' && s.trim());
          }
          if (Array.isArray(r.segmentDurationsMinutes)) {
            segmentDurations = r.segmentDurationsMinutes;
          }
        }
      } catch (err) {
        console.error('Route fetch error:', err);
      }
    }

    if (!routeName && bookingData.journey?.startLocation && bookingData.journey?.endLocation) {
      routeName = `${bookingData.journey.startLocation} - ${bookingData.journey.endLocation}`;
    }

    // 5. Fetch Bus & Driver Details
    let busRegNumber = bookingData.vehicle?.busRegistrationNumber || bookingData.busRegistrationNumber || busId || 'Bus';
    let busModel = bookingData.vehicle?.model || '';
    let driverName = tripData?.driverName || '';
    let driverPhone = tripData?.driverPhone || '';

    if (busId) {
      try {
        const busDoc = await adminDb.collection('buses').doc(busId).get();
        if (busDoc.exists) {
          const b = busDoc.data() || {};
          busRegNumber = b.numberPlate || b.registrationNumber || b.plateNumber || b.busNumber || busRegNumber;
          busModel = b.busModel || b.model || b.manufacturer || busModel;
          driverName = b.driverName || b.driver?.name || driverName;
          driverPhone = b.driverPhone || b.driver?.phone || driverPhone;
        }
      } catch (err) {
        console.error('Bus fetch error:', err);
      }
    }

    // 6. Fetch Real-time Vehicle Location
    let currentLocation: any = undefined;
    if (busId) {
      try {
        const locDoc = await adminDb.collection('vehicleLocations').doc(busId).get();
        if (locDoc.exists) {
          const loc = locDoc.data() || {};
          if (Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude)) {
            currentLocation = {
              latitude: Number(loc.latitude),
              longitude: Number(loc.longitude),
              speedKmH: Number(loc.speed || loc.speedKmH || 0),
              heading: Number(loc.heading || 0),
              recordedAt: loc.recordedAt || new Date().toISOString(),
            };
          }
        }
      } catch (err) {
        console.error('Location fetch error:', err);
      }
    }

    // 7. Determine Journey Status using authoritative lifecycle rules
    const isTripRunning = isJourneyActive(tripData?.journey, new Date());
    const isBookingCompleted = bookingData.status === 'COMPLETED' || bookingData.journeyCompleted === true;
    const hasBoarded = bookingData.status === 'BOARDED' || bookingData.boardingStatus === 'BOARDED';

    let journeyStatus: CaregiverLiveTrackingData['journeyStatus'] = 'SCHEDULED';
    if (isBookingCompleted) {
      journeyStatus = 'ARRIVED';
    } else if (hasBoarded) {
      journeyStatus = isTripRunning ? 'IN_TRANSIT' : 'BOARDED';
    } else if (isTripRunning) {
      journeyStatus = 'IN_TRANSIT';
    } else {
      journeyStatus = 'SCHEDULED';
    }

    // 8. Build Genuine Stops Timeline & Fetch Stop Coordinates
    const startLoc = bookingData.journey?.startLocation || bookingData.startLocation || (routeStops.length > 0 ? routeStops[0] : 'Origin');
    const endLoc = bookingData.journey?.endLocation || bookingData.endLocation || (routeStops.length > 0 ? routeStops[routeStops.length - 1] : 'Destination');

    let activeStops: string[] = [];
    if (routeStops.length >= 2) {
      activeStops = sliceJourneyStops(routeStops, startLoc, endLoc);
    }
    if (activeStops.length < 2) {
      activeStops = [startLoc, endLoc];
    }

    // Retrieve Stop Coordinates from 'stops' collection
    const stopsCoordsMap = new Map<string, { latitude: number; longitude: number }>();
    try {
      const stopsSnapshot = await adminDb.collection('stops').get();
      for (const doc of stopsSnapshot.docs) {
        const sData = doc.data() || {};
        const key = normalizeLocation(sData.name);
        if (key && Number.isFinite(sData.latitude) && Number.isFinite(sData.longitude)) {
          stopsCoordsMap.set(key, { latitude: Number(sData.latitude), longitude: Number(sData.longitude) });
        }
      }
    } catch (err) {
      console.error('Stops collection fetch error:', err);
    }

    // Calculate approximate ETA
    let remainingMinutes = 0;
    if (journeyStatus === 'ARRIVED') {
      remainingMinutes = 0;
    } else if (segmentDurations.length > 0) {
      remainingMinutes = segmentDurations.reduce((sum, d) => sum + (Number(d) || 5), 0);
    } else {
      remainingMinutes = Math.max(10, (activeStops.length - 1) * 6);
    }

    const totalStopsCount = activeStops.length;
    const stopWaypoints: Array<{ name: string; latitude: number; longitude: number }> = [];

    const stopCoordinates: Array<{
      name: string;
      latitude: number;
      longitude: number;
      isPassed: boolean;
      isCurrent: boolean;
      isDestination: boolean;
    }> = [];

    const stopsTimeline = activeStops.map((stopName, index) => {
      const isFirst = index === 0;
      const isLast = index === totalStopsCount - 1;

      let isPassed = false;
      let isCurrent = false;

      if (journeyStatus === 'ARRIVED') {
        isPassed = true;
        if (isLast) isCurrent = true;
      } else if (journeyStatus === 'SCHEDULED') {
        // Scheduled: Not yet started. No halts passed.
        isPassed = false;
        if (isFirst) isCurrent = true;
      } else {
        // IN_TRANSIT / BOARDED
        if (isFirst) {
          isPassed = true;
        } else if (index === 1 || isLast) {
          isCurrent = index === 1;
        }
      }

      // Check coordinates
      const coords = stopsCoordsMap.get(normalizeLocation(stopName));
      if (coords) {
        stopWaypoints.push({ name: stopName, latitude: coords.latitude, longitude: coords.longitude });
        stopCoordinates.push({
          name: stopName,
          latitude: coords.latitude,
          longitude: coords.longitude,
          isPassed,
          isCurrent,
          isDestination: isLast,
        });
      }

      return {
        name: stopName,
        isPassed,
        isCurrent,
        isDestination: isLast,
        etaMinutes: Math.max(0, index * 6),
      };
    });

    // Calculate real road polyline coordinates via OSRM
    let routeCoordinates: Array<[number, number]> = [];
    if (stopWaypoints.length >= 2) {
      try {
        const road = await getRouteThroughCoordinates(stopWaypoints);
        if (road?.geometry?.coordinates && Array.isArray(road.geometry.coordinates)) {
          // OSRM returns [lng, lat] -> convert to [lat, lng] for Leaflet
          routeCoordinates = road.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        }
      } catch (err) {
        console.error('OSRM route calculation error:', err);
      }
    }

    // Fallback road line between stop coordinates if OSRM is offline
    if (routeCoordinates.length === 0 && stopCoordinates.length >= 2) {
      routeCoordinates = stopCoordinates.map((s) => [s.latitude, s.longitude]);
    }

    const trackingData: CaregiverLiveTrackingData = {
      bookingId: bookingDoc.id,
      passengerId,
      passengerName,
      hasAccessibilityNeeds,
      accessibilityNeeds,
      tripId: tripId || 'TRP',
      busId: busId || 'BUS',
      busRegistrationNumber: busRegNumber,
      busModel: busModel || 'Accessible Coach',
      routeNumber: routeNumber || 'Route',
      routeName: routeName || `${startLoc} - ${endLoc}`,
      driverName: driverName || 'Assigned Driver',
      driverPhone: driverPhone || undefined,
      emergencyPhone: '1990',
      boardingStop: {
        name: startLoc,
        scheduledTime: bookingData.journey?.departureTime || tripData?.departureTime || 'Scheduled',
        hasBoarded: hasBoarded || journeyStatus === 'IN_TRANSIT' || journeyStatus === 'ARRIVED',
      },
      destinationStop: {
        name: endLoc,
        scheduledTime: bookingData.journey?.arrivalTime || tripData?.arrivalTime || 'Scheduled',
        hasArrived: journeyStatus === 'ARRIVED',
      },
      currentLocation,
      journeyStatus,
      stopsTimeline,
      stopCoordinates,
      routeCoordinates,
      etaMinutes: remainingMinutes,
      isSharingActive: true,
      lastUpdated: new Date().toISOString(),
    };

    return Response.json(
      {
        success: true,
        tracking: trackingData,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error('GET /api/caregiver/track Error:', error);
    return Response.json(
      { success: false, message: 'Failed to load live tracking data', error: error.message },
      { status: 500, headers: corsHeaders }
    );
  }
}
