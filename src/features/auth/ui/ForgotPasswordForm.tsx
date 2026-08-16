// Forgot / Reset Password Form Component for MoreAble app
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
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { API_BASE_URL } from '../../../shared/api/config';

export const ForgotPasswordForm = () => {
  const [identifier, setIdentifier] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errors, setErrors] = useState<{ identifier?: string; newPassword?: string; confirmPassword?: string }>({});

  const validateForm = () => {
    const newErrors: { identifier?: string; newPassword?: string; confirmPassword?: string } = {};

    if (!identifier.trim()) {
      newErrors.identifier = 'Email, NIC, or Mobile Number is required';
    }

    if (!newPassword || newPassword.length < 6) {
      newErrors.newPassword = 'New password must be at least 6 characters';
    }

    if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleResetPassword = async () => {
    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier.trim(),
          newPassword: newPassword,
        }),
      });

      const result = await response.json();

      setIsLoading(false);

      if (response.ok && result.success) {
        setIsSuccess(true);
        if (Platform.OS === 'web') {
          window.alert('Password reset successful! You can now log in with your new password.');
        } else {
          Alert.alert('Success', 'Password reset successful! You can now log in with your new password.');
        }
      } else {
        const errorMsg = result.message || 'Failed to reset password. Please try again.';
        setErrors({ identifier: errorMsg });
        if (Platform.OS === 'web') {
          window.alert(errorMsg);
        } else {
          Alert.alert('Reset Failed', errorMsg);
        }
      }
    } catch (error: any) {
      console.error('Reset Password Error:', error);
      setIsLoading(false);
      const netError = 'Network error. Please check your connection and try again.';
      setErrors({ identifier: netError });
      if (Platform.OS === 'web') {
        window.alert(netError);
      } else {
        Alert.alert('Error', netError);
      }
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
            <Ionicons name="key-outline" size={20} color="#0066CC" />
            <Text style={styles.badgeText}>Password Recovery</Text>
          </View>

          <Text style={styles.headerTitle} accessibilityRole="header">
            Reset Password
          </Text>
          <Text style={styles.subtitle}>
            Enter your account details and choose a new secure password
          </Text>

          {isSuccess ? (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={48} color="#10B981" style={{ marginBottom: 12 }} />
              <Text style={styles.successTitle}>Password Reset Complete!</Text>
              <Text style={styles.successMessage}>
                Your account password has been updated successfully.
              </Text>
              <TouchableOpacity
                style={styles.button}
                onPress={() => router.replace('/(auth)')}
                accessibilityRole="button"
                accessibilityLabel="Go to Login"
              >
                <Text style={styles.buttonText}>BACK TO LOGIN</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Account Identifier Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Account Email, NIC, or Mobile Number *</Text>
                <View style={[styles.inputWrapper, errors.identifier ? styles.inputErrorBorder : null]}>
                  <Ionicons name="person-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. email@example.com or NIC or Phone"
                    placeholderTextColor="#777"
                    autoCapitalize="none"
                    value={identifier}
                    onChangeText={setIdentifier}
                    accessibilityLabel="Account Email, NIC, or Mobile Number"
                  />
                </View>
                {errors.identifier ? (
                  <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                    <Text style={styles.errorText}>{errors.identifier}</Text>
                  </View>
                ) : null}
              </View>

              {/* New Password Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>New Password *</Text>
                <View style={[styles.inputWrapper, errors.newPassword ? styles.inputErrorBorder : null]}>
                  <Ionicons name="lock-closed-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Min 6 characters"
                    placeholderTextColor="#777"
                    secureTextEntry={!showPassword}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    accessibilityLabel="New Password"
                  />
                  <TouchableOpacity
                    style={styles.eyeIconContainer}
                    onPress={() => setShowPassword(!showPassword)}
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={24}
                      color="#0066CC"
                    />
                  </TouchableOpacity>
                </View>
                {errors.newPassword ? (
                  <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                    <Text style={styles.errorText}>{errors.newPassword}</Text>
                  </View>
                ) : null}
              </View>

              {/* Confirm Password Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm New Password *</Text>
                <View style={[styles.inputWrapper, errors.confirmPassword ? styles.inputErrorBorder : null]}>
                  <Ionicons name="lock-closed-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Re-enter new password"
                    placeholderTextColor="#777"
                    secureTextEntry={!showConfirmPassword}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    accessibilityLabel="Confirm New Password"
                  />
                  <TouchableOpacity
                    style={styles.eyeIconContainer}
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    accessibilityRole="button"
                    accessibilityLabel={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    <Ionicons
                      name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={24}
                      color="#0066CC"
                    />
                  </TouchableOpacity>
                </View>
                {errors.confirmPassword ? (
                  <View style={styles.errorContainer}>
                    <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                    <Text style={styles.errorText}>{errors.confirmPassword}</Text>
                  </View>
                ) : null}
              </View>

              {/* Reset Password Button */}
              <TouchableOpacity
                style={[styles.button, isLoading && styles.buttonDisabled]}
                onPress={handleResetPassword}
                disabled={isLoading}
                accessibilityRole="button"
                accessibilityLabel="Reset Password"
              >
                {isLoading ? (
                  <ActivityIndicator size="large" color="#ffffff" />
                ) : (
                  <Text style={styles.buttonText}>RESET PASSWORD</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          {/* Return to Login */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.replace('/(auth)')}
            accessibilityRole="button"
            accessibilityLabel="Back to Login"
          >
            <Ionicons name="arrow-back-outline" size={18} color="#0066CC" style={{ marginRight: 6 }} />
            <Text style={styles.backButtonText}>Back to Sign In</Text>
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
  successBox: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#10B981',
    marginBottom: 8,
  },
  successMessage: {
    fontSize: 15,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 20,
  },
});
