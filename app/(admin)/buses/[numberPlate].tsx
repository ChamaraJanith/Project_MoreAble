import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { BusDetailsScreen } from '../../../src/features/admin/ui/BusDetailsScreen';

export default function BusDetailsRoute() {
    const { numberPlate } = useLocalSearchParams<{ numberPlate: string }>();

    return <BusDetailsScreen numberPlate={numberPlate as string} />;
}