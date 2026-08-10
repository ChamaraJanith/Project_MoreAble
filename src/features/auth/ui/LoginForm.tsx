import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
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
                if (Platform.OS === 'web') {
                    window.alert('Login Successful!');
                    router.replace('/(tabs)');
                } else {
                    Alert.alert('Success', 'Login Successful!', [
                        { text: 'OK', onPress: () => router.replace('/(tabs)') }
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
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <View style={styles.formContainer}>
                <Text style={styles.headerTitle}>Welcome Back!</Text>
                <Text style={styles.subtitle}>Sign in to continue</Text>

                {/* Email or NIC Input */}
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Email or NIC</Text>
                    <TextInput
                        style={styles.input}
                        placeholder="Enter your email or NIC"
                        autoCapitalize="none"
                        value={formData.identifier}
                        onChangeText={(text) => setFormData({ ...formData, identifier: text })}
                    />
                    {errors.identifier && <Text style={styles.errorText}>{errors.identifier}</Text>}
                </View>

                {/* Password Input with Show/Hide Password Toggle */}
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>Password</Text>
                    <View style={styles.passwordContainer}>
                        <TextInput
                            style={styles.passwordInput}
                            placeholder="Enter your password"
                            secureTextEntry={!showPassword}
                            value={formData.password}
                            onChangeText={(text) => setFormData({ ...formData, password: text })}
                        />
                        <TouchableOpacity
                            style={styles.eyeIconContainer}
                            onPress={() => setShowPassword(!showPassword)}
                        >
                            <Ionicons
                                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                size={22}
                                color="#666"
                            />
                        </TouchableOpacity>
                    </View>
                    {errors.password && <Text style={styles.errorText}>{errors.password}</Text>}
                </View>

                {/* Login Button */}
                <TouchableOpacity
                    style={[styles.button, isLoading && styles.buttonDisabled]}
                    onPress={handleLogin}
                    disabled={isLoading}
                >
                    {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Login</Text>}
                </TouchableOpacity>

                {/* Navigate to Register Page */}
                <View style={styles.footer}>
                    <Text style={styles.footerText}>Don't have an account? </Text>
                    <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
                        <Text style={styles.registerLink}>Register Here</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f9f9f9', justifyContent: 'center' },
    formContainer: { padding: 25 },
    headerTitle: { fontSize: 32, fontWeight: 'bold', color: '#333', marginBottom: 5, textAlign: 'center' },
    subtitle: { fontSize: 16, color: '#666', marginBottom: 30, textAlign: 'center' },
    inputGroup: { marginBottom: 20 },
    label: { fontSize: 14, color: '#444', marginBottom: 5, fontWeight: '500' },
    input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 14, fontSize: 16 },
    passwordContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
    },
    passwordInput: {
        flex: 1,
        padding: 14,
        fontSize: 16,
    },
    eyeIconContainer: {
        paddingHorizontal: 12,
        paddingVertical: 14,
    },
    errorText: { color: 'red', fontSize: 12, marginTop: 4 },
    button: { backgroundColor: '#007AFF', padding: 15, borderRadius: 8, alignItems: 'center', marginTop: 10 },
    buttonDisabled: { backgroundColor: '#99c9ff' },
    buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 25 },
    footerText: { fontSize: 15, color: '#555' },
    registerLink: { fontSize: 15, color: '#007AFF', fontWeight: 'bold' },
});