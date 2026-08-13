import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    Alert, KeyboardAvoidingView, Platform,
    ScrollView,
    StyleSheet,
    Text, TextInput, TouchableOpacity,
    View
} from 'react-native';
import { formatFriendlyDate, formatFriendlyTime, TimeOfDay } from '../utils/dateTime';
import { TravelDatePickerModal } from './TravelDatePickerModal';
import { TravelTimePickerModal } from './TravelTimePickerModal';

type FieldName = 'origin' | 'destination';

interface RecentSearch {
    id: string;
    origin: string;
    destination: string;
    historyLabel: string;
    hour: number;
    minute: number;
    period: TimeOfDay['period'];
}

// Static demo data only — no backend/Firebase involved. For UI demonstration of the
// Recent Searches pattern only.
const RECENT_SEARCHES: RecentSearch[] = [
    {
        id: '1',
        origin: 'Kaduwela',
        destination: 'Battaramulla',
        historyLabel: 'Today · 8:30 AM',
        hour: 8,
        minute: 30,
        period: 'AM',
    },
    {
        id: '2',
        origin: 'Malabe',
        destination: 'Kollupitiya',
        historyLabel: 'Yesterday · 5:30 PM',
        hour: 5,
        minute: 30,
        period: 'PM',
    },
];

export const JourneyPlannerForm = () => {
    const [focusedInput, setFocusedInput] = useState<FieldName | null>(null);

    const [formData, setFormData] = useState({
        origin: '',
        destination: '',
    });

    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedTime, setSelectedTime] = useState<TimeOfDay | null>(null);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [showTimePicker, setShowTimePicker] = useState(false);

    const updateField = (field: FieldName, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSwap = () => {
        setFormData((prev) => ({
            ...prev,
            origin: prev.destination,
            destination: prev.origin,
        }));
    };

    const handleRepeatSearch = (search: RecentSearch) => {
        setFormData({
            origin: search.origin,
            destination: search.destination,
        });
        setSelectedDate(new Date());
        setSelectedTime({ hour: search.hour, minute: search.minute, period: search.period });
    };

    const handleSelectDate = (date: Date) => {
        setSelectedDate(date);
        setShowDatePicker(false);
    };

    const handleConfirmTime = (time: TimeOfDay) => {
        setSelectedTime(time);
        setShowTimePicker(false);
    };

    const handleSearch = () => {
        if (!formData.origin.trim() || !formData.destination.trim()) {
            const message = 'Please enter both a starting location and a destination.';
            if (Platform.OS === 'web') {
                window.alert(message);
            } else {
                Alert.alert('Missing Information', message);
            }
            return;
        }

        const summary = `From: ${formData.origin}\nTo: ${formData.destination}\nDate: ${selectedDate ? formatFriendlyDate(selectedDate) : 'Not selected'}\nTime: ${selectedTime ? formatFriendlyTime(selectedTime) : 'Not selected'}`;

        if (Platform.OS === 'web') {
            window.alert(`Journey details captured:\n\n${summary}`);
        } else {
            Alert.alert('Journey Details', summary, [{ text: 'OK' }]);
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {/* Header */}
                <View style={styles.headerRow}>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => router.back()}
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                    >
                        <Ionicons name="arrow-back" size={24} color="#0F172A" />
                    </TouchableOpacity>
                    <View style={styles.headerTextGroup}>
                        <Text style={styles.headerTitle} accessibilityRole="header">
                            Plan Your Journey
                        </Text>
                        <Text style={styles.subtitle}>
                            Find an accessible route that works for you.
                        </Text>
                    </View>
                </View>

                {/* Journey Search Card */}
                <View style={styles.cardContainer}>
                    <View style={styles.locationsBlock}>
                        <View style={styles.locationsStack}>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Starting Location</Text>
                                <View style={[
                                    styles.inputWrapper,
                                    focusedInput === 'origin' && styles.inputFocused,
                                ]}>
                                    <Ionicons
                                        name="location-outline"
                                        size={22}
                                        color={focusedInput === 'origin' ? '#0066CC' : '#5A6E7F'}
                                        style={styles.inputIcon}
                                    />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Enter starting location"
                                        placeholderTextColor="#8898AA"
                                        value={formData.origin}
                                        onChangeText={(text) => updateField('origin', text)}
                                        onFocus={() => setFocusedInput('origin')}
                                        onBlur={() => setFocusedInput(null)}
                                        accessibilityLabel="Starting Location"
                                        accessibilityHint="Enter the location you are travelling from"
                                    />
                                </View>
                            </View>

                            <View style={styles.locationDivider} />

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Destination</Text>
                                <View style={[
                                    styles.inputWrapper,
                                    focusedInput === 'destination' && styles.inputFocused,
                                ]}>
                                    <Ionicons
                                        name="location-outline"
                                        size={22}
                                        color={focusedInput === 'destination' ? '#0066CC' : '#5A6E7F'}
                                        style={styles.inputIcon}
                                    />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Enter destination"
                                        placeholderTextColor="#8898AA"
                                        value={formData.destination}
                                        onChangeText={(text) => updateField('destination', text)}
                                        onFocus={() => setFocusedInput('destination')}
                                        onBlur={() => setFocusedInput(null)}
                                        accessibilityLabel="Destination"
                                        accessibilityHint="Enter the location you are travelling to"
                                    />
                                </View>
                            </View>
                        </View>

                        <TouchableOpacity
                            style={styles.swapButton}
                            onPress={handleSwap}
                            accessibilityRole="button"
                            accessibilityLabel="Swap starting location and destination"
                            accessibilityHint="Double tap to swap the entered locations"
                        >
                            <Ionicons name="swap-vertical" size={22} color="#0066CC" />
                        </TouchableOpacity>
                    </View>

                    {/* Travel Date & Time */}
                    <View style={styles.rowTwoCol}>
                        <View style={[styles.inputGroup, styles.halfInputGroup]}>
                            <Text style={styles.label}>Travel Date</Text>
                            <TouchableOpacity
                                style={[
                                    styles.inputWrapper,
                                    showDatePicker && styles.inputFocused,
                                ]}
                                onPress={() => setShowDatePicker(true)}
                                accessibilityRole="button"
                                accessibilityLabel="Travel Date"
                                accessibilityHint="Double tap to open the calendar and choose a travel date"
                            >
                                <Ionicons
                                    name="calendar-outline"
                                    size={20}
                                    color={showDatePicker || selectedDate ? '#0066CC' : '#5A6E7F'}
                                    style={styles.inputIconTight}
                                />
                                <Text
                                    style={[styles.input, !selectedDate && styles.inputPlaceholder]}
                                    numberOfLines={1}
                                >
                                    {selectedDate ? formatFriendlyDate(selectedDate) : 'Select date'}
                                </Text>
                            </TouchableOpacity>
                        </View>

                        <View style={[styles.inputGroup, styles.halfInputGroup]}>
                            <Text style={styles.label}>Travel Time</Text>
                            <TouchableOpacity
                                style={[
                                    styles.inputWrapper,
                                    showTimePicker && styles.inputFocused,
                                ]}
                                onPress={() => setShowTimePicker(true)}
                                accessibilityRole="button"
                                accessibilityLabel="Travel Time"
                                accessibilityHint="Double tap to open the time picker and choose a travel time"
                            >
                                <Ionicons
                                    name="time-outline"
                                    size={20}
                                    color={showTimePicker || selectedTime ? '#0066CC' : '#5A6E7F'}
                                    style={styles.inputIconTight}
                                />
                                <Text
                                    style={[styles.input, !selectedTime && styles.inputPlaceholder]}
                                    numberOfLines={1}
                                >
                                    {selectedTime ? formatFriendlyTime(selectedTime) : 'Select time'}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Search Routes Button */}
                    <TouchableOpacity
                        style={styles.button}
                        onPress={handleSearch}
                        accessibilityRole="button"
                        accessibilityLabel="Search Routes"
                        accessibilityHint="Double tap to search for accessible transport routes"
                    >
                        <View style={styles.buttonInner}>
                            <Ionicons name="search" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                            <Text style={styles.buttonText}>SEARCH ROUTES</Text>
                        </View>
                    </TouchableOpacity>
                </View>

                {/* Recent Searches */}
                <View style={styles.recentSection}>
                    <Text style={styles.sectionTitle}>Recent Searches</Text>

                    {RECENT_SEARCHES.map((search) => (
                        <TouchableOpacity
                            key={search.id}
                            style={styles.recentCard}
                            onPress={() => handleRepeatSearch(search)}
                            accessibilityRole="button"
                            accessibilityLabel={`Repeat search from ${search.origin} to ${search.destination}`}
                            accessibilityHint={`${search.historyLabel}. Double tap to fill the journey form with this search`}
                        >
                            <View style={styles.recentIconBadge}>
                                <Ionicons name="time-outline" size={20} color="#0066CC" />
                            </View>
                            <View style={styles.recentTextContainer}>
                                <Text style={styles.recentOriginText} numberOfLines={1}>
                                    {search.origin}
                                </Text>
                                <View style={styles.recentDestinationRow}>
                                    <Ionicons name="arrow-forward" size={13} color="#64748B" style={{ marginRight: 4 }} />
                                    <Text style={styles.recentDestinationText} numberOfLines={1}>
                                        {search.destination}
                                    </Text>
                                </View>
                                <Text style={styles.recentWhenText}>{search.historyLabel}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={22} color="#94A3B8" />
                        </TouchableOpacity>
                    ))}
                </View>
            </ScrollView>

            <TravelDatePickerModal
                visible={showDatePicker}
                selectedDate={selectedDate}
                onClose={() => setShowDatePicker(false)}
                onSelect={handleSelectDate}
            />

            <TravelTimePickerModal
                visible={showTimePicker}
                selectedTime={selectedTime}
                onClose={() => setShowTimePicker(false)}
                onConfirm={handleConfirmTime}
            />
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F0F4F8',
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 32,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 20,
    },
    backButton: {
        minWidth: 44,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'flex-start',
        marginRight: 4,
        marginTop: 2,
    },
    headerTextGroup: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 26,
        fontWeight: '800',
        color: '#0F172A',
        letterSpacing: -0.5,
        marginBottom: 4,
    },
    subtitle: {
        fontSize: 15,
        fontWeight: '500',
        color: '#475569',
        lineHeight: 21,
    },
    cardContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        padding: 20,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 6,
        marginBottom: 24,
    },
    locationsBlock: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    locationsStack: {
        flex: 1,
    },
    locationDivider: {
        height: 1,
        backgroundColor: '#E2E8F0',
        marginVertical: 4,
    },
    swapButton: {
        width: 46,
        height: 46,
        borderRadius: 23,
        backgroundColor: '#EBF3FA',
        borderWidth: 1,
        borderColor: '#CCE3F8',
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 12,
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 2,
    },
    inputGroup: {
        marginBottom: 16,
    },
    label: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1E293B',
        marginBottom: 8,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderWidth: 2,
        borderColor: '#CBD5E1',
        borderRadius: 16,
        paddingHorizontal: 16,
        minHeight: 58, // Large accessible touch target
    },
    inputFocused: {
        borderColor: '#0066CC',
        backgroundColor: '#FFFFFF',
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 2,
    },
    inputIcon: {
        marginRight: 12,
    },
    inputIconTight: {
        marginRight: 8,
    },
    input: {
        flex: 1,
        fontSize: 16,
        fontWeight: '500',
        color: '#0F172A',
        paddingVertical: 14,
    },
    inputPlaceholder: {
        color: '#8898AA',
        fontWeight: '400',
    },
    rowTwoCol: {
        flexDirection: 'row',
        gap: 12,
    },
    halfInputGroup: {
        flex: 1,
    },
    button: {
        backgroundColor: '#0066CC',
        minHeight: 58,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 5,
        marginTop: 4,
    },
    buttonInner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '800',
        letterSpacing: 1,
    },
    recentSection: {
        marginTop: 4,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0F172A',
        marginBottom: 12,
    },
    recentCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 16,
        padding: 14,
        marginBottom: 12,
        minHeight: 58,
    },
    recentIconBadge: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#EBF3FA',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    recentTextContainer: {
        flex: 1,
    },
    recentOriginText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#0F172A',
    },
    recentDestinationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 3,
    },
    recentDestinationText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#334155',
    },
    recentWhenText: {
        fontSize: 13,
        fontWeight: '500',
        color: '#64748B',
        marginTop: 4,
    },
});
