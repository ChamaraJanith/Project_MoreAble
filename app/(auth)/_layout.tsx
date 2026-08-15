//Control layout of authentication screen
//This file is used to control the layout of authentication screen

import { Stack } from 'expo-router';
import React from 'react';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="register" />
      <Stack.Screen name="device-login" />
    </Stack>
  );
}
