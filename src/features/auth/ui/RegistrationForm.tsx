import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text, TextInput, TouchableOpacity,
    View
} from 'react-native';
import { UserRegistrationDTO } from '../../../entities/user/model/types';
import { API_BASE_URL } from '../../../shared/api/config';
import { parseSriLankanNic } from '../../../shared/utils/nicUtils';

export const RegistrationForm = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [hasGuardian, setHasGuardian] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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

        if (!formData.userName.trim()) newErrors.userName = 'Full Name is required';
        if (!formData.email.includes('@')) newErrors.email = 'Valid email address is required';
        if (formData.password.length < 6) newErrors.password = 'Password must be at least 6 characters';
        if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
        if (!formData.phoneNumber.trim()) newErrors.phoneNumber = 'Phone number is required';

        const nicCheck = parseSriLankanNic(formData.nicNo);
        if (!nicCheck.isValid) newErrors.nicNo = 'Invalid Sri Lankan NIC Number';

        if (hasGuardian) {
            if (!guardianData.fullName.trim()) newErrors.gFullName = 'Guardian name is required';
            if (!guardianData.mobileNo.trim()) newErrors.gMobileNo = 'Guardian mobile number is required';

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
            const payload: UserRegistrationDTO = {
                userName: formData.userName,
                email: formData.email,
                password: formData.password,
                nicNo: formData.nicNo,
                phoneNumber: formData.phoneNumber,
                guardianDetails: hasGuardian ? guardianData : undefined,
            };

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
                    window.alert('Registration Successful! Please verify your phone number.');
                    router.push({
                        pathname: '/(auth)/verify-otp',
                        params: { phoneNumber: formData.phoneNumber, passengerId: result.user.passengerId }
                    });
                } else {
                    Alert.alert('Success', 'Registration Successful! Please verify your phone number.', [
                        {
                            text: 'OK',
                            onPress: () => router.push({
                                pathname: '/(auth)/verify-otp',
                                params: { phoneNumber: formData.phoneNumber, passengerId: result.user.passengerId }
                            })
                        }
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
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            enabled={Platform.OS === 'ios'}
            style={styles.container}
        >
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="always"
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.cardContainer}>
                    {/* App Logo Header */}
                    <View style={styles.logoContainer}>
                        <Image
                            source={require('../../../../assets/images/moreable-logo.jpg')}
                            style={styles.logo}
                            resizeMode="contain"
                            accessibilityLabel="MoreAble Logo"
                        />
                    </View>

                    <Text style={styles.headerTitle} accessibilityRole="header">
                        Create Account
                    </Text>
                    <Text style={styles.subtitle}>
                        Join MoreAble for an accessible transit experience
                    </Text>

                    {/* Full Name Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Full Name</Text>
                        <View style={[styles.inputWrapper, errors.userName ? styles.inputErrorBorder : null]}>
                            <Ionicons name="person-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="e.g. John Doe"
                                placeholderTextColor="#777"
                                value={formData.userName}
                                onChangeText={(text) => setFormData({ ...formData, userName: text })}
                                accessibilityLabel="Full Name"
                            />
                        </View>
                        {errors.userName && (
                            <View style={styles.errorContainer}>
                                <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                <Text style={styles.errorText}>{errors.userName}</Text>
                            </View>
                        )}
                    </View>

                    {/* Email Address Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Email Address</Text>
                        <View style={[styles.inputWrapper, errors.email ? styles.inputErrorBorder : null]}>
                            <Ionicons name="mail-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="e.g. john@example.com"
                                placeholderTextColor="#777"
                                keyboardType="email-address"
                                autoCapitalize="none"
                                value={formData.email}
                                onChangeText={(text) => setFormData({ ...formData, email: text })}
                                accessibilityLabel="Email Address"
                            />
                        </View>
                        {errors.email && (
                            <View style={styles.errorContainer}>
                                <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                <Text style={styles.errorText}>{errors.email}</Text>
                            </View>
                        )}
                    </View>

                    {/* NIC Number Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>NIC Number</Text>
                        <View style={[styles.inputWrapper, errors.nicNo ? styles.inputErrorBorder : null]}>
                            <Ionicons name="card-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="199012345678 or 901234567V"
                                placeholderTextColor="#777"
                                value={formData.nicNo}
                                onChangeText={(text) => setFormData({ ...formData, nicNo: text })}
                                accessibilityLabel="NIC Number"
                            />
                        </View>
                        {errors.nicNo && (
                            <View style={styles.errorContainer}>
                                <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                <Text style={styles.errorText}>{errors.nicNo}</Text>
                            </View>
                        )}
                    </View>

                    {/* Phone Number Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Phone Number</Text>
                        <View style={[styles.inputWrapper, errors.phoneNumber ? styles.inputErrorBorder : null]}>
                            <Ionicons name="call-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="e.g. 0771234567"
                                placeholderTextColor="#777"
                                keyboardType="phone-pad"
                                value={formData.phoneNumber}
                                onChangeText={(text) => setFormData({ ...formData, phoneNumber: text })}
                                accessibilityLabel="Phone Number"
                            />
                        </View>
                        {errors.phoneNumber && (
                            <View style={styles.errorContainer}>
                                <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                <Text style={styles.errorText}>{errors.phoneNumber}</Text>
                            </View>
                        )}
                    </View>

                    {/* Password Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Password</Text>
                        <View style={[styles.inputWrapper, errors.password ? styles.inputErrorBorder : null]}>
                            <Ionicons name="lock-closed-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="Min 6 characters"
                                placeholderTextColor="#777"
                                secureTextEntry={!showPassword}
                                value={formData.password}
                                onChangeText={(text) => setFormData({ ...formData, password: text })}
                                accessibilityLabel="Password"
                            />
                            <TouchableOpacity
                                style={styles.eyeIconContainer}
                                onPress={() => setShowPassword(!showPassword)}
                                accessibilityRole="button"
                                accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                            >
                                <Ionicons
                                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                    size={24}
                                    color="#0066CC"
                                />
                            </TouchableOpacity>
                        </View>
                        {errors.password && (
                            <View style={styles.errorContainer}>
                                <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                <Text style={styles.errorText}>{errors.password}</Text>
                            </View>
                        )}
                    </View>

                    {/* Confirm Password Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Confirm Password</Text>
                        <View style={[styles.inputWrapper, errors.confirmPassword ? styles.inputErrorBorder : null]}>
                            <Ionicons name="shield-checkmark-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="Re-enter password"
                                placeholderTextColor="#777"
                                secureTextEntry={!showConfirmPassword}
                                value={formData.confirmPassword}
                                onChangeText={(text) => setFormData({ ...formData, confirmPassword: text })}
                                accessibilityLabel="Confirm Password"
                            />
                            <TouchableOpacity
                                style={styles.eyeIconContainer}
                                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                                accessibilityRole="button"
                                accessibilityLabel={showConfirmPassword ? "Hide password" : "Show password"}
                            >
                                <Ionicons
                                    name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                                    size={24}
                                    color="#0066CC"
                                />
                            </TouchableOpacity>
                        </View>
                        {errors.confirmPassword && (
                            <View style={styles.errorContainer}>
                                <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                <Text style={styles.errorText}>{errors.confirmPassword}</Text>
                            </View>
                        )}
                    </View>

                    {/* Guardian Switch Component */}
                    <View style={styles.switchCard}>
                        <View style={styles.switchTextContainer}>
                            <Ionicons name="people-outline" size={26} color="#0066CC" style={{ marginRight: 10 }} />
                            <Text style={styles.switchLabel}>Register with a Guardian?</Text>
                        </View>
                        <Switch
                            value={hasGuardian}
                            onValueChange={setHasGuardian}
                            trackColor={{ false: '#D0D9E2', true: '#82B1FF' }}
                            thumbColor={hasGuardian ? '#0066CC' : '#F4F7FB'}
                            accessibilityLabel="Register with a Guardian"
                        />
                    </View>

                    {/* Guardian Details Section (Conditionally Rendered) */}
                    {hasGuardian && (
                        <View style={styles.guardianSection}>
                            <Text style={styles.sectionTitle} accessibilityRole="header">
                                Guardian Details
                            </Text>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Guardian Name</Text>
                                <View style={[styles.inputWrapper, errors.gFullName ? styles.inputErrorBorder : null]}>
                                    <Ionicons name="person-circle-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="e.g. Jane Doe"
                                        placeholderTextColor="#777"
                                        value={guardianData.fullName}
                                        onChangeText={(text) => setGuardianData({ ...guardianData, fullName: text })}
                                        accessibilityLabel="Guardian Name"
                                    />
                                </View>
                                {errors.gFullName && (
                                    <View style={styles.errorContainer}>
                                        <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                        <Text style={styles.errorText}>{errors.gFullName}</Text>
                                    </View>
                                )}
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Guardian NIC</Text>
                                <View style={[styles.inputWrapper, errors.gNicNo ? styles.inputErrorBorder : null]}>
                                    <Ionicons name="card-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="Guardian NIC Number"
                                        placeholderTextColor="#777"
                                        value={guardianData.nicNo}
                                        onChangeText={(text) => setGuardianData({ ...guardianData, nicNo: text })}
                                        accessibilityLabel="Guardian NIC"
                                    />
                                </View>
                                {errors.gNicNo && (
                                    <View style={styles.errorContainer}>
                                        <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                        <Text style={styles.errorText}>{errors.gNicNo}</Text>
                                    </View>
                                )}
                            </View>

                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Guardian Mobile Number</Text>
                                <View style={[styles.inputWrapper, errors.gMobileNo ? styles.inputErrorBorder : null]}>
                                    <Ionicons name="call-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="e.g. 0711234567"
                                        placeholderTextColor="#777"
                                        keyboardType="phone-pad"
                                        value={guardianData.mobileNo}
                                        onChangeText={(text) => setGuardianData({ ...guardianData, mobileNo: text })}
                                        accessibilityLabel="Guardian Mobile Number"
                                    />
                                </View>
                                {errors.gMobileNo && (
                                    <View style={styles.errorContainer}>
                                        <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                        <Text style={styles.errorText}>{errors.gMobileNo}</Text>
                                    </View>
                                )}
                            </View>
                        </View>
                    )}

                    {/* Submit Button */}
                    <TouchableOpacity
                        style={[styles.button, isLoading && styles.buttonDisabled]}
                        onPress={handleRegister}
                        disabled={isLoading}
                        accessibilityRole="button"
                        accessibilityLabel="Register"
                    >
                        {isLoading ? (
                            <ActivityIndicator size="large" color="#ffffff" />
                        ) : (
                            <Text style={styles.buttonText}>CREATE ACCOUNT</Text>
                        )}
                    </TouchableOpacity>

                    {/* Login Link */}
                    <View style={styles.footer}>
                        <Text style={styles.footerText}>Already have an account? </Text>
                        <TouchableOpacity
                            onPress={() => router.replace('/(auth)')}
                            accessibilityRole="button"
                            accessibilityLabel="Login Here"
                        >
                            <Text style={styles.registerLink}>Login Here</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F4F7FB',
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        padding: 20,
    },
    cardContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 26,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 5,
        marginVertical: 10,
    },
    logoContainer: {
        alignItems: 'center',
        marginBottom: 15,
    },
    logo: {
        width: 130,
        height: 130,
    },
    headerTitle: {
        fontSize: 30,
        fontWeight: 'bold',
        color: '#1A2530',
        textAlign: 'center',
        marginBottom: 6,
    },
    subtitle: {
        fontSize: 16,
        color: '#5A6E7F',
        textAlign: 'center',
        marginBottom: 28,
        lineHeight: 22,
    },
    inputGroup: {
        marginBottom: 20,
    },
    label: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2C3E50',
        marginBottom: 8,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderWidth: 2,
        borderColor: '#D0D9E2',
        borderRadius: 14,
        paddingHorizontal: 14,
        minHeight: 56, // Large touch target for accessibility
    },
    inputErrorBorder: {
        borderColor: '#D32F2F',
        backgroundColor: '#FFEBEE',
    },
    inputIcon: {
        marginRight: 10,
    },
    input: {
        flex: 1,
        fontSize: 17,
        color: '#1A2530',
        paddingVertical: 12,
    },
    eyeIconContainer: {
        padding: 8,
        minHeight: 48,
        minWidth: 48,
        justifyContent: 'center',
        alignItems: 'center',
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
    },
    errorText: {
        color: '#D32F2F',
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 6,
    },
    switchCard: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#EBF3FA',
        padding: 16,
        borderRadius: 14,
        marginVertical: 15,
        borderWidth: 1,
        borderColor: '#D0D9E2',
    },
    switchTextContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    switchLabel: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1A2530',
    },
    guardianSection: {
        backgroundColor: '#F0F5FA',
        padding: 18,
        borderRadius: 16,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#D0D9E2',
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#0066CC',
        marginBottom: 16,
    },
    button: {
        backgroundColor: '#0066CC',
        minHeight: 56, // Accessible touch target height
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 10,
        shadowColor: '#0066CC',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 4,
    },
    buttonDisabled: {
        backgroundColor: '#82B1FF',
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 19,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 28,
    },
    footerText: {
        fontSize: 16,
        color: '#5A6E7F',
    },
    registerLink: {
        fontSize: 16,
        color: '#0066CC',
        fontWeight: 'bold',
        paddingVertical: 4,
    },
});