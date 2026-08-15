import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAuthStore } from '../../../shared/store/authStore';

export const LoginForm = () => {
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(true);

    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({});

    // Use Zustand auth store for login
    const { login, isLoading } = useAuthStore();

    const validateForm = () => {
        const newErrors: { identifier?: string; password?: string } = {};

        if (!identifier.trim()) {
            newErrors.identifier = 'Email or NIC Number is required';
        }
        if (!password) {
            newErrors.password = 'Password is required';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleLogin = async () => {
        if (!validateForm()) return;

        const result = await login(identifier, password);

        if (result.success) {
            const successMsg = result.isAdmin ? 'Admin Login Successful!' : 'Login Successful!';
            const targetRoute = result.isAdmin ? '/(admin)' : '/(tabs)';

            if (Platform.OS === 'web') {
                window.alert(successMsg);
                router.replace(targetRoute as any);
            } else {
                Alert.alert('Success', successMsg, [
                    { text: 'OK', onPress: () => router.replace(targetRoute as any) }
                ]);
            }
        } else {
            if (Platform.OS === 'web') {
                window.alert(result.message);
            } else {
                Alert.alert('Login Failed', result.message);
            }
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
                            errors.identifier ? styles.inputErrorBorder : null
                        ]}>
                            <Ionicons name="card-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="e.g. user@email.com or 199012345678"
                                placeholderTextColor="#777"
                                autoCapitalize="none"
                                autoCorrect={false}
                                value={identifier}
                                onChangeText={setIdentifier}
                                accessibilityLabel="Email address or NIC Number"
                                accessibilityHint="Enter your registered email address or Sri Lankan NIC number"
                            />
                        </View>
                        {errors.identifier ? (
                            <View style={styles.errorContainer}>
                                <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                <Text style={styles.errorText}>{errors.identifier}</Text>
                            </View>
                        ) : null}
                    </View>

                    {/* Password Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Password</Text>
                        <View style={[
                            styles.inputWrapper,
                            errors.password ? styles.inputErrorBorder : null
                        ]}>
                            <Ionicons name="lock-closed-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="Enter your password"
                                placeholderTextColor="#777"
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                                autoCorrect={false}
                                value={password}
                                onChangeText={setPassword}
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
                        {errors.password ? (
                            <View style={styles.errorContainer}>
                                <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                <Text style={styles.errorText}>{errors.password}</Text>
                            </View>
                        ) : null}
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

                    {/* Sign In Button */}
                    <TouchableOpacity
                        style={[styles.button, isLoading && styles.buttonDisabled]}
                        onPress={handleLogin}
                        disabled={isLoading}
                        accessibilityRole="button"
                        accessibilityLabel="Sign In"
                    >
                        {isLoading ? (
                            <ActivityIndicator size="large" color="#ffffff" />
                        ) : (
                            <Text style={styles.buttonText}>SIGN IN</Text>
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
        borderColor: '#CBD5E1',
        borderRadius: 16,
        paddingHorizontal: 16,
        minHeight: 58,
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
    button: {
        backgroundColor: '#0066CC',
        minHeight: 56,
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
    optionsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
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
        fontWeight: 'bold',
        color: '#0066CC',
    },
    supportBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EBF3FA',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#D0D9E2',
        marginTop: 16,
    },
    supportBannerText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#0066CC',
    },
});