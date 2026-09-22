/**
 * Caregiver & Safety Sharing Domain Entity Types (MOV-227 / MOV-228 / MOV-229 / MOV-230)
 *
 * Defines the core data models for multi-caregiver linking, granular notification
 * permissions, multi-channel dispatch (SMS, Email, Push), secure live tracking tokens,
 * and safety audit telemetry.
 */

export type CaregiverRelationship =
  | 'Parent'
  | 'Guardian'
  | 'Spouse'
  | 'Child'
  | 'Sibling'
  | 'Relative'
  | 'Caregiver / Nurse'
  | 'Doctor / Medical Aid'
  | 'Emergency Contact'
  | 'Other';

export type CaregiverLinkStatus = 'ACTIVE' | 'PENDING' | 'REVOKED' | 'REJECTED';

export type CaregiverDispatchChannel = 'SMS' | 'EMAIL' | 'PUSH';

export interface CaregiverNotificationChannels {
  sms: boolean;
  email: boolean;
  push: boolean;
}

export interface CaregiverPermissions {
  /** Master toggle to immediately enable/pause all sharing for this caregiver */
  isSharingActive: boolean;

  /** Send SMS/Email/Push alerts when the passenger books a trip */
  shareBookingConfirmation: boolean;

  /** Send SMS/Email/Push alerts when the passenger boards the bus (conductor scan) */
  shareBoardingStatus: boolean;

  /** Grant access to zero-login live GPS tracking, route timeline & ETA */
  shareLiveProgress: boolean;

  /** Send SMS/Email/Push alerts when the passenger safely reaches their destination */
  shareDestinationArrival: boolean;

  /** Send immediate high-priority SMS & Email alerts when passenger triggers Emergency SOS */
  shareEmergencyAlerts: boolean;

  /** Selected notification channels */
  channels: CaregiverNotificationChannels;
}

export interface CaregiverLink {
  /** Unique link identifier (e.g., LNK-2026-00001) */
  linkId: string;

  /** Passenger identifier (PAS-2026-XXXXX or Firebase UID) */
  passengerId: string;

  /** Passenger full name for display on caregiver alerts */
  passengerName?: string;

  /** Caregiver identifier (GUD-2026-XXXXX or UID if applicable) */
  caregiverId?: string | null;

  /** Caregiver full name */
  fullName: string;

  /** Primary contact phone number (E.164 format or SL local format) */
  mobileNo: string;

  /** Caregiver email address for HTML notifications and receipts */
  email: string;

  /** Optional National Identity Card Number */
  nicNo?: string;

  /** Relationship to passenger */
  relationship: CaregiverRelationship | string;

  /** Optional custom notes or medical/accessibility instructions */
  notes?: string;

  /** Whether this is the primary guardian synchronized from registration/profile */
  isPrimaryGuardian?: boolean;

  /** Current link status */
  status: CaregiverLinkStatus;

  /** 6-character alphanumeric invite/link code for easy pairing */
  inviteCode?: string;

  /** Granular sharing and alert permissions */
  permissions: CaregiverPermissions;

  /** ISO 8601 timestamps */
  createdAt: string;
  updatedAt: string;
}

export type CaregiverAlertEventType =
  | 'BOOKING_CONFIRMED'
  | 'BOARDING_CONFIRMED'
  | 'LIVE_LOCATION_PING'
  | 'DELAY_DETECTED'
  | 'DESTINATION_ARRIVED'
  | 'EMERGENCY_SOS';

export interface CaregiverAlertPayload {
  bookingId: string;
  passengerId: string;
  passengerName: string;
  tripId: string;
  busId: string;
  busRegistrationNumber?: string;
  routeNumber?: string;
  routeName?: string;
  boardingStopName: string;
  destinationStopName: string;
  scheduledDepartureTime?: string;
  scheduledArrivalTime?: string;
  currentStopName?: string;
  estimatedArrivalMinutes?: number;
  trackingToken?: string;
  trackingUrl?: string;
  emergencyNote?: string;
  gpsCoordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface CaregiverLiveTrackingData {
  bookingId: string;
  passengerId: string;
  passengerName: string;
  hasAccessibilityNeeds?: boolean;
  accessibilityNeeds?: string[];
  tripId: string;
  busId: string;
  busRegistrationNumber: string;
  busModel?: string;
  routeNumber: string;
  routeName: string;
  driverName?: string;
  driverPhone?: string;
  emergencyPhone?: string;
  boardingStop: {
    stopId?: string;
    name: string;
    scheduledTime?: string;
    actualTime?: string;
    hasBoarded: boolean;
  };
  destinationStop: {
    stopId?: string;
    name: string;
    scheduledTime?: string;
    actualTime?: string;
    hasArrived: boolean;
  };
  currentLocation?: {
    latitude: number;
    longitude: number;
    speedKmH?: number;
    heading?: number;
    recordedAt?: string;
  };
  journeyStatus: 'SCHEDULED' | 'BOARDED' | 'IN_TRANSIT' | 'DELAYED' | 'ARRIVED' | 'CANCELLED';
  currentStopIndex?: number;
  totalStops?: number;
  stopsTimeline: Array<{
    stopId?: string;
    name: string;
    isPassed: boolean;
    isCurrent: boolean;
    isDestination: boolean;
    etaMinutes?: number;
  }>;
  stopCoordinates?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    isPassed: boolean;
    isCurrent: boolean;
    isDestination: boolean;
  }>;
  routeCoordinates?: Array<[number, number]>;
  etaMinutes: number;
  isSharingActive: boolean;
  sharingExpiresAt?: string;
  lastUpdated: string;
}

export interface CaregiverSafetyLog {
  logId: string;
  passengerId: string;
  caregiverId?: string;
  caregiverName: string;
  caregiverMobile: string;
  caregiverEmail: string;
  eventType: CaregiverAlertEventType;
  channelsDelivered: CaregiverDispatchChannel[];
  messageSummary: string;
  trackingToken?: string;
  status: 'DELIVERED' | 'FAILED' | 'SKIPPED_PERMISSION';
  timestamp: string;
}
