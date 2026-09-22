/**
 * Public Live Journey Tracking Route (MOV-227 / MOV-230)
 *
 * Route: /track/:token (e.g. /track/TRK-2026-BKG001-A9Z)
 * Allows authorized caregivers to monitor live bus GPS, transit timeline, and safe arrival
 * directly from any browser without requiring an account or login.
 */

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { CaregiverLiveTrackingScreen } from '../../src/features/caregiver/ui/CaregiverLiveTrackingScreen';

export default function TrackJourneyPage() {
  const { token } = useLocalSearchParams<{ token?: string }>();

  return <CaregiverLiveTrackingScreen token={typeof token === 'string' ? token : ''} />;
}
