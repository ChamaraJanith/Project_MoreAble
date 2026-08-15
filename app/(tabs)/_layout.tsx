//Control layout of tab screen
//This file is used to control the layout of tab screen
//Navigation bar of tab screen
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#0066CC',
        tabBarInactiveTintColor: '#687076',
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="journey/index"
        options={{
          title: 'Journey',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bus-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="journey/results"
        options={{
          // Reached via router.push from the Journey Planner search, not a standalone tab.
          href: null,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="booking/index"
        options={{
          title: 'Booking',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ticket-outline" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen 
        name="booking/seats/[tripId]" 
        options={{ 
          href: null }} 
      />

      <Tabs.Screen 
        name="booking/confirm" 
        options={{ href: null }} 
        />

      <Tabs.Screen 
        name="booking/ticket/[bookingId]" 
        options={{ href: null }}
         />

    </Tabs>
  );
}
