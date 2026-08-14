import { Stack } from 'expo-router';
import React from 'react';

export default function AdminLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Admin Dashboard' }} />

      <Stack.Screen name="buses/index" options={{ title: 'Buses' }} />
      <Stack.Screen name="buses/add" options={{ title: 'Add Bus' }} />
      <Stack.Screen name="buses/[numberPlate]" options={{ title: 'Bus Details' }} />
      <Stack.Screen name="buses/edit/[numberPlate]" options={{ title: 'Edit Bus' }} />

      <Stack.Screen name="routes/index" options={{ title: 'Bus Routes' }} />
      <Stack.Screen name="routes/add" options={{ title: 'Add Route' }} />
      <Stack.Screen name="routes/[routeId]" options={{ title: 'Route Details' }} />
      <Stack.Screen name="routes/edit/[routeId]" options={{ title: 'Edit Route' }} />

      <Stack.Screen name="trips/add" options={{ title: 'Add Trip' }} />
    </Stack>
  );
}