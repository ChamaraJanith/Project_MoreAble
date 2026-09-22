/**
 * Caregiver Safety Sharing Center Modal (MOV-227 / MOV-228 / MOV-229)
 *
 * Full-featured modal providing passengers with complete control over their
 * linked caregivers, granular alert switches (Booking, Boarding, Live GPS, Arrival),
 * multi-channel preferences (SMS/Email), safety audit log, and master pause switch.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CaregiverLink, CaregiverPermissions, CaregiverSafetyLog } from '../../../entities/caregiver/model/types';
import {
  fetchCaregiverSafetyLogs,
  fetchPassengerCaregivers,
  linkNewCaregiver,
  removeCaregiverLink,
  setMasterSharingStatus,
  updateCaregiverPermissions,
} from '../api/caregiverService';
import { isValidEmail, isValidSriLankanMobile } from '../model/caregiverUtils';

interface CaregiverSafetyCenterModalProps {
  visible: boolean;
  onClose: () => void;
  passengerId: string;
  passengerName?: string;
  theme?: {
    isHighContrast?: boolean;
    colors?: {
      background?: string;
      card?: string;
      text?: string;
      border?: string;
      primary?: string;
    };
  };
}

export const CaregiverSafetyCenterModal: React.FC<CaregiverSafetyCenterModalProps> = ({
  visible,
  onClose,
  passengerId,
  passengerName,
  theme,
}) => {
  const [activeTab, setActiveTab] = useState<'CAREGIVERS' | 'ADD_NEW' | 'LOGS'>('CAREGIVERS');
  const [caregivers, setCaregivers] = useState<CaregiverLink[]>([]);
  const [logs, setLogs] = useState<CaregiverSafetyLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [masterSharing, setMasterSharing] = useState<boolean>(true);

  // Form State
  const [formName, setFormName] = useState('');
  const [formMobile, setFormMobile] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRelationship, setFormRelationship] = useState('Parent');
  const [formErrors, setFormErrors] = useState<{ name?: string; mobile?: string; email?: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Expanded permission accordion state
  const [expandedLinkId, setExpandedLinkId] = useState<string | null>(null);

  const loadCaregivers = async () => {
    if (!passengerId) return;
    setIsLoading(true);
    try {
      const list = await fetchPassengerCaregivers(passengerId);
      setCaregivers(list);
      // Master toggle is true if at least one caregiver has isSharingActive or list is empty
      if (list.length > 0) {
        setMasterSharing(list.some((c) => c.permissions?.isSharingActive !== false));
      }
    } catch (err) {
      console.error('Error loading caregivers:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadLogs = async () => {
    if (!passengerId) return;
    try {
      const auditLogs = await fetchCaregiverSafetyLogs(passengerId);
      setLogs(auditLogs);
    } catch (err) {
      console.error('Error loading safety logs:', err);
    }
  };

  useEffect(() => {
    if (visible) {
      loadCaregivers();
      loadLogs();
      setActiveTab('CAREGIVERS');
    }
  }, [visible, passengerId]);

  const handleMasterToggle = async (val: boolean) => {
    setMasterSharing(val);
    await setMasterSharingStatus(passengerId, val);
    setCaregivers((prev) =>
      prev.map((c) => ({
        ...c,
        permissions: {
          ...c.permissions,
          isSharingActive: val,
        },
      }))
    );
  };

  const handlePermissionToggle = async (
    linkId: string,
    field: keyof CaregiverPermissions | 'sms' | 'email',
    currentVal: boolean
  ) => {
    const targetCaregiver = caregivers.find((c) => c.linkId === linkId);
    if (!targetCaregiver) return;

    let updatedPermissions: CaregiverPermissions = { ...targetCaregiver.permissions };

    if (field === 'sms' || field === 'email') {
      updatedPermissions.channels = {
        ...updatedPermissions.channels,
        [field]: !currentVal,
      };
    } else {
      (updatedPermissions as any)[field] = !currentVal;
    }

    setCaregivers((prev) =>
      prev.map((c) => (c.linkId === linkId ? { ...c, permissions: updatedPermissions } : c))
    );

    await updateCaregiverPermissions(linkId, passengerId, updatedPermissions);
  };

  const handleDeleteCaregiver = (linkId: string, name: string) => {
    const doDelete = async () => {
      const ok = await removeCaregiverLink(linkId, passengerId);
      if (ok) {
        setCaregivers((prev) => prev.filter((c) => c.linkId !== linkId));
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`Are you sure you want to remove ${name} from your safety sharing network?`)) {
        doDelete();
      }
    } else {
      Alert.alert(
        'Remove Caregiver',
        `Are you sure you want to remove ${name} from receiving your journey alerts?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  };

  const handleAddSubmit = async () => {
    const errors: { name?: string; mobile?: string; email?: string } = {};

    if (!formName.trim()) {
      errors.name = 'Full name is required';
    }
    if (!formMobile.trim() && !formEmail.trim()) {
      errors.mobile = 'Provide either a mobile number or email address';
      errors.email = 'Provide either a mobile number or email address';
    }
    if (formMobile.trim() && !isValidSriLankanMobile(formMobile.trim())) {
      errors.mobile = 'Enter a valid 10-digit Sri Lankan mobile (e.g. 0771234567)';
    }
    if (formEmail.trim() && !isValidEmail(formEmail.trim())) {
      errors.email = 'Enter a valid email address';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setFormErrors({});
    setIsSubmitting(true);

    const result = await linkNewCaregiver({
      passengerId,
      fullName: formName.trim(),
      mobileNo: formMobile.trim(),
      email: formEmail.trim(),
      relationship: formRelationship,
    });

    setIsSubmitting(false);

    if (result.success && result.link) {
      setCaregivers((prev) => [result.link!, ...prev]);
      setFormName('');
      setFormMobile('');
      setFormEmail('');
      setActiveTab('CAREGIVERS');
      if (Platform.OS === 'web') {
        window.alert('Caregiver successfully linked to your safety network!');
      } else {
        Alert.alert('Success', 'Caregiver successfully linked to your safety network!');
      }
    } else {
      if (Platform.OS === 'web') {
        window.alert(result.message || 'Failed to add caregiver.');
      } else {
        Alert.alert('Error', result.message || 'Failed to add caregiver.');
      }
    }
  };

  const RELATIONSHIPS = ['Parent', 'Guardian', 'Spouse', 'Child', 'Sibling', 'Caregiver / Nurse', 'Doctor / Medical Aid', 'Emergency Contact', 'Other'];

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="shield-checkmark" size={24} color="#0284C7" />
              <Text style={styles.headerTitle}>Caregiver & Safety Sharing</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close Safety Center">
              <Ionicons name="close" size={24} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* Master Switch Bar */}
          <View style={styles.masterBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.masterTitle}>
                {masterSharing ? '🛡️ Live Safety Sharing Active' : '⏸️ Sharing Paused'}
              </Text>
              <Text style={styles.masterSub}>
                {masterSharing
                  ? 'Authorized caregivers will receive real-time alerts & tracking'
                  : 'All notifications and live tracking links are temporarily disabled'}
              </Text>
            </View>
            <Switch
              value={masterSharing}
              onValueChange={handleMasterToggle}
              trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
              thumbColor={masterSharing ? '#0284C7' : '#94A3B8'}
            />
          </View>

          {/* Tabs Navigation */}
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'CAREGIVERS' && styles.tabButtonActive]}
              onPress={() => setActiveTab('CAREGIVERS')}
            >
              <Ionicons
                name="people"
                size={18}
                color={activeTab === 'CAREGIVERS' ? '#0284C7' : '#64748B'}
              />
              <Text style={[styles.tabText, activeTab === 'CAREGIVERS' && styles.tabTextActive]}>
                Caregivers ({caregivers.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'ADD_NEW' && styles.tabButtonActive]}
              onPress={() => setActiveTab('ADD_NEW')}
            >
              <Ionicons
                name="person-add"
                size={18}
                color={activeTab === 'ADD_NEW' ? '#0284C7' : '#64748B'}
              />
              <Text style={[styles.tabText, activeTab === 'ADD_NEW' && styles.tabTextActive]}>
                Add Caregiver
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'LOGS' && styles.tabButtonActive]}
              onPress={() => setActiveTab('LOGS')}
            >
              <Ionicons
                name="time"
                size={18}
                color={activeTab === 'LOGS' ? '#0284C7' : '#64748B'}
              />
              <Text style={[styles.tabText, activeTab === 'LOGS' && styles.tabTextActive]}>
                Safety Logs
              </Text>
            </TouchableOpacity>
          </View>

          {/* Tab 1: Caregiver List & Granular Permissions */}
          {activeTab === 'CAREGIVERS' && (
            <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
              {isLoading ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="large" color="#0284C7" />
                  <Text style={styles.loadingText}>Loading safety network...</Text>
                </View>
              ) : caregivers.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="person-add-outline" size={48} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>No Caregivers Linked Yet</Text>
                  <Text style={styles.emptySub}>
                    Add family members, guardians, or nurses to automatically receive booking, boarding, and live tracking alerts.
                  </Text>
                  <TouchableOpacity style={styles.addCtaBtn} onPress={() => setActiveTab('ADD_NEW')}>
                    <Text style={styles.addCtaBtnText}>+ Add First Caregiver</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                caregivers.map((c) => {
                  const isExpanded = expandedLinkId === c.linkId;
                  const p = c.permissions || {};
                  return (
                    <View key={c.linkId} style={styles.caregiverCard}>
                      <View style={styles.cardHeader}>
                        <View style={styles.avatarBox}>
                          <Ionicons
                            name={c.isPrimaryGuardian ? 'shield' : 'person'}
                            size={20}
                            color="#FFFFFF"
                          />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <View style={styles.nameRow}>
                            <Text style={styles.caregiverName}>{c.fullName}</Text>
                            {c.isPrimaryGuardian && (
                              <View style={styles.primaryBadge}>
                                <Text style={styles.primaryBadgeText}>PRIMARY GUARDIAN</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.caregiverMeta}>
                            {c.relationship} • {c.mobileNo || c.email}
                          </Text>
                        </View>

                        <TouchableOpacity
                          style={styles.expandBtn}
                          onPress={() => setExpandedLinkId(isExpanded ? null : c.linkId)}
                        >
                          <Ionicons
                            name={isExpanded ? 'chevron-up' : 'settings-outline'}
                            size={20}
                            color="#0284C7"
                          />
                        </TouchableOpacity>
                      </View>

                      {/* Granular Permission Controls Accordion */}
                      {isExpanded && (
                        <View style={styles.permissionsContainer}>
                          <Text style={styles.permSectionTitle}>Granular Alert Permissions</Text>

                          {/* Master for this user */}
                          <View style={styles.permRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.permLabel}>Active Sharing</Text>
                              <Text style={styles.permDesc}>Enable/disable updates for this caregiver</Text>
                            </View>
                            <Switch
                              value={p.isSharingActive !== false}
                              onValueChange={() => handlePermissionToggle(c.linkId, 'isSharingActive', p.isSharingActive !== false)}
                              trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
                              thumbColor={p.isSharingActive !== false ? '#0284C7' : '#94A3B8'}
                            />
                          </View>

                          {/* Booking Alert */}
                          <View style={styles.permRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.permLabel}>🎟️ Booking Confirmation Alerts</Text>
                              <Text style={styles.permDesc}>Notify when a bus trip is reserved</Text>
                            </View>
                            <Switch
                              value={p.shareBookingConfirmation !== false}
                              onValueChange={() => handlePermissionToggle(c.linkId, 'shareBookingConfirmation', p.shareBookingConfirmation !== false)}
                              trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
                              thumbColor={p.shareBookingConfirmation !== false ? '#0284C7' : '#94A3B8'}
                            />
                          </View>

                          {/* Boarding Alert */}
                          <View style={styles.permRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.permLabel}>🚌 Boarding Status Alerts</Text>
                              <Text style={styles.permDesc}>Notify when conductor scans QR & you board</Text>
                            </View>
                            <Switch
                              value={p.shareBoardingStatus !== false}
                              onValueChange={() => handlePermissionToggle(c.linkId, 'shareBoardingStatus', p.shareBoardingStatus !== false)}
                              trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
                              thumbColor={p.shareBoardingStatus !== false ? '#0284C7' : '#94A3B8'}
                            />
                          </View>

                          {/* Live GPS Tracking */}
                          <View style={styles.permRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.permLabel}>📍 Live GPS Tracking Link</Text>
                              <Text style={styles.permDesc}>Allow viewing real-time bus location & ETA</Text>
                            </View>
                            <Switch
                              value={p.shareLiveProgress !== false}
                              onValueChange={() => handlePermissionToggle(c.linkId, 'shareLiveProgress', p.shareLiveProgress !== false)}
                              trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
                              thumbColor={p.shareLiveProgress !== false ? '#0284C7' : '#94A3B8'}
                            />
                          </View>

                          {/* Safe Arrival */}
                          <View style={styles.permRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.permLabel}>🏁 Safe Arrival Alerts</Text>
                              <Text style={styles.permDesc}>Notify when destination is reached</Text>
                            </View>
                            <Switch
                              value={p.shareDestinationArrival !== false}
                              onValueChange={() => handlePermissionToggle(c.linkId, 'shareDestinationArrival', p.shareDestinationArrival !== false)}
                              trackColor={{ false: '#CBD5E1', true: '#38BDF8' }}
                              thumbColor={p.shareDestinationArrival !== false ? '#0284C7' : '#94A3B8'}
                            />
                          </View>

                          {/* Channels */}
                          <Text style={[styles.permSectionTitle, { marginTop: 14 }]}>Delivery Channels</Text>
                          <View style={styles.channelsRow}>
                            <TouchableOpacity
                              style={[styles.channelChip, p.channels?.sms !== false && styles.channelChipActive]}
                              onPress={() => handlePermissionToggle(c.linkId, 'sms', p.channels?.sms !== false)}
                            >
                              <Ionicons name="chatbubble" size={14} color={p.channels?.sms !== false ? '#0284C7' : '#94A3B8'} />
                              <Text style={[styles.channelChipText, p.channels?.sms !== false && styles.channelChipTextActive]}>
                                SMS Alerts
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[styles.channelChip, p.channels?.email !== false && styles.channelChipActive]}
                              onPress={() => handlePermissionToggle(c.linkId, 'email', p.channels?.email !== false)}
                            >
                              <Ionicons name="mail" size={14} color={p.channels?.email !== false ? '#0284C7' : '#94A3B8'} />
                              <Text style={[styles.channelChipText, p.channels?.email !== false && styles.channelChipTextActive]}>
                                Email Alerts
                              </Text>
                            </TouchableOpacity>
                          </View>

                          {!c.isPrimaryGuardian && (
                            <TouchableOpacity
                              style={styles.deleteLinkBtn}
                              onPress={() => handleDeleteCaregiver(c.linkId, c.fullName)}
                            >
                              <Ionicons name="trash-outline" size={16} color="#DC2626" />
                              <Text style={styles.deleteLinkBtnText}>Remove Caregiver</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}

          {/* Tab 2: Add Caregiver Form */}
          {activeTab === 'ADD_NEW' && (
            <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
              <Text style={styles.formSectionTitle}>Caregiver Details</Text>

              {/* Full Name */}
              <Text style={styles.inputLabel}>Full Name *</Text>
              <TextInput
                style={[styles.textInput, formErrors.name && styles.inputError]}
                placeholder="e.g. Sunil Perera"
                placeholderTextColor="#94A3B8"
                value={formName}
                onChangeText={setFormName}
              />
              {formErrors.name && <Text style={styles.errorText}>{formErrors.name}</Text>}

              {/* Mobile */}
              <Text style={styles.inputLabel}>Mobile Phone Number (for SMS & WhatsApp) *</Text>
              <TextInput
                style={[styles.textInput, formErrors.mobile && styles.inputError]}
                placeholder="e.g. 0771234567"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                value={formMobile}
                onChangeText={setFormMobile}
              />
              {formErrors.mobile && <Text style={styles.errorText}>{formErrors.mobile}</Text>}

              {/* Email */}
              <Text style={styles.inputLabel}>Email Address (for HTML Travel Alerts) *</Text>
              <TextInput
                style={[styles.textInput, formErrors.email && styles.inputError]}
                placeholder="e.g. sunil.perera@example.com"
                placeholderTextColor="#94A3B8"
                keyboardType="email-address"
                autoCapitalize="none"
                value={formEmail}
                onChangeText={setFormEmail}
              />
              {formErrors.email && <Text style={styles.errorText}>{formErrors.email}</Text>}

              {/* Relationship */}
              <Text style={styles.inputLabel}>Relationship</Text>
              <View style={styles.chipsWrapper}>
                {RELATIONSHIPS.map((rel) => {
                  const isSelected = formRelationship === rel;
                  return (
                    <TouchableOpacity
                      key={rel}
                      style={[styles.relChip, isSelected && styles.relChipActive]}
                      onPress={() => setFormRelationship(rel)}
                    >
                      <Text style={[styles.relChipText, isSelected && styles.relChipTextActive]}>{rel}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
                onPress={handleAddSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>Save & Enable Sharing</Text>
                  </>
                )}
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* Tab 3: Safety Audit Logs */}
          {activeTab === 'LOGS' && (
            <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
              {logs.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="document-text-outline" size={48} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>No Safety Logs Yet</Text>
                  <Text style={styles.emptySub}>
                    When you book or travel on a bus, automated delivery receipts will appear here.
                  </Text>
                </View>
              ) : (
                logs.map((log) => (
                  <View key={log.logId} style={styles.logCard}>
                    <View style={styles.logHeader}>
                      <View style={styles.logBadge}>
                        <Text style={styles.logBadgeText}>{log.eventType}</Text>
                      </View>
                      <Text style={styles.logTime}>
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    <Text style={styles.logTarget}>Recipient: {log.caregiverName} ({log.caregiverMobile || log.caregiverEmail})</Text>
                    <Text style={styles.logSummary}>{log.messageSummary}</Text>
                    <View style={styles.channelsList}>
                      {log.channelsDelivered.map((ch) => (
                        <View key={ch} style={styles.channelDeliveredBadge}>
                          <Text style={styles.channelDeliveredText}>✓ {ch}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    minHeight: '65%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
  },
  masterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0F9FF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#BAE6FD',
  },
  masterTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0369A1',
  },
  masterSub: {
    fontSize: 12,
    color: '#0284C7',
    marginTop: 2,
    paddingRight: 10,
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 8,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: '#0284C7',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  tabTextActive: {
    color: '#0284C7',
    fontWeight: '700',
  },
  tabContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  loadingBox: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
    color: '#64748B',
    fontSize: 14,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#334155',
    marginTop: 12,
  },
  emptySub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  addCtaBtn: {
    marginTop: 18,
    backgroundColor: '#0284C7',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  addCtaBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  caregiverCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  avatarBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#0284C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  caregiverName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  primaryBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  primaryBadgeText: {
    color: '#15803D',
    fontSize: 9,
    fontWeight: '800',
  },
  caregiverMeta: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  expandBtn: {
    padding: 6,
  },
  permissionsContainer: {
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    padding: 14,
  },
  permSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  permLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
  },
  permDesc: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  channelsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  channelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  channelChipActive: {
    borderColor: '#0284C7',
    backgroundColor: '#F0F9FF',
  },
  channelChipText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  channelChipTextActive: {
    color: '#0284C7',
    fontWeight: '700',
  },
  deleteLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 6,
    backgroundColor: '#FEF2F2',
  },
  deleteLinkBtnText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '600',
  },
  formSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    marginTop: 10,
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  inputError: {
    borderColor: '#EF4444',
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: 4,
  },
  chipsWrapper: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    marginBottom: 16,
  },
  relChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  relChipActive: {
    backgroundColor: '#E0F2FE',
    borderColor: '#0284C7',
  },
  relChipText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  relChipTextActive: {
    color: '#0369A1',
    fontWeight: '700',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0284C7',
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 12,
    marginBottom: 24,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  logCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 10,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  logBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  logBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0369A1',
  },
  logTime: {
    fontSize: 12,
    color: '#94A3B8',
  },
  logTarget: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 4,
  },
  logSummary: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
    marginBottom: 8,
  },
  channelsList: {
    flexDirection: 'row',
    gap: 6,
  },
  channelDeliveredBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  channelDeliveredText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803D',
  },
});
