/**
 * Caregiver Active Trip Safety Banner (MOV-227 / MOV-229)
 *
 * Displays a reassuring safety sharing status indicator to passengers during their journey.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CaregiverSafetyCenterModal } from './CaregiverSafetyCenterModal';

interface CaregiverActiveTripBannerProps {
  passengerId: string;
  passengerName?: string;
  isSharingActive?: boolean;
}

export const CaregiverActiveTripBanner: React.FC<CaregiverActiveTripBannerProps> = ({
  passengerId,
  passengerName,
  isSharingActive = true,
}) => {
  const [modalVisible, setModalVisible] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={[styles.banner, !isSharingActive && styles.bannerPaused]}
        onPress={() => setModalVisible(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Caregiver safety sharing status banner"
      >
        <View style={styles.iconBox}>
          <Ionicons
            name={isSharingActive ? 'shield-checkmark' : 'pause-circle'}
            size={20}
            color={isSharingActive ? '#0284C7' : '#94A3B8'}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[styles.title, !isSharingActive && styles.titlePaused]}>
            {isSharingActive ? 'Caregiver Safety Sharing Active' : 'Caregiver Sharing Paused'}
          </Text>
          <Text style={styles.subtitle}>
            {isSharingActive
              ? 'Real-time SMS, Email & GPS tracking enabled'
              : 'Tap to manage permissions or resume'}
          </Text>
        </View>

        <View style={styles.manageBtn}>
          <Text style={styles.manageBtnText}>Manage</Text>
          <Ionicons name="chevron-forward" size={14} color="#0284C7" />
        </View>
      </TouchableOpacity>

      <CaregiverSafetyCenterModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        passengerId={passengerId}
        passengerName={passengerName}
      />
    </>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    marginVertical: 8,
  },
  bannerPaused: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0369A1',
  },
  titlePaused: {
    color: '#64748B',
  },
  subtitle: {
    fontSize: 11,
    color: '#0284C7',
    marginTop: 1,
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  manageBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
});
