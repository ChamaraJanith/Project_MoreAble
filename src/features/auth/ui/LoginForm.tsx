import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform,
    ScrollView,
    StyleSheet,
    Text, TextInput, TouchableOpacity,
    View
} from 'react-native';
import { API_BASE_URL } from '../../../shared/api/config';

export const LoginForm = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [formData, setFormData] = useState({
        identifier: '', // Email or NIC
        password: '',
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    const validateForm = () => {
        let newErrors: Record<string, string> = {};

        if (!formData.identifier.trim()) {
            newErrors.identifier = 'Email or NIC is required';
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
                        Welcome Back!
                    </Text>
                    <Text style={styles.subtitle}>
                        Sign in to continue to MoreAble
                    </Text>

                    {/* Email or NIC Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Email or NIC Number</Text>
                        <View style={[styles.inputWrapper, errors.identifier ? styles.inputErrorBorder : null]}>
                            <Ionicons name="card-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="e.g. user@email.com or 199012345678"
                                placeholderTextColor="#777"
                                autoCapitalize="none"
                                value={formData.identifier}
                                onChangeText={(text) => setFormData({ ...formData, identifier: text })}
                                accessibilityLabel="Email or NIC Number"
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
                        <View style={[styles.inputWrapper, errors.password ? styles.inputErrorBorder : null]}>
                            <Ionicons name="lock-closed-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.passwordInput}
                                placeholder="Enter your password"
                                placeholderTextColor="#777"
                                secureTextEntry={!showPassword}
                                value={formData.password}
                                onChangeText={(text) => setFormData({ ...formData, password: text })}
                                accessibilityLabel="Password"
                                accessibilityHint="Enter your password"
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

                    {/* Accessible Large Login Button */}
                    <TouchableOpacity
                        style={[styles.button, isLoading && styles.buttonDisabled]}
                        onPress={handleLogin}
                        disabled={isLoading}
                        accessibilityRole="button"
                        accessibilityLabel="Login"
                        accessibilityHint="Double tap to sign in"
                    >
                        {isLoading ? (
                            <ActivityIndicator size="large" color="#ffffff" />
                        ) : (
                            <Text style={styles.buttonText}>LOGIN</Text>
                        )}
                    </TouchableOpacity>

                    {/* Register Link */}
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
        width: 140,
        height: 140,
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
        marginBottom: 22,
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
    passwordInput: {
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