import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { AccessibilityBusDetailScreen } from '../../../src/features/admin/ui/AccessibilityBusDetailScreen';

export default function AdminBusAccessibilityRoute() {
    const { busId } = useLocalSearchParams<{ busId: string }>();

    return <AccessibilityBusDetailScreen busId={typeof busId === 'string' ? busId : ''} />;
}
