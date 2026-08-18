import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { API_BASE_URL } from '../src/shared/api/config';
import { useAuthStore } from '../src/shared/store/authStore';

export default function AccessibilityProfileScreen() {
    const { user } = useAuthStore();
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isRemoving, setIsRemoving] = useState(false);

    // Profile State
    const initialAccNeeds = Array.isArray((user as any)?.accessibilityNeeds) ? (user as any).accessibilityNeeds : [];
    const initialProfileId = (user as any)?.accessibilityProfileId || '';

    // Category Toggles initialized directly from user registration/profile state
    const [isWheelchair, setIsWheelchair] = useState(() =>
        Boolean((user as any)?.isWheelchairUser || initialAccNeeds.includes('wheelchair'))
    );
    const [isLowVision, setIsLowVision] = useState(() =>
        Boolean((user as any)?.isLowVisionPerson || initialAccNeeds.includes('low_vision'))
    );
    const [isHearing, setIsHearing] = useState(() =>
        Boolean((user as any)?.isHearingImpaired || initialAccNeeds.includes('hearing_impairment'))
    );
    const [profileId, setProfileId] = useState<string>(initialProfileId);

    // Requested Bus Services & Facilities State
    const [services, setServices] = useState({
        wheelchairRamp: true,
        wheelchairSpace: true,
        prioritySeats: true,
        clearAnnouncements: true,
        vibratedDevices: true,
        visualAnnouncements: true,
    });

    const displayUser = user || {
        passengerId: 'PAS-2026-00012',
        uid: 'demo-uid',
        userName: 'Sunil Perera',
    };

    // Load existing accessibility profile details from backend
    useEffect(() => {
        const loadProfile = async () => {
            setIsLoading(true);
            try {
                const pId = displayUser.passengerId;
                const userObj = user as any;
                
                // Read current registered choices from user profile
                const storeNeeds: string[] = Array.isArray(userObj?.accessibilityNeeds) ? userObj.accessibilityNeeds : [];
                let wheelchairState = Boolean(userObj?.isWheelchairUser || storeNeeds.includes('wheelchair'));
                let lowVisionState = Boolean(userObj?.isLowVisionPerson || storeNeeds.includes('low_vision'));
                let hearingState = Boolean(userObj?.isHearingImpaired || storeNeeds.includes('hearing_impairment'));

                const res = await fetch(`${API_BASE_URL}/api/accessibility-profile?passengerId=${pId}`);

                if (res.ok) {
                    const data = await res.json();
                    if (data.success && data.profile) {
                        const prof = data.profile;
                        setProfileId(prof.accessibilityProfileId || userObj?.accessibilityProfileId || '');
                        setHasNeeds(prof.hasAccessibilityNeeds !== false);

                        const needs: string[] = prof.accessibilityNeeds || [];
                        if (needs.length > 0) {
                            wheelchairState = needs.includes('wheelchair');
                            lowVisionState = needs.includes('low_vision');
                            hearingState = needs.includes('hearing_impairment');
                        }

                        if (prof.requestedServices) {
                            setServices({
                                wheelchairRamp: prof.requestedServices.wheelchairRamp !== false,
                                wheelchairSpace: prof.requestedServices.wheelchairSpace !== false,
                                prioritySeats: prof.requestedServices.prioritySeats !== false,
                                clearAnnouncements: prof.requestedServices.clearAnnouncements !== false,
                                vibratedDevices: prof.requestedServices.vibratedDevices !== false,
                                visualAnnouncements: prof.requestedServices.visualAnnouncements !== false,
                            });
                        }
                    }
                }

                setIsWheelchair(wheelchairState);
                setIsLowVision(lowVisionState);
                setIsHearing(hearingState);
            } catch (error) {
                console.error('Error loading accessibility profile:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadProfile();
    }, [displayUser.passengerId, user]);

    const toggleService = (key: keyof typeof services) => {
        setServices(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        const selectedNeeds: string[] = [];
        if (isWheelchair) selectedNeeds.push('wheelchair');
        if (isLowVision) selectedNeeds.push('low_vision');
        if (isHearing) selectedNeeds.push('hearing_impairment');

        try {
            const payload = {
                passengerId: displayUser.passengerId,
                userId: displayUser.uid,
                accessibilityProfileId: profileId || undefined,
                accessibilityNeeds: selectedNeeds,
                requestedServices: services,
            };

            const response = await fetch(`${API_BASE_URL}/api/accessibility-profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json();

            if (response.ok && result.success) {
                // Update local auth store state so profile screen badges update instantly
                const currentUser = useAuthStore.getState().user;
                if (currentUser) {
                    useAuthStore.setState({
                        user: {
                            ...currentUser,
                            accessibilityProfileId: result.profileId || profileId,
                            hasAccessibilityNeeds: selectedNeeds.length > 0,
                            accessibilityNeeds: selectedNeeds,
                            isWheelchairUser: isWheelchair,
                            isLowVisionPerson: isLowVision,
                            isHearingImpaired: isHearing,
                        },
                    });
                }

                if (Platform.OS === 'web') {
                    window.alert('Accessibility Profile saved successfully to accessibility_needs_persons collection!');
                } else {
                    Alert.alert('Success', 'Accessibility Profile saved successfully!');
                }
                router.back();
            } else {
                Alert.alert('Save Failed', result.message || 'Could not save profile.');
            }
        } catch (error) {
            console.error('Error saving profile:', error);
            Alert.alert('Error', 'Network error. Please try again later.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleRemoveProfile = async () => {
        const performRemove = async () => {
            setIsRemoving(true);
            try {
                const res = await fetch(`${API_BASE_URL}/api/accessibility-profile?passengerId=${displayUser.passengerId}`, {
                    method: 'DELETE',
                });

                if (res.ok) {
                    const currentUser = useAuthStore.getState().user;
                    if (currentUser) {
                        useAuthStore.setState({
                            user: {
                                ...currentUser,
                                accessibilityProfileId: null,
                                hasAccessibilityNeeds: false,
                                accessibilityNeeds: [],
                                isWheelchairUser: false,
                                isLowVisionPerson: false,
                                isHearingImpaired: false,
                            },
                        });
                    }

                    if (Platform.OS === 'web') {
                        window.alert('Accessibility Profile removed successfully.');
                    } else {
                        Alert.alert('Success', 'Accessibility Profile removed successfully.');
                    }
                    router.back();
                }
            } catch (err) {
                console.error('Error removing profile:', err);
            } finally {
                setIsRemoving(false);
            }
        };

        if (Platform.OS === 'web') {
            if (window.confirm('Are you sure you want to remove your accessibility profile preferences?')) {
                performRemove();
            }
        } else {
            Alert.alert('Remove Profile', 'Are you sure you want to remove your accessibility profile preferences?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: performRemove },
            ]);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <StatusBar barStyle="dark-content" />
            <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
                {/* Header Navigation */}
                <View style={styles.headerBar}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => router.back()}
                        accessibilityRole="button"
                        accessibilityLabel="Go Back"
                    >
                        <Ionicons name="arrow-back" size={24} color="#1E293B" />
                    </TouchableOpacity>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.headerTitle}>Manage Accessibility Profile</Text>
                        <Text style={styles.headerSubtitle}>Customize vehicle services & accommodations</Text>
                    </View>
                </View>

                {isLoading ? (
                    <View style={styles.loadingBox}>
                        <ActivityIndicator size="large" color="#7C3AED" />
                        <Text style={styles.loadingText}>Loading profile from accessibility_needs_persons...</Text>
                    </View>
                ) : (
                    <View>
                        {/* Profile Info Banner */}
                        <View style={styles.bannerCard}>
                            <View style={styles.bannerHeader}>
                                <Ionicons name="body" size={26} color="#7C3AED" style={{ marginRight: 10 }} />
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.bannerTitle}>Passenger Accessibility Profile</Text>
                                    <Text style={styles.bannerId}>
                                        Document ID: {profileId || `ACC-2026-00012`} • Passenger ID: {displayUser.passengerId}
                                    </Text>
                                </View>
                            </View>
                        </View>

                        {/* CATEGORY 1: WHEELCHAIR USER SERVICES */}
                        <View style={styles.categoryCard}>
                            <View style={styles.categoryHeader}>
                                <Text style={styles.categoryEmoji}>♿</Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.categoryTitle}>Wheelchair User Support</Text>
                                    <Text style={styles.categorySubtitle}>Mobility assistance & vehicle ramp access</Text>
                                </View>
                                <Switch
                                    value={isWheelchair}
                                    onValueChange={setIsWheelchair}
                                    trackColor={{ false: '#E2E8F0', true: '#DDD6FE' }}
                                    thumbColor={isWheelchair ? '#7C3AED' : '#F8FAFC'}
                                    accessibilityLabel="Enable Wheelchair User Support"
                                />
                            </View>

                            {isWheelchair && (
                                <View style={styles.servicesContainer}>
                                    <Text style={styles.servicesTitle}>Bus Services Requested:</Text>

                                    {/* Ramp Service */}
                                    <TouchableOpacity
                                        style={[styles.serviceRow, services.wheelchairRamp && styles.serviceRowActive]}
                                        onPress={() => toggleService('wheelchairRamp')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: services.wheelchairRamp }}
                                    >
                                        <Ionicons
                                            name={services.wheelchairRamp ? "checkbox" : "square-outline"}
                                            size={22}
                                            color={services.wheelchairRamp ? "#7C3AED" : "#94A3B8"}
                                            style={{ marginRight: 10 }}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.serviceName}>Wheelchair Ramp Access</Text>
                                            <Text style={styles.serviceDesc}>Driver deploys mechanical ramp for boarding.</Text>
                                        </View>
                                    </TouchableOpacity>

                                    {/* Wheelchair Space */}
                                    <TouchableOpacity
                                        style={[styles.serviceRow, services.wheelchairSpace && styles.serviceRowActive]}
                                        onPress={() => toggleService('wheelchairSpace')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: services.wheelchairSpace }}
                                    >
                                        <Ionicons
                                            name={services.wheelchairSpace ? "checkbox" : "square-outline"}
                                            size={22}
                                            color={services.wheelchairSpace ? "#7C3AED" : "#94A3B8"}
                                            style={{ marginRight: 10 }}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.serviceName}>Wheelchair Space Reservation</Text>
                                            <Text style={styles.serviceDesc}>Dedicated onboard space with locking restraints.</Text>
                                        </View>
                                    </TouchableOpacity>

                                    {/* Priority Seats */}
                                    <TouchableOpacity
                                        style={[styles.serviceRow, services.prioritySeats && styles.serviceRowActive]}
                                        onPress={() => toggleService('prioritySeats')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: services.prioritySeats }}
                                    >
                                        <Ionicons
                                            name={services.prioritySeats ? "checkbox" : "square-outline"}
                                            size={22}
                                            color={services.prioritySeats ? "#7C3AED" : "#94A3B8"}
                                            style={{ marginRight: 10 }}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.serviceName}>Priority Seating Access</Text>
                                            <Text style={styles.serviceDesc}>Reserved seats near the main entrance.</Text>
                                        </View>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>

                        {/* CATEGORY 2: LOW VISION SERVICES */}
                        <View style={styles.categoryCard}>
                            <View style={styles.categoryHeader}>
                                <Text style={styles.categoryEmoji}>👁️</Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.categoryTitle}>Low Vision Support</Text>
                                    <Text style={styles.categorySubtitle}>Audio announcements & visual aids</Text>
                                </View>
                                <Switch
                                    value={isLowVision}
                                    onValueChange={setIsLowVision}
                                    trackColor={{ false: '#E2E8F0', true: '#FDE68A' }}
                                    thumbColor={isLowVision ? '#D97706' : '#F8FAFC'}
                                    accessibilityLabel="Enable Low Vision Support"
                                />
                            </View>

                            {isLowVision && (
                                <View style={styles.servicesContainer}>
                                    <Text style={styles.servicesTitle}>Bus Services Requested:</Text>

                                    {/* Clear Announcements */}
                                    <TouchableOpacity
                                        style={[styles.serviceRow, services.clearAnnouncements && styles.serviceRowActiveAmber]}
                                        onPress={() => toggleService('clearAnnouncements')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: services.clearAnnouncements }}
                                    >
                                        <Ionicons
                                            name={services.clearAnnouncements ? "checkbox" : "square-outline"}
                                            size={22}
                                            color={services.clearAnnouncements ? "#D97706" : "#94A3B8"}
                                            style={{ marginRight: 10 }}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.serviceName}>Clear Audio Announcements</Text>
                                            <Text style={styles.serviceDesc}>High-volume stop announcements and route alerts.</Text>
                                        </View>
                                    </TouchableOpacity>

                                    {/* Vibrated Devices */}
                                    <TouchableOpacity
                                        style={[styles.serviceRow, services.vibratedDevices && styles.serviceRowActiveAmber]}
                                        onPress={() => toggleService('vibratedDevices')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: services.vibratedDevices }}
                                    >
                                        <Ionicons
                                            name={services.vibratedDevices ? "checkbox" : "square-outline"}
                                            size={22}
                                            color={services.vibratedDevices ? "#D97706" : "#94A3B8"}
                                            style={{ marginRight: 10 }}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.serviceName}>Vibrated Assistance Devices</Text>
                                            <Text style={styles.serviceDesc}>Tactile vibration alerts when bus approaches your stop.</Text>
                                        </View>
                                    </TouchableOpacity>

                                    {/* Priority Seats */}
                                    <TouchableOpacity
                                        style={[styles.serviceRow, services.prioritySeats && styles.serviceRowActiveAmber]}
                                        onPress={() => toggleService('prioritySeats')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: services.prioritySeats }}
                                    >
                                        <Ionicons
                                            name={services.prioritySeats ? "checkbox" : "square-outline"}
                                            size={22}
                                            color={services.prioritySeats ? "#D97706" : "#94A3B8"}
                                            style={{ marginRight: 10 }}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.serviceName}>Priority Front Seating</Text>
                                            <Text style={styles.serviceDesc}>Seats close to the driver for guided boarding.</Text>
                                        </View>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>

                        {/* CATEGORY 3: HEARING IMPAIRMENT SERVICES */}
                        <View style={styles.categoryCard}>
                            <View style={styles.categoryHeader}>
                                <Text style={styles.categoryEmoji}>👂</Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.categoryTitle}>Hearing Impairment Support</Text>
                                    <Text style={styles.categorySubtitle}>Visual displays & tactile alerts</Text>
                                </View>
                                <Switch
                                    value={isHearing}
                                    onValueChange={setIsHearing}
                                    trackColor={{ false: '#E2E8F0', true: '#BFDBFE' }}
                                    thumbColor={isHearing ? '#2563EB' : '#F8FAFC'}
                                    accessibilityLabel="Enable Hearing Impairment Support"
                                />
                            </View>

                            {isHearing && (
                                <View style={styles.servicesContainer}>
                                    <Text style={styles.servicesTitle}>Bus Services Requested:</Text>

                                    {/* Vibrated Devices */}
                                    <TouchableOpacity
                                        style={[styles.serviceRow, services.vibratedDevices && styles.serviceRowActiveBlue]}
                                        onPress={() => toggleService('vibratedDevices')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: services.vibratedDevices }}
                                    >
                                        <Ionicons
                                            name={services.vibratedDevices ? "checkbox" : "square-outline"}
                                            size={22}
                                            color={services.vibratedDevices ? "#2563EB" : "#94A3B8"}
                                            style={{ marginRight: 10 }}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.serviceName}>Vibrated Assistance Devices</Text>
                                            <Text style={styles.serviceDesc}>Haptic wristband or phone vibration for stop arrival.</Text>
                                        </View>
                                    </TouchableOpacity>

                                    {/* Visual Announcements */}
                                    <TouchableOpacity
                                        style={[styles.serviceRow, services.visualAnnouncements && styles.serviceRowActiveBlue]}
                                        onPress={() => toggleService('visualAnnouncements')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: services.visualAnnouncements }}
                                    >
                                        <Ionicons
                                            name={services.visualAnnouncements ? "checkbox" : "square-outline"}
                                            size={22}
                                            color={services.visualAnnouncements ? "#2563EB" : "#94A3B8"}
                                            style={{ marginRight: 10 }}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.serviceName}>Visual Route Announcements</Text>
                                            <Text style={styles.serviceDesc}>High-contrast LED screens displaying upcoming stops.</Text>
                                        </View>
                                    </TouchableOpacity>

                                    {/* Priority Seats */}
                                    <TouchableOpacity
                                        style={[styles.serviceRow, services.prioritySeats && styles.serviceRowActiveBlue]}
                                        onPress={() => toggleService('prioritySeats')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: services.prioritySeats }}
                                    >
                                        <Ionicons
                                            name={services.prioritySeats ? "checkbox" : "square-outline"}
                                            size={22}
                                            color={services.prioritySeats ? "#2563EB" : "#94A3B8"}
                                            style={{ marginRight: 10 }}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.serviceName}>Priority Visible Seating</Text>
                                            <Text style={styles.serviceDesc}>Seating positioned with clear view of digital displays.</Text>
                                        </View>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>

                        {/* ACTION BUTTONS */}
                        <View style={styles.actionButtonGroup}>
                            {/* Save Button */}
                            <TouchableOpacity
                                style={[styles.saveButton, isSaving && styles.buttonDisabled]}
                                onPress={handleSave}
                                disabled={isSaving}
                                accessibilityRole="button"
                                accessibilityLabel="Save Profile Changes"
                            >
                                {isSaving ? (
                                    <ActivityIndicator size="small" color="#FFFFFF" />
                                ) : (
                                    <>
                                        <Ionicons name="checkmark-circle-outline" size={22} color="#FFFFFF" style={{ marginRight: 8 }} />
                                        <Text style={styles.saveButtonText}>SAVE ACCESSIBILITY PROFILE</Text>
                                    </>
                                )}
                            </TouchableOpacity>

                            {/* Remove Profile Button */}
                            <TouchableOpacity
                                style={[styles.removeButton, isRemoving && styles.buttonDisabled]}
                                onPress={handleRemoveProfile}
                                disabled={isRemoving}
                                accessibilityRole="button"
                                accessibilityLabel="Remove Accessibility Profile"
                            >
                                <Ionicons name="trash-outline" size={20} color="#DC2626" style={{ marginRight: 6 }} />
                                <Text style={styles.removeButtonText}>CLEAR ACCESSIBILITY PROFILE</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
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
        padding: 18,
        paddingBottom: 40,
    },
    headerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 20,
    },
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    headerTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#0F172A',
    },
    headerSubtitle: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 2,
    },
    loadingBox: {
        padding: 40,
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 14,
        color: '#64748B',
    },
    bannerCard: {
        backgroundColor: '#F5F3FF',
        borderWidth: 1.5,
        borderColor: '#DDD6FE',
        borderRadius: 16,
        padding: 16,
        marginBottom: 18,
    },
    bannerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    bannerTitle: {
        fontSize: 17,
        fontWeight: 'bold',
        color: '#7C3AED',
    },
    bannerId: {
        fontSize: 12,
        color: '#6D28D9',
        fontWeight: '600',
        marginTop: 2,
    },
    bannerDescription: {
        fontSize: 13,
        color: '#4C1D95',
        lineHeight: 19,
    },
    categoryCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
        elevation: 2,
    },
    categoryHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    categoryEmoji: {
        fontSize: 26,
        marginRight: 12,
    },
    categoryTitle: {
        fontSize: 17,
        fontWeight: 'bold',
        color: '#0F172A',
    },
    categorySubtitle: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 2,
    },
    servicesContainer: {
        marginTop: 16,
        paddingTop: 14,
        borderTopWidth: 1,
        borderTopColor: '#F1F5F9',
    },
    servicesTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#334155',
        marginBottom: 10,
    },
    serviceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
        borderRadius: 12,
        padding: 12,
        marginBottom: 8,
    },
    serviceRowActive: {
        borderColor: '#7C3AED',
        backgroundColor: '#F5F3FF',
    },
    serviceRowActiveAmber: {
        borderColor: '#D97706',
        backgroundColor: '#FFFBEB',
    },
    serviceRowActiveBlue: {
        borderColor: '#2563EB',
        backgroundColor: '#EFF6FF',
    },
    serviceName: {
        fontSize: 15,
        fontWeight: '700',
        color: '#1E293B',
    },
    serviceDesc: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
    },
    actionButtonGroup: {
        marginTop: 10,
        gap: 12,
    },
    saveButton: {
        backgroundColor: '#7C3AED',
        minHeight: 56,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#7C3AED',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 4,
    },
    saveButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: 'bold',
        letterSpacing: 0.5,
    },
    removeButton: {
        backgroundColor: '#FEF2F2',
        borderWidth: 1.5,
        borderColor: '#FCA5A5',
        minHeight: 52,
        borderRadius: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    removeButtonText: {
        color: '#DC2626',
        fontSize: 14,
        fontWeight: 'bold',
    },
    buttonDisabled: {
        opacity: 0.6,
    },
});
