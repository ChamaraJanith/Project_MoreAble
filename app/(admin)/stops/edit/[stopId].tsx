import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StopForm } from '../../../../src/features/admin/ui/StopForm';

export default function EditStopScreen() {
    const { stopId } = useLocalSearchParams<{ stopId: string }>();

    return <StopForm stopId={stopId as string} />;
}