import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { BusForm } from '../../../../src/features/admin/ui/BusForm';

export default function EditBusScreen() {
    const { numberPlate } = useLocalSearchParams<{ numberPlate: string }>();

    return <BusForm numberPlate={numberPlate as string} />;
}