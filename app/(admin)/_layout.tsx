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

      <Stack.Screen name="stops/index" options={{ title: 'Bus Stops' }} />
      <Stack.Screen name="stops/add" options={{ title: 'Add New Stop' }} />
      <Stack.Screen name="stops/[stopId]" options={{ title: 'Stop Details' }} />
      <Stack.Screen name="stops/edit/[stopId]" options={{ title: 'Edit Bus Stop' }} />

      <Stack.Screen name="reports/index" options={{ title: 'Review Reports' }} />
      <Stack.Screen name="reports/[reportId]" options={{ title: 'Review Report' }} />

      <Stack.Screen name="users/index" options={{ title: 'User Management' }} />
      <Stack.Screen name="users/[userId]" options={{ title: 'User Profile' }} />

      <Stack.Screen name="trips/index" options={{ title: 'Trips' }} />
      <Stack.Screen name="trips/add" options={{ title: 'Add Trip' }} />
      <Stack.Screen name="trips/[tripId]" options={{ title: 'Trip Details' }} />
      <Stack.Screen name="trips/edit/[tripId]" options={{ title: 'Edit Trip' }} />
    </Stack>
  );
}