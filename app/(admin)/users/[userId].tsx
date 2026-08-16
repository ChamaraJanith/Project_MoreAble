import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { UserDetailsScreen } from '../../../src/features/admin/ui/UserDetailsScreen';

export default function UserDetailsRoute() {
    const { userId } = useLocalSearchParams<{ userId: string }>();

    return <UserDetailsScreen userId={userId as string} />;
}