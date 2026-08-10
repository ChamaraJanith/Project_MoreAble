import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator, Alert,
    ScrollView,
    StyleSheet,
    Switch,
    Text, TextInput, TouchableOpacity,
    View
} from 'react-native';
import { UserRegistrationDTO } from '../../../entities/user/model/types';
import { API_BASE_URL } from '../../../shared/api/config'; // API Config එක Import කිරීම
import { parseSriLankanNic } from '../../../shared/utils/nicUtils';

export const RegistrationForm = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [hasGuardian, setHasGuardian] = useState(false);

    // Form States
    const [formData, setFormData] = useState({
        userName: '',
        email: '',
        password: '',
        confirmPassword: '',
        nicNo: '',
        phoneNumber: '',
    });

    // Guardian States
    const [guardianData, setGuardianData] = useState({
        fullName: '',
        email: '',
        mobileNo: '',
        nicNo: '',
        relationship: '',
    });

    // Error State
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateForm = () => {
        let newErrors: Record<string, string> = {};

        if (!formData.userName.trim()) newErrors.userName = 'Name is required';
        if (!formData.email.includes('@')) newErrors.email = 'Valid email is required';
        if (formData.password.length < 6) newErrors.password = 'Password must be at least 6 characters';
        if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = 'Passwords do not match';

        const nicCheck = parseSriLankanNic(formData.nicNo);
        if (!nicCheck.isValid) newErrors.nicNo = 'Invalid Sri Lankan NIC Number';

        if (hasGuardian) {
            if (!guardianData.fullName.trim()) newErrors.gFullName = 'Guardian name is required';
            if (!guardianData.mobileNo.trim()) newErrors.gMobileNo = 'Guardian mobile is required';

            const gNicCheck = parseSriLankanNic(guardianData.nicNo);
            if (!gNicCheck.isValid) newErrors.gNicNo = 'Invalid Guardian NIC Number';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleRegister = async () => {
        if (!validateForm()) return;

        setIsLoading(true);

        try {
            //DTO to Send data to the backend
            const payload: UserRegistrationDTO = {
                userName: formData.userName,
                email: formData.email,
                password: formData.password,
                nicNo: formData.nicNo,
                phoneNumber: formData.phoneNumber,
                guardianDetails: hasGuardian ? guardianData : undefined,
            };

            //Send APIs to backend
            const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            let result: any = {};
            try {
                result = await response.json();
            } catch (parseError) {
                console.error('Failed to parse JSON response:', parseError);
            }

            if (response.ok) {
                if (Platform.OS === 'web') {
                    window.alert('Registration Successful!');
                    router.replace('/(auth)/login');
                } else {
                    Alert.alert('Success', 'Registration Successful!', [
                        { text: 'OK', onPress: () => router.replace('/(auth)/login') }
                    ]);
                }
            } else {
                Alert.alert('Registration Failed', result.message || 'Something went wrong');
            }
        } catch (error) {
            console.error('Registration Error:', error);
            Alert.alert('Error', 'Network error. Please check your connection and try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            <Text style={styles.headerTitle}>Create Account</Text>

            {/* Basic Details Section */}
            <View style={styles.inputGroup}>
                <Text style={styles.label}>Full Name</Text>
                <TextInput style={styles.input} placeholder="John Doe"
                    value={formData.userName} onChangeText={(text) => setFormData({ ...formData, userName: text })} />
                {errors.userName && <Text style={styles.errorText}>{errors.userName}</Text>}
            </View>

            <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <TextInput style={styles.input} placeholder="john@example.com" keyboardType="email-address" autoCapitalize="none"
                    value={formData.email} onChangeText={(text) => setFormData({ ...formData, email: text })} />
                {errors.email && <Text style={styles.errorText}>{errors.email}</Text>}
            </View>

            <View style={styles.inputGroup}>
                <Text style={styles.label}>NIC Number</Text>
                <TextInput style={styles.input} placeholder="199012345678 or 901234567V"
                    value={formData.nicNo} onChangeText={(text) => setFormData({ ...formData, nicNo: text })} />
                {errors.nicNo && <Text style={styles.errorText}>{errors.nicNo}</Text>}
            </View>

            <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone Number</Text>
                <TextInput style={styles.input} placeholder="0771234567" keyboardType="phone-pad"
                    value={formData.phoneNumber} onChangeText={(text) => setFormData({ ...formData, phoneNumber: text })} />
            </View>

            <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <TextInput style={styles.input} placeholder="Min 6 characters" secureTextEntry
                    value={formData.password} onChangeText={(text) => setFormData({ ...formData, password: text })} />
                {errors.password && <Text style={styles.errorText}>{errors.password}</Text>}
            </View>

            <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm Password</Text>
                <TextInput style={styles.input} placeholder="Re-enter password" secureTextEntry
                    value={formData.confirmPassword} onChangeText={(text) => setFormData({ ...formData, confirmPassword: text })} />
                {errors.confirmPassword && <Text style={styles.errorText}>{errors.confirmPassword}</Text>}
            </View>

            {/* Guardian Switch Component */}
            <View style={styles.switchContainer}>
                <Text style={styles.switchLabel}>Register with a Guardian?</Text>
                <Switch value={hasGuardian} onValueChange={setHasGuardian} />
            </View>

            {/* Guardian Details Section (Conditionally Rendered) */}
            {hasGuardian && (
                <View style={styles.guardianSection}>
                    <Text style={styles.sectionTitle}>Guardian Details</Text>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Guardian Name</Text>
                        <TextInput style={styles.input} placeholder="Jane Doe"
                            value={guardianData.fullName} onChangeText={(text) => setGuardianData({ ...guardianData, fullName: text })} />
                        {errors.gFullName && <Text style={styles.errorText}>{errors.gFullName}</Text>}
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Guardian NIC</Text>
                        <TextInput style={styles.input} placeholder="NIC Number"
                            value={guardianData.nicNo} onChangeText={(text) => setGuardianData({ ...guardianData, nicNo: text })} />
                        {errors.gNicNo && <Text style={styles.errorText}>{errors.gNicNo}</Text>}
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Guardian Mobile No</Text>
                        <TextInput style={styles.input} placeholder="0711234567" keyboardType="phone-pad"
                            value={guardianData.mobileNo} onChangeText={(text) => setGuardianData({ ...guardianData, mobileNo: text })} />
                        {errors.gMobileNo && <Text style={styles.errorText}>{errors.gMobileNo}</Text>}
                    </View>
                </View>
            )}

            {/* Submit Button */}
            <TouchableOpacity
                style={[styles.button, isLoading && styles.buttonDisabled]}
                onPress={handleRegister}
                disabled={isLoading}
            >
                {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Register</Text>}
            </TouchableOpacity>
        </ScrollView>
    );
};

// Stylesheet
const styles = StyleSheet.create({
    container: { padding: 20, backgroundColor: '#f9f9f9', flexGrow: 1 },
    headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#333', marginBottom: 20, textAlign: 'center' },
    sectionTitle: { fontSize: 18, fontWeight: '600', color: '#555', marginBottom: 15, marginTop: 10 },
    inputGroup: { marginBottom: 15 },
    label: { fontSize: 14, color: '#444', marginBottom: 5, fontWeight: '500' },
    input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16 },
    errorText: { color: 'red', fontSize: 12, marginTop: 4 },
    switchContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 15, borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#eee', marginVertical: 10 },
    switchLabel: { fontSize: 16, fontWeight: '500', color: '#333' },
    guardianSection: { backgroundColor: '#eef2f3', padding: 15, borderRadius: 10, marginBottom: 15 },
    button: { backgroundColor: '#007AFF', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10, marginBottom: 40 },
    buttonDisabled: { backgroundColor: '#99c9ff' },
    buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
});