import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
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
    const [etaMinutes, setEtaMinutes] = useState('0');
    const [assignNotes, setAssignNotes] = useState('');

    // State for Live Directives / Comms to Bus Console
    const [liveDirectiveInput, setLiveDirectiveInput] = useState('');
    const [isSendingDirective, setIsSendingDirective] = useState(false);
    const adminChatScrollRef = useRef<ScrollView>(null);

    // Modal state for Resolve Emergency
    const [resolveModalVisible, setResolveModalVisible] = useState(false);
    const [resolutionNotes, setResolutionNotes] = useState('');
    const [actionTaken, setActionTaken] = useState('');

    const openAssignModal = () => {
        if (emergency) {
            const plate = emergency.vehicle?.plateNumber || 'Bus Device';
            if (!responderName) {
                setResponderName(`Onboard Bus Crew (${plate})`);
            }
            if (!responderContact) {
                setResponderContact('0771234567');
            }
            if (!assignNotes) {
                setAssignNotes('Bus crew: Pull over safely at nearest bus halt and verify commuter safety.');
            }
        }
        setAssignModalVisible(true);
    };

    const handleCallBusCrew = (phone?: string) => {
        const targetPhone = phone || emergency?.assignment?.responderContact || responderContact || '0771234567';
        Linking.openURL(`tel:${targetPhone}`).catch(() => {
            Alert.alert('Call Failed', `Unable to place call to ${targetPhone}. Ensure device has telephone capabilities.`);
        });
    };

    const handleSendLiveDirective = async () => {
        if (!liveDirectiveInput.trim() || !emergency) return;
        setIsSendingDirective(true);
        try {
            const updated = await updateEmergencyStatusApi(emergency.id, {
                status: emergency.status,
                directiveMessage: liveDirectiveInput.trim(),
                changedBy: (user as any)?.name || user?.email || 'Admin Dispatcher',
            });
            setEmergency(updated);
            setLiveDirectiveInput('');
            Alert.alert('Directive Transmitted', 'Live directive sent directly to the onboard bus console.');
        } catch (err: any) {
            Alert.alert('Transmission Failed', err.message || 'Failed to send directive to bus device.');
        } finally {
            setIsSendingDirective(false);
        }
    };

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
        const interval = setInterval(async () => {
            if (emergencyId && !isUpdating) {
                try {
                    const fresh = await getEmergencyById(emergencyId);
                    if (fresh) {
                        setEmergency(fresh);
                    }
                } catch {
                    // background polling silent catch
                }
            }
        }, 3500);
        return () => clearInterval(interval);
    }, [emergencyId, isUpdating, loadEmergency]);

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

                {/* Section 6: Live Bus Console Comms & Directives */}
                <View style={[styles.sectionCard, { borderColor: '#93C5FD', borderWidth: 1.5 }]}>
                    <View style={styles.sectionHeader}>
                        <Ionicons name="chatbubbles-outline" size={20} color="#0066CC" />
                        <Text style={[styles.sectionTitleText, { color: '#0066CC' }]}>
                            Bus Console Direct Comms & Dispatch Directives
                        </Text>
                        <View style={styles.liveBadge}>
                            <View style={styles.liveIndicatorDot} />
                            <Text style={styles.liveBadgeText}>LIVE LINK</Text>
                        </View>
                    </View>

                    <View style={styles.targetBusBox}>
                        <View style={styles.targetBusIconCircle}>
                            <Ionicons name="bus" size={20} color="#0066CC" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.targetBusTitle}>
                                Bus {emergency.vehicle?.plateNumber || 'N/A'} (Route {emergency.vehicle?.routeNumber || 'N/A'})
                            </Text>
                            <Text style={styles.targetBusSubtitle}>
                                Target Device: Onboard Bus Driver & Conductor Console
                            </Text>
                        </View>
                        <TouchableOpacity
                            style={styles.busCallBtn}
                            onPress={() => handleCallBusCrew()}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="call" size={15} color="#FFFFFF" />
                            <Text style={styles.busCallBtnText}>Call Bus</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Live Dispatch Message Thread */}
                    <Text style={[styles.infoLabel, { marginTop: 14, marginBottom: 6 }]}>
                        Live Directive & Status Thread:
                    </Text>
                    <ScrollView
                        ref={adminChatScrollRef}
                        style={styles.dispatchThreadScroll}
                        contentContainerStyle={styles.dispatchThreadBox}
                        nestedScrollEnabled
                        onContentSizeChange={() => adminChatScrollRef.current?.scrollToEnd({ animated: false })}
                    >
                        {(!emergency.dispatchMessages || emergency.dispatchMessages.length === 0) ? (
                            <Text style={styles.emptyThreadText}>
                                No directives exchanged yet. Send operational instructions below or call the onboard crew directly.
                            </Text>
                        ) : (
                            emergency.dispatchMessages.map((msg) => {
                                const isAdmin = msg.sender === 'ADMIN';
                                return (
                                    <View
                                        key={msg.id}
                                        style={[
                                            styles.dispatchBubble,
                                            isAdmin ? styles.dispatchBubbleAdmin : styles.dispatchBubbleBus,
                                        ]}
                                    >
                                        <View style={styles.dispatchSenderRow}>
                                            <Ionicons
                                                name={isAdmin ? 'shield-checkmark' : 'bus'}
                                                size={12}
                                                color={isAdmin ? '#2563EB' : '#D97706'}
                                            />
                                            <Text
                                                style={[
                                                    styles.dispatchSenderText,
                                                    { color: isAdmin ? '#2563EB' : '#D97706' },
                                                ]}
                                                numberOfLines={1}
                                            >
                                                {msg.senderName}
                                            </Text>
                                            <Text style={styles.dispatchTimeText}>
                                                {formatDateTime(msg.sentAt)}
                                            </Text>
                                        </View>
                                        <Text style={styles.dispatchMessageText}>{msg.message}</Text>
                                    </View>
                                );
                            })
                        )}
                    </ScrollView>

                    {/* Quick Directives & Input */}
                    {!isResolved && (
                        <View style={{ marginTop: 12 }}>
                            <View style={styles.quickChipsRow}>
                                <TouchableOpacity
                                    style={styles.quickChip}
                                    onPress={() => setLiveDirectiveInput('Pull over safely at next bus bay.')}
                                >
                                    <Text style={styles.quickChipText}>🛑 Pull over</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.quickChip}
                                    onPress={() => setLiveDirectiveInput('Deploy wheelchair ramp at exit.')}
                                >
                                    <Text style={styles.quickChipText}>♿ Deploy ramp</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.quickChip}
                                    onPress={() => setLiveDirectiveInput('Emergency patrol / ambulance dispatched.')}
                                >
                                    <Text style={styles.quickChipText}>🚑 Paramedics notified</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.quickChip}
                                    onPress={() => setLiveDirectiveInput('Verify commuter vitals & passenger safety.')}
                                >
                                    <Text style={styles.quickChipText}>🩺 Check vitals</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.quickChip}
                                    onPress={() => setLiveDirectiveInput('Hold bus position at current halt.')}
                                >
                                    <Text style={styles.quickChipText}>🚦 Hold bus</Text>
                                </TouchableOpacity>
                            </View>

                            <View style={styles.directiveInputRow}>
                                <TextInput
                                    style={styles.directiveTextInput}
                                    placeholder="Type live directive or chat message to bus console..."
                                    placeholderTextColor="#94A3B8"
                                    value={liveDirectiveInput}
                                    onChangeText={setLiveDirectiveInput}
                                    onSubmitEditing={handleSendLiveDirective}
                                    returnKeyType="send"
                                />
                                <TouchableOpacity
                                    style={styles.sendDirectiveBtn}
                                    onPress={handleSendLiveDirective}
                                    disabled={isSendingDirective || !liveDirectiveInput.trim()}
                                >
                                    {isSendingDirective ? (
                                        <ActivityIndicator size="small" color="#FFFFFF" />
                                    ) : (
                                        <Ionicons name="send" size={16} color="#FFFFFF" />
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}
                </View>

                {/* Section 7: Status History Audit Trail (MOV-236) */}
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
                            onPress={openAssignModal}
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
                                onPress={openAssignModal}
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
                            Assign onboard vehicle crew or rapid transit dispatch team to coordinate emergency response.
                        </Text>

                        {/* Target Vehicle Unit Box */}
                        <View style={styles.modalTargetBusBox}>
                            <View style={styles.modalTargetBusIcon}>
                                <Ionicons name="bus" size={18} color="#0066CC" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.modalTargetBusTitle}>
                                    Target: Bus {emergency?.vehicle?.plateNumber || 'N/A'} (Route {emergency?.vehicle?.routeNumber || 'N/A'})
                                </Text>
                                <Text style={styles.modalTargetBusSub}>
                                    Dispatches directly to the onboard Driver & Conductor device
                                </Text>
                            </View>
                        </View>

                        {/* Quick Presets */}
                        <View style={styles.presetRow}>
                            <TouchableOpacity
                                style={[styles.presetChip, responderName.includes('Onboard') && styles.presetChipActive]}
                                onPress={() => {
                                    setResponderName(`Onboard Bus Crew (${emergency?.vehicle?.plateNumber || 'Bus Device'})`);
                                    setResponderContact('0771234567');
                                    setEtaMinutes('0');
                                    setAssignNotes('Bus crew: Pull over safely at next bus halt and assist commuter immediately.');
                                }}
                            >
                                <Ionicons name="bus-outline" size={14} color={responderName.includes('Onboard') ? '#0066CC' : '#64748B'} />
                                <Text style={[styles.presetChipText, responderName.includes('Onboard') && styles.presetChipTextActive]}>
                                    Onboard Crew (0 min)
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.presetChip, responderName.includes('Depot') && styles.presetChipActive]}
                                onPress={() => {
                                    setResponderName(`Transit Depot Patrol (Route ${emergency?.vehicle?.routeNumber || 'Transit'})`);
                                    setResponderContact('0112345678');
                                    setEtaMinutes('10');
                                    setAssignNotes('Depot patrol intercepting vehicle at upcoming transit stop.');
                                }}
                            >
                                <Ionicons name="business-outline" size={14} color={responderName.includes('Depot') ? '#0066CC' : '#64748B'} />
                                <Text style={[styles.presetChipText, responderName.includes('Depot') && styles.presetChipTextActive]}>
                                    Depot Team (10 min)
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {/* Direct Call Button */}
                        <TouchableOpacity
                            style={styles.modalDirectCallBtn}
                            onPress={() => handleCallBusCrew(responderContact)}
                            activeOpacity={0.8}
                        >
                            <Ionicons name="call" size={16} color="#FFFFFF" />
                            <Text style={styles.modalDirectCallBtnText}>
                                Call Bus Device Now ({responderContact || '0771234567'})
                            </Text>
                        </TouchableOpacity>

                        <View style={styles.modalInputGroup}>
                            <Text style={styles.modalInputLabel}>Responder / Team Name *</Text>
                            <TextInput
                                style={styles.modalInput}
                                placeholder="e.g. Onboard Bus Crew or Patrol Team"
                                placeholderTextColor="#94A3B8"
                                value={responderName}
                                onChangeText={setResponderName}
                            />
                        </View>

                        <View style={styles.modalInputGroup}>
                            <Text style={styles.modalInputLabel}>Responder Contact Phone *</Text>
                            <TextInput
                                style={styles.modalInput}
                                placeholder="e.g. 0771234567"
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
                                placeholder="0 for onboard, or estimated minutes"
                                placeholderTextColor="#94A3B8"
                                keyboardType="numeric"
                                value={etaMinutes}
                                onChangeText={setEtaMinutes}
                            />
                        </View>

                        <View style={styles.modalInputGroup}>
                            <Text style={styles.modalInputLabel}>Dispatch Instructions / Notes</Text>
                            <View style={styles.quickChipsRow}>
                                <TouchableOpacity
                                    style={styles.quickChip}
                                    onPress={() => setAssignNotes((prev) => (prev ? prev + ' ' : '') + 'Pull over safely at next bus bay.')}
                                >
                                    <Text style={styles.quickChipText}>+ Pull over</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.quickChip}
                                    onPress={() => setAssignNotes((prev) => (prev ? prev + ' ' : '') + 'Deploy wheelchair ramp.')}
                                >
                                    <Text style={styles.quickChipText}>+ Deploy ramp</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.quickChip}
                                    onPress={() => setAssignNotes((prev) => (prev ? prev + ' ' : '') + 'Medical distress — check vitals.')}
                                >
                                    <Text style={styles.quickChipText}>+ Check vitals</Text>
                                </TouchableOpacity>
                            </View>
                            <TextInput
                                style={[styles.modalInput, styles.modalTextArea]}
                                placeholder="Provide specific instructions or directives to the crew..."
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
    targetBusBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        borderRadius: 12,
        padding: 12,
        gap: 12,
        borderWidth: 1,
        borderColor: '#BFDBFE',
    },
    targetBusIconCircle: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#DBEAFE',
        alignItems: 'center',
        justifyContent: 'center',
    },
    targetBusTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: '#1E3A8A',
    },
    targetBusSubtitle: {
        fontSize: 11,
        color: '#64748B',
        marginTop: 2,
    },
    busCallBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#16A34A',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        gap: 6,
    },
    busCallBtnText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '800',
    },
    dispatchThreadScroll: {
        maxHeight: 280,
        backgroundColor: '#F8FAFC',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    dispatchThreadBox: {
        padding: 12,
        gap: 10,
    },
    emptyThreadText: {
        fontSize: 12,
        color: '#94A3B8',
        fontStyle: 'italic',
        textAlign: 'center',
        paddingVertical: 18,
    },
    dispatchBubble: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 14,
        gap: 4,
        maxWidth: '78%',
        minWidth: 180,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 2,
        elevation: 1,
    },
    dispatchBubbleAdmin: {
        alignSelf: 'flex-end',
        backgroundColor: '#EFF6FF',
        borderWidth: 1,
        borderColor: '#BFDBFE',
        borderBottomRightRadius: 2,
    },
    dispatchBubbleBus: {
        alignSelf: 'flex-start',
        backgroundColor: '#FEF3C7',
        borderWidth: 1,
        borderColor: '#FDE68A',
        borderBottomLeftRadius: 2,
    },
    dispatchSenderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 2,
    },
    dispatchSenderText: {
        fontSize: 11,
        fontWeight: '800',
        flexShrink: 1,
    },
    dispatchTimeText: {
        fontSize: 10,
        color: '#94A3B8',
        marginLeft: 'auto',
        paddingLeft: 8,
        flexShrink: 0,
    },
    dispatchMessageText: {
        fontSize: 13,
        color: '#1E293B',
        lineHeight: 18,
    },
    quickChipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: 8,
    },
    quickChip: {
        backgroundColor: '#F1F5F9',
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 16,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    quickChipText: {
        fontSize: 11,
        fontWeight: '600',
        color: '#475569',
    },
    directiveInputRow: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
    },
    directiveTextInput: {
        flex: 1,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        fontSize: 13,
        color: '#0F172A',
    },
    sendDirectiveBtn: {
        backgroundColor: '#0066CC',
        width: 38,
        height: 38,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    liveBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ECFDF5',
        borderWidth: 1,
        borderColor: '#A7F3D0',
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 2,
        gap: 5,
        marginLeft: 'auto',
    },
    liveIndicatorDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#10B981',
    },
    liveBadgeText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#059669',
        letterSpacing: 0.5,
    },
    modalTargetBusBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EFF6FF',
        borderRadius: 10,
        padding: 10,
        gap: 10,
        borderWidth: 1,
        borderColor: '#BFDBFE',
        marginBottom: 12,
    },
    modalTargetBusIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#DBEAFE',
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalTargetBusTitle: {
        fontSize: 13,
        fontWeight: '800',
        color: '#1E3A8A',
    },
    modalTargetBusSub: {
        fontSize: 11,
        color: '#64748B',
    },
    presetRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 10,
    },
    presetChip: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 8,
        paddingVertical: 8,
        paddingHorizontal: 6,
    },
    presetChipActive: {
        backgroundColor: '#EFF6FF',
        borderColor: '#0066CC',
    },
    presetChipText: {
        fontSize: 11,
        fontWeight: '700',
        color: '#64748B',
    },
    presetChipTextActive: {
        color: '#0066CC',
        fontWeight: '800',
    },
    modalDirectCallBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#16A34A',
        paddingVertical: 10,
        borderRadius: 8,
        gap: 8,
        marginBottom: 12,
    },
    modalDirectCallBtnText: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '800',
    },
});
