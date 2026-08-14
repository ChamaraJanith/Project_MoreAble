import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { RouteForm } from '../../../../src/features/admin/ui/RouteForm';

export default function EditRouteScreen() {
    const { routeId } = useLocalSearchParams<{ routeId: string }>();

    return <RouteForm routeId={routeId as string} />;
}