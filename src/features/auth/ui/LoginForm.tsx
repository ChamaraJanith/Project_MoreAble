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
import { API_BASE_URL } from '../../../shared/api/config';

export const LoginForm = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(true);
    const [focusedInput, setFocusedInput] = useState<'identifier' | 'password' | null>(null);

    const [formData, setFormData] = useState({
        identifier: '', // Email or NIC
        password: '',
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateForm = () => {
        let newErrors: Record<string, string> = {};

        if (!formData.identifier.trim()) {
            newErrors.identifier = 'Email or NIC Number is required';
        }
        if (!formData.password) {
            newErrors.password = 'Password is required';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleLogin = async () => {
        if (!validateForm()) return;

        setIsLoading(true);

        try {
            const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            let result: any = {};
            try {
                result = await response.json();
            } catch (parseError) {
                console.error('Failed to parse JSON response:', parseError);
            }

            if (response.ok) {
                const isAdmin = result.user?.role === 'ADMIN';
                const successMsg = isAdmin ? 'Admin Login Successful!' : 'Login Successful!';
                const targetRoute = isAdmin ? '/(admin)' : '/(tabs)';

                if (Platform.OS === 'web') {
                    window.alert(successMsg);
                    router.replace(targetRoute);
                } else {
                    Alert.alert('Success', successMsg, [
                        { text: 'OK', onPress: () => router.replace(targetRoute) }
                    ]);
                }
            } else {
                Alert.alert('Login Failed', result.message || 'Invalid credentials');
            }
        } catch (error) {
            console.error('Login Error:', error);
            Alert.alert('Error', 'Network error. Please try again later.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleForgotPassword = () => {
        if (Platform.OS === 'web') {
            window.alert('Please contact your transit support hotline or guardian for password recovery assistance.');
        } else {
            Alert.alert('Password Recovery', 'Please contact your transit support hotline or registered guardian to reset your account password.');
        }
    };

    const handleContactSupport = () => {
        if (Platform.OS === 'web') {
            window.alert('Transit Support Hotline: 1919 (24/7 Accessible Helpline)');
        } else {
            Alert.alert('Accessible Support Hotline', 'Call 1919 for 24/7 Transit Assistance & Emergency Support.', [{ text: 'Close' }]);
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.container}
        >
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.cardContainer}>
                    {/* Top Accessibility Badge */}
                    <View style={styles.badgeContainer}>
                        <Ionicons name="accessibility" size={18} color="#0066CC" style={{ marginRight: 6 }} />
                        <Text style={styles.badgeText}>MoreAble Accessible Portal</Text>
                    </View>

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
                        Welcome Back
                    </Text>
                    <Text style={styles.subtitle}>
                        Accessible Transit & Mobility Platform
                    </Text>

                    {/* Email or NIC Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Email Address or NIC Number</Text>
                        <View style={[
                            styles.inputWrapper,
                            focusedInput === 'identifier' && styles.inputFocused,
                            errors.identifier ? styles.inputErrorBorder : null
                        ]}>
                            <Ionicons
                                name="card-outline"
                                size={24}
                                color={focusedInput === 'identifier' ? '#0066CC' : '#5A6E7F'}
                                style={styles.inputIcon}
                            />
                            <TextInput
                                style={styles.input}
                                placeholder="e.g. user@email.com or 199012345678"
                                placeholderTextColor="#8898AA"
                                autoCapitalize="none"
                                value={formData.identifier}
                                onChangeText={(text) => setFormData({ ...formData, identifier: text })}
                                onFocus={() => setFocusedInput('identifier')}
                                onBlur={() => setFocusedInput(null)}
                                accessibilityLabel="Email address or NIC Number"
                                accessibilityHint="Enter your registered email address or Sri Lankan NIC number"
                            />
                        </View>
                        {errors.identifier && (
                            <View style={styles.errorContainer}>
                                <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                <Text style={styles.errorText}>{errors.identifier}</Text>
                            </View>
                        )}
                    </View>

                    {/* Password Input with Show/Hide Toggle */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Password</Text>
                        <View style={[
                            styles.inputWrapper,
                            focusedInput === 'password' && styles.inputFocused,
                            errors.password ? styles.inputErrorBorder : null
                        ]}>
                            <Ionicons
                                name="lock-closed-outline"
                                size={24}
                                color={focusedInput === 'password' ? '#0066CC' : '#5A6E7F'}
                                style={styles.inputIcon}
                            />
                            <TextInput
                                style={styles.passwordInput}
                                placeholder="Enter your password"
                                placeholderTextColor="#8898AA"
                                secureTextEntry={!showPassword}
                                value={formData.password}
                                onChangeText={(text) => setFormData({ ...formData, password: text })}
                                onFocus={() => setFocusedInput('password')}
                                onBlur={() => setFocusedInput(null)}
                                accessibilityLabel="Password"
                                accessibilityHint="Enter your account password"
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

                    {/* Options Row: Remember Me & Forgot Password */}
                    <View style={styles.optionsRow}>
                        <View style={styles.rememberMeContainer}>
                            <Switch
                                value={rememberMe}
                                onValueChange={setRememberMe}
                                trackColor={{ false: '#D0D9E2', true: '#82B1FF' }}
                                thumbColor={rememberMe ? '#0066CC' : '#F4F7FB'}
                                accessibilityLabel="Remember Me"
                            />
                            <Text style={styles.rememberMeText}>Remember Me</Text>
                        </View>
                        <TouchableOpacity
                            onPress={handleForgotPassword}
                            accessibilityRole="button"
                            accessibilityLabel="Forgot Password"
                        >
                            <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Accessible Primary Login Button */}
                    <TouchableOpacity
                        style={[styles.button, isLoading && styles.buttonDisabled]}
                        onPress={handleLogin}
                        disabled={isLoading}
                        accessibilityRole="button"
                        accessibilityLabel="Sign In"
                        accessibilityHint="Double tap to log into your account"
                    >
                        {isLoading ? (
                            <ActivityIndicator size="large" color="#ffffff" />
                        ) : (
                            <View style={styles.buttonInner}>
                                <Text style={styles.buttonText}>SIGN IN</Text>
                                <Ionicons name="arrow-forward-outline" size={22} color="#FFFFFF" style={{ marginLeft: 8 }} />
                            </View>
                        )}
                    </TouchableOpacity>

                    {/* Register Navigation Footer */}
                    <View style={styles.footer}>
                        <Text style={styles.footerText}>Don't have an account? </Text>
                        <TouchableOpacity
                            onPress={() => router.push('/(auth)/register')}
                            accessibilityRole="button"
                            accessibilityLabel="Register Here"
                        >
                            <Text style={styles.registerLink}>Register Here</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Emergency Transit Support Banner */}
                    <TouchableOpacity
                        style={styles.supportBanner}
                        onPress={handleContactSupport}
                        accessibilityRole="button"
                        accessibilityLabel="Contact Transit Support Hotline"
                    >
                        <Ionicons name="call" size={20} color="#0066CC" style={{ marginRight: 8 }} />
                        <Text style={styles.supportBannerText}>Need help? 24/7 Transit Helpline (1919)</Text>
                    </TouchableOpacity>
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
    },
    badgeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'center',
        backgroundColor: '#EBF3FA',
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#CCE3F8',
    },
    badgeText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#0066CC',
        letterSpacing: 0.3,
    },
    logoContainer: {
        alignItems: 'center',
        marginBottom: 12,
    },
    logo: {
        width: 140,
        height: 140,
    },
    headerTitle: {
        fontSize: 32,
        fontWeight: '800',
        color: '#0F172A',
        textAlign: 'center',
        marginBottom: 6,
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 15,
        fontWeight: '500',
        color: '#475569',
        textAlign: 'center',
        marginBottom: 28,
        lineHeight: 22,
    },
    inputGroup: {
        marginBottom: 20,
    },
    label: {
        fontSize: 15,
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
    inputErrorBorder: {
        borderColor: '#D32F2F',
        backgroundColor: '#FEF2F2',
    },
    inputIcon: {
        marginRight: 12,
    },
    input: {
        flex: 1,
        fontSize: 17,
        fontWeight: '500',
        color: '#0F172A',
        paddingVertical: 14,
    },
    passwordInput: {
        flex: 1,
        fontSize: 17,
        fontWeight: '500',
        color: '#0F172A',
        paddingVertical: 14,
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
    optionsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    rememberMeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    rememberMeText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#334155',
        marginLeft: 8,
    },
    forgotPasswordText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#0066CC',
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
        marginBottom: 16,
    },
    footerText: {
        fontSize: 16,
        color: '#475569',
    },
    registerLink: {
        fontSize: 16,
        color: '#0066CC',
        fontWeight: '800',
        paddingVertical: 4,
    },
    supportBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F1F5F9',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        marginTop: 6,
    },
    supportBannerText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#0066CC',
    },
});