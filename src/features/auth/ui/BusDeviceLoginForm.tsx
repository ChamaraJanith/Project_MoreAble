
//Vehicle dashboard Login Form
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { saveBusSession } from '../../../shared/utils/busSession';
import { loginBus } from '../api/busAuthApi';

export const BusDeviceLoginForm = () => {
    const [numberPlate, setNumberPlate] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [errors, setErrors] = useState<{ numberPlate?: string; password?: string }>({});
    const [signInError, setSignInError] = useState('');

    const validateForm = () => {
        const newErrors: { numberPlate?: string; password?: string } = {};

        if (!numberPlate.trim()) {
            newErrors.numberPlate = 'Bus Number Plate is required';
        }
        if (!password) {
            newErrors.password = 'Bus Password is required';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleBusLogin = async () => {
        setSignInError('');
        if (!validateForm()) return;

        setIsLoading(true);

        try {
            // The bus is identified by the backend from these credentials; the
            // busId and token come back from there and are never assumed here.
            const session = await loginBus(numberPlate, password);
            await saveBusSession(session);

            // Cleared as soon as it has been exchanged for a token, so it is
            // not left sitting in component state.
            setPassword('');

            router.replace('/vehicle-dashboard' as any);
        } catch (error: any) {
            setSignInError(error?.message || 'Unable to sign in right now. Please try again.');
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

                    <View style={styles.badgeContainer}>
                        <Ionicons name="bus-outline" size={20} color="#0066CC" />
                        <Text style={styles.badgeText}>Vehicle Device Portal</Text>
                    </View>

                    <Text style={styles.headerTitle} accessibilityRole="header">
                        Bus Device Login
                    </Text>
                    <Text style={styles.subtitle}>
                        Enter vehicle credentials to connect bus terminal
                    </Text>

                    {/* Bus Number Plate Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Bus Number Plate</Text>
                        <View style={[
                            styles.inputWrapper,
                            errors.numberPlate ? styles.inputErrorBorder : null
                        ]}>
                            <Ionicons name="bus-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="e.g. NC-6789 or WP NB-1234"
                                placeholderTextColor="#777"
                                autoCapitalize="characters"
                                autoCorrect={false}
                                value={numberPlate}
                                onChangeText={setNumberPlate}
                                accessibilityLabel="Bus Number Plate"
                            />
                        </View>
                        {errors.numberPlate ? (
                            <View style={styles.errorContainer}>
                                <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                <Text style={styles.errorText}>{errors.numberPlate}</Text>
                            </View>
                        ) : null}
                    </View>

                    {/* Bus Password Input */}
                    <View style={styles.inputGroup}>
                        <Text style={styles.label}>Bus Password</Text>
                        <View style={[
                            styles.inputWrapper,
                            errors.password ? styles.inputErrorBorder : null
                        ]}>
                            <Ionicons name="lock-closed-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="Enter bus security password"
                                placeholderTextColor="#777"
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                                autoCorrect={false}
                                value={password}
                                onChangeText={setPassword}
                                accessibilityLabel="Bus Password"
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

                    {!!signInError && (
                        <View style={styles.errorContainer} accessibilityLiveRegion="polite">
                            <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                            <Text style={styles.errorText}>{signInError}</Text>
                        </View>
                    )}

                    {/* Login to Vehicle Button */}
                    <TouchableOpacity
                        style={[styles.button, isLoading && styles.buttonDisabled]}
                        onPress={handleBusLogin}
                        disabled={isLoading}
                        accessibilityRole="button"
                        accessibilityLabel="Login to Vehicle"
                    >
                        {isLoading ? (
                            <ActivityIndicator size="large" color="#ffffff" />
                        ) : (
                            <Text style={styles.buttonText}>LOGIN TO VEHICLE</Text>
                        )}
                    </TouchableOpacity>

                    {/* Return to User Login */}
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => router.replace('/(auth)')}
                        accessibilityRole="button"
                        accessibilityLabel="Back to User Login"
                    >
                        <Ionicons name="arrow-back-outline" size={18} color="#0066CC" style={{ marginRight: 6 }} />
                        <Text style={styles.backButtonText}>Back to User Login</Text>
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
        marginBottom: 10,
    },
    logo: {
        width: 120,
        height: 120,
    },
    badgeContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EBF3FA',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
        alignSelf: 'center',
        marginBottom: 12,
    },
    badgeText: {
        fontSize: 13,
        fontWeight: '700',
        color: '#0066CC',
        marginLeft: 6,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#1A2530',
        textAlign: 'center',
        marginBottom: 6,
    },
    subtitle: {
        fontSize: 15,
        color: '#5A6E7F',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 20,
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
        fontSize: 18,
        fontWeight: 'bold',
        letterSpacing: 1,
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 20,
        paddingVertical: 8,
    },
    backButtonText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#0066CC',
    },
});
