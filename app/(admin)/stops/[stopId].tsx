import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StopDetailsScreen } from '../../../src/features/admin/ui/StopDetailsScreen';

export default function StopDetailsRoute() {
    const { stopId } = useLocalSearchParams<{ stopId: string }>();

    return <StopDetailsScreen stopId={stopId as string} />;
}