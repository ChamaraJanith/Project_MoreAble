// This is for Vehicle Operations Console View (Bus Conductor & Driver Dashboard)
import { AppText as Text } from '../src/shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Linking,
    Modal,
    Platform,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { getEmergencies, updateEmergencyStatusApi } from '../src/features/admin/api/emergencyAdminApi';
import { EmergencyRequest } from '../src/entities/emergency/model/types';

import { TripControlTab } from '../src/features/driver/ui/TripControlTab';
import { useTripJourney } from '../src/features/driver/ui/useTripJourney';
import { PassengerManifestTab } from '../src/features/driver/ui/PassengerManifestTab';
import { TripInfoTab } from '../src/features/driver/ui/TripInfoTab';
import { describeBusSession } from '../src/features/driver/utils/busSessionView';
import { BusSession, clearBusSession, getBusSession } from '../src/shared/utils/busSession';
import { useJourneyStore } from '../src/shared/store/journeyStore';

type VehicleTab = 'PASSENGERS' | 'TRIP_CONTROL' | 'TRIP';

export default function VehicleDashboardScreen() {
    const { t } = useTranslation();
    const [session, setSession] = useState<BusSession | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [exitError, setExitError] = useState('');
    const [activeTab, setActiveTab] = useState<VehicleTab>('PASSENGERS');

    // The bus's trips and running journey, held above the tabs so switching
    // tabs does not reload them (MOV-294). Location sharing is not owned here —
    // it follows the journey, so signing out below never stops it.
    const journey = useTripJourney(session?.busId);
    
    // Subscribe to emergency store
    const { activeSOS, clearSOS } = useJourneyStore();

    // Live Dispatch Chat State
    const [busEmergency, setBusEmergency] = useState<EmergencyRequest | null>(null);
    const [isChatModalVisible, setIsChatModalVisible] = useState(false);
    const [chatInputMessage, setChatInputMessage] = useState('');
    const [isSendingMessage, setIsSendingMessage] = useState(false);
    const chatScrollRef = useRef<ScrollView>(null);

    const syncBusEmergency = useCallback(async () => {
        try {
            const plate = session?.numberPlate;
            if (!plate) return;
            const list = await getEmergencies({ search: plate });
            const active = list.find((e) => e.status !== 'RESOLVED');
            if (active) {
                setBusEmergency(active);
            }
        } catch {
            // silent catch
        }
    }, [session?.numberPlate]);

    React.useEffect(() => {
        if (activeSOS?.isActive || isChatModalVisible) {
            syncBusEmergency();
            const interval = setInterval(syncBusEmergency, 3500);
            return () => clearInterval(interval);
        }
    }, [activeSOS?.isActive, isChatModalVisible, syncBusEmergency]);

    const handleCallControlCenter = () => {
        Linking.openURL('tel:0112345678').catch(() => {
            Alert.alert('Call Failed', 'Unable to initiate call to Control Center.');
        });
    };

    const handleSendBusMessage = async (customText?: string) => {
        const text = (customText || chatInputMessage).trim();
        if (!text) return;
        setIsSendingMessage(true);
        try {
            const plate = session?.numberPlate;
            const emergencies = await getEmergencies({ search: plate });
            const active = emergencies.find((e) => e.status !== 'RESOLVED') || emergencies[0];
            if (active) {
                const updated = await updateEmergencyStatusApi(active.id, {
                    status: active.status === 'PENDING' ? 'ASSIGNED' : active.status,
                    responderName: `Onboard Bus Crew (${identity.signedIn ? identity.numberPlate : 'Bus Crew'})`,
                    responderContact: '0771234567',
                    directiveMessage: text,
                    changedBy: `Bus Crew (${identity.signedIn ? identity.numberPlate : 'Onboard'})`,
                });
                setBusEmergency(updated);
                setChatInputMessage('');
            }
        } catch {
            Alert.alert('Transmission Failed', 'Unable to send message to Control Center.');
        } finally {
            setIsSendingMessage(false);
        }
    };

    const handleSendQuickAckToAdmin = async () => {
        await handleSendBusMessage('Bus crew acknowledged directive. Currently attending to commuter.');
        Alert.alert('Message Sent', 'Control Center notified: Bus crew attending to commuter.');
    };

    const handleConfirmAssistedAndResolve = () => {
        Alert.alert(
            'Confirm Passenger Assisted',
            'Have you safely attended to the passenger and is the emergency resolved?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Confirm Resolved',
                    style: 'default',
                    onPress: async () => {
                        clearSOS();
                        try {
                            const plate = session?.numberPlate;
                            const emergencies = await getEmergencies({ search: plate });
                            if (emergencies.length > 0 && emergencies[0].status !== 'RESOLVED') {
                                await updateEmergencyStatusApi(emergencies[0].id, {
                                    status: 'RESOLVED',
                                    actionTaken: `Passenger safely assisted onboard by bus crew (${identity.signedIn ? identity.numberPlate : 'Bus Crew'}). Normal transit operations resumed.`,
                                    notes: 'Resolved via Bus Dashboard Console',
                                    changedBy: `Bus Crew (${identity.signedIn ? identity.numberPlate : 'Onboard'})`,
                                });
                            }
                        } catch {
                            // Local clear already succeeded
                        }
                        Alert.alert('Incident Resolved', 'Emergency status marked as resolved. Control Center notified.');
                    },
                },
            ]
        );
    };

    useFocusEffect(
        useCallback(() => {
            let active = true;

            (async () => {
                setIsLoading(true);
                const stored = await getBusSession();

                if (!active) return;

                setSession(stored);
                setIsLoading(false);
            })();

            return () => {
                active = false;
            };
        }, [])
    );

    const handleExit = useCallback(async () => {
        setExitError('');

        try {
            await clearBusSession();
        } catch {
            setExitError('Could not sign this bus out. Please try again.');
            return;
        }

        setSession(null);
        router.replace('/(auth)');
    }, []);

    const identity = describeBusSession(session);

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />

            {/* Top Navigation Bar */}
            <View style={styles.header}>
                <View style={styles.headerTitleGroup}>
                    <View style={styles.busIconBox}>
                        <Ionicons name="bus" size={20} color="#0066CC" />
                    </View>
                    <View>
                        <Text style={styles.headerTitle}>{t('driver.transitConsole', 'Transit Console')}</Text>
                        <View style={styles.plateRow}>
                            <View style={styles.activeDot} />
                            <Text style={styles.headerSubtitle}>
                                {identity.signedIn ? identity.numberPlate : 'Not Signed In'}
                            </Text>
                            {journey.journey?.trip?.routeNumber && (
                                <View style={styles.headerRouteTag}>
                                    <Text style={styles.headerRouteTagText}>Route {journey.journey.trip.routeNumber}</Text>
                                </View>
                            )}
                        </View>
                    </View>
                </View>

                <TouchableOpacity
                    style={styles.logoutButton}
                    onPress={handleExit}
                    accessibilityRole="button"
                    accessibilityLabel="Sign this bus out"
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="log-out-outline" size={16} color="#DC2626" />
                    <Text style={styles.logoutText}>{t('driver.exitBus', 'Exit')}</Text>
                </TouchableOpacity>
            </View>

            {/* Main Console Content */}
            <View style={styles.container}>
                {activeSOS?.isActive && (
                    <View style={styles.emergencyBanner}>
                        <View style={styles.emergencyTopRow}>
                            <Ionicons name="warning" size={24} color="#FFFFFF" />
                            <View style={styles.emergencyBannerTextContainer}>
                                <Text style={styles.emergencyBannerTitle}>EMERGENCY SOS</Text>
                                <Text style={styles.emergencyBannerDesc}>
                                    {activeSOS.passengerName} has triggered an SOS! Please check immediately.
                                </Text>
                            </View>
                            <TouchableOpacity style={styles.dismissEmergencyBtn} onPress={clearSOS}>
                                <Text style={styles.dismissEmergencyText}>DISMISS</Text>
                            </TouchableOpacity>
                        </View>

                        {/* Interactive Bus Operations Emergency Actions */}
                        <View style={styles.emergencyActionsRow}>
                            <TouchableOpacity
                                style={styles.emergencyCallBtn}
                                onPress={handleCallControlCenter}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="call" size={14} color="#FFFFFF" />
                                <Text style={styles.emergencyBtnText}>Call Control Center</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.emergencyChatBtn}
                                onPress={() => {
                                    syncBusEmergency();
                                    setIsChatModalVisible(true);
                                }}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="chatbubbles" size={14} color="#FFFFFF" />
                                <Text style={styles.emergencyBtnText}>
                                    Live Dispatch Chat {busEmergency?.dispatchMessages?.length ? `(${busEmergency.dispatchMessages.length})` : ''}
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.emergencyResolveBtn}
                                onPress={handleConfirmAssistedAndResolve}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="checkmark-circle" size={14} color="#FFFFFF" />
                                <Text style={styles.emergencyBtnText}>Assisted & Resolved</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
                {!!exitError && (
                    <View style={styles.exitErrorRow} accessibilityLiveRegion="polite">
                        <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                        <Text style={styles.exitErrorText}>{exitError}</Text>
                    </View>
                )}

                {isLoading ? (
                    <View style={styles.loadingBox}>
                        <ActivityIndicator size="large" color="#0066CC" />
                        <Text style={styles.loadingText}>{t('driver.loadingConsole', 'Loading vehicle console session...')}</Text>
                    </View>
                ) : !identity.signedIn ? (
                    /* Unauthenticated Bus Screen */
                    <View style={styles.signInCard}>
                        <View style={styles.lockIconCircle}>
                            <Ionicons name="lock-closed-outline" size={42} color="#0066CC" />
                        </View>
                        <Text style={styles.signInTitle}>{t('driver.consoleLocked', 'Vehicle Console Locked')}</Text>
                        <Text style={styles.signInDesc}>
                            Please sign in with your bus device credentials to access the Passenger Manifest & Conductor Console.
                        </Text>

                        <TouchableOpacity
                            style={styles.signInBtn}
                            onPress={() => router.replace('/(auth)/device-login' as any)}
                            activeOpacity={0.85}
                        >
                            <Ionicons name="key-outline" size={18} color="#FFFFFF" />
                            <Text style={styles.signInBtnText}>{t('driver.signInToBus', 'SIGN IN TO BUS DEVICE')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    /* Authenticated Bus Console */
                    <View style={{ flex: 1 }}>
                        {/* Operations Tab Switcher Bar */}
                        <View style={styles.tabBar}>
                            <TouchableOpacity
                                style={[styles.tabItem, activeTab === 'PASSENGERS' && styles.tabItemActive]}
                                onPress={() => setActiveTab('PASSENGERS')}
                                activeOpacity={0.8}
                            >
                                <Ionicons
                                    name="people"
                                    size={16}
                                    color={activeTab === 'PASSENGERS' ? '#0066CC' : '#64748B'}
                                />
                                <Text
                                    style={[
                                        styles.tabText,
                                        activeTab === 'PASSENGERS' && styles.tabTextActive,
                                    ]}
                                >
                                    Manifest
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.tabItem, activeTab === 'TRIP_CONTROL' && styles.tabItemActive]}
                                onPress={() => setActiveTab('TRIP_CONTROL')}
                                activeOpacity={0.8}
                            >
                                <Ionicons
                                    name="navigate"
                                    size={16}
                                    color={activeTab === 'TRIP_CONTROL' ? '#0066CC' : '#64748B'}
                                />
                                <Text
                                    style={[
                                        styles.tabText,
                                        activeTab === 'TRIP_CONTROL' && styles.tabTextActive,
                                    ]}
                                >
                                    Trip Control
                                </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.tabItem, activeTab === 'TRIP' && styles.tabItemActive]}
                                onPress={() => setActiveTab('TRIP')}
                                activeOpacity={0.8}
                            >
                                <Ionicons
                                    name="information-circle"
                                    size={16}
                                    color={activeTab === 'TRIP' ? '#0066CC' : '#64748B'}
                                />
                                <Text
                                    style={[
                                        styles.tabText,
                                        activeTab === 'TRIP' && styles.tabTextActive,
                                    ]}
                                >
                                    Bus Specs
                                </Text>
                            </TouchableOpacity>
                        </View>

                        {/* Active Tab View */}
                        <View style={styles.tabContent}>
                            {activeTab === 'PASSENGERS' && (
                                <PassengerManifestTab
                                    busId={session?.busId}
                                    numberPlate={session?.numberPlate}
                                    activeJourney={journey.journey}
                                    onNavigateToTripControl={() => setActiveTab('TRIP_CONTROL')}
                                />
                            )}

                            {activeTab === 'TRIP_CONTROL' && (
                                <TripControlTab journey={journey} />
                            )}

                            {activeTab === 'TRIP' && (
                                <TripInfoTab busId={session?.busId} numberPlate={session?.numberPlate} />
                            )}
                        </View>
                    </View>
                )}
            </View>

            {/* Modal: Driver & Conductor Live Chat with Dispatcher */}
            <Modal
                visible={isChatModalVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setIsChatModalVisible(false)}
            >
                <KeyboardAvoidingView
                    style={styles.chatModalOverlay}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                >
                    <View style={styles.chatModalCard}>
                        {/* Chat Header */}
                        <View style={styles.chatModalHeader}>
                            <View style={{ flex: 1 }}>
                                <View style={styles.chatModalTitleRow}>
                                    <View style={styles.liveIndicatorDot} />
                                    <Text style={styles.chatModalTitle}>Control Center Dispatch</Text>
                                </View>
                                <Text style={styles.chatModalSubtitle}>
                                    Bus {identity.signedIn ? identity.numberPlate : 'Console'} • Live HQ Link
                                </Text>
                            </View>
                            <TouchableOpacity
                                style={styles.chatModalCallBtn}
                                onPress={handleCallControlCenter}
                                activeOpacity={0.8}
                            >
                                <Ionicons name="call" size={14} color="#FFFFFF" />
                                <Text style={styles.chatModalCallText}>Call HQ</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.chatModalCloseBtn}
                                onPress={() => setIsChatModalVisible(false)}
                            >
                                <Ionicons name="close" size={20} color="#64748B" />
                            </TouchableOpacity>
                        </View>

                        {/* Quick Response Chips for Driver / Conductor */}
                        <Text style={styles.quickReplyLabel}>Driver Quick Responses:</Text>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={styles.driverChipsScrollView}
                            contentContainerStyle={styles.driverChipsScroll}
                        >
                            <TouchableOpacity
                                style={styles.driverChip}
                                onPress={() => handleSendBusMessage('Attending to commuter onboard. Status stable.')}
                                disabled={isSendingMessage}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.driverChipText}>✅ Attending onboard</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.driverChip}
                                onPress={() => handleSendBusMessage('Safely pulled over at next bus halt.')}
                                disabled={isSendingMessage}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.driverChipText}>🛑 Safely pulled over</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.driverChip}
                                onPress={() => handleSendBusMessage('Wheelchair ramp deployed at vehicle exit.')}
                                disabled={isSendingMessage}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.driverChipText}>♿ Ramp deployed</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.driverChip}
                                onPress={() => handleSendBusMessage('Need medical / ambulance assistance at next halt.')}
                                disabled={isSendingMessage}
                                activeOpacity={0.7}
                            >
                                <Text style={styles.driverChipText}>🚑 Need ambulance</Text>
                            </TouchableOpacity>
                        </ScrollView>

                        {/* Chat Messages Body */}
                        <ScrollView
                            ref={chatScrollRef}
                            style={styles.chatMessageList}
                            contentContainerStyle={styles.chatMessageListContent}
                            onContentSizeChange={() => chatScrollRef.current?.scrollToEnd({ animated: true })}
                        >
                            {(!busEmergency?.dispatchMessages || busEmergency.dispatchMessages.length === 0) ? (
                                <View style={styles.emptyChatBox}>
                                    <Ionicons name="chatbubbles-outline" size={32} color="#94A3B8" />
                                    <Text style={styles.emptyChatTitle}>No messages exchanged yet</Text>
                                    <Text style={styles.emptyChatDesc}>
                                        Use quick buttons above or type below to send situation updates to Control Center.
                                    </Text>
                                </View>
                            ) : (
                                busEmergency.dispatchMessages.map((msg) => {
                                    const isFromBus = msg.sender === 'BUS_CREW';
                                    return (
                                        <View
                                            key={msg.id}
                                            style={[
                                                styles.chatBubble,
                                                isFromBus ? styles.chatBubbleBus : styles.chatBubbleAdmin,
                                            ]}
                                        >
                                            <View style={styles.chatBubbleHeader}>
                                                <View style={styles.chatBubbleSenderGroup}>
                                                    <Ionicons
                                                        name={isFromBus ? 'bus' : 'shield-checkmark'}
                                                        size={12}
                                                        color={isFromBus ? '#D97706' : '#2563EB'}
                                                    />
                                                    <Text
                                                        style={[
                                                            styles.chatBubbleSender,
                                                            { color: isFromBus ? '#D97706' : '#2563EB' },
                                                        ]}
                                                        numberOfLines={1}
                                                    >
                                                        {msg.senderName}
                                                    </Text>
                                                </View>
                                                <Text style={styles.chatBubbleTime}>
                                                    {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </Text>
                                            </View>
                                            <Text style={styles.chatBubbleText}>{msg.message}</Text>
                                        </View>
                                    );
                                })
                            )}
                        </ScrollView>

                        {/* Input Row */}
                        <View style={styles.chatInputRow}>
                            <TextInput
                                style={styles.chatTextInput}
                                placeholder="Type update to dispatch..."
                                placeholderTextColor="#94A3B8"
                                value={chatInputMessage}
                                onChangeText={setChatInputMessage}
                                editable={!isSendingMessage}
                            />
                            <TouchableOpacity
                                style={[
                                    styles.chatSendBtn,
                                    (!chatInputMessage.trim() || isSendingMessage) && styles.chatSendBtnDisabled,
                                ]}
                                onPress={() => handleSendBusMessage()}
                                disabled={!chatInputMessage.trim() || isSendingMessage}
                            >
                                {isSendingMessage ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <Ionicons name="send" size={16} color="#FFFFFF" />
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#F4F7FB',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
    },
    headerTitleGroup: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    busIconBox: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
        borderWidth: 1,
        borderColor: '#DBEAFE',
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '900',
        color: '#0F172A',
        letterSpacing: 0.2,
    },
    plateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 2,
        gap: 6,
    },
    activeDot: {
        width: 7,
        height: 7,
        borderRadius: 4,
        backgroundColor: '#10B981',
    },
    headerSubtitle: {
        fontSize: 12,
        fontWeight: '800',
        color: '#334155',
    },
    headerRouteTag: {
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 6,
        paddingVertical: 1.5,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    headerRouteTagText: {
        fontSize: 10,
        fontWeight: '800',
        color: '#0066CC',
    },
    logoutButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF2F2',
        paddingVertical: 7,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#FEE2E2',
        gap: 4,
    },
    logoutText: {
        fontSize: 12,
        fontWeight: '800',
        color: '#DC2626',
    },
    container: {
        flex: 1,
        paddingHorizontal: 12,
        paddingTop: 10,
    },
    exitErrorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF2F2',
        padding: 10,
        borderRadius: 10,
        marginBottom: 12,
    },
    exitErrorText: {
        color: '#D32F2F',
        fontSize: 12,
        marginLeft: 8,
    },
    loadingBox: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 10,
    },
    signInCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 28,
        alignItems: 'center',
        marginTop: 40,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 3,
    },
    lockIconCircle: {
        width: 70,
        height: 70,
        borderRadius: 35,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    signInTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0F172A',
        marginTop: 8,
    },
    signInDesc: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        marginTop: 6,
        lineHeight: 19,
    },
    signInBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0066CC',
        paddingHorizontal: 22,
        paddingVertical: 13,
        borderRadius: 12,
        marginTop: 20,
        gap: 8,
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 3,
    },
    signInBtnText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 13,
        letterSpacing: 0.3,
    },
    tabBar: {
        flexDirection: 'row',
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 3,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginBottom: 10,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.03,
        shadowRadius: 2,
        elevation: 1,
    },
    tabItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 9,
        borderRadius: 10,
        gap: 5,
    },
    tabItemActive: {
        backgroundColor: '#EFF6FF',
    },
    tabText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#64748B',
    },
    tabTextActive: {
        color: '#0066CC',
        fontWeight: '800',
    },
    tabContent: {
        flex: 1,
    },
    emergencyBanner: {
        backgroundColor: '#DC2626',
        borderRadius: 12,
        padding: 16,
        marginBottom: 16,
        shadowColor: '#DC2626',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    emergencyTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    emergencyBannerTextContainer: {
        flex: 1,
        marginLeft: 12,
    },
    emergencyBannerTitle: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '900',
        letterSpacing: 0.5,
    },
    emergencyBannerDesc: {
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: '500',
        marginTop: 4,
        lineHeight: 18,
    },
    dismissEmergencyBtn: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        marginLeft: 10,
    },
    dismissEmergencyText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '800',
    },
    emergencyActionsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: 'rgba(255, 255, 255, 0.25)',
    },
    emergencyCallBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#1E293B',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        gap: 6,
    },
    emergencyChatBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#2563EB',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        gap: 6,
    },
    emergencyAckBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#2563EB',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        gap: 6,
    },
    emergencyResolveBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#16A34A',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        gap: 6,
    },
    emergencyBtnText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '800',
    },
    chatModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        justifyContent: 'flex-end',
    },
    chatModalCard: {
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: Platform.OS === 'ios' ? 24 : 14,
        height: '75%',
        maxHeight: '85%',
    },
    chatModalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
        gap: 10,
    },
    chatModalTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    liveIndicatorDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#10B981',
    },
    chatModalTitle: {
        fontSize: 16,
        fontWeight: '900',
        color: '#0F172A',
    },
    chatModalSubtitle: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
    },
    chatModalCallBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#16A34A',
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
        gap: 4,
    },
    chatModalCallText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '800',
    },
    chatModalCloseBtn: {
        padding: 6,
        borderRadius: 8,
        backgroundColor: '#F1F5F9',
    },
    quickReplyLabel: {
        fontSize: 11,
        fontWeight: '800',
        color: '#64748B',
        textTransform: 'uppercase',
        marginTop: 10,
        marginBottom: 6,
        letterSpacing: 0.5,
    },
    driverChipsScrollView: {
        height: 38,
        maxHeight: 38,
        flexGrow: 0,
        marginBottom: 6,
    },
    driverChipsScroll: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 2,
    },
    driverChip: {
        backgroundColor: '#EFF6FF',
        borderWidth: 1,
        borderColor: '#BFDBFE',
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 6,
        height: 32,
        justifyContent: 'center',
        alignItems: 'center',
    },
    driverChipText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#1E40AF',
    },
    chatMessageList: {
        flex: 1,
        marginVertical: 4,
    },
    chatMessageListContent: {
        gap: 8,
        paddingVertical: 6,
    },
    emptyChatBox: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 40,
        gap: 8,
    },
    emptyChatTitle: {
        fontSize: 14,
        fontWeight: '800',
        color: '#475569',
    },
    emptyChatDesc: {
        fontSize: 12,
        color: '#94A3B8',
        textAlign: 'center',
        paddingHorizontal: 24,
    },
    chatBubble: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 14,
        maxWidth: '85%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    chatBubbleBus: {
        alignSelf: 'flex-end',
        backgroundColor: '#FEF3C7',
        borderWidth: 1,
        borderColor: '#FDE68A',
        borderBottomRightRadius: 2,
    },
    chatBubbleAdmin: {
        alignSelf: 'flex-start',
        backgroundColor: '#EFF6FF',
        borderWidth: 1,
        borderColor: '#BFDBFE',
        borderBottomLeftRadius: 2,
    },
    chatBubbleHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 4,
    },
    chatBubbleSenderGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        flexShrink: 1,
    },
    chatBubbleSender: {
        fontSize: 11,
        fontWeight: '800',
    },
    chatBubbleTime: {
        fontSize: 10,
        color: '#94A3B8',
        flexShrink: 0,
    },
    chatBubbleText: {
        fontSize: 13,
        color: '#1E293B',
        lineHeight: 18,
    },
    chatInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#E2E8F0',
    },
    chatTextInput: {
        flex: 1,
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 9,
        fontSize: 13,
        color: '#0F172A',
    },
    chatSendBtn: {
        backgroundColor: '#0066CC',
        width: 40,
        height: 40,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    chatSendBtnDisabled: {
        backgroundColor: '#94A3B8',
        opacity: 0.6,
    },
});
