import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { AddTripForm } from '../../../../src/features/admin/ui/AddTripForm';

export default function EditTripScreen() {
    const { tripId } = useLocalSearchParams<{ tripId: string }>();

    // Reuses the existing trip form in edit mode rather than duplicating it.
    return <AddTripForm tripId={tripId as string} />;
}
