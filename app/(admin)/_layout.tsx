import { Stack } from 'expo-router';
import React from 'react';

export default function AdminLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Admin Dashboard' }} />
      <Stack.Screen name="trips/add" options={{ title: 'Add Trip' }} />
    </Stack>
  );
}
