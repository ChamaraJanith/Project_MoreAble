import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Linking,
    RefreshControl,
    ScrollView,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { AppText as Text } from '../../../src/shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import {
    EmergencyRequest,
    EmergencyStatus,
} from '../../../src/entities/emergency/model/types';
import { getEmergencies, deleteEmergencyApi } from '../../../src/features/admin/api/emergencyAdminApi';


export default function EmergencyDashboardScreen() {
    const [emergencies, setEmergencies] = useState<EmergencyRequest[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [selectedTab, setSelectedTab] = useState<EmergencyStatus | 'ALL'>('ALL');
    const [searchQuery, setSearchQuery] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const loadData = useCallback(async (isRefresh = false) => {
        if (isRefresh) setIsRefreshing(true);
        else setIsLoading(true);
        setErrorMessage('');

        try {
            const data = await getEmergencies({ status: 'ALL' });
            setEmergencies(data);
        } catch (error: any) {
            setErrorMessage(error?.message || 'Failed to fetch emergency requests.');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            loadData();
            // Polling interval every 10 seconds for real-time dispatch dashboard
            const interval = setInterval(() => {
                getEmergencies({ status: 'ALL' })
                    .then((data) => setEmergencies(data))
                    .catch(() => {});
            }, 10000);

            return () => clearInterval(interval);
        }, [loadData])
    );

    const counts = useMemo(() => {
        const pending = emergencies.filter((e) => e.status === 'PENDING').length;
        const assigned = emergencies.filter((e) => e.status === 'ASSIGNED').length;
        const resolved = emergencies.filter((e) => e.status === 'RESOLVED').length;
        return { pending, assigned, resolved, total: emergencies.length };
    }, [emergencies]);

    const filteredEmergencies = useMemo(() => {
        return emergencies.filter((item) => {
            const matchesTab = selectedTab === 'ALL' || item.status === selectedTab;
            if (!matchesTab) return false;

            if (!searchQuery.trim()) return true;
            const query = searchQuery.toLowerCase().trim();
            return (
                item.id.toLowerCase().includes(query) ||
                item.passenger?.name?.toLowerCase().includes(query) ||
                item.passenger?.phone?.includes(query) ||
                item.vehicle?.plateNumber?.toLowerCase().includes(query) ||
                item.bookingId?.toLowerCase().includes(query)
            );
        });
    }, [emergencies, selectedTab, searchQuery]);

    const handleCallPhone = (phone?: string) => {
        if (!phone) {
            Alert.alert('No Phone', 'Passenger phone number is not available.');
            return;
        }
        Linking.openURL(`tel:${phone}`).catch(() => {
            Alert.alert('Call Failed', 'Unable to initiate phone call on this device.');
        });
    };

    const handleOpenMaps = (lat: number, lng: number) => {
        const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        Linking.openURL(url).catch(() => {
            Alert.alert('Map Error', 'Unable to open Google Maps.');
        });
    };

    const handleDeleteEmergency = (id: string) => {
        Alert.alert(
            'Dismiss Incident',
            `Are you sure you want to dismiss and clear emergency record ${id}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Dismiss',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteEmergencyApi(id);
                            setEmergencies((prev) => prev.filter((e) => e.id !== id));
                        } catch (err: any) {
                            Alert.alert('Error', err?.message || 'Failed to dismiss emergency.');
                        }
                    },
                },
            ]
        );
    };

    const formatElapsedTime = (isoString?: string) => {

        if (!isoString) return 'Just now';
        const diffMs = Date.now() - new Date(isoString).getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        return `${Math.floor(diffHours / 24)}d ago`;
    };

    const getStatusStyle = (status: EmergencyStatus) => {
        switch (status) {
            case 'PENDING':
                return {
                    badge: styles.statusBadgePending,
                    text: styles.statusTextPending,
                    border: styles.cardBorderPending,
                    label: '🚨 PENDING ACTION',
                };
            case 'ASSIGNED':
                return {
                    badge: styles.statusBadgeAssigned,
                    text: styles.statusTextAssigned,
                    border: styles.cardBorderAssigned,
                    label: '🛡️ SUPPORT ASSIGNED',
                };
            case 'RESOLVED':
                return {
                    badge: styles.statusBadgeResolved,
                    text: styles.statusTextResolved,
                    border: styles.cardBorderResolved,
                    label: '✅ RESOLVED',
                };
            default:
                return {
                    badge: styles.statusBadgePending,
                    text: styles.statusTextPending,
                    border: styles.cardBorderPending,
                    label: status,
                };
        }
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => router.back()}
                    accessibilityRole="button"
                    accessibilityLabel="Back to admin dashboard"
                >
                    <Ionicons name="arrow-back" size={24} color="#1E293B" />
                </TouchableOpacity>

                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>Emergency Requests</Text>
                    <Text style={styles.headerSubtitle}>Coordinate Incident Support & Rapid Response</Text>
                </View>

                <TouchableOpacity
                    style={styles.refreshIconBtn}
                    onPress={() => loadData(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Refresh emergencies"
                >
                    <Ionicons name="refresh" size={22} color="#0284C7" />
                </TouchableOpacity>
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={isRefreshing} onRefresh={() => loadData(true)} />
                }
            >
                {/* Stats Overview Grid */}
                <View style={styles.statsGrid}>
                    <TouchableOpacity
                        style={[styles.statBox, selectedTab === 'PENDING' && styles.statBoxActive]}
                        onPress={() => setSelectedTab('PENDING')}
                    >
                        <View style={[styles.statIconBadge, { backgroundColor: '#FEE2E2' }]}>
                            <Ionicons name="alert-circle" size={20} color="#DC2626" />
                        </View>
                        <Text style={[styles.statNumber, { color: '#DC2626' }]}>{counts.pending}</Text>
                        <Text style={styles.statLabel}>Pending</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.statBox, selectedTab === 'ASSIGNED' && styles.statBoxActive]}
                        onPress={() => setSelectedTab('ASSIGNED')}
                    >
                        <View style={[styles.statIconBadge, { backgroundColor: '#FEF3C7' }]}>
                            <Ionicons name="shield-half" size={20} color="#D97706" />
                        </View>
                        <Text style={[styles.statNumber, { color: '#D97706' }]}>{counts.assigned}</Text>
                        <Text style={styles.statLabel}>Assigned</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.statBox, selectedTab === 'RESOLVED' && styles.statBoxActive]}
                        onPress={() => setSelectedTab('RESOLVED')}
                    >
                        <View style={[styles.statIconBadge, { backgroundColor: '#DCFCE7' }]}>
                            <Ionicons name="checkmark-circle" size={20} color="#16A34A" />
                        </View>
                        <Text style={[styles.statNumber, { color: '#16A34A' }]}>{counts.resolved}</Text>
                        <Text style={styles.statLabel}>Resolved</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.statBox, selectedTab === 'ALL' && styles.statBoxActive]}
                        onPress={() => setSelectedTab('ALL')}
                    >
                        <View style={[styles.statIconBadge, { backgroundColor: '#F1F5F9' }]}>
                            <Ionicons name="layers-outline" size={20} color="#475569" />
                        </View>
                        <Text style={[styles.statNumber, { color: '#1E293B' }]}>{counts.total}</Text>
                        <Text style={styles.statLabel}>Total</Text>
                    </TouchableOpacity>
                </View>

                {/* Search Bar */}
                <View style={styles.searchContainer}>
                    <Ionicons name="search" size={20} color="#64748B" style={styles.searchIcon} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search by passenger, phone, vehicle plate..."
                        placeholderTextColor="#94A3B8"
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <Ionicons name="close-circle" size={18} color="#94A3B8" />
                        </TouchableOpacity>
                    )}
                </View>

                {/* Filter Tabs */}
                <View style={styles.filterTabsRow}>
                    {(['ALL', 'PENDING', 'ASSIGNED', 'RESOLVED'] as const).map((tab) => {
                        const active = selectedTab === tab;
                        return (
                            <TouchableOpacity
                                key={tab}
                                style={[styles.filterChip, active && styles.filterChipActive]}
                                onPress={() => setSelectedTab(tab)}
                            >
                                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                                    {tab === 'ALL' ? 'All Incidents' : tab}
                                </Text>
                            </TouchableOpacity>
                        );
                    })}
                </View>

                {/* Error Banner */}
                {!!errorMessage && (
                    <View style={styles.errorBanner}>
                        <Ionicons name="warning-outline" size={20} color="#DC2626" />
                        <Text style={styles.errorText}>{errorMessage}</Text>
                    </View>
                )}

                {/* Loading Indicator */}
                {isLoading ? (
                    <View style={styles.loaderCenter}>
                        <ActivityIndicator size="large" color="#DC2626" />
                        <Text style={styles.loaderText}>Scanning active transit emergencies...</Text>
                    </View>
                ) : filteredEmergencies.length === 0 ? (
                    <View style={styles.emptyState}>
                        <View style={styles.emptyIconContainer}>
                            <Ionicons name="shield-checkmark" size={48} color="#16A34A" />
                        </View>
                        <Text style={styles.emptyTitle}>No Emergency Requests Found</Text>
                        <Text style={styles.emptySubtext}>
                            {searchQuery
                                ? 'No results matched your search term.'
                                : 'All transit lines running smoothly with no pending emergency alerts.'}
                        </Text>
                    </View>
                ) : (
                    filteredEmergencies.map((item) => {
                        const statusConfig = getStatusStyle(item.status);
                        return (
                            <View key={item.id} style={[styles.card, statusConfig.border]}>
                                {/* Top Bar: ID, Status, Elapsed Time */}
                                <View style={styles.cardHeader}>
                                    <View style={styles.cardIdGroup}>
                                        <Text style={styles.cardId}>{item.id}</Text>
                                        <View style={statusConfig.badge}>
                                            <Text style={statusConfig.text}>{statusConfig.label}</Text>
                                        </View>
                                    </View>
                                    <View style={styles.cardHeaderActions}>
                                        <View style={styles.elapsedBadge}>
                                            <Ionicons name="time-outline" size={13} color="#64748B" />
                                            <Text style={styles.elapsedText}>{formatElapsedTime(item.createdAt)}</Text>
                                        </View>
                                        <TouchableOpacity
                                            style={styles.dismissButton}
                                            onPress={() => handleDeleteEmergency(item.id)}
                                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                            accessibilityLabel={`Dismiss emergency ${item.id}`}
                                        >
                                            <Ionicons name="trash-outline" size={14} color="#94A3B8" />
                                        </TouchableOpacity>
                                    </View>
                                </View>


                                {/* Passenger Details */}
                                <View style={styles.sectionRow}>
                                    <View style={styles.iconCircle}>
                                        <Ionicons name="person" size={18} color="#0284C7" />
                                    </View>
                                    <View style={styles.sectionContent}>
                                        <Text style={styles.sectionLabel}>PASSENGER DETAILS</Text>
                                        <Text style={styles.primaryText}>{item.passenger?.name || 'Commuter'}</Text>
                                        <View style={styles.phoneActionRow}>
                                            <Text style={styles.secondaryText}>{item.passenger?.phone || 'No phone'}</Text>
                                            {item.passenger?.phone && (
                                                <TouchableOpacity
                                                    style={styles.callButton}
                                                    onPress={() => handleCallPhone(item.passenger?.phone)}
                                                >
                                                    <Ionicons name="call" size={12} color="#FFFFFF" />
                                                    <Text style={styles.callButtonText}>Call</Text>
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                        {item.passenger?.specialAssistance && (
                                            <View style={styles.specialAssistanceBadge}>
                                                <Ionicons name="accessibility" size={12} color="#7C3AED" />
                                                <Text style={styles.specialAssistanceText}>
                                                    {item.passenger.specialAssistance}
                                                </Text>
                                            </View>
                                        )}
                                    </View>
                                </View>

                                {/* Vehicle Information */}
                                <View style={styles.sectionRow}>
                                    <View style={[styles.iconCircle, { backgroundColor: '#F0FDF4' }]}>
                                        <Ionicons name="bus" size={18} color="#16A34A" />
                                    </View>
                                    <View style={styles.sectionContent}>
                                        <Text style={styles.sectionLabel}>VEHICLE INFORMATION</Text>
                                        <Text style={styles.primaryText}>
                                            {item.vehicle?.plateNumber || 'Vehicle Not Linked'}
                                        </Text>
                                        <Text style={styles.secondaryText}>
                                            {item.vehicle?.model || 'Transit Unit'}
                                            {item.vehicle?.driverId ? ` • Driver ID: ${item.vehicle.driverId}` : ''}
                                        </Text>
                                    </View>
                                </View>

                                {/* Location Details */}
                                <View style={styles.sectionRow}>
                                    <View style={[styles.iconCircle, { backgroundColor: '#FEF2F2' }]}>
                                        <Ionicons name="location" size={18} color="#DC2626" />
                                    </View>
                                    <View style={styles.sectionContent}>
                                        <Text style={styles.sectionLabel}>EMERGENCY LOCATION</Text>
                                        <Text style={styles.primaryText}>
                                            {item.location?.stopName || item.location?.address || 'Live GPS Coordinates'}
                                        </Text>
                                        <Text style={styles.secondaryText}>
                                            {item.location?.latitude.toFixed(5)}, {item.location?.longitude.toFixed(5)}
                                        </Text>
                                        <TouchableOpacity
                                            style={styles.mapButton}
                                            onPress={() => handleOpenMaps(item.location.latitude, item.location.longitude)}
                                        >
                                            <Ionicons name="map-outline" size={14} color="#0284C7" />
                                            <Text style={styles.mapButtonText}>View on Google Maps</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>

                                {/* Assignment or Resolution Info if Available */}
                                {item.assignment && (
                                    <View style={styles.supportBox}>
                                        <Ionicons name="shield-checkmark" size={16} color="#D97706" />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.supportTitle}>
                                                Assigned: {item.assignment.responderName} ({item.assignment.responderContact})
                                            </Text>
                                            {item.assignment.etaMinutes ? (
                                                <Text style={styles.supportMeta}>ETA: ~{item.assignment.etaMinutes} mins</Text>
                                            ) : null}
                                        </View>
                                    </View>
                                )}

                                {/* Action Button */}
                                <TouchableOpacity
                                    style={[
                                        styles.actionButton,
                                        item.status === 'PENDING'
                                            ? styles.actionButtonPending
                                            : item.status === 'ASSIGNED'
                                            ? styles.actionButtonAssigned
                                            : styles.actionButtonResolved,
                                    ]}
                                    onPress={() => router.push(`/(admin)/emergencies/${item.id}` as any)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Manage emergency ${item.id}`}
                                >
                                    <Ionicons
                                        name={
                                            item.status === 'PENDING'
                                                ? 'alert-circle'
                                                : item.status === 'ASSIGNED'
                                                ? 'checkmark-circle-outline'
                                                : 'document-text-outline'
                                        }
                                        size={18}
                                        color="#FFFFFF"
                                    />
                                    <Text style={styles.actionButtonText}>
                                        {item.status === 'PENDING'
                                            ? 'Coordinate & Assign Support'
                                            : item.status === 'ASSIGNED'
                                            ? 'Update & Resolve Incident'
                                            : 'View Incident Timeline'}
                                    </Text>
                                    <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
                                </TouchableOpacity>
                            </View>
                        );
                    })
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC',
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
    headerTitleContainer: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#0F172A',
    },
    headerSubtitle: {
        fontSize: 12,
        color: '#64748B',
        marginTop: 2,
    },
    refreshIconBtn: {
        padding: 8,
        borderRadius: 8,
        backgroundColor: '#E0F2FE',
    },
    scrollContent: {
        padding: 16,
        paddingBottom: 32,
    },
    statsGrid: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 16,
    },
    statBox: {
        flex: 1,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 12,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    statBoxActive: {
        borderColor: '#0284C7',
        backgroundColor: '#F0F9FF',
    },
    statIconBadge: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 6,
    },
    statNumber: {
        fontSize: 18,
        fontWeight: '700',
    },
    statLabel: {
        fontSize: 11,
        color: '#64748B',
        fontWeight: '500',
        marginTop: 2,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 10,
        paddingHorizontal: 12,
        height: 44,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginBottom: 12,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 14,
        color: '#1E293B',
    },
    filterTabsRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 16,
    },
    filterChip: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    filterChipActive: {
        backgroundColor: '#0F172A',
        borderColor: '#0F172A',
    },
    filterChipText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#64748B',
    },
    filterChipTextActive: {
        color: '#FFFFFF',
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FEF2F2',
        padding: 12,
        borderRadius: 8,
        marginBottom: 16,
        gap: 8,
        borderWidth: 1,
        borderColor: '#FECACA',
    },
    errorText: {
        flex: 1,
        color: '#DC2626',
        fontSize: 13,
    },
    loaderCenter: {
        paddingVertical: 48,
        alignItems: 'center',
    },
    loaderText: {
        fontSize: 14,
        color: '#64748B',
        marginTop: 12,
    },
    emptyState: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 32,
        alignItems: 'center',
        marginTop: 20,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    emptyIconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#DCFCE7',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#0F172A',
        marginBottom: 6,
    },
    emptySubtext: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 18,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
        elevation: 2,
    },
    cardBorderPending: {
        borderColor: '#F87171',
    },
    cardBorderAssigned: {
        borderColor: '#FBBF24',
    },
    cardBorderResolved: {
        borderColor: '#86EFAC',
    },
    cardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingBottom: 12,
        marginBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    cardIdGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    cardId: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
    },
    statusBadgePending: {
        backgroundColor: '#FEE2E2',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    statusTextPending: {
        color: '#DC2626',
        fontSize: 11,
        fontWeight: '700',
    },
    statusBadgeAssigned: {
        backgroundColor: '#FEF3C7',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    statusTextAssigned: {
        color: '#D97706',
        fontSize: 11,
        fontWeight: '700',
    },
    statusBadgeResolved: {
        backgroundColor: '#DCFCE7',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    statusTextResolved: {
        color: '#16A34A',
        fontSize: 11,
        fontWeight: '700',
    },
    cardHeaderActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    elapsedBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    dismissButton: {
        padding: 5,
        borderRadius: 6,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
    },
    elapsedText: {
        fontSize: 12,
        color: '#64748B',
    },
    sectionRow: {
        flexDirection: 'row',
        marginBottom: 12,
        gap: 12,
    },
    iconCircle: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#E0F2FE',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 2,
    },
    sectionContent: {
        flex: 1,
    },
    sectionLabel: {
        fontSize: 10,
        fontWeight: '700',
        color: '#94A3B8',
        letterSpacing: 0.5,
        marginBottom: 2,
    },
    primaryText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#0F172A',
    },
    secondaryText: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 1,
    },
    phoneActionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 2,
    },
    callButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#0284C7',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        gap: 4,
    },
    callButtonText: {
        color: '#FFFFFF',
        fontSize: 11,
        fontWeight: '600',
    },
    specialAssistanceBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        backgroundColor: '#EDE9FE',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        gap: 4,
        marginTop: 4,
    },
    specialAssistanceText: {
        color: '#7C3AED',
        fontSize: 11,
        fontWeight: '600',
    },
    mapButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        gap: 4,
    },
    mapButtonText: {
        color: '#0284C7',
        fontSize: 12,
        fontWeight: '600',
    },
    supportBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFBEB',
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#FDE68A',
        marginBottom: 12,
        gap: 8,
    },
    supportTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: '#92400E',
    },
    supportMeta: {
        fontSize: 11,
        color: '#B45309',
        marginTop: 1,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        borderRadius: 10,
        gap: 8,
        marginTop: 4,
    },
    actionButtonPending: {
        backgroundColor: '#DC2626',
    },
    actionButtonAssigned: {
        backgroundColor: '#D97706',
    },
    actionButtonResolved: {
        backgroundColor: '#475569',
    },
    actionButtonText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
});
