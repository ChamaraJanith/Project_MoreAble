import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Linking,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View
} from 'react-native';
import { Booking } from '../../src/entities/booking/model/types';
import { getBookingHistory } from '../../src/features/booking/api/bookingApi';
import { isBookingUpcoming, sortBookings } from '../../src/features/booking/utils/bookingFilter';
import { selectActiveJourneyView, syncActiveJourney } from '../../src/features/journey/services/activeJourneySync';
import { formatDisplayDate } from '../../src/features/journey/utils/dateTime';
import { NotificationHeaderIcon } from '../../src/features/notifications/ui/NotificationHeaderIcon';
import { useAppTheme } from '../../src/shared/hooks/useAppTheme';
import { useAuthStore } from '../../src/shared/store/authStore';
import { useJourneyStore } from '../../src/shared/store/journeyStore';
import { AppText as Text } from '../../src/shared/ui/AppText';
import { statusBadgeStyles } from '../../src/shared/ui/statusBadgeStyles';

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const { user, token } = useAuthStore();
  const journeyStore = useJourneyStore();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncedForToken, setSyncedForToken] = useState<string | null>(null);

  // Time-based personalized greeting
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t('home.goodMorning', 'Good morning');
    if (hour < 17) return t('home.goodAfternoon', 'Good afternoon');
    return t('home.goodEvening', 'Good evening');
  }, [t]);

  // Authenticated user or fallback demo passenger
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
    isWheelchairUser: true,
    isAccessibilityVerified: true,
    guardianDetails: {
      fullName: 'Sunil Perera',
      mobileNo: '0779876543',
      relationship: 'Father',
    },
  };

  const getInitials = (name: string) => {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Sync active journey from server and fetch bookings
  const loadData = useCallback(async () => {
    if (token) {
      try {
        await syncActiveJourney(token);
        setSyncedForToken(token);
      } catch {
        // sync error handled in syncActiveJourney
      }
    }

    const passengerId = user?.passengerId || displayUser.passengerId;
    if (passengerId) {
      setLoadingBookings(true);
      try {
        const data = await getBookingHistory(passengerId);
        setBookings(data);
      } catch {
        // Keep existing bookings or gracefully show none
      } finally {
        setLoadingBookings(false);
      }
    }
  }, [user?.passengerId, displayUser.passengerId, token]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // Live journey active state
  const isSyncingOngoing = token ? syncedForToken !== token : false;
  const activeJourneyView = selectActiveJourneyView(
    {
      isJourneyStarted: journeyStore.isJourneyStarted,
      bookingId: journeyStore.bookingId,
      vehicleDetails: journeyStore.vehicleDetails,
    },
    isSyncingOngoing
  );

  // Next upcoming trip
  const now = useMemo(() => new Date(), []);
  const upcomingBookings = useMemo(
    () => sortBookings(bookings.filter((b) => isBookingUpcoming(b, now)), 'UPCOMING'),
    [bookings, now]
  );
  const nextBooking = upcomingBookings[0] || null;

  // Accessibility profile pills
  const accessibilityBadges = useMemo(() => {
    const list: { label: string; icon: keyof typeof Ionicons.glyphMap }[] = [];
    if (displayUser.isWheelchairUser) {
      list.push({ label: 'Wheelchair Access', icon: 'body' });
    }
    if (displayUser.isElderPerson || (displayUser.calculatedAge && displayUser.calculatedAge >= 60)) {
      list.push({ label: 'Senior Priority', icon: 'person' });
    }
    if ((displayUser as any).isLowVisionPerson) {
      list.push({ label: 'Audio & Visual Aid', icon: 'eye' });
    }
    if ((displayUser as any).isWalkingDifficultyPerson) {
      list.push({ label: 'Walking Support', icon: 'walk' });
    }
    if (displayUser.guardianDetails?.mobileNo) {
      list.push({ label: 'Guardian Protected', icon: 'shield-checkmark' });
    }
    if (list.length === 0) {
      list.push({ label: 'Standard Accessible', icon: 'checkmark-circle' });
    }
    return list;
  }, [displayUser]);

  const handleOpenProfile = () => {
    router.push('/profile' as any);
  };

  const handlePrefillRoute = (origin: string, destination: string) => {
    router.push({
      pathname: '/journey',
      params: {
        origin,
        destination,
        prefillAt: Date.now().toString(),
      },
    } as any);
  };

  const handleCallEmergency = () => {
    if (Platform.OS === 'web') {
      window.alert('Emergency Hotline: Dialing 1990 (Suwa Seriya 24/7 Ambulance)');
    } else {
      Alert.alert(
        'Emergency Assistance',
        'Call Sri Lanka 24/7 Emergency Ambulance (1990) or MoreAble Transit Safety Hotline?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Call 1990 (Ambulance)', onPress: () => Linking.openURL('tel:1990') },
          { text: 'Transit Safety (011-2345678)', onPress: () => Linking.openURL('tel:0112345678') },
        ]
      );
    }
  };

  const isHighContrast = theme.isHighContrast;
  const containerBg = isHighContrast ? '#0F172A' : '#F8FAFC';
  const cardBg = isHighContrast ? '#1E293B' : '#FFFFFF';
  const textColor = isHighContrast ? '#FFFFFF' : '#0F172A';
  const subtextColor = isHighContrast ? '#94A3B8' : '#64748B';
  const cardBorder = isHighContrast ? '#334155' : '#E2E8F0';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: containerBg }]}>
      <StatusBar barStyle={isHighContrast ? 'light-content' : 'dark-content'} backgroundColor={containerBg} />
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#0066CC']}
            tintColor="#0066CC"
          />
        }
      >
        {/* 1. Header Bar: Logo Brand & Quick Actions */}
        <View style={styles.headerBar}>
          <View style={styles.brandGroup}>
            <View style={styles.brandIconBox}>
              <Ionicons name="bus" size={20} color="#FFFFFF" />
            </View>
            <View>
              <Text style={[styles.appName, { color: isHighContrast ? '#38BDF8' : '#0066CC' }]}>
                {t('home.appName', 'MoreAble')}
              </Text>
              <Text style={[styles.appTagline, { color: subtextColor }]}>
                {t('home.appTagline', 'Accessible Transit Portal')}
              </Text>
            </View>
          </View>

          <View style={styles.headerRightActions}>
            <NotificationHeaderIcon size={24} color={isHighContrast ? '#FFFFFF' : '#0F172A'} />

            <TouchableOpacity
              style={styles.profileLogoButton}
              onPress={handleOpenProfile}
              accessibilityRole="button"
              accessibilityLabel="Open User Profile"
              activeOpacity={0.8}
            >
              <View style={styles.profileAvatarCircle}>
                <Text style={styles.profileAvatarText}>{getInitials(displayUser.userName)}</Text>
              </View>
              <View style={styles.profileBadgeOnline} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. Personalized Commuter Welcome Hero Card */}
        <TouchableOpacity
          style={[styles.heroCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
          onPress={handleOpenProfile}
          activeOpacity={0.9}
        >
          <View style={styles.heroTopRow}>
            <View style={styles.heroAvatar}>
              <Text style={styles.heroAvatarText}>{getInitials(displayUser.userName)}</Text>
            </View>

            <View style={styles.heroUserMeta}>
              <Text style={[styles.heroGreeting, { color: subtextColor }]}>{greeting},</Text>
              <Text style={[styles.heroUserName, { color: textColor }]} numberOfLines={1}>
                {displayUser.userName}
              </Text>
              <View style={styles.passengerBadgeRow}>
                <View style={styles.passengerIdChip}>
                  <Ionicons name="card" size={12} color="#0066CC" style={{ marginRight: 4 }} />
                  <Text style={styles.passengerIdText}>{displayUser.passengerId}</Text>
                </View>
                {displayUser.isAccessibilityVerified && (
                  <View style={styles.verifiedChip}>
                    <Ionicons name="shield-checkmark" size={11} color="#065F46" style={{ marginRight: 3 }} />
                    <Text style={styles.verifiedText}>Verified Commuter</Text>
                  </View>
                )}
              </View>
            </View>

            <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
          </View>

          {/* Commuter Accessibility Features Pills */}
          <View style={styles.accessibilityPillsContainer}>
            {accessibilityBadges.map((badge, idx) => (
              <View key={idx} style={styles.accessibilityPill}>
                <Ionicons name={badge.icon} size={12} color="#0066CC" style={{ marginRight: 4 }} />
                <Text style={styles.accessibilityPillText}>{badge.label}</Text>
              </View>
            ))}
          </View>

          {/* Guardian Info Banner if present */}
          {displayUser.guardianDetails && (
            <View style={styles.guardianBanner}>
              <Ionicons name="shield-half-outline" size={14} color="#0066CC" />
              <Text style={styles.guardianBannerText}>
                Guardian Linked: <Text style={styles.guardianNameText}>{displayUser.guardianDetails.fullName}</Text> (
                {displayUser.guardianDetails.mobileNo}) • Auto-alerts on board
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* 3. Real-Time Ongoing / Live Journey Alert Banner (if active) */}
        {activeJourneyView.isLive && (
          <TouchableOpacity
            style={styles.liveJourneyBanner}
            onPress={() => router.push('/active-journey' as any)}
            activeOpacity={0.9}
          >
            <View style={styles.liveBadgeRow}>
              <View style={styles.livePulsingBadge}>
                <View style={styles.pulseDot} />
                <Text style={styles.liveBadgeText}>LIVE JOURNEY IN PROGRESS</Text>
              </View>
              <Text style={styles.liveTapTrackText}>Tap to Track &gt;</Text>
            </View>

            <View style={styles.liveContentRow}>
              <View style={styles.liveBusIconBox}>
                <Ionicons name="bus" size={24} color="#0066CC" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.liveBusPlate}>
                  Bus {activeJourneyView.vehicleCard?.plateNumber}
                </Text>
                <Text style={styles.liveSubtext}>
                  Live transit tracking &amp; conductor support active
                </Text>
              </View>
              <TouchableOpacity
                style={styles.sosSmallBtn}
                onPress={() => router.push('/active-journey' as any)}
              >
                <Ionicons name="warning" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                <Text style={styles.sosSmallBtnText}>SOS</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}

        {/* 4. Next Upcoming Reservation Ticket Card */}
        {nextBooking ? (
          <View style={styles.sectionWrapper}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: textColor }]}>Next Upcoming Trip</Text>
              <TouchableOpacity onPress={() => router.push('/booking' as any)}>
                <Text style={styles.sectionLink}>View All ({upcomingBookings.length})</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.ticketCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <View style={styles.ticketTopRow}>
                <View style={styles.busInfoRow}>
                  <View style={styles.ticketBusIconCircle}>
                    <Ionicons name="bus" size={16} color="#0066CC" />
                  </View>
                  <Text style={[styles.ticketPlateText, { color: textColor }]}>
                    {nextBooking.vehicle.numberPlate}
                  </Text>
                  {nextBooking.journey.routeNumber && (
                    <View style={styles.routePill}>
                      <Text style={styles.routePillText}>Route {nextBooking.journey.routeNumber}</Text>
                    </View>
                  )}
                </View>

                <View style={[styles.confirmedBadge, statusBadgeStyles.active]}>
                  <Text style={[styles.confirmedText, statusBadgeStyles.activeText]}>CONFIRMED</Text>
                </View>
              </View>

              {/* Route Trajectory */}
              <View style={styles.ticketRouteRow}>
                <View style={styles.routeDotsCol}>
                  <View style={styles.dotOrigin} />
                  <View style={styles.dotLine} />
                  <View style={styles.dotDestination} />
                </View>
                <View style={styles.routeTextCol}>
                  <Text style={[styles.routeStationText, { color: textColor }]}>
                    {nextBooking.journey.startLocation}
                  </Text>
                  <Text style={[styles.routeStationText, { color: textColor }]}>
                    {nextBooking.journey.endLocation}
                  </Text>
                </View>
              </View>

              {/* Time & Seat Badges */}
              <View style={styles.ticketMetaRow}>
                {(nextBooking.journeyDate || nextBooking.travelDate) && (
                  <View style={styles.ticketMetaBadge}>
                    <Ionicons name="calendar-outline" size={13} color="#0066CC" />
                    <Text style={styles.ticketMetaText}>
                      {formatDisplayDate(nextBooking.journeyDate || nextBooking.travelDate)}
                    </Text>
                  </View>
                )}

                <View style={styles.ticketMetaBadge}>
                  <Ionicons name="time-outline" size={13} color="#0066CC" />
                  <Text style={styles.ticketMetaText}>{nextBooking.journey.departureTime}</Text>
                </View>

                <View style={styles.ticketMetaBadge}>
                  <Ionicons name="star-outline" size={13} color="#0066CC" />
                  <Text style={styles.ticketMetaText}>Seat {nextBooking.seatNumber}</Text>
                </View>
              </View>

              {/* Support Notice */}
              <View style={styles.conductorAlertBanner}>
                <Ionicons name="checkbox-outline" size={14} color="#0066CC" />
                <Text style={styles.conductorAlertText}>Travel Support: Conductor notified for assistance 🚌</Text>
              </View>

              <View style={styles.ticketActionsRow}>
                <TouchableOpacity
                  style={styles.viewTicketBtn}
                  onPress={() =>
                    router.push({
                      pathname: '/booking/ticket/[bookingId]',
                      params: { bookingId: nextBooking.bookingId },
                    } as any)
                  }
                >
                  <Ionicons name="qr-code-outline" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                  <Text style={styles.viewTicketBtnText}>View Ticket QR &gt;</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.allBookingsBtn}
                  onPress={() => router.push('/booking' as any)}
                >
                  <Text style={styles.allBookingsBtnText}>My Trips</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}

        {/* 5. Quick Journey Planner Search Bar */}
        <View style={styles.sectionWrapper}>
          <Text style={[styles.sectionTitle, { color: textColor }]}>Where are you traveling?</Text>

          <TouchableOpacity
            style={[styles.searchBanner, { backgroundColor: cardBg, borderColor: cardBorder }]}
            onPress={() => router.push('/journey' as any)}
            activeOpacity={0.85}
          >
            <View style={styles.searchIconCircle}>
              <Ionicons name="search" size={20} color="#0066CC" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.searchPlaceholder}>Search accessible routes &amp; stops...</Text>
              <Text style={styles.searchSubtext}>Filter by low-floor vehicles, ramps &amp; elevators</Text>
            </View>
            <View style={styles.searchActionArrow}>
              <Ionicons name="arrow-forward" size={18} color="#0066CC" />
            </View>
          </TouchableOpacity>

          {/* Quick Destination Chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
            {[
              { origin: 'Kollupitiya', destination: 'Battaramulla' },
              { origin: 'Pettah', destination: 'Maharagama' },
              { origin: 'Colombo Fort', destination: 'Moratuwa' },
              { origin: 'Kollupitiya', destination: 'Kaduwela' },
              { origin: 'Pettah', destination: 'Horana' },
            ].map((route, i) => (
              <TouchableOpacity
                key={i}
                style={styles.routeChip}
                onPress={() => handlePrefillRoute(route.origin, route.destination)}
              >
                <Ionicons name="location-outline" size={12} color="#0066CC" style={{ marginRight: 4 }} />
                <Text style={styles.routeChipText}>
                  {route.origin} → {route.destination}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* 6. Core Transit Services Hub (6 High-Utility Cards) */}
        <View style={styles.sectionWrapper}>
          <Text style={[styles.sectionTitle, { color: textColor }]}>Transit Services &amp; Tools</Text>

          <View style={styles.servicesGrid}>
            {/* Card 1: Plan Journey */}
            <TouchableOpacity
              style={[styles.serviceCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={() => router.push('/journey' as any)}
              activeOpacity={0.85}
            >
              <View style={[styles.serviceIconCircle, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="navigate-circle" size={26} color="#0066CC" />
              </View>
              <Text style={[styles.serviceCardTitle, { color: textColor }]}>Plan Journey</Text>
              <Text style={styles.serviceCardDesc}>Routes, ramps &amp; bus timetables</Text>
            </TouchableOpacity>

            {/* Card 2: My Bookings */}
            <TouchableOpacity
              style={[styles.serviceCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={() => router.push('/booking' as any)}
              activeOpacity={0.85}
            >
              <View style={[styles.serviceIconCircle, { backgroundColor: '#F0FDF4' }]}>
                <Ionicons name="ticket" size={26} color="#10B981" />
              </View>
              <Text style={[styles.serviceCardTitle, { color: textColor }]}>My Bookings</Text>
              <Text style={styles.serviceCardDesc}>Reserved seats &amp; QR passes</Text>
            </TouchableOpacity>

            {/* Card 3: Active Journey */}
            <TouchableOpacity
              style={[styles.serviceCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={() => router.push('/active-journey' as any)}
              activeOpacity={0.85}
            >
              <View style={[styles.serviceIconCircle, { backgroundColor: '#FEF2F2' }]}>
                <Ionicons name="bus" size={26} color="#DC2626" />
              </View>
              <Text style={[styles.serviceCardTitle, { color: textColor }]}>Active Journey</Text>
              <Text style={styles.serviceCardDesc}>Live GPS &amp; rapid SOS button</Text>
            </TouchableOpacity>

            {/* Card 4: Accessibility Reports */}
            <TouchableOpacity
              style={[styles.serviceCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={() => router.push('/accessibility-reports' as any)}
              activeOpacity={0.85}
            >
              <View style={[styles.serviceIconCircle, { backgroundColor: '#FFFBEB' }]}>
                <Ionicons name="document-text" size={26} color="#D97706" />
              </View>
              <Text style={[styles.serviceCardTitle, { color: textColor }]}>Access Reports</Text>
              <Text style={styles.serviceCardDesc}>Report ramp &amp; stop obstacles</Text>
            </TouchableOpacity>

            {/* Card 5: Favourite Routes */}
            <TouchableOpacity
              style={[styles.serviceCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={() => router.push('/favourite-routes' as any)}
              activeOpacity={0.85}
            >
              <View style={[styles.serviceIconCircle, { backgroundColor: '#F5F3FF' }]}>
                <Ionicons name="heart" size={26} color="#7C3AED" />
              </View>
              <Text style={[styles.serviceCardTitle, { color: textColor }]}>Saved Routes</Text>
              <Text style={styles.serviceCardDesc}>Daily frequent commutes</Text>
            </TouchableOpacity>

            {/* Card 6: Profile & Accessibility Needs */}
            <TouchableOpacity
              style={[styles.serviceCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
              onPress={handleOpenProfile}
              activeOpacity={0.85}
            >
              <View style={[styles.serviceIconCircle, { backgroundColor: '#EBF3FA' }]}>
                <Ionicons name="accessibility" size={26} color="#0284C7" />
              </View>
              <Text style={[styles.serviceCardTitle, { color: textColor }]}>Special Seating</Text>
              <Text style={styles.serviceCardDesc}>Guardian &amp; wheelchair config</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 7. Popular Accessible Routes in System */}
        <View style={styles.sectionWrapper}>
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>Popular Accessible Routes</Text>
            <TouchableOpacity onPress={() => router.push('/journey' as any)}>
              <Text style={styles.sectionLink}>All Routes &gt;</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.routesList}>
            {[
              {
                number: '177',
                name: 'Kollupitiya ↔ Kaduwela',
                via: 'Via Battaramulla & Malabe',
                features: ['Low-Floor Ramp', 'Priority Seating', 'AC'],
                origin: 'Kollupitiya',
                destination: 'Battaramulla',
              },
              {
                number: '138',
                name: 'Pettah ↔ Maharagama',
                via: 'Via Nugegoda & High Level Rd',
                features: ['Wheelchair Bay', 'Audio Alerts', 'Frequent'],
                origin: 'Pettah',
                destination: 'Maharagama',
              },
              {
                number: '100',
                name: 'Colombo Fort ↔ Moratuwa',
                via: 'Via Galle Road Coastal Line',
                features: ['Priority Access', 'Senior Care', 'Direct'],
                origin: 'Colombo Fort',
                destination: 'Moratuwa',
              },
            ].map((route, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.popularRouteCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
                onPress={() => handlePrefillRoute(route.origin, route.destination)}
                activeOpacity={0.85}
              >
                <View style={styles.popularRouteTop}>
                  <View style={styles.routeBadgeLarge}>
                    <Text style={styles.routeBadgeLargeText}>Route {route.number}</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[styles.popularRouteName, { color: textColor }]} numberOfLines={1}>
                      {route.name}
                    </Text>
                    <Text style={styles.popularRouteVia}>{route.via}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#0066CC" />
                </View>

                <View style={styles.routeFeaturesRow}>
                  {route.features.map((feat, fIdx) => (
                    <View key={fIdx} style={styles.routeFeatureChip}>
                      <Ionicons name="checkmark-circle" size={11} color="#065F46" style={{ marginRight: 3 }} />
                      <Text style={styles.routeFeatureText}>{feat}</Text>
                    </View>
                  ))}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 8. Emergency Safety & Conductor Assistance Helpline */}
        <View style={styles.emergencyBox}>
          <View style={styles.emergencyHeaderRow}>
            <View style={styles.emergencyIconCircle}>
              <Ionicons name="call" size={20} color="#DC2626" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.emergencyTitle}>24/7 Transit Emergency &amp; Safety</Text>
              <Text style={styles.emergencySub}>
                Rapid medical support, conductor alerts &amp; caregiver hotline
              </Text>
            </View>
          </View>

          <View style={styles.emergencyBtnRow}>
            <TouchableOpacity style={styles.emergencyBtnRed} onPress={handleCallEmergency}>
              <Ionicons name="call" size={15} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.emergencyBtnText}>Emergency (1990)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.emergencyBtnOutline}
              onPress={() => router.push('/active-journey' as any)}
            >
              <Ionicons name="alert-circle" size={15} color="#DC2626" style={{ marginRight: 6 }} />
              <Text style={styles.emergencyBtnOutlineText}>Active Journey SOS</Text>
            </TouchableOpacity>
          </View>
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
    paddingBottom: 40,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    marginTop: 6,
  },
  brandGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#0066CC',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    elevation: 2,
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  appName: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0066CC',
    letterSpacing: -0.5,
  },
  appTagline: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 1,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileLogoButton: {
    position: 'relative',
  },
  profileAvatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0066CC',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#BAE6FD',
  },
  profileAvatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  profileBadgeOnline: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10B981',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 3,
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0284C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  heroAvatarText: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
  },
  heroUserMeta: {
    flex: 1,
  },
  heroGreeting: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  heroUserName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 3,
  },
  passengerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  passengerIdChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  passengerIdText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0066CC',
  },
  verifiedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  accessibilityPillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  accessibilityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF3FA',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  accessibilityPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0066CC',
  },
  guardianBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    padding: 10,
    borderRadius: 10,
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#0066CC',
    gap: 6,
  },
  guardianBannerText: {
    fontSize: 11,
    color: '#334155',
    flex: 1,
    fontWeight: '500',
  },
  guardianNameText: {
    fontWeight: '700',
    color: '#0066CC',
  },
  liveJourneyBanner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: '#38BDF8',
    elevation: 4,
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  liveBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  livePulsingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 6,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  liveBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#0066CC',
  },
  liveTapTrackText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0066CC',
  },
  liveContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveBusIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EBF3FA',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  liveBusPlate: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0F172A',
  },
  liveSubtext: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  sosSmallBtn: {
    backgroundColor: '#DC2626',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  sosSmallBtnText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
  },
  sectionWrapper: {
    marginBottom: 22,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 10,
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0066CC',
  },
  ticketCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  ticketTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  busInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ticketBusIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#EBF3FA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ticketPlateText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0F172A',
  },
  routePill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  routePillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
  },
  confirmedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  confirmedText: {
    fontSize: 11,
    fontWeight: '900',
  },
  ticketRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  routeDotsCol: {
    alignItems: 'center',
    marginRight: 10,
    width: 14,
  },
  dotOrigin: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#94A3B8',
  },
  dotLine: {
    width: 2,
    height: 18,
    backgroundColor: '#CBD5E1',
    marginVertical: 2,
  },
  dotDestination: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0066CC',
  },
  routeTextCol: {
    flex: 1,
    gap: 8,
  },
  routeStationText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1E293B',
  },
  ticketMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  ticketMetaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  ticketMetaText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  conductorAlertBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF3FA',
    padding: 8,
    borderRadius: 8,
    gap: 6,
    marginBottom: 12,
  },
  conductorAlertText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0066CC',
  },
  ticketActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  viewTicketBtn: {
    flex: 1,
    height: 42,
    backgroundColor: '#0066CC',
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewTicketBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  allBookingsBtn: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  allBookingsBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#475569',
  },
  searchBanner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    marginBottom: 12,
  },
  searchIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#EBF3FA',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  searchPlaceholder: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  searchSubtext: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  searchActionArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  chipsScroll: {
    flexDirection: 'row',
  },
  routeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
    elevation: 1,
  },
  routeChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  servicesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  serviceCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  serviceIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  serviceCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  serviceCardDesc: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  routesList: {
    gap: 10,
  },
  popularRouteCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  popularRouteTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  routeBadgeLarge: {
    backgroundColor: '#0066CC',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  routeBadgeLargeText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
  },
  popularRouteName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  popularRouteVia: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  routeFeaturesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  routeFeatureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  routeFeatureText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
  },
  emergencyBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#FECACA',
    marginTop: 4,
    marginBottom: 10,
  },
  emergencyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  emergencyIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emergencyTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#991B1B',
  },
  emergencySub: {
    fontSize: 11,
    color: '#7F1D1D',
    fontWeight: '500',
    marginTop: 1,
  },
  emergencyBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  emergencyBtnRed: {
    flex: 1,
    height: 40,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emergencyBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  emergencyBtnOutline: {
    flex: 1,
    height: 40,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#DC2626',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emergencyBtnOutlineText: {
    color: '#DC2626',
    fontWeight: '800',
    fontSize: 12,
  },
});
