import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Booking } from '../../../entities/booking/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { updateAssistanceStatus } from '../../booking/api/bookingApi';

interface AssistanceManifestCardProps {
    busId?: string;
    numberPlate?: string;
}

export function AssistanceManifestCard({ busId }: AssistanceManifestCardProps) {
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [loading, setLoading] = useState(true);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    useEffect(() => {
        loadAssistanceRequests();
    }, [busId]);

    async function loadAssistanceRequests() {
        if (!busId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const res = await fetch(`${API_BASE_URL}/api/booking/history?busId=${encodeURIComponent(busId)}`);
            const data = await res.json().catch(() => null);
            if (data?.success && Array.isArray(data.bookings)) {
                // Filter bookings that have travel assistance requested
                const assisted = data.bookings.filter(
                    (b: Booking) =>
                        b.status === 'CONFIRMED' &&
                        (b.assistanceRequested?.wheelchairAssistance ||
                            b.assistanceRequested?.boardingAssistance ||
                            b.assistanceRequested?.walkingAssistance ||
                            b.assistanceRequested?.prioritySeatAssistance)
                );
                setBookings(assisted);
            }
        } catch {
            // Silently swallow network error for background card
        } finally {
            setLoading(false);
        }
    }

    async function handleStatusChange(bookingId: string, newStatus: any) {
        setUpdatingId(bookingId);
        try {
            await updateAssistanceStatus(bookingId, newStatus);
            setBookings((prev) =>
                prev.map((b) => (b.bookingId === bookingId ? { ...b, assistanceStatus: newStatus } : b))
            );
        } catch (err: any) {
            console.error('Failed to update assistance status:', err);
        } finally {
            setUpdatingId(null);
        }
    }

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Ionicons name="hand-left" size={20} color="#7C3AED" />
                <View style={{ marginLeft: 8, flex: 1 }}>
                    <Text style={styles.title}>Conductor Assistance Manifest 👨‍✈️</Text>
                    <Text style={styles.subtitleText}>Conductor handles ramp deployment & boarding assistance at stops.</Text>
                </View>
            </View>

            {loading ? (
                <ActivityIndicator style={{ marginVertical: 12 }} size="small" color="#7C3AED" />
            ) : bookings.length === 0 ? (
                <Text style={styles.emptyText}>No pending passenger travel assistance requests for this trip.</Text>
            ) : (
                bookings.map((booking) => {
                    const status = booking.assistanceStatus ?? 'PENDING';
                    const isUpdating = updatingId === booking.bookingId;

                    return (
                        <View key={booking.bookingId} style={styles.passengerRow}>
                            <View style={styles.passengerHeader}>
                                <View>
                                    <Text style={styles.passengerSeat}>
                                        Seat {booking.seatNumber}
                                        {booking.pairedSeatNumber ? ` + Companion ${booking.pairedSeatNumber}` : ''}
                                    </Text>
                                    <Text style={styles.bookingId}>Booking #{booking.bookingId}</Text>
                                    <Text style={styles.stopInfo}>
                                        Pickup: {booking.journey?.startLocation || '—'} ➔ Drop-off: {booking.journey?.endLocation || '—'}
                                    </Text>
                                </View>

                                <View style={[styles.statusBadge, { backgroundColor: getStatusBg(status) }]}>
                                    <Text style={[styles.statusBadgeText, { color: getStatusColor(status) }]}>
                                        {getStatusLabel(status)}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.assistanceTags}>
                                {booking.assistanceRequested?.wheelchairAssistance && (
                                    <View style={[styles.tag, { backgroundColor: '#F3E8FF' }]}>
                                        <Ionicons name="body" size={12} color="#7C3AED" />
                                        <Text style={[styles.tagText, { color: '#7C3AED' }]}>Wheelchair Ramp & Space</Text>
                                    </View>
                                )}
                                {booking.assistanceRequested?.boardingAssistance && (
                                    <View style={[styles.tag, { backgroundColor: '#DBEAFE' }]}>
                                        <Ionicons name="footsteps" size={12} color="#1D4ED8" />
                                        <Text style={[styles.tagText, { color: '#1D4ED8' }]}>Boarding Guidance</Text>
                                    </View>
                                )}
                                {booking.assistanceRequested?.walkingAssistance && (
                                    <View style={[styles.tag, { backgroundColor: '#E0E7FF' }]}>
                                        <Ionicons name="walk" size={12} color="#4338CA" />
                                        <Text style={[styles.tagText, { color: '#4338CA' }]}>Walking Escort</Text>
                                    </View>
                                )}
                            </View>

                            {!!booking.specialRequests && (
                                <Text style={styles.notes}>Passenger Note: {booking.specialRequests}</Text>
                            )}

                            {/* Action Buttons for Conductor */}
                            <View style={styles.actionRow}>
                                {isUpdating ? (
                                    <ActivityIndicator size="small" color="#0066CC" />
                                ) : (
                                    <>
                                        {status !== 'CONFIRMED' && status !== 'COMPLETED' && (
                                            <TouchableOpacity
                                                style={[styles.actionBtn, { backgroundColor: '#D1FAE5' }]}
                                                onPress={() => handleStatusChange(booking.bookingId, 'CONFIRMED')}
                                            >
                                                <Text style={[styles.actionBtnText, { color: '#065F46' }]}>
                                                    Acknowledge Request
                                                </Text>
                                            </TouchableOpacity>
                                        )}
                                        {status !== 'IN_PROGRESS' && status !== 'COMPLETED' && (
                                            <TouchableOpacity
                                                style={[styles.actionBtn, { backgroundColor: '#DBEAFE' }]}
                                                onPress={() => handleStatusChange(booking.bookingId, 'IN_PROGRESS')}
                                            >
                                                <Text style={[styles.actionBtnText, { color: '#1E40AF' }]}>
                                                    Assisting Boarding
                                                </Text>
                                            </TouchableOpacity>
                                        )}
                                        {status !== 'COMPLETED' && (
                                            <TouchableOpacity
                                                style={[styles.actionBtn, { backgroundColor: '#F3E8FF' }]}
                                                onPress={() => handleStatusChange(booking.bookingId, 'COMPLETED')}
                                            >
                                                <Text style={[styles.actionBtnText, { color: '#6B21A8' }]}>
                                                    Complete Assistance
                                                </Text>
                                            </TouchableOpacity>
                                        )}
                                    </>
                                )}
                            </View>
                        </View>
                    );
                })
            )}
        </View>
    );
}

function getStatusLabel(status: string) {
    switch (status) {
        case 'CONFIRMED':
            return 'ACKNOWLEDGED BY CREW';
        case 'IN_PROGRESS':
            return 'ASSISTING BOARDING';
        case 'COMPLETED':
            return 'ASSISTANCE COMPLETED';
        case 'DECLINED':
            return 'UNAVAILABLE';
        default:
            return 'NOTIFIED CONDUCTOR';
    }
}

function getStatusBg(status: string) {
    switch (status) {
        case 'CONFIRMED':
            return '#D1FAE5';
        case 'IN_PROGRESS':
            return '#DBEAFE';
        case 'COMPLETED':
            return '#E0E7FF';
        case 'DECLINED':
            return '#FEE2E2';
        default:
            return '#FEF3C7';
    }
}

function getStatusColor(status: string) {
    switch (status) {
        case 'CONFIRMED':
            return '#065F46';
        case 'IN_PROGRESS':
            return '#1E40AF';
        case 'COMPLETED':
            return '#3730A3';
        case 'DECLINED':
            return '#991B1B';
        default:
            return '#92400E';
    }
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 16,
        marginTop: 16,
        width: '100%',
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    title: {
        fontSize: 15,
        fontWeight: '700',
        color: '#0F172A',
    },
    subtitleText: {
        fontSize: 11,
        color: '#64748B',
        marginTop: 2,
    },
    stopInfo: {
        fontSize: 11,
        fontWeight: '600',
        color: '#0066CC',
        marginTop: 4,
    },
    emptyText: {
        fontSize: 13,
        color: '#94A3B8',
        fontStyle: 'italic',
    },
    passengerRow: {
        backgroundColor: '#F8FAFC',
        borderRadius: 12,
        padding: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: '#F1F5F9',
    },
    passengerHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    passengerSeat: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
    },
    bookingId: {
        fontSize: 11,
        color: '#64748B',
        marginTop: 2,
    },
    statusBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 8,
    },
    statusBadgeText: {
        fontSize: 10,
        fontWeight: '800',
    },
    assistanceTags: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
    },
    tag: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    tagText: {
        fontSize: 11,
        fontWeight: '600',
        marginLeft: 4,
    },
    notes: {
        fontSize: 12,
        color: '#475569',
        marginTop: 6,
        fontStyle: 'italic',
    },
    actionRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 10,
        justifyContent: 'flex-end',
    },
    actionBtn: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 8,
    },
    actionBtnText: {
        fontSize: 11,
        fontWeight: '700',
    },
});
