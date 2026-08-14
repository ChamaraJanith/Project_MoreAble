import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { TripDetailsScreen } from '../../../src/features/admin/ui/TripDetailsScreen';

export default function TripDetailsRoute() {
    const { tripId } = useLocalSearchParams<{ tripId: string }>();

    return <TripDetailsScreen tripId={tripId as string} />;
}
