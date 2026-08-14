import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { RouteDetailsScreen } from '../../../src/features/admin/ui/RouteDetailsScreen';

export default function RouteDetailsRoute() {
    const { routeId } = useLocalSearchParams<{ routeId: string }>();

    return <RouteDetailsScreen routeId={routeId as string} />;
}