import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { Booking } from '../../../entities/booking/model/types';
import { AppText as Text } from '../../../shared/ui/AppText';

interface QRManifestScannerModalProps {
    visible: boolean;
    onClose: () => void;
    onScanTicket: (scannedPayload: string) => void;
    currentBookings?: Booking[];
    isProcessing?: boolean;
}

export function QRManifestScannerModal({
    visible,
    onClose,
    onScanTicket,
    currentBookings = [],
    isProcessing = false,
}: QRManifestScannerModalProps) {
    const [permission, requestPermission] = useCameraPermissions();
    const [facing, setFacing] = useState<'back' | 'front'>('back');
    const [flash, setFlash] = useState(false);
    const [manualInput, setManualInput] = useState('');
    const [activeMode, setActiveMode] = useState<'CAMERA' | 'MANUAL'>('CAMERA');
    const [scannedRecently, setScannedRecently] = useState(false);

    // Laser scan beam animation
    const scanLineAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (visible && activeMode === 'CAMERA') {
            const loop = Animated.loop(
                Animated.sequence([
                    Animated.timing(scanLineAnim, {
                        toValue: 1,
                        duration: 2000,
                        useNativeDriver: true,
                    }),
                    Animated.timing(scanLineAnim, {
                        toValue: 0,
                        duration: 2000,
                        useNativeDriver: true,
                    }),
                ])
            );
            loop.start();
            return () => loop.stop();
        }
    }, [visible, activeMode]);

    useEffect(() => {
        if (visible) {
            setScannedRecently(false);
            setManualInput('');
        }
    }, [visible]);

    const handleBarcodeScanned = ({ data }: { data: string }) => {
        if (scannedRecently || isProcessing) return;

        setScannedRecently(true);
        try {
            if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
        } catch {}

        onScanTicket(data);
    };

    const handleManualSubmit = () => {
        if (!manualInput.trim() || isProcessing) return;
        try {
            if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
        } catch {}
        onScanTicket(manualInput.trim());
    };

    const handleQuickSelectTicket = (booking: Booking) => {
        if (isProcessing) return;
        try {
            if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
        } catch {}
        const payload = booking.qrPayload || booking.bookingId;
        onScanTicket(payload);
    };

    const toggleFacing = () => {
        setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
    };

    const toggleFlash = () => {
        setFlash((prev) => !prev);
    };

    const translateY = scanLineAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 220],
    });

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={false}
            onRequestClose={onClose}
        >
            <View style={styles.container}>
                {/* Top Control Bar */}
                <View style={styles.topBar}>
                    <TouchableOpacity
                        style={styles.circleBtn}
                        onPress={onClose}
                        accessibilityLabel="Close QR Scanner"
                    >
                        <Ionicons name="close" size={22} color="#0F172A" />
                    </TouchableOpacity>

                    <View style={styles.modeToggleContainer}>
                        <TouchableOpacity
                            style={[
                                styles.modeToggleBtn,
                                activeMode === 'CAMERA' && styles.modeToggleBtnActive,
                            ]}
                            onPress={() => setActiveMode('CAMERA')}
                        >
                            <Ionicons
                                name="camera"
                                size={16}
                                color={activeMode === 'CAMERA' ? '#FFFFFF' : '#64748B'}
                            />
                            <Text
                                style={[
                                    styles.modeToggleText,
                                    activeMode === 'CAMERA' && styles.modeToggleTextActive,
                                ]}
                            >
                                Camera
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                styles.modeToggleBtn,
                                activeMode === 'MANUAL' && styles.modeToggleBtnActive,
                            ]}
                            onPress={() => setActiveMode('MANUAL')}
                        >
                            <Ionicons
                                name="keypad"
                                size={16}
                                color={activeMode === 'MANUAL' ? '#FFFFFF' : '#64748B'}
                            />
                            <Text
                                style={[
                                    styles.modeToggleText,
                                    activeMode === 'MANUAL' && styles.modeToggleTextActive,
                                ]}
                            >
                                Manual / Test
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.topRightControls}>
                        {activeMode === 'CAMERA' && (
                            <>
                                <TouchableOpacity
                                    style={[styles.circleBtn, flash && styles.circleBtnActive]}
                                    onPress={toggleFlash}
                                    accessibilityLabel="Toggle Flashlight"
                                >
                                    <Ionicons
                                        name={flash ? 'flash' : 'flash-off'}
                                        size={18}
                                        color={flash ? '#D97706' : '#475569'}
                                    />
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.circleBtn, { marginLeft: 8 }]}
                                    onPress={toggleFacing}
                                    accessibilityLabel="Flip Camera"
                                >
                                    <Ionicons name="camera-reverse" size={18} color="#475569" />
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </View>

                {/* Body Content */}
                {activeMode === 'CAMERA' ? (
                    <View style={styles.cameraWrapper}>
                        {!permission ? (
                            <View style={styles.permissionBox}>
                                <ActivityIndicator size="large" color="#0066CC" />
                                <Text style={styles.infoText}>Checking camera permissions...</Text>
                            </View>
                        ) : !permission.granted ? (
                            <View style={styles.permissionBox}>
                                <View style={styles.permissionIconCircle}>
                                    <Ionicons name="camera-outline" size={40} color="#0066CC" />
                                </View>
                                <Text style={styles.permissionTitle}>Camera Permission Required</Text>
                                <Text style={styles.permissionSub}>
                                    Please grant camera access to scan passenger boarding QR codes quickly.
                                </Text>
                                <TouchableOpacity
                                    style={styles.grantBtn}
                                    onPress={requestPermission}
                                >
                                    <Text style={styles.grantBtnText}>Grant Camera Access</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.grantSecondaryBtn}
                                    onPress={() => setActiveMode('MANUAL')}
                                >
                                    <Text style={styles.grantSecondaryBtnText}>Use Manual / Test Selection</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <>
                                <CameraView
                                    style={StyleSheet.absoluteFill}
                                    facing={facing}
                                    enableTorch={flash}
                                    barcodeScannerSettings={{
                                        barcodeTypes: ['qr'],
                                    }}
                                    onBarcodeScanned={scannedRecently ? undefined : handleBarcodeScanned}
                                />

                                {/* Viewfinder Reticle Overlay */}
                                <View style={styles.overlayContainer} pointerEvents="box-none">
                                    <View style={styles.maskDark} />

                                    <View style={styles.centerRow}>
                                        <View style={styles.maskDark} />

                                        <View style={styles.viewfinderFrame}>
                                            {/* Corner brackets */}
                                            <View style={[styles.corner, styles.cornerTL]} />
                                            <View style={[styles.corner, styles.cornerTR]} />
                                            <View style={[styles.corner, styles.cornerBL]} />
                                            <View style={[styles.corner, styles.cornerBR]} />

                                            {/* Animated Laser Scanning Line */}
                                            <Animated.View
                                                style={[
                                                    styles.scanLine,
                                                    { transform: [{ translateY }] },
                                                ]}
                                            />

                                            {isProcessing && (
                                                <View style={styles.verifyingIndicator}>
                                                    <ActivityIndicator size="large" color="#0066CC" />
                                                    <Text style={styles.verifyingText}>
                                                        Verifying Ticket...
                                                    </Text>
                                                </View>
                                            )}
                                        </View>

                                        <View style={styles.maskDark} />
                                    </View>

                                    <View style={styles.maskDark} />
                                </View>
                            </>
                        )}

                        {/* Scanner Helper Floating Card */}
                        <View style={styles.scannerFooterCard}>
                            <View style={styles.scannerFooterIconBox}>
                                <Ionicons name="scan" size={20} color="#0066CC" />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.scannerInstruction}>
                                    Align Passenger Ticket QR Code
                                </Text>
                                <Text style={styles.scannerSubInstruction}>
                                    Instant verification for boarding, drop-off & fare collection
                                </Text>
                            </View>
                        </View>
                    </View>
                ) : (
                    /* Manual Input & Test Ticket Selector */
                    <ScrollView
                        style={styles.manualScroll}
                        contentContainerStyle={styles.manualScrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.manualCard}>
                            <View style={styles.manualCardHeader}>
                                <View style={styles.manualIconCircle}>
                                    <Ionicons name="keypad" size={16} color="#0066CC" />
                                </View>
                                <Text style={styles.manualTitle}>Enter Ticket Reference Code</Text>
                            </View>
                            <Text style={styles.manualSub}>
                                If passenger's screen is damaged or low battery, enter their Booking ID:
                            </Text>

                            <View style={styles.inputRow}>
                                <TextInput
                                    style={styles.manualInput}
                                    placeholder="e.g. BKG-2026-00036"
                                    placeholderTextColor="#94A3B8"
                                    value={manualInput}
                                    onChangeText={setManualInput}
                                    autoCapitalize="characters"
                                    returnKeyType="done"
                                    onSubmitEditing={handleManualSubmit}
                                />
                                <TouchableOpacity
                                    style={[
                                        styles.verifyBtn,
                                        !manualInput.trim() && styles.verifyBtnDisabled,
                                    ]}
                                    onPress={handleManualSubmit}
                                    disabled={!manualInput.trim() || isProcessing}
                                >
                                    {isProcessing ? (
                                        <ActivityIndicator size="small" color="#FFFFFF" />
                                    ) : (
                                        <>
                                            <Ionicons name="search" size={15} color="#FFFFFF" />
                                            <Text style={styles.verifyBtnText}>Verify</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>

                        {/* Quick Test Picker for Trip Passengers */}
                        <View style={styles.testPickerSection}>
                            <View style={styles.sectionHeaderRow}>
                                <Ionicons name="people" size={16} color="#64748B" />
                                <Text style={styles.sectionHeader}>
                                    Trip Passengers ({currentBookings.length})
                                </Text>
                            </View>

                            {currentBookings.length === 0 ? (
                                <View style={styles.emptyTestBox}>
                                    <Ionicons name="people-outline" size={36} color="#94A3B8" />
                                    <Text style={styles.emptyTestTitle}>No Bookings Found</Text>
                                    <Text style={styles.emptyTestText}>
                                        No passenger reservations registered for this trip.
                                    </Text>
                                </View>
                            ) : (
                                currentBookings.map((b) => {
                                    const isW =
                                        b.seatNumber?.startsWith('W') ||
                                        b.assistanceRequested?.wheelchairAssistance;
                                    const isPriority = b.isPrioritySeat;
                                    const isBoarded = b.boardingStatus === 'BOARDED';
                                    const isPaid = b.paymentStatus === 'PAID';
                                    const displayName = b.passengerName || b.userId || 'Guest Passenger';

                                    return (
                                        <TouchableOpacity
                                            key={b.bookingId}
                                            style={[
                                                styles.testPassengerCard,
                                                isBoarded && styles.testPassengerCardBoarded,
                                            ]}
                                            onPress={() => handleQuickSelectTicket(b)}
                                            disabled={isProcessing}
                                            activeOpacity={0.8}
                                        >
                                            {/* Seat Box */}
                                            <View
                                                style={[
                                                    styles.testSeatBox,
                                                    isW && styles.testSeatBoxWheelchair,
                                                    isBoarded && styles.testSeatBoxBoarded,
                                                ]}
                                            >
                                                <Text style={[styles.testSeatLabel, isBoarded && styles.testSeatLabelBoarded, isW && styles.testSeatLabelWheelchair]}>
                                                    SEAT
                                                </Text>
                                                <Text style={[styles.testSeatText, isBoarded && styles.testSeatTextBoarded, isW && styles.testSeatTextWheelchair]}>
                                                    {b.seatNumber}
                                                </Text>
                                                {isW && (
                                                    <Ionicons
                                                        name="accessibility"
                                                        size={11}
                                                        color="#7C3AED"
                                                        style={{ marginTop: 1 }}
                                                    />
                                                )}
                                                {isPriority && !isW && (
                                                    <Ionicons
                                                        name="star"
                                                        size={11}
                                                        color="#D97706"
                                                        style={{ marginTop: 1 }}
                                                    />
                                                )}
                                            </View>

                                            {/* Details Col */}
                                            <View style={styles.testDetailsCol}>
                                                <View style={styles.testRowTop}>
                                                    <Text
                                                        style={styles.testPassengerName}
                                                        numberOfLines={1}
                                                    >
                                                        {displayName}
                                                    </Text>

                                                    {isBoarded ? (
                                                        <View style={styles.boardedMiniBadge}>
                                                            <Ionicons
                                                                name="checkmark-circle"
                                                                size={12}
                                                                color="#15803D"
                                                            />
                                                            <Text style={styles.boardedMiniText}>
                                                                BOARDED
                                                            </Text>
                                                        </View>
                                                    ) : (
                                                        <View style={styles.pendingMiniBadge}>
                                                            <Ionicons
                                                                name="scan"
                                                                size={12}
                                                                color="#0284C7"
                                                            />
                                                            <Text style={styles.pendingMiniText}>
                                                                SCAN TICKET
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>

                                                <Text style={styles.testSubId} numberOfLines={1}>
                                                    Ref: {b.bookingId}
                                                </Text>

                                                <View style={styles.testMetaRow}>
                                                    <Text
                                                        style={styles.testHaltText}
                                                        numberOfLines={1}
                                                    >
                                                        <Ionicons
                                                            name="location"
                                                            size={12}
                                                            color="#0284C7"
                                                        />{' '}
                                                        {b.journey?.endLocation || 'Destination'}
                                                    </Text>

                                                    <Text style={styles.testFareText}>
                                                        LKR {b.fare?.totalFare ?? '—'} ·{' '}
                                                        <Text style={{ fontWeight: '800', color: isPaid ? '#15803D' : '#D97706' }}>
                                                            {isPaid ? 'Paid' : 'Cash'}
                                                        </Text>
                                                    </Text>
                                                </View>
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })
                            )}
                        </View>
                    </ScrollView>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: Platform.OS === 'ios' ? 52 : 28,
        paddingHorizontal: 16,
        paddingBottom: 14,
        backgroundColor: '#FFFFFF',
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
        zIndex: 10,
        elevation: 2,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
    },
    circleBtn: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: '#F1F5F9',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        alignItems: 'center',
        justifyContent: 'center',
    },
    circleBtnActive: {
        backgroundColor: '#FEF3C7',
        borderWidth: 1,
        borderColor: '#F59E0B',
    },
    modeToggleContainer: {
        flexDirection: 'row',
        backgroundColor: '#F1F5F9',
        borderRadius: 20,
        padding: 3,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    modeToggleBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 17,
        gap: 6,
    },
    modeToggleBtnActive: {
        backgroundColor: '#0066CC',
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3,
        elevation: 2,
    },
    modeToggleText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#64748B',
    },
    modeToggleTextActive: {
        color: '#FFFFFF',
    },
    topRightControls: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    cameraWrapper: {
        flex: 1,
        position: 'relative',
        backgroundColor: '#0F172A',
    },
    permissionBox: {
        flex: 1,
        backgroundColor: '#FFFFFF',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 30,
    },
    permissionIconCircle: {
        width: 72,
        height: 72,
        borderRadius: 36,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    permissionTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0F172A',
        marginBottom: 8,
        textAlign: 'center',
    },
    permissionSub: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 18,
    },
    grantBtn: {
        backgroundColor: '#0066CC',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
        width: '100%',
        alignItems: 'center',
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.2,
        shadowRadius: 5,
        elevation: 3,
    },
    grantBtnText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 14,
    },
    grantSecondaryBtn: {
        backgroundColor: '#F1F5F9',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
        width: '100%',
        alignItems: 'center',
        marginTop: 10,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    grantSecondaryBtnText: {
        color: '#0F172A',
        fontWeight: '700',
        fontSize: 14,
    },
    infoText: {
        color: '#64748B',
        fontSize: 13,
        marginTop: 12,
        fontWeight: '600',
    },
    overlayContainer: {
        ...StyleSheet.absoluteFill,
    },
    maskDark: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
    },
    centerRow: {
        flexDirection: 'row',
        height: 260,
    },
    viewfinderFrame: {
        width: 260,
        height: 260,
        position: 'relative',
        backgroundColor: 'transparent',
    },
    corner: {
        position: 'absolute',
        width: 32,
        height: 32,
        borderColor: '#38BDF8',
    },
    cornerTL: {
        top: 0,
        left: 0,
        borderTopWidth: 4,
        borderLeftWidth: 4,
        borderTopLeftRadius: 14,
    },
    cornerTR: {
        top: 0,
        right: 0,
        borderTopWidth: 4,
        borderRightWidth: 4,
        borderTopRightRadius: 14,
    },
    cornerBL: {
        bottom: 0,
        left: 0,
        borderBottomWidth: 4,
        borderLeftWidth: 4,
        borderBottomLeftRadius: 14,
    },
    cornerBR: {
        bottom: 0,
        right: 0,
        borderBottomWidth: 4,
        borderRightWidth: 4,
        borderBottomRightRadius: 14,
    },
    scanLine: {
        position: 'absolute',
        left: 6,
        right: 6,
        height: 3,
        backgroundColor: '#38BDF8',
        shadowColor: '#38BDF8',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.9,
        shadowRadius: 8,
        borderRadius: 2,
    },
    verifyingIndicator: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(255, 255, 255, 0.92)',
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    verifyingText: {
        color: '#0066CC',
        fontWeight: '800',
        fontSize: 14,
        marginTop: 10,
    },
    scannerFooterCard: {
        position: 'absolute',
        bottom: Platform.OS === 'ios' ? 36 : 24,
        left: 16,
        right: 16,
        backgroundColor: '#FFFFFF',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
    scannerFooterIconBox: {
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    scannerInstruction: {
        color: '#0F172A',
        fontSize: 13,
        fontWeight: '800',
    },
    scannerSubInstruction: {
        color: '#64748B',
        fontSize: 11,
        marginTop: 2,
        fontWeight: '500',
    },
    manualScroll: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    manualScrollContent: {
        padding: 16,
        paddingBottom: 40,
    },
    manualCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 2,
    },
    manualCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 6,
    },
    manualIconCircle: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    manualTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: '#0F172A',
    },
    manualSub: {
        fontSize: 12,
        color: '#64748B',
        marginBottom: 14,
        lineHeight: 18,
    },
    inputRow: {
        flexDirection: 'row',
        gap: 10,
    },
    manualInput: {
        flex: 1,
        backgroundColor: '#F8FAFC',
        color: '#0F172A',
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        fontSize: 13,
        fontWeight: '700',
        borderWidth: 1,
        borderColor: '#CBD5E1',
    },
    verifyBtn: {
        flexDirection: 'row',
        backgroundColor: '#0066CC',
        paddingHorizontal: 16,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    verifyBtnDisabled: {
        backgroundColor: '#94A3B8',
    },
    verifyBtnText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 13,
    },
    testPickerSection: {
        flex: 1,
    },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
    },
    sectionHeader: {
        fontSize: 12,
        fontWeight: '800',
        color: '#64748B',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    emptyTestBox: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 30,
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    emptyTestTitle: {
        color: '#0F172A',
        fontSize: 14,
        fontWeight: '800',
        marginTop: 10,
    },
    emptyTestText: {
        color: '#64748B',
        fontSize: 12,
        marginTop: 4,
        textAlign: 'center',
    },
    testPassengerCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.03,
        shadowRadius: 3,
        elevation: 1,
    },
    testPassengerCardBoarded: {
        backgroundColor: '#F0FDF4',
        borderColor: '#BBF7D0',
    },
    testSeatBox: {
        width: 48,
        height: 52,
        borderRadius: 10,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#BFDBFE',
        marginRight: 12,
    },
    testSeatBoxWheelchair: {
        backgroundColor: '#FAF5FF',
        borderColor: '#E9D5FF',
    },
    testSeatBoxBoarded: {
        backgroundColor: '#DCFCE7',
        borderColor: '#86EFAC',
    },
    testSeatLabel: {
        fontSize: 8,
        fontWeight: '800',
        color: '#3B82F6',
        letterSpacing: 0.5,
    },
    testSeatLabelWheelchair: {
        color: '#7C3AED',
    },
    testSeatLabelBoarded: {
        color: '#15803D',
    },
    testSeatText: {
        fontSize: 14,
        fontWeight: '900',
        color: '#1E40AF',
    },
    testSeatTextWheelchair: {
        color: '#6B21A8',
    },
    testSeatTextBoarded: {
        color: '#166534',
    },
    testDetailsCol: {
        flex: 1,
        justifyContent: 'center',
    },
    testRowTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 2,
    },
    testPassengerName: {
        fontSize: 14,
        fontWeight: '800',
        color: '#0F172A',
        flex: 1,
        marginRight: 8,
    },
    testSubId: {
        fontSize: 11,
        color: '#64748B',
        fontWeight: '600',
        marginBottom: 4,
    },
    testMetaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    testHaltText: {
        fontSize: 11,
        color: '#0284C7',
        fontWeight: '600',
        flex: 1,
    },
    testFareText: {
        fontSize: 11,
        color: '#475569',
        fontWeight: '700',
    },
    boardedMiniBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#DCFCE7',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        gap: 4,
    },
    boardedMiniText: {
        color: '#15803D',
        fontSize: 10,
        fontWeight: '800',
    },
    pendingMiniBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#E0F2FE',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        gap: 4,
    },
    pendingMiniText: {
        color: '#0369A1',
        fontSize: 10,
        fontWeight: '800',
    },
});
