import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { useNotificationStore } from '../../src/shared/store/notificationStore';

export default function TabLayout() {
  const unreadCount = useNotificationStore((state) => state.unreadCount);

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
        name="journey/route-details"
        options={{
          // Reached via "View details" on a recommended route, not a standalone tab.
          href: null,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
          name="booking/index"
          options={{
              title: 'Bookings',
              tabBarIcon: ({ color, size }) => (
                  <Ionicons name="ticket-outline" size={size} color={color} />
              ),
          }}
      />
      <Tabs.Screen
          name="notifications"
          options={{
              title: 'Notifications',
              tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : undefined,
              tabBarBadgeStyle: { backgroundColor: '#EF4444', color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
              tabBarIcon: ({ color, size }) => (
                  <Ionicons name="notifications-outline" size={size} color={color} />
              ),
          }}
      />


      <Tabs.Screen
         name="booking/options" 
         options={{ 
          href: null }} 
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
