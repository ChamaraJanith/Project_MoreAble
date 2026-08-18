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
    const [step, setStep] = useState<1 | 2>(1);
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
        secondaryPhoneNumber: '',
    });

    // Ethical Accessibility Inquiry States
    const [hasAccessibilityNeeds, setHasAccessibilityNeeds] = useState<boolean | null>(null);
    const [accessibilityNeeds, setAccessibilityNeeds] = useState({
        wheelchair: false,
        lowVision: false,
        hearingImpairment: false,
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

    const validateStep1 = () => {
        let newErrors: Record<string, string> = {};

        if (!formData.userName.trim()) newErrors.userName = 'Full Name is required';
        if (!formData.email.includes('@')) newErrors.email = 'Valid email address is required';
        if (formData.password.length < 6) newErrors.password = 'Password must be at least 6 characters';
        if (formData.password !== formData.confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
        if (!formData.phoneNumber.trim() || formData.phoneNumber.trim().length < 9) newErrors.phoneNumber = 'Valid primary mobile number is required';
        if (!formData.secondaryPhoneNumber.trim() || formData.secondaryPhoneNumber.trim().length < 9) {
            newErrors.secondaryPhoneNumber = 'Valid secondary mobile number is required';
        } else if (formData.phoneNumber.trim() === formData.secondaryPhoneNumber.trim()) {
            newErrors.secondaryPhoneNumber = 'Secondary mobile number must be different from primary number';
        }

        const nicCheck = parseSriLankanNic(formData.nicNo);
        if (!nicCheck.isValid) newErrors.nicNo = 'Invalid Sri Lankan NIC Number';

        if (hasAccessibilityNeeds === null) {
            newErrors.accessibilityInquiry = 'Please select whether you require accessibility assistance';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const validateStep2 = () => {
        let newErrors: Record<string, string> = {};

        if (hasAccessibilityNeeds && !accessibilityNeeds.wheelchair && !accessibilityNeeds.lowVision && !accessibilityNeeds.hearingImpairment) {
            newErrors.accessibilityNeeds = 'Please select at least one accessibility option that applies to you';
        }

        if (hasGuardian) {
            if (!guardianData.fullName.trim()) newErrors.gFullName = 'Guardian name is required';
            if (!guardianData.mobileNo.trim()) newErrors.gMobileNo = 'Guardian mobile number is required';

            const gNicCheck = parseSriLankanNic(guardianData.nicNo);
            if (!gNicCheck.isValid) newErrors.gNicNo = 'Invalid Guardian NIC Number';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleNextStep = () => {
        if (validateStep1()) {
            setStep(2);
        }
    };

    const handleBackStep = () => {
        setErrors({});
        setStep(1);
    };

    const toggleAccessibilityCategory = (key: 'wheelchair' | 'lowVision' | 'hearingImpairment') => {
        setAccessibilityNeeds(prev => ({
            ...prev,
            [key]: !prev[key],
        }));
    };

    const handleRegister = async () => {
        if (!validateStep2()) return;

        setIsLoading(true);

        const selectedNeeds: string[] = [];
        if (hasAccessibilityNeeds) {
            if (accessibilityNeeds.wheelchair) selectedNeeds.push('wheelchair');
            if (accessibilityNeeds.lowVision) selectedNeeds.push('low_vision');
            if (accessibilityNeeds.hearingImpairment) selectedNeeds.push('hearing_impairment');
        }

        try {
            const payload: UserRegistrationDTO = {
                userName: formData.userName,
                email: formData.email,
                password: formData.password,
                nicNo: formData.nicNo,
                phoneNumber: formData.phoneNumber,
                secondaryPhoneNumber: formData.secondaryPhoneNumber,
                hasAccessibilityNeeds: !!hasAccessibilityNeeds,
                accessibilityNeeds: selectedNeeds,
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

                    {/* Step Indicator */}
                    <View style={styles.stepIndicatorContainer} accessibilityLabel={`Step ${step} of 2`}>
                        <View style={[styles.stepBadge, step === 1 ? styles.stepBadgeActive : styles.stepBadgeDone]}>
                            <Text style={[styles.stepBadgeText, step === 1 ? styles.stepBadgeTextActive : styles.stepBadgeTextDone]}>
                                1. Basic Details
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color="#777" style={{ marginHorizontal: 4 }} />
                        <View style={[styles.stepBadge, step === 2 ? styles.stepBadgeActive : styles.stepBadgeInactive]}>
                            <Text style={[styles.stepBadgeText, step === 2 ? styles.stepBadgeTextActive : styles.stepBadgeTextInactive]}>
                                2. Accessibility & Options
                            </Text>
                        </View>
                    </View>

                    {/* STEP 1: BASIC DETAILS & ETHICAL ACCESSIBILITY QUESTION */}
                    {step === 1 && (
                        <View>
                            {/* Full Name Input */}
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Full Name *</Text>
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
                                <Text style={styles.label}>Email Address *</Text>
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
                                <Text style={styles.label}>NIC Number *</Text>
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

                            {/* Primary Phone Number Input */}
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Primary Mobile Number *</Text>
                                <View style={[styles.inputWrapper, errors.phoneNumber ? styles.inputErrorBorder : null]}>
                                    <Ionicons name="call-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="e.g. 0771234567"
                                        placeholderTextColor="#777"
                                        keyboardType="phone-pad"
                                        value={formData.phoneNumber}
                                        onChangeText={(text) => setFormData({ ...formData, phoneNumber: text })}
                                        accessibilityLabel="Primary Mobile Number"
                                    />
                                </View>
                                {errors.phoneNumber && (
                                    <View style={styles.errorContainer}>
                                        <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                        <Text style={styles.errorText}>{errors.phoneNumber}</Text>
                                    </View>
                                )}
                            </View>

                            {/* Secondary Phone Number Input */}
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Secondary Mobile Number *</Text>
                                <View style={[styles.inputWrapper, errors.secondaryPhoneNumber ? styles.inputErrorBorder : null]}>
                                    <Ionicons name="phone-portrait-outline" size={24} color="#0066CC" style={styles.inputIcon} />
                                    <TextInput
                                        style={styles.input}
                                        placeholder="e.g. 0719876543"
                                        placeholderTextColor="#777"
                                        keyboardType="phone-pad"
                                        value={formData.secondaryPhoneNumber}
                                        onChangeText={(text) => setFormData({ ...formData, secondaryPhoneNumber: text })}
                                        accessibilityLabel="Secondary Mobile Number"
                                    />
                                </View>
                                {errors.secondaryPhoneNumber && (
                                    <View style={styles.errorContainer}>
                                        <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                        <Text style={styles.errorText}>{errors.secondaryPhoneNumber}</Text>
                                    </View>
                                )}
                            </View>

                            {/* Password Input */}
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>Password *</Text>
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
                                <Text style={styles.label}>Confirm Password *</Text>
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

                            {/* ETHICAL ACCESSIBILITY INQUIRY SECTION */}
                            <View style={styles.ethicalCard}>
                                <View style={styles.ethicalHeader}>
                                    <Ionicons name="body-outline" size={24} color="#0066CC" style={{ marginRight: 8 }} />
                                    <Text style={styles.ethicalTitle}>Accessibility Support Inquiry</Text>
                                </View>
                                <Text style={styles.ethicalDescription}>
                                    MoreAble is dedicated to an inclusive transit experience. Asking about your accessibility needs allows us to tailor route recommendations, reserve priority seats/ramps, and inform transport crew for assistance. Sharing this is optional and confidential.
                                </Text>

                                <Text style={styles.ethicalQuestion}>
                                    Do you require accessibility assistance for your journeys? *
                                </Text>

                                <View style={styles.inquiryOptionsRow}>
                                    <TouchableOpacity
                                        style={[
                                            styles.inquiryOptionButton,
                                            hasAccessibilityNeeds === true && styles.inquiryOptionSelected
                                        ]}
                                        onPress={() => {
                                            setHasAccessibilityNeeds(true);
                                            setErrors(prev => ({ ...prev, accessibilityInquiry: '' }));
                                        }}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: hasAccessibilityNeeds === true }}
                                        accessibilityLabel="Yes, I require accessibility assistance"
                                    >
                                        <Ionicons
                                            name={hasAccessibilityNeeds === true ? "checkmark-circle" : "ellipse-outline"}
                                            size={22}
                                            color={hasAccessibilityNeeds === true ? "#0066CC" : "#777"}
                                        />
                                        <Text style={[
                                            styles.inquiryOptionText,
                                            hasAccessibilityNeeds === true && styles.inquiryOptionTextSelected
                                        ]}>
                                            Yes, I do
                                        </Text>
                                    </TouchableOpacity>

                                    <TouchableOpacity
                                        style={[
                                            styles.inquiryOptionButton,
                                            hasAccessibilityNeeds === false && styles.inquiryOptionSelected
                                        ]}
                                        onPress={() => {
                                            setHasAccessibilityNeeds(false);
                                            setErrors(prev => ({ ...prev, accessibilityInquiry: '' }));
                                        }}
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: hasAccessibilityNeeds === false }}
                                        accessibilityLabel="No, I don't require accessibility assistance"
                                    >
                                        <Ionicons
                                            name={hasAccessibilityNeeds === false ? "checkmark-circle" : "ellipse-outline"}
                                            size={22}
                                            color={hasAccessibilityNeeds === false ? "#0066CC" : "#777"}
                                        />
                                        <Text style={[
                                            styles.inquiryOptionText,
                                            hasAccessibilityNeeds === false && styles.inquiryOptionTextSelected
                                        ]}>
                                            No, I don't
                                        </Text>
                                    </TouchableOpacity>
                                </View>

                                {errors.accessibilityInquiry && (
                                    <View style={styles.errorContainer}>
                                        <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                        <Text style={styles.errorText}>{errors.accessibilityInquiry}</Text>
                                    </View>
                                )}
                            </View>

                            {/* Continue to Step 2 Button */}
                            <TouchableOpacity
                                style={styles.button}
                                onPress={handleNextStep}
                                accessibilityRole="button"
                                accessibilityLabel="Continue to Next Step"
                            >
                                <Text style={styles.buttonText}>NEXT STEP →</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* STEP 2: ACCESSIBILITY PREFERENCES & OPTIONS (WITH BACK BUTTON) */}
                    {step === 2 && (
                        <View>
                            {/* ACCESSIBILITY CATEGORIES CHECKBOXES (Conditionally rendered if hasAccessibilityNeeds is true) */}
                            {hasAccessibilityNeeds ? (
                                <View style={styles.categoriesSection}>
                                    <Text style={styles.sectionTitle} accessibilityRole="header">
                                        Select Your Accessibility Requirements
                                    </Text>
                                    <Text style={styles.sectionSubtitle}>
                                        Please check all the options that apply to you so we can customize your transit features:
                                    </Text>

                                    {/* Wheelchair User Checkbox */}
                                    <TouchableOpacity
                                        style={[
                                            styles.checkboxCard,
                                            accessibilityNeeds.wheelchair && styles.checkboxCardSelected
                                        ]}
                                        onPress={() => toggleAccessibilityCategory('wheelchair')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: accessibilityNeeds.wheelchair }}
                                        accessibilityLabel="Wheelchair User - Mobility assistance and vehicle ramp access"
                                    >
                                        <View style={styles.checkboxIconWrapper}>
                                            <Ionicons
                                                name={accessibilityNeeds.wheelchair ? "checkbox" : "square-outline"}
                                                size={26}
                                                color={accessibilityNeeds.wheelchair ? "#0066CC" : "#777"}
                                            />
                                        </View>
                                        <View style={styles.checkboxContent}>
                                            <View style={styles.checkboxTitleRow}>
                                                <Text style={styles.checkboxEmoji}>♿</Text>
                                                <Text style={styles.checkboxLabel}>Wheelchair User</Text>
                                            </View>
                                            <Text style={styles.checkboxSubtext}>
                                                Requires wheelchair ramp, low-floor vehicle, or priority wheelchair space.
                                            </Text>
                                        </View>
                                    </TouchableOpacity>

                                    {/* Low Vision Person Checkbox */}
                                    <TouchableOpacity
                                        style={[
                                            styles.checkboxCard,
                                            accessibilityNeeds.lowVision && styles.checkboxCardSelected
                                        ]}
                                        onPress={() => toggleAccessibilityCategory('lowVision')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: accessibilityNeeds.lowVision }}
                                        accessibilityLabel="Low Vision Person - Audio announcements and high contrast screen support"
                                    >
                                        <View style={styles.checkboxIconWrapper}>
                                            <Ionicons
                                                name={accessibilityNeeds.lowVision ? "checkbox" : "square-outline"}
                                                size={26}
                                                color={accessibilityNeeds.lowVision ? "#0066CC" : "#777"}
                                            />
                                        </View>
                                        <View style={styles.checkboxContent}>
                                            <View style={styles.checkboxTitleRow}>
                                                <Text style={styles.checkboxEmoji}>👁️</Text>
                                                <Text style={styles.checkboxLabel}>Low Vision Person</Text>
                                            </View>
                                            <Text style={styles.checkboxSubtext}>
                                                Requires audio route announcements, high contrast, or guided boarding assistance.
                                            </Text>
                                        </View>
                                    </TouchableOpacity>

                                    {/* Hearing Impairment Person Checkbox */}
                                    <TouchableOpacity
                                        style={[
                                            styles.checkboxCard,
                                            accessibilityNeeds.hearingImpairment && styles.checkboxCardSelected
                                        ]}
                                        onPress={() => toggleAccessibilityCategory('hearingImpairment')}
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: accessibilityNeeds.hearingImpairment }}
                                        accessibilityLabel="Hearing Impairment Person - Visual displays and text alerts"
                                    >
                                        <View style={styles.checkboxIconWrapper}>
                                            <Ionicons
                                                name={accessibilityNeeds.hearingImpairment ? "checkbox" : "square-outline"}
                                                size={26}
                                                color={accessibilityNeeds.hearingImpairment ? "#0066CC" : "#777"}
                                            />
                                        </View>
                                        <View style={styles.checkboxContent}>
                                            <View style={styles.checkboxTitleRow}>
                                                <Text style={styles.checkboxEmoji}>👂</Text>
                                                <Text style={styles.checkboxLabel}>Hearing Impairment Person</Text>
                                            </View>
                                            <Text style={styles.checkboxSubtext}>
                                                Requires visual screen displays, text notifications, or visual stop alerts.
                                            </Text>
                                        </View>
                                    </TouchableOpacity>

                                    {errors.accessibilityNeeds && (
                                        <View style={styles.errorContainer}>
                                            <Ionicons name="alert-circle-outline" size={18} color="#D32F2F" />
                                            <Text style={styles.errorText}>{errors.accessibilityNeeds}</Text>
                                        </View>
                                    )}
                                </View>
                            ) : (
                                <View style={styles.standardNoticeCard}>
                                    <Ionicons name="information-circle-outline" size={26} color="#0066CC" style={{ marginRight: 10 }} />
                                    <Text style={styles.standardNoticeText}>
                                        Standard journey profile selected. You can update your accessibility preferences anytime from your profile settings.
                                    </Text>
                                </View>
                            )}

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
                                        <Text style={styles.label}>Guardian Name *</Text>
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
                                        <Text style={styles.label}>Guardian NIC *</Text>
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
                                        <Text style={styles.label}>Guardian Mobile Number *</Text>
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

                            {/* NAVIGATION & SUBMIT BUTTONS */}
                            <View style={styles.navigationButtonGroup}>
                                {/* Back Button */}
                                <TouchableOpacity
                                    style={styles.backButton}
                                    onPress={handleBackStep}
                                    accessibilityRole="button"
                                    accessibilityLabel="Back to Basic Details"
                                >
                                    <Ionicons name="arrow-back" size={20} color="#0066CC" style={{ marginRight: 6 }} />
                                    <Text style={styles.backButtonText}>BACK</Text>
                                </TouchableOpacity>

                                {/* Submit Button */}
                                <TouchableOpacity
                                    style={[styles.button, styles.submitButtonFlex, isLoading && styles.buttonDisabled]}
                                    onPress={handleRegister}
                                    disabled={isLoading}
                                    accessibilityRole="button"
                                    accessibilityLabel="Create Account"
                                >
                                    {isLoading ? (
                                        <ActivityIndicator size="large" color="#ffffff" />
                                    ) : (
                                        <Text style={styles.buttonText}>CREATE ACCOUNT</Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

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
        marginBottom: 20,
        lineHeight: 22,
    },
    stepIndicatorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
    },
    stepBadge: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
    },
    stepBadgeActive: {
        backgroundColor: '#0066CC',
    },
    stepBadgeDone: {
        backgroundColor: '#EBF3FA',
        borderWidth: 1,
        borderColor: '#0066CC',
    },
    stepBadgeInactive: {
        backgroundColor: '#F0F4F8',
    },
    stepBadgeText: {
        fontSize: 13,
        fontWeight: '600',
    },
    stepBadgeTextActive: {
        color: '#FFFFFF',
    },
    stepBadgeTextDone: {
        color: '#0066CC',
    },
    stepBadgeTextInactive: {
        color: '#778899',
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
    ethicalCard: {
        backgroundColor: '#F0F7FF',
        borderColor: '#B3D7FF',
        borderWidth: 1.5,
        borderRadius: 16,
        padding: 18,
        marginBottom: 22,
    },
    ethicalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    ethicalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#0066CC',
    },
    ethicalDescription: {
        fontSize: 14,
        color: '#334E68',
        lineHeight: 20,
        marginBottom: 14,
    },
    ethicalQuestion: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1A2530',
        marginBottom: 12,
    },
    inquiryOptionsRow: {
        flexDirection: 'row',
        gap: 10,
    },
    inquiryOptionButton: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FFFFFF',
        borderWidth: 2,
        borderColor: '#D0D9E2',
        borderRadius: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        minHeight: 52,
    },
    inquiryOptionSelected: {
        borderColor: '#0066CC',
        backgroundColor: '#EBF3FA',
    },
    inquiryOptionText: {
        fontSize: 15,
        fontWeight: '600',
        color: '#5A6E7F',
        marginLeft: 8,
    },
    inquiryOptionTextSelected: {
        color: '#0066CC',
        fontWeight: 'bold',
    },
    categoriesSection: {
        marginBottom: 20,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#0066CC',
        marginBottom: 6,
    },
    sectionSubtitle: {
        fontSize: 14,
        color: '#5A6E7F',
        marginBottom: 16,
        lineHeight: 20,
    },
    checkboxCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F8FAFC',
        borderWidth: 2,
        borderColor: '#D0D9E2',
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
        minHeight: 64,
    },
    checkboxCardSelected: {
        borderColor: '#0066CC',
        backgroundColor: '#EBF3FA',
    },
    checkboxIconWrapper: {
        marginRight: 12,
    },
    checkboxContent: {
        flex: 1,
    },
    checkboxTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    checkboxEmoji: {
        fontSize: 18,
        marginRight: 6,
    },
    checkboxLabel: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1A2530',
    },
    checkboxSubtext: {
        fontSize: 13,
        color: '#5A6E7F',
        lineHeight: 18,
    },
    standardNoticeCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EBF3FA',
        padding: 16,
        borderRadius: 14,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#B3D7FF',
    },
    standardNoticeText: {
        flex: 1,
        fontSize: 14,
        color: '#004080',
        lineHeight: 20,
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
    navigationButtonGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 10,
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EBF3FA',
        borderWidth: 2,
        borderColor: '#0066CC',
        borderRadius: 14,
        minHeight: 56,
        paddingHorizontal: 18,
    },
    backButtonText: {
        color: '#0066CC',
        fontSize: 16,
        fontWeight: 'bold',
    },
    submitButtonFlex: {
        flex: 1,
        marginTop: 0,
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
        fontSize: 18,
        fontWeight: 'bold',
        letterSpacing: 0.5,
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