import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Booking } from '../../../../src/entities/booking/model/types';
import { getBooking } from '../../../../src/features/booking/api/bookingApi';

export default function BookingTicketScreen() {
    const router = useRouter();

    const { bookingId } = useLocalSearchParams<{
        bookingId: string;
    }>();

    const [booking, setBooking] = useState<Booking | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!bookingId) return;

        getBooking(bookingId as string)
            .then(setBooking)
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [bookingId]);

    // Loading State
    if (loading) {
        return (
            <ActivityIndicator
                style={styles.center}
                size="large"
                color="#0066CC"
            />
        );
    }

    // Error State
    if (error || !booking) {
        return (
            <View style={styles.center}>
                <Text style={styles.error}>
                    {error || 'Booking not found.'}
                </Text>
            </View>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.content}>
            {/* Success Icon */}
            <View style={styles.successIcon}>
                <Ionicons
                    name="checkmark-circle"
                    size={48}
                    color="#10B981"
                />
            </View>

            {/* Header */}
            <Text style={styles.title}>
                Booking Confirmed
            </Text>

            <Text style={styles.subtitle}>
                Booking ID: {booking.bookingId}
            </Text>

            {/* Ticket Card */}
            <View style={styles.ticketCard}>
                {/* QR Code */}
                <View style={styles.qrWrapper}>
                    <QRCode
                        value={booking.qrPayload}
                        size={180}
                    />
                </View>

                {/* Divider */}
                <View style={styles.divider} />

                {/* Booking Details */}
                <TicketRow
                    label="Seat"
                    value={`${booking.seatNumber}${booking.pairedSeatNumber ? ` + ${booking.pairedSeatNumber}` : ''}${booking.isPrioritySeat ? ' (Priority)' : ''}`}
                />

                <TicketRow
                    label="From"
                    value={booking.journey.startLocation}
                />

                <TicketRow
                    label="To"
                    value={booking.journey.endLocation}
                />

                <TicketRow
                    label="Departure"
                    value={booking.journey.departureTime}
                />

                <TicketRow
                    label="Est. Arrival"
                    value={booking.journey.estimatedArrivalTime}
                />

                <TicketRow
                    label="Vehicle"
                    value={`${booking.vehicle.numberPlate} · ${booking.vehicle.busModel}`}
                />

                <TicketRow
                    label="Seat"
                    value={`${booking.seatNumber}${
                        booking.isPrioritySeat ? ' (Priority)' : ''
                    }`}
                    isLast
                />

                <TicketRow 
                    label="Fare Paid" 
                    value={`LKR ${booking.fare?.totalFare ?? '—'}`} 
                    isLast 
                />
            </View>

            {/* Done Button */}
            <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => router.replace('/booking')}
                accessibilityRole="button"
                accessibilityLabel="Back to my bookings"
            >
                <Text style={styles.primaryButtonText}>
                    DONE
                </Text>
            </TouchableOpacity>
        </ScrollView>
    );
}

function TicketRow({
    label,
    value,
    isLast,
}: {
    label: string;
    value: string;
    isLast?: boolean;
}) {
    return (
        <View
            style={[
                styles.row,
                isLast && styles.rowLast,
            ]}
        >
            <Text style={styles.rowLabel}>
                {label}
            </Text>

            <Text
                style={styles.rowValue}
                numberOfLines={1}
            >
                {value}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({

    content: {
        padding: 20,
        backgroundColor: '#F8FAFC',
        flexGrow: 1,
        alignItems: 'center',
    },

    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },

    error: {
        color: '#D32F2F',
        textAlign: 'center',
    },

    successIcon: {
        marginTop: 10,
        marginBottom: 8,
    },

    title: {
        fontSize: 22,
        fontWeight: '800',
        color: '#0F172A',
    },

    subtitle: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 4,
        marginBottom: 20,
    },

    ticketCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 20,
        width: '100%',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        alignItems: 'center',
    },

    qrWrapper: {
        padding: 16,
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        marginBottom: 16,
    },

    divider: {
        height: 1,
        backgroundColor: '#F1F5F9',
        width: '100%',
        marginBottom: 8,
    },

    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },

    rowLast: {
        borderBottomWidth: 0,
    },

    rowLabel: {
        fontSize: 13,
        color: '#64748B',
    },

    rowValue: {
        fontSize: 14,
        fontWeight: '700',
        color: '#0F172A',
        flexShrink: 1,
        marginLeft: 12,
        textAlign: 'right',
    },

    primaryButton: {
        backgroundColor: '#0066CC',
        minHeight: 52,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 24,
        width: '100%',
    },

    primaryButtonText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 15,
        letterSpacing: 0.5,
    },
});