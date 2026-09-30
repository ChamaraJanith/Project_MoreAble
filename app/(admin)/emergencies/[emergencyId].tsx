import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Linking,
    Modal,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    EmergencyRequest
} from '../../../src/entities/emergency/model/types';
import {
    getEmergencyById,
    updateEmergencyStatusApi,
} from '../../../src/features/admin/api/emergencyAdminApi';
import { useAuthStore } from '../../../src/shared/store/authStore';
import { AppText as Text } from '../../../src/shared/ui/AppText';

export default function EmergencyDetailScreen() {
    const { emergencyId } = useLocalSearchParams<{ emergencyId: string }>();
    const { user } = useAuthStore();

    const [emergency, setEmergency] = useState<EmergencyRequest | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [isUpdating, setIsUpdating] = useState(false);

    // Modal state for Assign Support
    const [assignModalVisible, setAssignModalVisible] = useState(false);
    const [responderName, setResponderName] = useState('');
    const [responderContact, setResponderContact] = useState('');
    const [etaMinutes, setEtaMinutes] = useState('10');
    const [assignNotes, setAssignNotes] = useState('');

    // Modal state for Resolve Emergency
    const [resolveModalVisible, setResolveModalVisible] = useState(false);
    const [resolutionNotes, setResolutionNotes] = useState('');
    const [actionTaken, setActionTaken] = useState('');

    const loadEmergency = useCallback(async () => {
        if (!emergencyId) return;
        setIsLoading(true);
        setErrorMessage('');
        try {
            const data = await getEmergencyById(emergencyId);
            setEmergency(data);
        } catch (err: any) {
            setErrorMessage(err.message || 'Failed to load emergency details.');
        } finally {
            setIsLoading(false);
        }
    }, [emergencyId]);

    useEffect(() => {
        loadEmergency();
    }, [loadEmergency]);

    const handleAssignSupport = async () => {
        if (!responderName.trim() || !responderContact.trim()) {
            Alert.alert('Validation Error', 'Responder Name and Contact Number are required.');
            return;
        }

        setIsUpdating(true);
        try {
            const updated = await updateEmergencyStatusApi(emergency!.id, {
                status: 'ASSIGNED',
                responderName: responderName.trim(),
                responderContact: responderContact.trim(),
                etaMinutes: parseInt(etaMinutes, 10) || 10,
                notes: assignNotes.trim() || 'Rapid support dispatched to transit location',
                changedBy: (user as any)?.name || user?.email || 'Admin Dispatcher',
            });
            setEmergency(updated);
            setAssignModalVisible(false);
            Alert.alert('Support Assigned', `Support team ${responderName} assigned successfully.`);
        } catch (err: any) {
            Alert.alert('Assignment Failed', err.message || 'Failed to assign support responder.');
        } finally {
            setIsUpdating(false);
        }
    };

    const handleResolveEmergency = async () => {
        if (!resolutionNotes.trim() && !actionTaken.trim()) {
            Alert.alert('Validation Error', 'Please describe the action taken to resolve this emergency.');
            return;
        }

        setIsUpdating(true);
        try {
            const updated = await updateEmergencyStatusApi(emergency!.id, {
                status: 'RESOLVED',
                actionTaken: actionTaken.trim() || resolutionNotes.trim(),
                notes: resolutionNotes.trim() || 'Incident investigated and safely resolved',
                changedBy: (user as any)?.name || user?.email || 'Admin Dispatcher',
            });
            setEmergency(updated);
            setResolveModalVisible(false);
            Alert.alert('Incident Resolved', 'Emergency has been marked as resolved and safely closed.');
        } catch (err: any) {
            Alert.alert('Resolution Failed', err.message || 'Failed to resolve emergency.');
        } finally {
            setIsUpdating(false);
        }
    };

    const handleCallPhone = (phone?: string) => {
        if (!phone) {
            Alert.alert('No Phone', 'Contact phone number is not available.');
            return;
        }
        Linking.openURL(`tel:${phone}`).catch(() => {
            Alert.alert('Call Failed', 'Unable to initiate call on this device.');
        });
    };

    const handleOpenMaps = (lat: number, lng: number) => {
        const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        Linking.openURL(url).catch(() => {
            Alert.alert('Map Error', 'Unable to open Google Maps.');
        });
    };

    const formatDateTime = (isoString?: string) => {
        if (!isoString) return '—';
        const d = new Date(isoString);
        return `${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    };

    if (isLoading) {
        return (
            <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color="#DC2626" />
                <Text style={styles.loadingText}>Loading incident coordinates and status history...</Text>
            </View>
        );
    }

    if (!emergency || errorMessage) {
        return (
            <View style={styles.centerContainer}>
                <Ionicons name="alert-circle-outline" size={48} color="#DC2626" />
                <Text style={styles.errorTitle}>Incident Not Found</Text>
                <Text style={styles.errorSubtext}>{errorMessage || 'The requested emergency request was not found.'}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={() => router.back()}>
                    <Text style={styles.retryButtonText}>Return to Dashboard</Text>
                </TouchableOpacity>
            </View>
        );
    }

    const isPending = emergency.status === 'PENDING';
    const isAssigned = emergency.status === 'ASSIGNED';
    const isResolved = emergency.status === 'RESOLVED';

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => router.back()}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                >
                    <Ionicons name="arrow-back" size={24} color="#1E293B" />
                </TouchableOpacity>
                <View style={styles.headerTitleGroup}>
                    <Text style={styles.headerTitle}>{emergency.id}</Text>
                    <Text style={styles.headerSubtitle}>Incident Coordination & Response</Text>
                </View>
                <View
                    style={[
                        styles.headerStatusBadge,
                        isPending
                            ? styles.badgePending
                            : isAssigned
                                ? styles.badgeAssigned
                                : styles.badgeResolved,
                    ]}
                >
                    <Text
                        style={[
                            styles.headerStatusText,
                            isPending
                                ? styles.textPending
                                : isAssigned
                                    ? styles.textAssigned
                                    : styles.textResolved,
                        ]}
                    >
                        {emergency.status}
                    </Text>
                </View>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {/* Critical Banner for Pending */}
                {isPending && (
                    <View style={styles.criticalAlertBanner}>
                        <Ionicons name="warning" size={22} color="#DC2626" />
                        <View style={{ flex: 1 }}>
                            <Text style={styles.criticalAlertTitle}>Immediate Response Required</Text>
                            <Text style={styles.criticalAlertText}>
                                Commuter initiated SOS distress beacon. Assign support team to coordinate rescue.
                            </Text>
                        </View>
                    </View>
                )}

                {/* Section 1: Passenger Information */}
                <View style={styles.sectionCard}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="person-circle-outline" size={20} color="#0284C7" />
                        <Text style={styles.sectionTitleText}>Passenger Information</Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Passenger Name</Text>
                        <Text style={styles.infoValueBold}>{emergency.passenger?.name || 'Unknown Commuter'}</Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Contact Number</Text>
                        <View style={styles.phoneActionInline}>
                            <Text style={styles.infoValue}>{emergency.passenger?.phone || 'No phone'}</Text>
                            {emergency.passenger?.phone && (
                                <TouchableOpacity
                                    style={styles.callSmallBtn}
                                    onPress={() => handleCallPhone(emergency.passenger?.phone)}
                                >
                                    <Ionicons name="call" size={12} color="#FFFFFF" />
                                    <Text style={styles.callSmallBtnText}>Call Commuter</Text>
                                </TouchableOpacity>
                            )}
                        </View>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Passenger ID</Text>
                        <Text style={styles.infoValue}>{emergency.passenger?.id || '—'}</Text>
                    </View>

                    {emergency.passenger?.specialAssistance && (
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Accessibility Need</Text>
                            <View style={styles.accessBadge}>
                                <Ionicons name="accessibility" size={13} color="#7C3AED" />
                                <Text style={styles.accessBadgeText}>{emergency.passenger.specialAssistance}</Text>
                            </View>
                        </View>
                    )}
                </View>

                {/* Section 2: Vehicle & Transit Details */}
                <View style={styles.sectionCard}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="bus-outline" size={20} color="#16A34A" />
                        <Text style={styles.sectionTitleText}>Vehicle & Journey Details</Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Vehicle Plate</Text>
                        <Text style={styles.infoValueBold}>{emergency.vehicle?.plateNumber || '—'}</Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Bus Model</Text>
                        <Text style={styles.infoValue}>{emergency.vehicle?.model || 'Transit Bus'}</Text>
                    </View>

                    {emergency.vehicle?.driverId && (
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Assigned Driver</Text>
                            <Text style={styles.infoValue}>{emergency.vehicle.driverId}</Text>
                        </View>
                    )}

                    {emergency.bookingId && (
                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Booking Reference</Text>
                            <Text style={styles.infoValue}>{emergency.bookingId}</Text>
                        </View>
                    )}
                </View>

                {/* Section 3: Incident Location & GPS Coordinates */}
                <View style={styles.sectionCard}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="location-outline" size={20} color="#DC2626" />
                        <Text style={styles.sectionTitleText}>Location Coordinates</Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Transit Stop / Area</Text>
                        <Text style={styles.infoValueBold}>
                            {emergency.location?.stopName || emergency.location?.address || 'En-Route Halt'}
                        </Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>GPS Coordinates</Text>
                        <Text style={styles.infoValue}>
                            {emergency.location?.latitude.toFixed(6)}, {emergency.location?.longitude.toFixed(6)}
                        </Text>
                    </View>

                    <TouchableOpacity
                        style={styles.openMapActionBtn}
                        onPress={() => handleOpenMaps(emergency.location.latitude, emergency.location.longitude)}
                    >
                        <Ionicons name="navigate" size={16} color="#FFFFFF" />
                        <Text style={styles.openMapActionText}>Open Live Location in Google Maps</Text>
                    </TouchableOpacity>
                </View>

                {/* Section 4: Emergency Time & Elapsed Duration */}
                <View style={styles.sectionCard}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="time-outline" size={20} color="#475569" />
                        <Text style={styles.sectionTitleText}>Emergency Timestamp</Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Incident Triggered</Text>
                        <Text style={styles.infoValue}>{formatDateTime(emergency.createdAt)}</Text>
                    </View>

                    <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Last Updated</Text>
                        <Text style={styles.infoValue}>{formatDateTime(emergency.updatedAt)}</Text>
                    </View>
                </View>

                {/* Section 5: Current Support Assignment or Resolution Details */}
                {emergency.assignment && (
                    <View style={[styles.sectionCard, { borderColor: '#FBBF24', borderWidth: 1.5 }]}>
                        <View style={styles.sectionHeader}>
                            <Ionicons name="shield-checkmark-outline" size={20} color="#D97706" />
                            <Text style={[styles.sectionTitleText, { color: '#B45309' }]}>Assigned Support Responder</Text>
                        </View>

                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Responder Name</Text>
                            <Text style={styles.infoValueBold}>{emergency.assignment.responderName}</Text>
                        </View>

                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Contact Number</Text>
                            <View style={styles.phoneActionInline}>
                                <Text style={styles.infoValue}>{emergency.assignment.responderContact}</Text>
                                <TouchableOpacity
                                    style={[styles.callSmallBtn, { backgroundColor: '#D97706' }]}
                                    onPress={() => handleCallPhone(emergency.assignment?.responderContact)}
                                >
                                    <Ionicons name="call" size={12} color="#FFFFFF" />
                                    <Text style={styles.callSmallBtnText}>Call Responder</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {emergency.assignment.etaMinutes ? (
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Estimated Arrival</Text>
                                <Text style={styles.infoValueBold}>~{emergency.assignment.etaMinutes} minutes</Text>
                            </View>
                        ) : null}

                        {emergency.assignment.notes ? (
                            <View style={styles.infoRow}>
                                <Text style={styles.infoLabel}>Dispatch Notes</Text>
                                <Text style={styles.infoValue}>{emergency.assignment.notes}</Text>
                            </View>
                        ) : null}
                    </View>
                )}

                {emergency.resolution && (
                    <View style={[styles.sectionCard, { borderColor: '#86EFAC', borderWidth: 1.5 }]}>
                        <View style={styles.sectionHeader}>
                            <Ionicons name="checkmark-done-circle-outline" size={20} color="#16A34A" />
                            <Text style={[styles.sectionTitleText, { color: '#15803D' }]}>Incident Resolution</Text>
                        </View>

                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Resolved At</Text>
                            <Text style={styles.infoValue}>{formatDateTime(emergency.resolution.resolvedAt)}</Text>
                        </View>

                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Resolved By</Text>
                            <Text style={styles.infoValue}>{emergency.resolution.resolvedBy}</Text>
                        </View>

                        <View style={styles.infoRow}>
                            <Text style={styles.infoLabel}>Action Taken</Text>
                            <Text style={styles.infoValueBold}>
                                {emergency.resolution.actionTaken || emergency.resolution.notes}
                            </Text>
                        </View>
                    </View>
                )}

                {/* Section 6: Status History Audit Trail (MOV-236) */}
                <View style={styles.sectionCard}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="git-commit-outline" size={20} color="#6366F1" />
                        <Text style={styles.sectionTitleText}>Status History Audit Trail</Text>
                    </View>

                    <View style={styles.timelineContainer}>
                        {(emergency.statusHistory || []).map((step, index) => {
                            const isLast = index === (emergency.statusHistory || []).length - 1;
                            const isStepPending = step.status === 'PENDING';
                            const isStepAssigned = step.status === 'ASSIGNED';
                            return (
                                <View key={index} style={styles.timelineItem}>
                                    <View style={styles.timelineLeftColumn}>
                                        <View
                                            style={[
                                                styles.timelineDot,
                                                isStepPending
                                                    ? styles.dotPending
                                                    : isStepAssigned
                                                        ? styles.dotAssigned
                                                        : styles.dotResolved,
                                            ]}
                                        >
                                            <Ionicons
                                                name={
                                                    isStepPending
                                                        ? 'alert'
                                                        : isStepAssigned
                                                            ? 'shield-checkmark'
                                                            : 'checkmark'
                                                }
                                                size={12}
                                                color="#FFFFFF"
                                            />
                                        </View>
                                        {!isLast && <View style={styles.timelineLine} />}
                                    </View>

                                    <View style={styles.timelineContent}>
                                        <View style={styles.timelineTitleRow}>
                                            <Text style={styles.timelineStatus}>{step.status}</Text>
                                            <Text style={styles.timelineTime}>{formatDateTime(step.changedAt)}</Text>
                                        </View>
                                        <Text style={styles.timelineActor}>Logged by: {step.changedBy}</Text>
                                        {step.notes && <Text style={styles.timelineNotes}>"{step.notes}"</Text>}
                                        {step.responderName && (
                                            <Text style={styles.timelineResponder}>
                                                Responder: {step.responderName} ({step.responderContact})
                                            </Text>
                                        )}
                                        {step.actionTaken && (
                                            <Text style={styles.timelineAction}>Action: {step.actionTaken}</Text>
                                        )}
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                </View>

                {/* Status Update Actions (Pending -> Assigned -> Resolved) */}
                <View style={styles.actionsContainer}>
                    {isPending && (
                        <TouchableOpacity
                            style={[styles.primaryActionBtn, { backgroundColor: '#DC2626' }]}
                            onPress={() => setAssignModalVisible(true)}
                        >
                            <Ionicons name="shield-half" size={20} color="#FFFFFF" />
                            <Text style={styles.primaryActionBtnText}>Assign Support Responder</Text>
                        </TouchableOpacity>
                    )}

                    {isAssigned && (
                        <View style={{ gap: 10 }}>
                            <TouchableOpacity
                                style={[styles.primaryActionBtn, { backgroundColor: '#16A34A' }]}
                                onPress={() => setResolveModalVisible(true)}
                            >
                                <Ionicons name="checkmark-done" size={20} color="#FFFFFF" />
                                <Text style={styles.primaryActionBtnText}>Mark Incident as Resolved</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.secondaryActionBtn, { borderColor: '#D97706' }]}
                                onPress={() => setAssignModalVisible(true)}
                            >
                                <Ionicons name="refresh" size={18} color="#D97706" />
                                <Text style={[styles.secondaryActionBtnText, { color: '#D97706' }]}>
                                    Reassign / Update Support
                                </Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {isResolved && (
                        <View style={styles.resolvedNoticeBox}>
                            <Ionicons name="checkmark-circle" size={24} color="#16A34A" />
                            <Text style={styles.resolvedNoticeText}>
                                This incident has been fully resolved and the record is permanently archived.
                            </Text>
                        </View>
                    )}
                </View>
            </ScrollView>

            {/* Modal: Assign Support Responder */}
            <Modal
                visible={assignModalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setAssignModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Assign Support Responder</Text>
                            <TouchableOpacity onPress={() => setAssignModalVisible(false)}>
                                <Ionicons name="close" size={24} color="#64748B" />
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.modalSubtitle}>
                            Assign local emergency response personnel or dispatch team to coordinate support.
                        </Text>

                        <View style={styles.modalInputGroup}>
                            <Text style={styles.modalInputLabel}>Responder / Team Name *</Text>
                            <TextInput
                                style={styles.modalInput}
                                placeholder="e.g. SLTB Emergency Patrol Team 4"
                                placeholderTextColor="#94A3B8"
                                value={responderName}
                                onChangeText={setResponderName}
                            />
                        </View>

                        <View style={styles.modalInputGroup}>
                            <Text style={styles.modalInputLabel}>Responder Contact Phone *</Text>
                            <TextInput
                                style={styles.modalInput}
                                placeholder="e.g. 0712345678"
                                placeholderTextColor="#94A3B8"
                                keyboardType="phone-pad"
                                value={responderContact}
                                onChangeText={setResponderContact}
                            />
                        </View>

                        <View style={styles.modalInputGroup}>
                            <Text style={styles.modalInputLabel}>Estimated Arrival (Minutes)</Text>
                            <TextInput
                                style={styles.modalInput}
                                placeholder="e.g. 10"
                                placeholderTextColor="#94A3B8"
                                keyboardType="numeric"
                                value={etaMinutes}
                                onChangeText={setEtaMinutes}
                            />
                        </View>

                        <View style={styles.modalInputGroup}>
                            <Text style={styles.modalInputLabel}>Dispatch Instructions / Notes</Text>
                            <TextInput
                                style={[styles.modalInput, styles.modalTextArea]}
                                placeholder="Provide specific instructions to responder..."
                                placeholderTextColor="#94A3B8"
                                multiline
                                numberOfLines={3}
                                value={assignNotes}
                                onChangeText={setAssignNotes}
                            />
                        </View>

                        <View style={styles.modalBtnRow}>
                            <TouchableOpacity
                                style={styles.modalCancelBtn}
                                onPress={() => setAssignModalVisible(false)}
                                disabled={isUpdating}
                            >
                                <Text style={styles.modalCancelBtnText}>Cancel</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.modalConfirmBtn, { backgroundColor: '#D97706' }]}
                                onPress={handleAssignSupport}
                                disabled={isUpdating}
                            >
                                {isUpdating ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <Text style={styles.modalConfirmBtnText}>Confirm Assignment</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Modal: Resolve Emergency */}
            <Modal
                visible={resolveModalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setResolveModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Resolve Emergency Incident</Text>
                            <TouchableOpacity onPress={() => setResolveModalVisible(false)}>
                                <Ionicons name="close" size={24} color="#64748B" />
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.modalSubtitle}>
                            Confirm commuter safety and log actions taken to close the incident.
                        </Text>

                        <View style={styles.modalInputGroup}>
                            <Text style={styles.modalInputLabel}>Action Taken *</Text>
                            <TextInput
                                style={styles.modalInput}
                                placeholder="e.g. Paramedic assistance rendered, commuter safe"
                                placeholderTextColor="#94A3B8"
                                value={actionTaken}
                                onChangeText={setActionTaken}
                            />
                        </View>

                        <View style={styles.modalInputGroup}>
                            <Text style={styles.modalInputLabel}>Resolution Notes & Follow-up</Text>
                            <TextInput
                                style={[styles.modalInput, styles.modalTextArea]}
                                placeholder="Add summary of incident resolution..."
                                placeholderTextColor="#94A3B8"
                                multiline
                                numberOfLines={3}
                                value={resolutionNotes}
                                onChangeText={setResolutionNotes}
                            />
                        </View>

                        <View style={styles.modalBtnRow}>
                            <TouchableOpacity
                                style={styles.modalCancelBtn}
                                onPress={() => setResolveModalVisible(false)}
                                disabled={isUpdating}
                            >
                                <Text style={styles.modalCancelBtnText}>Cancel</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.modalConfirmBtn, { backgroundColor: '#16A34A' }]}
                                onPress={handleResolveEmergency}
                                disabled={isUpdating}
                            >
                                {isUpdating ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <Text style={styles.modalConfirmBtnText}>Resolve Incident</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        backgroundColor: '#F8FAFC',
    },
    loadingText: {
        fontSize: 14,
        color: '#64748B',
        marginTop: 12,
        textAlign: 'center',
    },
    errorTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#0F172A',
        marginTop: 12,
    },
    errorSubtext: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        marginTop: 4,
        marginBottom: 16,
    },
    retryButton: {
        backgroundColor: '#0F172A',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    retryButtonText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 52,
        paddingBottom: 16,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },
    backButton: {
        padding: 8,
        borderRadius: 8,
        backgroundColor: '#F1F5F9',
        marginRight: 12,
    },
    headerTitleGroup: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#0F172A',
    },
    headerSubtitle: {
        fontSize: 11,
        color: '#64748B',
        marginTop: 1,
    },
    headerStatusBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 8,
    },
    badgePending: {
        backgroundColor: '#FEE2E2',
    },
    badgeAssigned: {
        backgroundColor: '#FEF3C7',
    },
    badgeResolved: {
        backgroundColor: '#DCFCE7',
    },
    headerStatusText: {
        fontSize: 11,
        fontWeight: '700',
    },
    textPending: {
        color: '#DC2626',
    },
    textAssigned: {
        color: '#D97706',
    },
    textResolved: {
        color: '#16A34A',
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 40,
    },
    criticalAlertBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF2F2',
        borderWidth: 1.5,
        borderColor: '#F87171',
        borderRadius: 12,
        padding: 14,
        marginBottom: 16,
        gap: 12,
    },
    criticalAlertTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#B91C1C',
    },
    criticalAlertText: {
        fontSize: 12,
        color: '#DC2626',
        marginTop: 2,
        lineHeight: 16,
    },
    sectionCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 16,
        marginBottom: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingBottom: 10,
        marginBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    sectionTitleText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 6,
    },
    infoLabel: {
        fontSize: 13,
        color: '#64748B',
    },
    infoValue: {
        fontSize: 13,
        color: '#1E293B',
        fontWeight: '500',
    },
    infoValueBold: {
        fontSize: 14,
        color: '#0F172A',
        fontWeight: '700',
    },
    phoneActionInline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    callSmallBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0284C7',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 4,
        gap: 4,
    },
    callSmallBtnText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '600',
    },
    accessBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EDE9FE',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        gap: 4,
    },
    accessBadgeText: {
        color: '#7C3AED',
        fontSize: 12,
        fontWeight: '600',
    },
    openMapActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0284C7',
        borderRadius: 8,
        paddingVertical: 10,
        gap: 6,
        marginTop: 10,
    },
    openMapActionText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '600',
    },
    timelineContainer: {
        marginTop: 4,
    },
    timelineItem: {
        flexDirection: 'row',
        gap: 12,
    },
    timelineLeftColumn: {
        alignItems: 'center',
        width: 20,
    },
    timelineDot: {
        width: 20,
        height: 20,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    dotPending: {
        backgroundColor: '#DC2626',
    },
    dotAssigned: {
        backgroundColor: '#D97706',
    },
    dotResolved: {
        backgroundColor: '#16A34A',
    },
    timelineLine: {
        flex: 1,
        width: 2,
        backgroundColor: '#CBD5E1',
        marginVertical: 4,
    },
    timelineContent: {
        flex: 1,
        paddingBottom: 16,
    },
    timelineTitleRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    timelineStatus: {
        fontSize: 13,
        fontWeight: '700',
        color: '#0F172A',
    },
    timelineTime: {
        fontSize: 11,
        color: '#94A3B8',
    },
    timelineActor: {
        fontSize: 11,
        color: '#64748B',
        marginTop: 2,
    },
    timelineNotes: {
        fontSize: 12,
        color: '#334155',
        fontStyle: 'italic',
        marginTop: 4,
    },
    timelineResponder: {
        fontSize: 12,
        color: '#B45309',
        fontWeight: '600',
        marginTop: 4,
    },
    timelineAction: {
        fontSize: 12,
        color: '#15803D',
        fontWeight: '600',
        marginTop: 4,
    },
    actionsContainer: {
        marginTop: 8,
    },
    primaryActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        borderRadius: 12,
        gap: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    primaryActionBtnText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },
    secondaryActionBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1.5,
        backgroundColor: '#FFFFFF',
        gap: 6,
    },
    secondaryActionBtnText: {
        fontSize: 14,
        fontWeight: '600',
    },
    resolvedNoticeBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F0FDF4',
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#BBF7D0',
        gap: 12,
    },
    resolvedNoticeText: {
        flex: 1,
        fontSize: 13,
        color: '#15803D',
        fontWeight: '500',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        padding: 20,
    },
    modalCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 10,
        elevation: 5,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#0F172A',
    },
    modalSubtitle: {
        fontSize: 12,
        color: '#64748B',
        marginBottom: 16,
        lineHeight: 16,
    },
    modalInputGroup: {
        marginBottom: 12,
    },
    modalInputLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#334155',
        marginBottom: 4,
    },
    modalInput: {
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        fontSize: 14,
        color: '#0F172A',
    },
    modalTextArea: {
        height: 70,
        textAlignVertical: 'top',
    },
    modalBtnRow: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 12,
    },
    modalCancelBtn: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 8,
        backgroundColor: '#F1F5F9',
        alignItems: 'center',
    },
    modalCancelBtnText: {
        color: '#475569',
        fontSize: 14,
        fontWeight: '600',
    },
    modalConfirmBtn: {
        flex: 2,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    modalConfirmBtnText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '700',
    },
});
