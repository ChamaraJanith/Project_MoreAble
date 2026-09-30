import { Ionicons } from '@expo/vector-icons';
import { Href, router, Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { accessibilityReportsPath } from '../../src/features/reports/utils/reportRoutes';

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
        // One tab, one nested stack (app/(tabs)/journey/_layout.tsx). The
        // planner, the results, the route details and the community feedback
        // screen used to be four sibling tab routes hidden with `href: null`,
        // which left them with no push history — so Back fell through to the
        // tab router and landed on Home. They are stack frames now, and only
        // the tab entry is declared here.
        name="journey"
        options={{
          title: 'Journey',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bus-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="activities/index"
        options={{
          title: 'Activities',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="activities/journey/[bookingId]"
        options={{
          // Reached via "View Journey" on an ongoing activity (MOV-297), not a standalone tab.
          href: null,
        }}
      />
      <Tabs.Screen
        name="activities/completed/[bookingId]"
        options={{
          // Reached via "View Details" on a completed activity (MOV-297), not a standalone tab.
          href: null,
        }}
      />
      <Tabs.Screen
        name="activities/rate/[bookingId]"
        options={{
          // Reached only after the passenger confirms End Journey, not a standalone tab.
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
          name="accessibility-reports-tab"
          options={{
              title: 'Accessibility Reports',
              tabBarAccessibilityLabel: 'Accessibility Reports',
              tabBarLabel: ({ color, position, children }) => (
                  <Text
                      numberOfLines={2}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                      style={[position === 'below-icon' ? styles.twoLineLabel : styles.besideLabel, { color }]}
                  >
                      {children}
                  </Text>
              ),
              tabBarIcon: ({ color, size }) => (
                  <Ionicons name="accessibility-outline" size={size} color={color} />
              ),
          }}
          listeners={{
              // The reports screen lives in the root stack (app/accessibility-reports.tsx),
              // so push it rather than switching tabs — Back then returns here.
              tabPress: (e) => {
                  e.preventDefault();
                  router.push(accessibilityReportsPath() as Href);
              },
          }}
      />
      <Tabs.Screen
          // Opened from the header bell (NotificationHeaderIcon), not a bottom tab.
          name="notifications"
          options={{ href: null }}
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

const styles = StyleSheet.create({
  // Matches the default below-icon tab label (10pt, medium) but lets
  // "Accessibility Reports" wrap onto two lines instead of truncating.
  twoLineLabel: { fontSize: 10, lineHeight: 11, fontWeight: '500', textAlign: 'center' },
  besideLabel: { fontSize: 13, marginStart: 5, fontWeight: '500' },
});
