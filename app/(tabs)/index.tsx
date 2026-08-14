import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuthStore } from '../../src/shared/store/authStore';

export default function HomeScreen() {
  const { user } = useAuthStore();

  // Fallback demo user details if store user is null
  const displayUser = user || {
    uid: 'demo-user-123',
    passengerId: 'PA-2026-1024',
    userName: 'Kavindu Perera',
    email: 'kavindu.p@example.com',
    nicNo: '199824501234',
    calculatedAge: 27,
    isElderPerson: false,
    role: 'PASSENGER',
    phoneNumber: '+94 77 123 4567',
  };

  const getInitials = (name: string) => {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const handleOpenProfile = () => {
    router.push('/profile' as any);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {/* Top Header Bar */}
        <View style={styles.headerBar}>
          <View>
            <Text style={styles.appName}>MoreAble</Text>
            <Text style={styles.appTagline}>Accessible Transit Portal</Text>
          </View>

          {/* Profile Header Logo Icon Button */}
          <TouchableOpacity
            style={styles.profileLogoButton}
            onPress={handleOpenProfile}
            accessibilityRole="button"
            accessibilityLabel="Open User Profile"
            accessibilityHint="Navigates to full profile screen"
            activeOpacity={0.8}
          >
            <View style={styles.profileAvatarCircle}>
              <Text style={styles.profileAvatarText}>{getInitials(displayUser.userName)}</Text>
            </View>
            <View style={styles.profileBadgeOnline} />
          </TouchableOpacity>
        </View>

        {/* Basic Details Profile Card on Home */}
        <TouchableOpacity
          style={styles.profileDetailsCard}
          onPress={handleOpenProfile}
          activeOpacity={0.9}
        >
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardAvatarLarge}>
              <Text style={styles.cardAvatarText}>{getInitials(displayUser.userName)}</Text>
            </View>

            <View style={styles.cardUserMainInfo}>
              <Text style={styles.cardGreeting}>Welcome back,</Text>
              <Text style={styles.cardUserName} numberOfLines={1}>{displayUser.userName}</Text>
              <View style={styles.passengerIdChip}>
                <Ionicons name="card" size={12} color="#0066CC" style={{ marginRight: 4 }} />
                <Text style={styles.passengerIdText}>{displayUser.passengerId}</Text>
              </View>
            </View>

            <Ionicons name="chevron-forward" size={24} color="#94A3B8" />
          </View>

          <View style={styles.cardDivider} />

          {/* Basic Details Grid */}
          <View style={styles.detailsGrid}>
            <View style={styles.detailItem}>
              <Ionicons name="mail" size={14} color="#0066CC" style={styles.detailIcon} />
              <Text style={styles.detailText} numberOfLines={1}>{displayUser.email}</Text>
            </View>

            <View style={styles.detailItem}>
              <Ionicons name="call" size={14} color="#0066CC" style={styles.detailIcon} />
              <Text style={styles.detailText}>{displayUser.phoneNumber || '+94 77 123 4567'}</Text>
            </View>

            <View style={styles.detailItem}>
              <Ionicons name="id-card" size={14} color="#0066CC" style={styles.detailIcon} />
              <Text style={styles.detailText}>NIC: {displayUser.nicNo || 'N/A'}</Text>
            </View>

            <View style={styles.detailItem}>
              <Ionicons name="shield-checkmark" size={14} color="#10B981" style={styles.detailIcon} />
              <Text style={styles.detailText}>Role: {displayUser.role}</Text>
            </View>
          </View>

          <View style={styles.viewProfileRow}>
            <Text style={styles.viewProfileText}>Tap to view full profile & settings</Text>
            <Ionicons name="arrow-forward-circle" size={18} color="#0066CC" />
          </View>
        </TouchableOpacity>

        {/* Main Action Banner: Plan a Journey */}
        <Text style={styles.sectionHeading}>Quick Services</Text>

        <TouchableOpacity
          style={styles.planJourneyCard}
          onPress={() => router.push('/journey' as any)}
          accessibilityRole="button"
          accessibilityLabel="Plan a Journey"
          accessibilityHint="Double tap to open the journey planner"
          activeOpacity={0.85}
        >
          <View style={styles.planJourneyContent}>
            <View style={styles.planIconWrapper}>
              <Ionicons name="navigate-circle" size={36} color="#FFFFFF" />
            </View>
            <View style={styles.planTextWrapper}>
              <Text style={styles.planTitle}>Plan a Journey</Text>
              <Text style={styles.planSubtext}>Find accessible bus routes & real-time schedules</Text>
            </View>
          </View>
          <View style={styles.planArrowBadge}>
            <Ionicons name="arrow-forward" size={20} color="#0066CC" />
          </View>
        </TouchableOpacity>

        {/* Secondary Quick Action Cards */}
        <View style={styles.quickGrid}>
          <TouchableOpacity
            style={styles.quickCard}
            onPress={() => router.push('/booking' as any)}
            activeOpacity={0.8}
          >
            <View style={[styles.quickIconCircle, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="ticket" size={24} color="#0066CC" />
            </View>
            <Text style={styles.quickCardTitle}>My Bookings</Text>
            <Text style={styles.quickCardSub}>Active passes</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickCard}
            onPress={handleOpenProfile}
            activeOpacity={0.8}
          >
            <View style={[styles.quickIconCircle, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="accessibility" size={24} color="#10B981" />
            </View>
            <Text style={styles.quickCardTitle}>Accessibility</Text>
            <Text style={styles.quickCardSub}>Profile settings</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    marginTop: 8,
  },
  appName: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0066CC',
    letterSpacing: -0.5,
  },
  appTagline: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  profileLogoButton: {
    position: 'relative',
    padding: 2,
  },
  profileAvatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0066CC',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#BAE6FD',
    elevation: 3,
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  profileAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  profileBadgeOnline: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 13,
    height: 13,
    borderRadius: 6.5,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  profileDetailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    marginBottom: 24,
    elevation: 4,
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardAvatarLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0284C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  cardAvatarText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  cardUserMainInfo: {
    flex: 1,
  },
  cardGreeting: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  cardUserName: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  passengerIdChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  passengerIdText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0066CC',
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 14,
  },
  detailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
  },
  detailIcon: {
    marginRight: 6,
  },
  detailText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    flexShrink: 1,
  },
  viewProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  viewProfileText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0066CC',
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 12,
  },
  planJourneyCard: {
    backgroundColor: '#0066CC',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    elevation: 4,
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  planJourneyContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  planIconWrapper: {
    marginRight: 14,
  },
  planTextWrapper: {
    flex: 1,
  },
  planTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  planSubtext: {
    fontSize: 12,
    color: '#E0F2FE',
    fontWeight: '500',
  },
  planArrowBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  quickGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  quickCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  quickIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  quickCardSub: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
  },
});
