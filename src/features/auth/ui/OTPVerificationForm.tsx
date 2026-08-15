//This code for OTP Verification Form.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
    ActivityIndicator, Alert,
    KeyboardAvoidingView, Platform,
    ScrollView,
    StyleSheet,
    Text, TextInput, TouchableOpacity,
    View
} from 'react-native';
import { API_BASE_URL } from '../../../shared/api/config';

export const OTPVerificationForm = () => {
    const params = useLocalSearchParams();
    const phoneNumber = params.phoneNumber as string || '';
    const passengerId = params.passengerId as string || '';

    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [isLoading, setIsLoading] = useState(false);
    const [isResending, setIsResending] = useState(false);
    const [error, setError] = useState('');

    // Refs for auto-advancing focus
    const inputRefs = useRef<Array<TextInput | null>>([]);

    const handleOtpChange = (value: string, index: number) => {
        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);
        setError('');

        // Move to next input if value is entered
        if (value && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyPress = (e: any, index: number) => {
        if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handleVerify = async () => {
        const otpCode = otp.join('');
        if (otpCode.length !== 6) {
            setError('Please enter the 6-digit OTP code.');
            return;
        }

        setIsLoading(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phoneNumber,
                    otp: otpCode,
                    passengerId
                }),
            });

            const result = await response.json();

            if (response.ok) {
                if (Platform.OS === 'web') {
                    window.alert('Verification Successful!');
                    router.replace('/(auth)');
                } else {
                    Alert.alert('Success', 'Phone number verified successfully!', [
                        { text: 'OK', onPress: () => router.replace('/(auth)') }
                    ]);
                }
            } else {
                setError(result.message || 'Invalid OTP. Please try again.');
            }
        } catch (error) {
            console.error('Verify OTP Error:', error);
            setError('Network error. Please try again later.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResendOTP = async () => {
        setIsResending(true);
        setError('');
        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/send-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber }),
            });

            const result = await response.json();

            if (response.ok) {
                if (Platform.OS === 'web') {
                    window.alert('A new OTP has been sent to your phone.');
                } else {
                    Alert.alert('Success', 'A new OTP has been sent to your phone.');
                }
            } else {
                setError(result.message || 'Failed to resend OTP.');
            }
        } catch (error) {
            console.error('Resend OTP Error:', error);
            setError('Network error. Please try again later.');
        } finally {
            setIsResending(false);
        }
    };

    // Mask phone number for display
    const maskedPhone = phoneNumber ? `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-3)}` : 'your phone';

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
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => router.replace('/(auth)/register')}
                        accessibilityRole="button"
                        accessibilityLabel="Go back to registration"
                    >
                        <Ionicons name="arrow-back-outline" size={24} color="#1E293B" />
                    </TouchableOpacity>

                    <View style={styles.iconContainer}>
                        <View style={styles.iconCircle}>
                            <Ionicons name="phone-portrait-outline" size={48} color="#0066CC" />
                        </View>
                    </View>

                    <Text style={styles.headerTitle} accessibilityRole="header">
                        Verify Account
                    </Text>
                    <Text style={styles.subtitle}>
                        We sent a 6-digit code to {maskedPhone}. Please enter it below to verify your phone number.
                    </Text>

                    <View style={styles.otpContainer}>
                        {otp.map((digit, index) => (
                            <TextInput
                                key={index}
                                ref={(ref) => { inputRefs.current[index] = ref; }}
                                style={[
                                    styles.otpInput,
                                    digit ? styles.otpInputFilled : null,
                                    error ? styles.otpInputError : null
                                ]}
                                maxLength={1}
                                keyboardType="number-pad"
                                value={digit}
                                onChangeText={(value) => handleOtpChange(value, index)}
                                onKeyPress={(e) => handleKeyPress(e, index)}
                                accessibilityLabel={`OTP digit ${index + 1}`}
                            />
                        ))}
                    </View>

                    {error ? (
                        <View style={styles.errorContainer}>
                            <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                    ) : null}

                    <TouchableOpacity
                        style={[styles.button, isLoading && styles.buttonDisabled]}
                        onPress={handleVerify}
                        disabled={isLoading}
                        accessibilityRole="button"
                        accessibilityLabel="Verify OTP"
                    >
                        {isLoading ? (
                            <ActivityIndicator size="large" color="#ffffff" />
                        ) : (
                            <View style={styles.buttonInner}>
                                <Text style={styles.buttonText}>VERIFY</Text>
                                <Ionicons name="checkmark-circle-outline" size={22} color="#FFFFFF" style={{ marginLeft: 8 }} />
                            </View>
                        )}
                    </TouchableOpacity>

                    <View style={styles.footer}>
                        <Text style={styles.footerText}>Didn't receive the code? </Text>
                        <TouchableOpacity
                            onPress={handleResendOTP}
                            disabled={isResending}
                            accessibilityRole="button"
                            accessibilityLabel="Resend OTP"
                        >
                            {isResending ? (
                                <ActivityIndicator size="small" color="#0066CC" />
                            ) : (
                                <Text style={styles.resendLink}>Resend OTP</Text>
                            )}
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
        backgroundColor: '#F0F4F8',
    },
    scrollContent: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: 20,
        paddingVertical: 24,
    },
    cardContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 24,
        padding: 26,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 6,
        marginVertical: 10,
        position: 'relative',
    },
    backButton: {
        position: 'absolute',
        top: 20,
        left: 20,
        padding: 8,
        zIndex: 10,
    },
    iconContainer: {
        alignItems: 'center',
        marginBottom: 20,
        marginTop: 10,
    },
    iconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#EBF3FA',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#CCE3F8',
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: '800',
        color: '#0F172A',
        textAlign: 'center',
        marginBottom: 10,
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 15,
        fontWeight: '500',
        color: '#475569',
        textAlign: 'center',
        marginBottom: 28,
        lineHeight: 22,
        paddingHorizontal: 10,
    },
    otpContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    otpInput: {
        width: 45,
        height: 55,
        borderWidth: 2,
        borderColor: '#CBD5E1',
        borderRadius: 12,
        fontSize: 24,
        fontWeight: '700',
        textAlign: 'center',
        color: '#0F172A',
        backgroundColor: '#F8FAFC',
    },
    otpInputFilled: {
        borderColor: '#0066CC',
        backgroundColor: '#FFFFFF',
    },
    otpInputError: {
        borderColor: '#D32F2F',
        backgroundColor: '#FEF2F2',
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
        marginTop: -10,
    },
    errorText: {
        color: '#D32F2F',
        fontSize: 14,
        fontWeight: '600',
        marginLeft: 6,
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
    },
    buttonDisabled: {
        backgroundColor: '#94A3B8',
    },
    buttonInner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 19,
        fontWeight: '800',
        letterSpacing: 1,
    },
    footer: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 26,
    },
    footerText: {
        fontSize: 15,
        color: '#475569',
    },
    resendLink: {
        fontSize: 15,
        color: '#0066CC',
        fontWeight: '800',
    },
});
