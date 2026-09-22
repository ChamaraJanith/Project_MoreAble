/**
 * Zero-Login Caregiver Live Journey Tracking Screen (MOV-227 / MOV-230)
 *
 * Rendered when a caregiver opens the tracking link from SMS/Email on any web or mobile browser.
 * Displays real-time bus location, live route timeline, arrival countdown, and emergency contacts.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CaregiverLiveTrackingData } from '../../../entities/caregiver/model/types';
import { fetchLiveTrackingByToken } from '../api/caregiverService';
import { CaregiverInteractiveMap } from './CaregiverInteractiveMap';

interface CaregiverLiveTrackingScreenProps {
  token: string;
}

export const CaregiverLiveTrackingScreen: React.FC<CaregiverLiveTrackingScreenProps> = ({ token }) => {
  const [data, setData] = useState<CaregiverLiveTrackingData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const loadData = async (showLoading = false) => {
    if (showLoading) setIsLoading(true);
    try {
      const tracking = await fetchLiveTrackingByToken(token);
      if (tracking) {
        setData(tracking);
        setErrorMsg(null);
        setLastRefreshed(new Date());
      } else {
        setErrorMsg('Unable to retrieve tracking details. The link may have expired or was disabled by the passenger.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error loading live tracking.');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);
    // Real-time auto-refresh interval every 12 seconds
    const interval = setInterval(() => {
      loadData(false);
    }, 12000);

    return () => clearInterval(interval);
  }, [token]);

  const handleCallEmergency = () => {
    const phone = data?.emergencyPhone || '1990';
    Linking.openURL(`tel:${phone}`);
  };

  const handleCallDriver = () => {
    if (data?.driverPhone) {
      Linking.openURL(`tel:${data.driverPhone}`);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#0284C7" />
        <Text style={styles.loadingTitle}>Connecting to Live Bus GPS...</Text>
        <Text style={styles.loadingSub}>Fetching real-time transit telemetry</Text>
      </View>
    );
  }

  if (errorMsg || !data) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="alert-circle-outline" size={56} color="#EF4444" />
        <Text style={styles.errorTitle}>Live Tracking Unavailable</Text>
        <Text style={styles.errorSub}>{errorMsg || 'Journey link is invalid or expired.'}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => loadData(true)}>
          <Ionicons name="refresh" size={18} color="#FFFFFF" />
          <Text style={styles.retryBtnText}>Retry Connection</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isArrived = data.journeyStatus === 'ARRIVED';
  const isBoarded = data.journeyStatus === 'IN_TRANSIT' || data.journeyStatus === 'BOARDED';

  return (
    <View style={styles.container}>
      {/* Top App Bar */}
      <View style={styles.topBar}>
        <View style={styles.branding}>
          <View style={styles.brandIcon}>
            <Ionicons name="shield-checkmark" size={18} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.brandTitle} numberOfLines={1}>MoreAble Safety</Text>
            <Text style={styles.brandSubtitle} numberOfLines={1}>Live Passenger Monitor</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.refreshBtn} onPress={() => loadData(false)} activeOpacity={0.7}>
          <Ionicons name="sync" size={14} color="#0284C7" />
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollBody} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Passenger Hero Card */}
        <View style={styles.passengerHero}>
          <View style={styles.heroRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroLabel}>MONITORING PASSENGER</Text>
              <Text style={styles.heroName}>{data.passengerName}</Text>
              {data.hasAccessibilityNeeds && data.accessibilityNeeds && data.accessibilityNeeds.length > 0 && (
                <View style={styles.accessTagsRow}>
                  {data.accessibilityNeeds.map((need, idx) => (
                    <View key={idx} style={styles.accessBadge}>
                      <Ionicons name="accessibility" size={12} color="#0369A1" />
                      <Text style={styles.accessBadgeText}>{need}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.statusPill}>
              <View style={[styles.statusDot, isArrived ? styles.statusDotGreen : styles.statusDotBlue]} />
              <Text style={styles.statusPillText}>{data.journeyStatus.replace('_', ' ')}</Text>
            </View>
          </View>

          {/* Route Info */}
          <View style={styles.routeHeaderBox}>
            <Ionicons name="bus" size={20} color="#0284C7" />
            <Text style={styles.routeHeaderText}>
              Route {data.routeNumber} • {data.routeName}
            </Text>
          </View>
        </View>

        {/* Real-time Interactive Route & Live Bus Map */}
        <View style={styles.mapCard}>
          <CaregiverInteractiveMap data={data} height={320} />

          <View style={styles.gpsTelemetryOverlayBar}>
            {data.currentLocation ? (
              <View style={styles.telemetryRow}>
                <View style={styles.telemetryItem}>
                  <Text style={styles.telemetryLabel}>GPS FIX</Text>
                  <Text style={styles.telemetryValue}>
                    {data.currentLocation.latitude.toFixed(4)}, {data.currentLocation.longitude.toFixed(4)}
                  </Text>
                </View>
                <View style={styles.telemetryDivider} />
                <View style={styles.telemetryItem}>
                  <Text style={styles.telemetryLabel}>SPEED</Text>
                  <Text style={styles.telemetryValue}>{data.currentLocation.speedKmH || 0} km/h</Text>
                </View>
                <View style={styles.telemetryDivider} />
                <View style={styles.telemetryItem}>
                  <Text style={styles.telemetryLabel}>STATUS</Text>
                  <Text style={[styles.telemetryValue, { color: '#0284C7' }]}>
                    {isArrived ? 'Arrived' : data.journeyStatus === 'IN_TRANSIT' ? 'Live Moving' : 'Scheduled'}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.telemetryAwaiting}>
                <Ionicons name="radio" size={16} color="#0284C7" />
                <Text style={styles.telemetryAwaitingText}>
                  {data.journeyStatus === 'SCHEDULED'
                    ? 'Awaiting bus departure from boarding halt'
                    : 'Connecting to live bus satellite telemetry...'}
                </Text>
              </View>
            )}
          </View>

          {/* ETA Banner */}
          <View style={styles.etaBanner}>
            <View>
              <Text style={styles.etaLabel}>ESTIMATED ARRIVAL</Text>
              <Text style={styles.etaValue}>
                {isArrived ? 'Safe Arrival Completed' : `~ ${data.etaMinutes} mins remaining`}
              </Text>
            </View>
            <View style={styles.etaBadge}>
              <Ionicons name="time" size={18} color="#0369A1" />
              <Text style={styles.etaBadgeText}>On Time</Text>
            </View>
          </View>
        </View>

        {/* Route Stops Timeline */}
        <View style={styles.timelineCard}>
          <Text style={styles.cardSectionTitle}>Journey Route Timeline</Text>

          <View style={styles.timelineList}>
            {data.stopsTimeline.map((stop, index) => {
              const isFirst = index === 0;
              const isLast = index === data.stopsTimeline.length - 1;

              return (
                <View key={index} style={styles.timelineItem}>
                  <View style={styles.timelineIconCol}>
                    <View
                      style={[
                        styles.timelineDot,
                        stop.isPassed && styles.timelineDotPassed,
                        stop.isCurrent && styles.timelineDotCurrent,
                        stop.isDestination && styles.timelineDotDest,
                      ]}
                    >
                      {stop.isPassed ? (
                        <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                      ) : stop.isDestination ? (
                        <Ionicons name="flag" size={12} color="#FFFFFF" />
                      ) : null}
                    </View>
                    {!isLast && <View style={[styles.timelineLine, stop.isPassed && styles.timelineLinePassed]} />}
                  </View>

                  <View style={styles.timelineTextCol}>
                    <View style={styles.stopNameRow}>
                      <Text
                        style={[
                          styles.stopName,
                          stop.isCurrent && styles.stopNameCurrent,
                          stop.isDestination && styles.stopNameDest,
                        ]}
                      >
                        {stop.name}
                      </Text>
                      {isFirst && <Text style={styles.stopSubBadge}>Boarding Halt</Text>}
                      {isLast && <Text style={styles.stopSubBadgeDest}>Destination</Text>}
                    </View>
                    {stop.isCurrent && (
                      <Text style={styles.currentBusNotice}>
                        {isArrived
                          ? '✅ Safely reached destination'
                          : isBoarded || data.journeyStatus === 'IN_TRANSIT'
                          ? '🚌 Bus approaching this halt right now'
                          : '🕒 Boarding halt • Waiting for bus departure'}
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Vehicle & Emergency Support Card */}
        <View style={styles.supportCard}>
          <Text style={styles.cardSectionTitle}>Vehicle & Safety Contacts</Text>

          <View style={styles.supportGrid}>
            <View style={styles.supportItem}>
              <Text style={styles.supportLabel}>Bus Vehicle</Text>
              <Text style={styles.supportValue}>{data.busRegistrationNumber}</Text>
              <Text style={styles.supportSub}>{data.busModel || 'Low Floor City Coach'}</Text>
            </View>

            <View style={styles.supportItem}>
              <Text style={styles.supportLabel}>Assigned Driver</Text>
              <Text style={styles.supportValue}>{data.driverName || 'Licensed Driver'}</Text>
              {data.driverPhone && (
                <TouchableOpacity style={styles.callDriverBtn} onPress={handleCallDriver}>
                  <Ionicons name="call" size={12} color="#0284C7" />
                  <Text style={styles.callDriverBtnText}>Call Driver</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Quick Emergency Button */}
          <TouchableOpacity style={styles.emergencyBtn} onPress={handleCallEmergency}>
            <Ionicons name="alert-circle" size={20} color="#FFFFFF" />
            <Text style={styles.emergencyBtnText}>Emergency Assistance (1990 Suwa Seriya)</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerNoteText}>
            Updated: {lastRefreshed.toLocaleTimeString()} • Powered by MoreAble SafeTransit™ Engine
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 16,
  },
  loadingSub: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#DC2626',
    marginTop: 16,
  },
  errorSub: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
    maxWidth: 320,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#0284C7',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginTop: 20,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 48 : 14,
    paddingBottom: 14,
    borderBottomWidth: 3,
    borderBottomColor: '#0284C7',
    gap: 12,
  },
  branding: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  brandIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#0284C7',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  brandTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  brandSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F0F9FF',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    flexShrink: 0,
  },
  refreshText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
  },
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  passengerHero: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0284C7',
    letterSpacing: 0.5,
  },
  heroName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  accessTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  accessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0F9FF',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  accessBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0369A1',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotGreen: {
    backgroundColor: '#16A34A',
  },
  statusDotBlue: {
    backgroundColor: '#0284C7',
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  routeHeaderBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  routeHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  mapCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    overflow: 'hidden',
    marginBottom: 14,
  },
  gpsTelemetryOverlayBar: {
    backgroundColor: '#0F172A',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  telemetryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  telemetryItem: {
    alignItems: 'center',
    flex: 1,
  },
  telemetryDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#334155',
  },
  telemetryLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  telemetryValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 2,
  },
  telemetryAwaiting: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  telemetryAwaitingText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '600',
  },
  etaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#F0F9FF',
    borderTopWidth: 1,
    borderTopColor: '#BAE6FD',
  },
  etaLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284C7',
  },
  etaValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0369A1',
    marginTop: 2,
  },
  etaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  etaBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0369A1',
  },
  timelineCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    marginBottom: 14,
  },
  cardSectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 16,
  },
  timelineList: {
    paddingLeft: 4,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 18,
  },
  timelineIconCol: {
    alignItems: 'center',
    width: 28,
  },
  timelineDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotPassed: {
    backgroundColor: '#16A34A',
  },
  timelineDotCurrent: {
    backgroundColor: '#0284C7',
    borderWidth: 3,
    borderColor: '#BAE6FD',
  },
  timelineDotDest: {
    backgroundColor: '#0F172A',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  timelineLinePassed: {
    backgroundColor: '#16A34A',
  },
  timelineTextCol: {
    flex: 1,
    marginLeft: 12,
    paddingTop: 1,
  },
  stopNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  stopName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  stopNameCurrent: {
    color: '#0284C7',
    fontWeight: '800',
    fontSize: 15,
  },
  stopNameDest: {
    color: '#0F172A',
    fontWeight: '700',
  },
  stopSubBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0284C7',
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  stopSubBadgeDest: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0F172A',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  currentBusNotice: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
    marginTop: 4,
  },
  supportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    marginBottom: 14,
  },
  supportGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  supportItem: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  supportLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  supportValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },
  supportSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  callDriverBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  callDriverBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  emergencyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingVertical: 12,
    borderRadius: 10,
  },
  emergencyBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  footerNote: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  footerNoteText: {
    fontSize: 11,
    color: '#94A3B8',
  },
});
