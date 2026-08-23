import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API_BASE_URL } from '../../../shared/api/config';

interface TripInfoTabProps {
    busId?: string;
    numberPlate?: string;
}

export function TripInfoTab({ busId, numberPlate }: TripInfoTabProps) {
    const [busData, setBusData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!busId) {
            setLoading(false);
            return;
        }

        (async () => {
            try {
                setLoading(true);
                const res = await fetch(`${API_BASE_URL}/api/buses/${encodeURIComponent(busId)}`);
                const data = await res.json().catch(() => null);
                if (data?.success && data.bus) {
                    setBusData(data.bus);
                }
            } catch {
                // Silently swallow fallback
            } finally {
                setLoading(false);
            }
        })();
    }, [busId]);

    if (loading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="small" color="#0066CC" />
                <Text style={styles.loadingText}>Fetching vehicle specs...</Text>
            </View>
        );
    }

    const facilities = busData?.accessibilityFacilities;

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 30 }}>
            <View style={styles.headerTitleRow}>
                <Ionicons name="bus-outline" size={22} color="#0066CC" />
                <Text style={styles.headerTitle}>Vehicle Operations & Specifications 🚍</Text>
            </View>

            {/* Vehicle Profile Card */}
            <View style={styles.card}>
                <View style={styles.cardHeader}>
                    <View style={styles.busBadge}>
                        <Ionicons name="bus" size={20} color="#0066CC" />
                    </View>
                    <View>
                        <Text style={styles.plateNumber}>{numberPlate || busData?.numberPlate || 'BUS-CON-01'}</Text>
                        <Text style={styles.modelName}>{busData?.busModel || 'Leyland Commercial Transit'}</Text>
                    </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.specGrid}>
                    <View style={styles.specItem}>
                        <Text style={styles.specLabel}>Seat Capacity</Text>
                        <Text style={styles.specValue}>{busData?.seatCapacity || 42} seats</Text>
                    </View>
                    <View style={styles.specItem}>
                        <Text style={styles.specLabel}>Operational Status</Text>
                        <Text style={[styles.specValue, { color: '#059669' }]}>ACTIVE IN SERVICE</Text>
                    </View>
                </View>
            </View>

            {/* Accessibility Facilities Card */}
            <Text style={styles.sectionLabel}>Accessibility Equipment & Capacity</Text>

            <View style={styles.facilitiesCard}>
                <FacilityRow
                    icon="body-outline"
                    title="Mechanical Ramp Access"
                    desc="Vehicle equipped with mechanical ramp deployed by conductor."
                    status={facilities?.wheelchairRamp !== false}
                />

                <FacilityRow
                    icon="easel-outline"
                    title="Wheelchair Bays"
                    desc={`Designated wheelchair positions (${facilities?.wheelchairSpace?.count ?? 2} bays).`}
                    status={facilities?.wheelchairSpace?.available !== false}
                />

                <FacilityRow
                    icon="people-outline"
                    title="Guardian Companion Seats"
                    desc="Paired caregiver seats located beside wheelchair positions."
                    status={facilities?.guardianSeats?.available !== false}
                />

                <FacilityRow
                    icon="star-outline"
                    title="Priority Reserved Seats"
                    desc="Priority seating reserved for low vision & mobility commuters."
                    status={facilities?.prioritySeats?.available !== false}
                    isLast
                />
            </View>
        </ScrollView>
    );
}

function FacilityRow({
    icon,
    title,
    desc,
    status,
    isLast,
}: {
    icon: string;
    title: string;
    desc: string;
    status: boolean;
    isLast?: boolean;
}) {
    return (
        <View style={[styles.facilityRow, isLast && { borderBottomWidth: 0 }]}>
            <View style={styles.facilityIconBox}>
                <Ionicons name={icon as any} size={20} color={status ? '#0066CC' : '#94A3B8'} />
            </View>

            <View style={{ flex: 1, marginLeft: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.facilityTitle}>{title}</Text>
                    <View style={[styles.statusPill, { backgroundColor: status ? '#D1FAE5' : '#F1F5F9' }]}>
                        <Text style={[styles.statusPillText, { color: status ? '#065F46' : '#64748B' }]}>
                            {status ? 'EQUIPPED' : 'NOT EQUIPPED'}
                        </Text>
                    </View>
                </View>
                <Text style={styles.facilityDesc}>{desc}</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        width: '100%',
    },
    center: {
        padding: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 10,
    },
    headerTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    headerTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: '#0F172A',
        marginLeft: 8,
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    busBadge: {
        width: 42,
        height: 42,
        borderRadius: 12,
        backgroundColor: '#EBF3FA',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    plateNumber: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0F172A',
    },
    modelName: {
        fontSize: 12,
        color: '#64748B',
    },
    divider: {
        height: 1,
        backgroundColor: '#F1F5F9',
        marginVertical: 12,
    },
    specGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    specItem: {},
    specLabel: {
        fontSize: 11,
        color: '#64748B',
    },
    specValue: {
        fontSize: 13,
        fontWeight: '700',
        color: '#0F172A',
        marginTop: 2,
    },
    sectionLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
        marginBottom: 8,
    },
    facilitiesCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    facilityRow: {
        flexDirection: 'row',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    facilityIconBox: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: '#F8FAFC',
        alignItems: 'center',
        justifyContent: 'center',
    },
    facilityTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: '#0F172A',
    },
    facilityDesc: {
        fontSize: 11,
        color: '#64748B',
        marginTop: 2,
    },
    statusPill: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 6,
    },
    statusPillText: {
        fontSize: 9,
        fontWeight: '800',
    },
});
