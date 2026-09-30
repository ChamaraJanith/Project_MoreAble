import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getOngoingJourneys } from '../src/features/activities/api/ongoingJourneyApi';
import { SOSButton } from '../src/features/journey/components/SOSButton';
import { useAuthStore } from '../src/shared/store/authStore';
import { useJourneyStore } from '../src/shared/store/journeyStore';
import { BusSession, getBusSession } from '../src/shared/utils/busSession';

export default function ActiveJourneyScreen() {
  const { isJourneyStarted, passengerDetails, vehicleDetails, bookingId, setJourneyStarted } = useJourneyStore();
  const authUser = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const [session, setSession] = useState<BusSession | null>(null);
  const [isLoadingOngoing, setIsLoadingOngoing] = useState(false);

  useEffect(() => {
    // 1. Bus session if running on in-cab device
    getBusSession().then(setSession).catch(() => { });

    // 2. Hydrate passenger details from authenticated user
    if (authUser) {
      useJourneyStore.setState({
        passengerDetails: {
          id: authUser.passengerId || authUser.uid,
          name: authUser.userName || authUser.email || 'Passenger',
          phone: authUser.phoneNumber || authUser.secondaryPhoneNumber || '0771234567',
        },
        caregiverId: authUser.guardianDetails?.mobileNo || authUser.guardianId || null,
      });
    }

    // 3. Hydrate active journey from ongoing journeys API
    if (token) {
      setIsLoadingOngoing(true);
      getOngoingJourneys(token)
        .then((journeys) => {
          if (journeys && journeys.length > 0) {
            const current = journeys[0];
            useJourneyStore.setState({
              isJourneyStarted: true,
              bookingId: current.booking.bookingId,
              vehicleDetails: {
                plateNumber: current.booking.vehicle?.numberPlate || current.busId || 'BUS-TRANSIT',
                model: current.booking.vehicle?.busModel || 'Transit Bus',
              },
              driverId: current.busId || current.activeJourney?.tripId || null,
            });
          }
        })
        .catch(() => { })
        .finally(() => setIsLoadingOngoing(false));
    }
  }, [authUser, token]);

  const activeName = authUser?.userName || passengerDetails?.name || 'Passenger';
  const activePhone = authUser?.phoneNumber || passengerDetails?.phone || '0771234567';
  const specialAssistance = (authUser?.accessibilityNeeds && authUser.accessibilityNeeds.length > 0)
    ? authUser.accessibilityNeeds.join(', ')
    : authUser?.isWheelchairUser
      ? 'Wheelchair Assistance'
      : authUser?.isWalkingDifficultyPerson
        ? 'Walking Difficulty Support'
        : authUser?.isLowVisionPerson
          ? 'Low Vision Support'
          : authUser?.isHearingImpaired
            ? 'Hearing Support'
            : null;

  const vehiclePlate = session?.numberPlate || vehicleDetails?.plateNumber || 'Transit Bus';
  const vehicleModel = vehicleDetails?.model || 'Transit Bus';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      {/* Top Navigation Header */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={22} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle}>Active Journey</Text>
          <Text style={styles.headerSubtitle}>Real-time transit & rapid safety dispatch</Text>
        </View>
        <View style={styles.headerRightAction}>
          <View style={[styles.pulseBadge, isJourneyStarted ? styles.pulseActive : styles.pulseIdle]}>
            <View style={[styles.pulseDot, isJourneyStarted ? styles.pulseDotActive : styles.pulseDotIdle]} />
            <Text style={[styles.pulseText, isJourneyStarted ? styles.pulseTextActive : styles.pulseTextIdle]}>
              {isJourneyStarted ? 'LIVE' : 'IDLE'}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Real Commuter Profile Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.avatarCircle}>
              <Ionicons name="person" size={20} color="#0066CC" />
            </View>
            <View style={styles.cardHeaderTextCol}>
              <Text style={styles.cardSuperLabel}>COMMUTER DETAILS</Text>
              <Text style={styles.passengerNameText} numberOfLines={1}>{activeName}</Text>
              <View style={styles.phoneRow}>
                <Ionicons name="call-outline" size={13} color="#64748B" />
                <Text style={styles.passengerPhoneText}>{activePhone}</Text>
              </View>
            </View>
            <View style={styles.verifiedPill}>
              <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
              <Text style={styles.verifiedText}>Verified</Text>
            </View>
          </View>

          {specialAssistance && (
            <View style={styles.specialAssistanceBadge}>
              <Ionicons name="accessibility" size={14} color="#7C3AED" />
              <Text style={styles.specialAssistanceText}>{specialAssistance}</Text>
            </View>
          )}
        </View>

        {/* 2. Vehicle & Booking Details Card */}
        <View style={[styles.card, styles.vehicleCard]}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.vehicleIconCircle}>
              <Ionicons name="bus" size={20} color="#047857" />
            </View>
            <View style={styles.cardHeaderTextCol}>
              <Text style={styles.vehicleSuperLabel}>ASSIGNED VEHICLE</Text>
              <Text style={styles.vehiclePlateText}>{vehiclePlate}</Text>
              <Text style={styles.vehicleModelText}>
                {vehicleModel} {bookingId ? `• Booking: ${bookingId}` : ''}
              </Text>
            </View>
          </View>
        </View>

        {/* 3. Live Journey State Display */}
        <View style={styles.statusSection}>
          {isLoadingOngoing ? (
            <View style={styles.statusBoxLoading}>
              <ActivityIndicator size="small" color="#0066CC" />
              <Text style={styles.statusLoadingText}>Syncing live transit broadcast...</Text>
            </View>
          ) : isJourneyStarted ? (
            <View style={styles.statusBoxActive}>
              <View style={styles.statusIconCircleActive}>
                <Ionicons name="navigate-circle" size={26} color="#047857" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.startedLabel}>Your journey has been started</Text>
                <Text style={styles.startedSub}>Real-time location broadcast enabled onboard</Text>
              </View>
            </View>
          ) : (
            <View style={styles.statusBoxWaiting}>
              <View style={styles.statusIconCircleWaiting}>
                <Ionicons name="time-outline" size={24} color="#64748B" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.waitingLabel}>Waiting for journey to start...</Text>
                <Text style={styles.waitingSub}>Beacon will activate once transit departs</Text>
              </View>
            </View>
          )}
        </View>

        {/* 4. SOS Emergency Dispatch Section */}
        <View style={styles.sosCard}>
          <View style={styles.sosHeaderRow}>
            <Ionicons name="alert-circle" size={20} color="#DC2626" />
            <Text style={styles.sosCardTitle}>RAPID EMERGENCY RESPONSE</Text>
          </View>
          <Text style={styles.sosCardSub}>
            Press the emergency button below to instantly broadcast an urgent safety alert to the bus driver, your caregiver, and transit dispatch.
          </Text>

          <View style={styles.sosButtonWrapper}>
            <SOSButton />
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
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleGroup: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  headerRightAction: {
    marginLeft: 8,
  },
  pulseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 5,
  },
  pulseActive: {
    backgroundColor: '#DCFCE7',
  },
  pulseIdle: {
    backgroundColor: '#F1F5F9',
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pulseDotActive: {
    backgroundColor: '#16A34A',
  },
  pulseDotIdle: {
    backgroundColor: '#94A3B8',
  },
  pulseText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  pulseTextActive: {
    color: '#16A34A',
  },
  pulseTextIdle: {
    color: '#64748B',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  vehicleCard: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vehicleIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardHeaderTextCol: {
    flex: 1,
    marginLeft: 12,
  },
  cardSuperLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
  },
  vehicleSuperLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#047857',
    letterSpacing: 0.5,
  },
  passengerNameText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 4,
  },
  passengerPhoneText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  verifiedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16A34A',
  },
  specialAssistanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    marginTop: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#EDE9FE',
  },
  specialAssistanceText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7C3AED',
  },
  vehiclePlateText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#065F46',
    marginTop: 2,
  },
  vehicleModelText: {
    fontSize: 12,
    color: '#047857',
    marginTop: 2,
    fontWeight: '500',
  },
  statusSection: {
    marginBottom: 16,
  },
  statusBoxLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  statusLoadingText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  statusBoxActive: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  statusIconCircleActive: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  startedLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#065F46',
  },
  startedSub: {
    fontSize: 11,
    color: '#047857',
    marginTop: 2,
  },
  statusBoxWaiting: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusIconCircleWaiting: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  waitingLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
  },
  waitingSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  sosCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: '#FEE2E2',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    alignItems: 'center',
  },
  sosHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  sosCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 0.5,
  },
  sosCardSub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 16,
  },
  sosButtonWrapper: {
    width: '100%',
    alignItems: 'center',
  },
});
