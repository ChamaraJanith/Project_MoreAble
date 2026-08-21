// Profile screen for MoreAble app
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { API_BASE_URL } from '../src/shared/api/config';
import { useAuthStore } from '../src/shared/store/authStore';
import { parseSriLankanNic } from '../src/shared/utils/nicUtils';
import { getProfileCompletionPercentage, isAccessibilityProfileVerified } from '../src/shared/utils/profileUtils';

export default function ProfileScreen() {
  const { user, logout, updateGuardianDetails } = useAuthStore();

  // Test state toggle for demo preview (disabled by default)
  const [testAge60, setTestAge60] = useState(false);

  // Modal State for Guardian Details
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Modal State for Manage Accessibility Profile
  const [isAccModalOpen, setIsAccModalOpen] = useState(false);
  const [accWheelchair, setAccWheelchair] = useState(false);
  const [accLowVision, setAccLowVision] = useState(false);
  const [accHearing, setAccHearing] = useState(false);
  const [isSavingAcc, setIsSavingAcc] = useState(false);

  // Form States for Guardian
  const [gName, setGName] = useState('');
  const [gNic, setGNic] = useState('');
  const [gMobile, setGMobile] = useState('');
  const [gRelationship, setGRelationship] = useState('Son / Daughter');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Modal State for Edit User Profile Details
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);
  const [editUserName, setEditUserName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editNic, setEditNic] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editSecondaryPhone, setEditSecondaryPhone] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [editFormErrors, setEditFormErrors] = useState<Record<string, string>>({});

  // Fallback demo user details if store user is null
  const displayUser = user || {
    uid: 'demo-user-123',
    passengerId: 'PA-2026-1024',
    userName: 'Kavindu Perera',
    email: 'kavindu.p@example.com',
    nicNo: '196224501234',
    calculatedAge: testAge60 ? 64 : 27,
    isElderPerson: testAge60,
    role: 'PASSENGER',
    phoneNumber: '0771234567',
    secondaryPhoneNumber: '0719876543',
    isVerified: true,
    guardianId: null,
    guardianDetails: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Determine age & elderly status
  const parsedNicInfo = displayUser.nicNo ? parseSriLankanNic(displayUser.nicNo) : null;
  const age = testAge60 ? 64 : (displayUser.calculatedAge ?? parsedNicInfo?.age ?? 27);
  const isElderly = testAge60 ? true : (age >= 60 || Boolean(displayUser.isElderPerson));

  // Determine accessibility status & category flags
  const accNeeds: string[] = Array.isArray((displayUser as any).accessibilityNeeds) ? (displayUser as any).accessibilityNeeds : [];
  const isWheelchair = Boolean((displayUser as any).isWheelchairUser || accNeeds.includes('wheelchair'));
  const isLowVision = Boolean((displayUser as any).isLowVisionPerson || accNeeds.includes('low_vision'));
  const isHearingImpaired = Boolean((displayUser as any).isHearingImpaired || accNeeds.includes('hearing_impairment'));
  const hasAccessibility = Boolean(
    (displayUser as any).hasAccessibilityNeeds ||
    (displayUser as any).accessibilityProfileId ||
    accNeeds.length > 0 ||
    isWheelchair ||
    isLowVision ||
    isHearingImpaired
  );

  const openAccModal = () => {
    router.push('/accessibility-profile' as any);
  };

  const handleSaveAccessibilityProfile = async () => {
    setIsSavingAcc(true);
    const updatedNeeds: string[] = [];
    if (accWheelchair) updatedNeeds.push('wheelchair');
    if (accLowVision) updatedNeeds.push('low_vision');
    if (accHearing) updatedNeeds.push('hearing_impairment');

    try {
      const currentAuthUser = useAuthStore.getState().user;
      if (currentAuthUser) {
        const profileId = currentAuthUser.accessibilityProfileId || `ACC-${new Date().getFullYear()}-00012`;
        const updatedAuthUser = {
          ...currentAuthUser,
          accessibilityProfileId: profileId,
          hasAccessibilityNeeds: true,
          accessibilityNeeds: updatedNeeds,
          isWheelchairUser: accWheelchair,
          isLowVisionPerson: accLowVision,
          isHearingImpaired: accHearing,
        };
        useAuthStore.setState({ user: updatedAuthUser });
      }

      setIsAccModalOpen(false);
      if (Platform.OS === 'web') {
        window.alert('Accessibility Profile updated successfully!');
      } else {
        Alert.alert('Success', 'Accessibility Profile updated successfully!');
      }
    } catch (err) {
      console.error('Error saving accessibility profile:', err);
      Alert.alert('Error', 'Failed to save accessibility profile.');
    } finally {
      setIsSavingAcc(false);
    }
  };

  const openEditProfileModal = () => {
    setEditUserName(displayUser.userName || '');
    setEditEmail(displayUser.email || '');
    setEditNic(displayUser.nicNo || '');
    setEditPhone(displayUser.phoneNumber || '');
    setEditSecondaryPhone(displayUser.secondaryPhoneNumber || '');
    setEditFormErrors({});
    setIsEditProfileModalOpen(true);
  };

  const handleSaveProfileDetails = async () => {
    const errors: Record<string, string> = {};

    if (!editUserName.trim()) {
      errors.editUserName = 'Full Name is required';
    }

    if (!editEmail.trim()) {
      errors.editEmail = 'Email Address is required';
    } else if (!/\S+@\S+\.\S+/.test(editEmail.trim())) {
      errors.editEmail = 'Please enter a valid email address';
    }

    if (!editNic.trim()) {
      errors.editNic = 'NIC Number is required';
    } else {
      const parsed = parseSriLankanNic(editNic.trim());
      if (!parsed.isValid) {
        errors.editNic = 'Please enter a valid Sri Lankan NIC number';
      }
    }

    if (!editPhone.trim()) {
      errors.editPhone = 'Primary Mobile Phone is required';
    } else if (!/^(?:0|94|\+94)?7[0-9]{8}$/.test(editPhone.trim().replace(/\s+/g, ''))) {
      errors.editPhone = 'Please enter a valid Sri Lankan mobile number (e.g. 0771234567)';
    }

    if (editSecondaryPhone.trim() && !/^(?:0|94|\+94)?7[0-9]{8}$/.test(editSecondaryPhone.trim().replace(/\s+/g, ''))) {
      errors.editSecondaryPhone = 'Please enter a valid Sri Lankan mobile number (e.g. 0719876543)';
    }

    if (Object.keys(errors).length > 0) {
      setEditFormErrors(errors);
      return;
    }

    setIsSavingProfile(true);
    setEditFormErrors({});

    try {
      const payload = {
        passengerId: displayUser.passengerId,
        uid: displayUser.uid,
        userName: editUserName.trim(),
        email: editEmail.trim(),
        nicNo: editNic.trim(),
        phoneNumber: editPhone.trim(),
        secondaryPhoneNumber: editSecondaryPhone.trim() || null,
      };

      const res = await fetch(`${API_BASE_URL}/api/users/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (res.ok && result.success) {
        const currentUser = useAuthStore.getState().user;
        if (currentUser) {
          const parsedNic = parseSriLankanNic(editNic.trim());
          const newAge = parsedNic.isValid ? parsedNic.age : currentUser.calculatedAge;
          const isElder = parsedNic.isValid ? parsedNic.age >= 60 : currentUser.isElderPerson;

          useAuthStore.setState({
            user: {
              ...currentUser,
              userName: editUserName.trim(),
              email: editEmail.trim(),
              nicNo: editNic.trim(),
              phoneNumber: editPhone.trim(),
              secondaryPhoneNumber: editSecondaryPhone.trim() || null,
              calculatedAge: newAge,
              isElderPerson: isElder,
            },
          });
        }

        setIsEditProfileModalOpen(false);
        if (Platform.OS === 'web') {
          window.alert('Profile details updated successfully!');
        } else {
          Alert.alert('Success', 'Profile details updated successfully!');
        }
      } else {
        Alert.alert('Update Failed', result.message || 'Could not update profile details.');
      }
    } catch (err) {
      console.error('Error updating profile details:', err);
      Alert.alert('Error', 'Network error. Failed to update profile details.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Guardian completion status
  const currentGuardian = displayUser.guardianDetails;
  const isGuardianCompleted = Boolean(currentGuardian && currentGuardian.fullName);

  // Automatically fetch guardian details from backend if guardianId or passengerId exists but guardianDetails is missing locally
  useEffect(() => {
    const fetchGuardianData = async () => {
      const gId = displayUser.guardianId;
      const pId = displayUser.passengerId;
      if ((gId || pId) && (!currentGuardian || !currentGuardian.fullName)) {
        try {
          const queryParam = gId ? `guardianId=${gId}` : `passengerId=${pId}`;
          const res = await fetch(`${API_BASE_URL}/api/guardians?${queryParam}`);
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.guardian && data.guardian.fullName) {
              updateGuardianDetails({
                fullName: data.guardian.fullName,
                nicNo: data.guardian.nicNo,
                mobileNo: data.guardian.mobileNo,
                relationship: data.guardian.relationship,
                email: data.guardian.email,
              });
            }
          }
        } catch (err) {
          console.error('Error fetching guardian details on profile mount:', err);
        }
      }
    };

    fetchGuardianData();
  }, [displayUser.guardianId, displayUser.passengerId, currentGuardian]);

  // Steps & Accessibility Profile Verification Progress Calculation
  const isAccVerified = isAccessibilityProfileVerified({
    hasAccessibilityNeeds: hasAccessibility,
    isAccessibilityVerified: (displayUser as any).isAccessibilityVerified,
    isVerified: (displayUser as any).isVerified,
  });

  const profileCompletionPercentage = getProfileCompletionPercentage({
    hasAccessibilityNeeds: hasAccessibility,
    isAccessibilityVerified: (displayUser as any).isAccessibilityVerified,
    isVerified: (displayUser as any).isVerified,
  });

  const progressPercentage = profileCompletionPercentage;

  const handleLogout = async () => {
    const performLogout = async () => {
      await logout();
      router.replace('/(auth)');
    };

    if (Platform.OS === 'web') {
      const confirmed = window.confirm('Are you sure you want to log out?');
      if (confirmed) {
        await performLogout();
      }
    } else {
      Alert.alert('Logout', 'Are you sure you want to log out?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: performLogout,
        },
      ]);
    }
  };

  const getInitials = (name: string) => {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const openGuardianModal = () => {
    if (currentGuardian) {
      setGName(currentGuardian.fullName || '');
      setGNic(currentGuardian.nicNo || '');
      setGMobile(currentGuardian.mobileNo || '');
      setGRelationship(currentGuardian.relationship || 'Son / Daughter');
    } else {
      setGName('');
      setGNic('');
      setGMobile('');
      setGRelationship('Son / Daughter');
    }
    setFormErrors({});
    setIsModalOpen(true);
  };

  const handleSaveGuardian = async () => {
    const errors: Record<string, string> = {};

    if (!gName.trim()) {
      errors.gName = 'Guardian Full Name is required';
    }

    if (!gMobile.trim() || gMobile.length < 9) {
      errors.gMobile = 'Valid Mobile Number is required';
    }

    if (gNic.trim()) {
      const nicCheck = parseSriLankanNic(gNic);
      if (!nicCheck.isValid) {
        errors.gNic = 'Invalid Sri Lankan NIC number';
      }
    } else {
      errors.gNic = 'Guardian NIC Number is required';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSaving(true);

    const guardianPayload = {
      fullName: gName.trim(),
      nicNo: gNic.trim(),
      mobileNo: gMobile.trim(),
      relationship: gRelationship.trim(),
    };

    try {
      if (displayUser.passengerId) {
        await fetch(`${API_BASE_URL}/api/guardians`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            passengerId: displayUser.passengerId,
            guardianId: displayUser.guardianId,
            ...guardianPayload,
          }),
        });
      }
    } catch (err) {
      console.error('Error persisting guardian details to API:', err);
    }

    updateGuardianDetails(guardianPayload);
    setIsSaving(false);
    setIsModalOpen(false);

    if (Platform.OS === 'web') {
      window.alert('Guardian Details saved successfully!');
    } else {
      Alert.alert('Success', 'Guardian details saved successfully! Your profile step is completed.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {/* Header Navigation */}
        <View style={styles.headerBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go Back"
          >
            <Ionicons name="arrow-back" size={24} color="#1E293B" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>User Profile</Text>
          <TouchableOpacity
            style={styles.demoAgeBadge}
            onPress={() => setTestAge60(!testAge60)}
            accessibilityRole="button"
            accessibilityLabel="Toggle test age"
          >
            <Text style={styles.demoAgeText}>{isElderly ? `Age ${age} (Elder)` : `Age ${age}`}</Text>
          </TouchableOpacity>
        </View>

        {/* Profile Card Header */}
        <View style={styles.profileHeaderCard}>
          <View style={styles.avatarContainer}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitials}>{getInitials(displayUser.userName)}</Text>
            </View>
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={20} color="#10B981" />
            </View>
          </View>

          <Text style={styles.userName}>{displayUser.userName}</Text>
          <Text style={styles.passengerIdText}>ID: {displayUser.passengerId}</Text>

          <View style={styles.tagContainer}>
            <View style={[styles.roleTag, displayUser.role === 'ADMIN' ? styles.adminTag : styles.passengerTag]}>
              <Ionicons
                name={displayUser.role === 'ADMIN' ? 'shield-checkmark' : 'person'}
                size={14}
                color="#FFFFFF"
                style={{ marginRight: 4 }}
              />
              <Text style={styles.roleTagText}>{displayUser.role}</Text>
            </View>

            {isElderly && (
              <View style={styles.elderTag}>
                <Ionicons name="heart" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                <Text style={styles.roleTagText}>Senior Citizen (60+)</Text>
              </View>
            )}

            {isWheelchair && (
              <View style={[styles.roleTag, { backgroundColor: '#7C3AED' }]}>
                <Text style={{ fontSize: 12, marginRight: 4 }}>♿</Text>
                <Text style={styles.roleTagText}>Wheelchair User</Text>
              </View>
            )}

            {isLowVision && (
              <View style={[styles.roleTag, { backgroundColor: '#D97706' }]}>
                <Text style={{ fontSize: 12, marginRight: 4 }}>👁️</Text>
                <Text style={styles.roleTagText}>Low Vision</Text>
              </View>
            )}

            {isHearingImpaired && (
              <View style={[styles.roleTag, { backgroundColor: '#2563EB' }]}>
                <Text style={{ fontSize: 12, marginRight: 4 }}>👂</Text>
                <Text style={styles.roleTagText}>Hearing Impaired</Text>
              </View>
            )}

            {hasAccessibility && !isWheelchair && !isLowVision && !isHearingImpaired && (
              <View style={[styles.roleTag, { backgroundColor: '#0284C7' }]}>
                <Ionicons name="body" size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                <Text style={styles.roleTagText}>Accessibility Support</Text>
              </View>
            )}

            {!isElderly && !hasAccessibility && (
              <View style={[styles.roleTag, { backgroundColor: age >= 18 ? '#0284C7' : '#64748B' }]}>
                <Ionicons name={age >= 18 ? 'checkmark-circle' : 'person'} size={14} color="#FFFFFF" style={{ marginRight: 4 }} />
                <Text style={styles.roleTagText}>{age >= 18 ? 'Citizen' : 'Minor'}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ====================================================================== */}
        {/* ACTION REQUIRED & STEP PROGRESS SECTION (Accessibility & Elderly) */}
        {/* ====================================================================== */}
        {(isElderly || hasAccessibility) && (
          <View style={styles.stepsCardContainer}>
            <View style={styles.stepsHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepsTitle}>Profile Verification Status</Text>
                <Text style={styles.stepsSubtitle}>
                  {hasAccessibility
                    ? (progressPercentage === 80 ? 'Accessibility verification is pending (80% Complete)' : 'Profile is fully verified (100% Complete)')
                    : 'Required profile actions for passengers'}
                </Text>
              </View>

              {/* Circular Progress Badge */}
              <View style={styles.progressCircleContainer}>
                <View style={[styles.progressRingOuter, progressPercentage === 100 && styles.progressRingOuterDone]}>
                  <View style={[styles.progressRingInner, progressPercentage === 100 && styles.progressRingInnerDone]}>
                    <Text style={[styles.progressText, progressPercentage === 100 && styles.progressTextDone]}>
                      {progressPercentage}%
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Accessibility Verification Status Banners */}
            {hasAccessibility && progressPercentage === 80 && (
              <View style={styles.warningBanner}>
                <Ionicons name="alert-circle" size={24} color="#D97706" style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningTitle}>Accessibility Needs Unverified (80%)</Text>
                  <Text style={styles.warningText}>
                    You requested accessibility assistance during registration. Your profile status is 80% until profile verification is completed.
                  </Text>
                </View>
              </View>
            )}

            {hasAccessibility && progressPercentage === 100 && (
              <View style={styles.successBanner}>
                <Ionicons name="checkmark-circle" size={24} color="#059669" style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.successBannerTitle}>Accessibility Needs Verified (100%)</Text>
                  <Text style={styles.successBannerText}>
                    Your accessibility profile details are verified and active for priority transit services.
                  </Text>
                </View>
              </View>
            )}

            {/* Mandatory Booking Warning Box (Only shown if Senior Citizen and Guardian is NOT registered yet) */}
            {isElderly && !isGuardianCompleted && (
              <View style={styles.warningBanner}>
                <Ionicons name="warning" size={24} color="#D97706" style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningTitle}>Guardian Requirement Warning</Text>
                  <Text style={styles.warningText}>
                    Providing Guardian Details is compulsory for passengers over 60 years old when making bus bookings!
                  </Text>
                </View>
              </View>
            )}

            {isElderly && isGuardianCompleted && (
              <View style={styles.successBanner}>
                <Ionicons name="checkmark-circle" size={24} color="#059669" style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.successBannerTitle}>Guardian Registered</Text>
                  <Text style={styles.successBannerText}>
                    Emergency contact and guardian details are verified for bus bookings.
                  </Text>
                </View>
              </View>
            )}

            {/* Step Item 1: Guardian Details (Only required for passengers aged 60+) */}
            {isElderly && (
              <View style={styles.stepItemCard}>
                <View style={styles.stepIconColumn}>
                  <View style={[styles.stepCircleIcon, isGuardianCompleted ? styles.stepDoneCircle : styles.stepPendingCircle]}>
                    <Ionicons
                      name={isGuardianCompleted ? 'checkmark-sharp' : 'alert'}
                      size={18}
                      color="#FFFFFF"
                    />
                  </View>
                </View>

                <View style={styles.stepInfoColumn}>
                  <View style={styles.stepHeaderRow}>
                    <Text style={styles.stepItemTitle}>Step 1: Guardian Details</Text>
                    <View style={[styles.statusBadge, isGuardianCompleted ? styles.statusBadgeDone : styles.statusBadgePending]}>
                      <Text style={[styles.statusBadgeText, isGuardianCompleted ? styles.statusTextDone : styles.statusTextPending]}>
                        {isGuardianCompleted ? 'Completed' : 'Action Required'}
                      </Text>
                    </View>
                  </View>

                  {isGuardianCompleted && currentGuardian ? (
                    <View style={styles.guardianSummaryBox}>
                      <Text style={styles.guardianSummaryName}>{currentGuardian.fullName}</Text>
                      <Text style={styles.guardianSummaryDetail}>NIC: {currentGuardian.nicNo} • Mobile: {currentGuardian.mobileNo}</Text>
                      {currentGuardian.relationship && (
                        <Text style={styles.guardianSummaryDetail}>Relationship: {currentGuardian.relationship}</Text>
                      )}
                    </View>
                  ) : (
                    <Text style={styles.stepItemDescription}>
                      Please register an emergency contact guardian to enable smooth seat reservations.
                    </Text>
                  )}

                  <View style={styles.stepButtonRow}>
                    {isGuardianCompleted && (
                      <TouchableOpacity
                        style={styles.stepViewButton}
                        onPress={() => setIsViewModalOpen(true)}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="eye-outline" size={18} color="#0066CC" style={{ marginRight: 4 }} />
                        <Text style={styles.stepViewButtonText}>View Details</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={[
                        styles.stepActionButton,
                        isGuardianCompleted ? styles.stepActionButtonSecondary : { flex: 1 },
                      ]}
                      onPress={openGuardianModal}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name={isGuardianCompleted ? 'create-outline' : 'person-add-outline'}
                        size={18}
                        color="#FFFFFF"
                        style={{ marginRight: 6 }}
                      />
                      <Text style={styles.stepActionButtonText}>
                        {isGuardianCompleted ? 'Edit Details' : 'Add Guardian Details'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Details Section */}
        <View style={styles.sectionCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Personal Information</Text>
            <TouchableOpacity
              onPress={openEditProfileModal}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#EFF6FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Edit Personal Profile Details"
            >
              <Ionicons name="create-outline" size={16} color="#0066CC" style={{ marginRight: 4 }} />
              <Text style={{ color: '#0066CC', fontSize: 13, fontWeight: '700' }}>Edit Details</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="mail-outline" size={20} color="#0066CC" />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoLabel}>Email Address</Text>
              <Text style={styles.infoValue}>{displayUser.email}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="card-outline" size={20} color="#0066CC" />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoLabel}>NIC Number</Text>
              <Text style={styles.infoValue}>{displayUser.nicNo || 'Not provided'}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="call-outline" size={20} color="#0066CC" />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoLabel}>Primary Phone Number</Text>
              <Text style={styles.infoValue}>{displayUser.phoneNumber || 'Not provided'}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="phone-portrait-outline" size={20} color="#0066CC" />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoLabel}>Secondary Phone Number</Text>
              <Text style={styles.infoValue}>{displayUser.secondaryPhoneNumber || 'Not provided'}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="calendar-outline" size={20} color="#0066CC" />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoLabel}>Calculated Age</Text>
              <Text style={styles.infoValue}>
                {age} years {isElderly ? '(Senior Citizen)' : age >= 18 ? '(Citizen)' : '(Minor)'}
              </Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.infoRow}>
            <View style={styles.iconCircle}>
              <Ionicons name="accessibility-outline" size={20} color="#0066CC" />
            </View>
            <View style={styles.infoTextContainer}>
              <Text style={styles.infoLabel}>Accessibility Profile</Text>
              <Text style={styles.infoValue}>
                {displayUser.accessibilityProfileId
                  ? `Active (${displayUser.accessibilityProfileId})`
                  : displayUser.hasAccessibilityNeeds
                  ? 'Active (Standard Support)'
                  : 'Not Required (Standard Transit)'}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick Settings & Actions */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Account Options</Text>

          <TouchableOpacity style={styles.actionRow} onPress={openEditProfileModal}>
            <Ionicons name="create-outline" size={22} color="#0066CC" />
            <Text style={styles.actionRowText}>Edit Personal Profile Details</Text>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.divider} />

          {(isElderly || hasAccessibility) && (
            <>
              <TouchableOpacity style={styles.actionRow} onPress={openAccModal}>
                <Ionicons name="body-outline" size={22} color="#7C3AED" />
                <Text style={[styles.actionRowText, { color: '#7C3AED', fontWeight: 'bold' }]}>
                  Manage Accessibility Profile
                </Text>
                <Ionicons name="chevron-forward" size={18} color="#7C3AED" />
              </TouchableOpacity>

              <View style={styles.divider} />
            </>
          )}

          <TouchableOpacity style={styles.actionRow} onPress={() => setIsViewModalOpen(true)}>
            <Ionicons name="eye-outline" size={22} color="#0066CC" />
            <Text style={styles.actionRowText}>View Guardian Details</Text>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.actionRow} onPress={() => router.push('/journey' as any)}>
            <Ionicons name="bus-outline" size={22} color="#475569" />
            <Text style={styles.actionRowText}>My Journeys & Bookings</Text>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.actionRow} onPress={() => router.push('/accessibility-reports')}>
            <Ionicons name="document-text-outline" size={22} color="#0066CC" />
            <Text style={styles.actionRowText}>Accessibility Reports</Text>
            <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={22} color="#EF4444" style={{ marginRight: 8 }} />
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ====================================================================== */}
      {/* MODAL: ADD / EDIT GUARDIAN DETAILS */}
      {/* ====================================================================== */}
      <Modal visible={isModalOpen} animationType="slide" transparent onRequestClose={() => setIsModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="shield-checkmark" size={24} color="#0066CC" style={{ marginRight: 8 }} />
                <Text style={styles.modalTitle}>Guardian Details</Text>
              </View>
              <TouchableOpacity onPress={() => setIsModalOpen(false)} style={styles.modalCloseButton}>
                <Ionicons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Please provide valid guardian details for emergency contact & booking requirements.
            </Text>

            {/* Guardian Name Input */}
            <View style={styles.modalInputGroup}>
              <Text style={styles.modalInputLabel}>Guardian Full Name *</Text>
              <View style={[styles.modalInputWrapper, formErrors.gName ? styles.modalInputError : null]}>
                <Ionicons name="person-outline" size={20} color="#0066CC" style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.modalTextInput}
                  placeholder="e.g. Sunethra Perera"
                  placeholderTextColor="#94A3B8"
                  value={gName}
                  onChangeText={setGName}
                />
              </View>
              {formErrors.gName && <Text style={styles.modalErrorText}>{formErrors.gName}</Text>}
            </View>

            {/* Guardian NIC Input */}
            <View style={styles.modalInputGroup}>
              <Text style={styles.modalInputLabel}>Guardian NIC Number *</Text>
              <View style={[styles.modalInputWrapper, formErrors.gNic ? styles.modalInputError : null]}>
                <Ionicons name="card-outline" size={20} color="#0066CC" style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.modalTextInput}
                  placeholder="197012345678 or 701234567V"
                  placeholderTextColor="#94A3B8"
                  value={gNic}
                  onChangeText={setGNic}
                />
              </View>
              {formErrors.gNic && <Text style={styles.modalErrorText}>{formErrors.gNic}</Text>}
            </View>

            {/* Guardian Mobile Input */}
            <View style={styles.modalInputGroup}>
              <Text style={styles.modalInputLabel}>Guardian Mobile Phone *</Text>
              <View style={[styles.modalInputWrapper, formErrors.gMobile ? styles.modalInputError : null]}>
                <Ionicons name="call-outline" size={20} color="#0066CC" style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.modalTextInput}
                  placeholder="e.g. 0771234567"
                  placeholderTextColor="#94A3B8"
                  keyboardType="phone-pad"
                  value={gMobile}
                  onChangeText={setGMobile}
                />
              </View>
              {formErrors.gMobile && <Text style={styles.modalErrorText}>{formErrors.gMobile}</Text>}
            </View>

            {/* Relationship Input */}
            <View style={styles.modalInputGroup}>
              <Text style={styles.modalInputLabel}>Relationship to Passenger</Text>
              <View style={styles.modalInputWrapper}>
                <Ionicons name="people-outline" size={20} color="#0066CC" style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.modalTextInput}
                  placeholder="e.g. Son, Daughter, Spouse, Relative"
                  placeholderTextColor="#94A3B8"
                  value={gRelationship}
                  onChangeText={setGRelationship}
                />
              </View>
            </View>

            {/* Modal Actions */}
            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setIsModalOpen(false)}
                disabled={isSaving}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveGuardian}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalSaveBtnText}>Save Guardian Details</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ====================================================================== */}
      {/* MODAL: VIEW GUARDIAN DETAILS */}
      {/* ====================================================================== */}
      <Modal visible={isViewModalOpen} animationType="fade" transparent onRequestClose={() => setIsViewModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.viewModalContent}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="shield-checkmark" size={24} color="#0066CC" style={{ marginRight: 8 }} />
                <Text style={styles.modalTitle}>Guardian Information</Text>
              </View>
              <TouchableOpacity onPress={() => setIsViewModalOpen(false)} style={styles.modalCloseButton}>
                <Ionicons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            {isGuardianCompleted && currentGuardian ? (
              <View style={{ marginTop: 12 }}>
                <View style={styles.viewBadgeCard}>
                  <Ionicons name="checkmark-circle" size={20} color="#10B981" style={{ marginRight: 8 }} />
                  <Text style={styles.viewBadgeText}>Verified Emergency Guardian</Text>
                </View>

                <View style={styles.viewDetailRow}>
                  <View style={styles.iconCircle}>
                    <Ionicons name="person-outline" size={20} color="#0066CC" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>Guardian Full Name</Text>
                    <Text style={styles.infoValue}>{currentGuardian.fullName}</Text>
                  </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.viewDetailRow}>
                  <View style={styles.iconCircle}>
                    <Ionicons name="card-outline" size={20} color="#0066CC" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>NIC Number</Text>
                    <Text style={styles.infoValue}>{currentGuardian.nicNo}</Text>
                  </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.viewDetailRow}>
                  <View style={styles.iconCircle}>
                    <Ionicons name="call-outline" size={20} color="#0066CC" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>Mobile Phone</Text>
                    <Text style={styles.infoValue}>{currentGuardian.mobileNo}</Text>
                  </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.viewDetailRow}>
                  <View style={styles.iconCircle}>
                    <Ionicons name="people-outline" size={20} color="#0066CC" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoLabel}>Relationship to Passenger</Text>
                    <Text style={styles.infoValue}>{currentGuardian.relationship || 'Son / Daughter'}</Text>
                  </View>
                </View>

                <View style={[styles.modalActionsRow, { marginTop: 20 }]}>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    onPress={() => setIsViewModalOpen(false)}
                  >
                    <Text style={styles.modalCancelBtnText}>Close</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.modalSaveBtn}
                    onPress={() => {
                      setIsViewModalOpen(false);
                      openGuardianModal();
                    }}
                  >
                    <Ionicons name="create-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.modalSaveBtnText}>Edit Details</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={{ marginTop: 12, alignItems: 'center', paddingVertical: 10 }}>
                <Ionicons name="alert-circle-outline" size={48} color="#F59E0B" style={{ marginBottom: 10 }} />
                <Text style={styles.noGuardianTitle}>No Guardian Registered</Text>
                <Text style={styles.noGuardianText}>
                  Passengers aged 60+ are required to register emergency guardian details before making bus seat reservations.
                </Text>

                <View style={[styles.modalActionsRow, { width: '100%', marginTop: 20 }]}>
                  <TouchableOpacity
                    style={styles.modalCancelBtn}
                    onPress={() => setIsViewModalOpen(false)}
                  >
                    <Text style={styles.modalCancelBtnText}>Close</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.modalSaveBtn}
                    onPress={() => {
                      setIsViewModalOpen(false);
                      openGuardianModal();
                    }}
                  >
                    <Ionicons name="person-add-outline" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                    <Text style={styles.modalSaveBtnText}>Add Guardian Now</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ====================================================================== */}
      {/* MODAL: MANAGE ACCESSIBILITY PROFILE */}
      {/* ====================================================================== */}
      <Modal visible={isAccModalOpen} animationType="slide" transparent onRequestClose={() => setIsAccModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="body" size={24} color="#7C3AED" style={{ marginRight: 8 }} />
                <Text style={styles.modalTitle}>Manage Accessibility Profile</Text>
              </View>
              <TouchableOpacity onPress={() => setIsAccModalOpen(false)} style={styles.modalCloseButton}>
                <Ionicons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Update your transit accessibility needs and accommodations. Profile ID: {displayUser.accessibilityProfileId || 'ACC-2026-00012'}
            </Text>

            {/* Wheelchair User Toggle Card */}
            <TouchableOpacity
              style={[
                styles.checkboxCardModal,
                accWheelchair && styles.checkboxCardModalSelected
              ]}
              onPress={() => setAccWheelchair(!accWheelchair)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accWheelchair }}
            >
              <Ionicons
                name={accWheelchair ? "checkbox" : "square-outline"}
                size={24}
                color={accWheelchair ? "#7C3AED" : "#94A3B8"}
                style={{ marginRight: 10 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.checkboxTitleModal}>♿ Wheelchair User</Text>
                <Text style={styles.checkboxSubtextModal}>Requires ramp access, low-floor vehicle, and priority space.</Text>
              </View>
            </TouchableOpacity>

            {/* Low Vision Toggle Card */}
            <TouchableOpacity
              style={[
                styles.checkboxCardModal,
                accLowVision && styles.checkboxCardModalSelected
              ]}
              onPress={() => setAccLowVision(!accLowVision)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accLowVision }}
            >
              <Ionicons
                name={accLowVision ? "checkbox" : "square-outline"}
                size={24}
                color={accLowVision ? "#D97706" : "#94A3B8"}
                style={{ marginRight: 10 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.checkboxTitleModal}>👁️ Low Vision Person</Text>
                <Text style={styles.checkboxSubtextModal}>Requires audio route announcements and high contrast support.</Text>
              </View>
            </TouchableOpacity>

            {/* Hearing Impaired Toggle Card */}
            <TouchableOpacity
              style={[
                styles.checkboxCardModal,
                accHearing && styles.checkboxCardModalSelected
              ]}
              onPress={() => setAccHearing(!accHearing)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: accHearing }}
            >
              <Ionicons
                name={accHearing ? "checkbox" : "square-outline"}
                size={24}
                color={accHearing ? "#2563EB" : "#94A3B8"}
                style={{ marginRight: 10 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.checkboxTitleModal}>👂 Hearing Impairment Person</Text>
                <Text style={styles.checkboxSubtextModal}>Requires visual screen displays and text notifications.</Text>
              </View>
            </TouchableOpacity>

            {/* Modal Actions */}
            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setIsAccModalOpen(false)}
                disabled={isSavingAcc}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalSaveBtn, { backgroundColor: '#7C3AED' }]}
                onPress={handleSaveAccessibilityProfile}
                disabled={isSavingAcc}
              >
                {isSavingAcc ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalSaveBtnText}>Save Preferences</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ====================================================================== */}
      {/* MODAL: EDIT PERSONAL PROFILE DETAILS */}
      {/* ====================================================================== */}
      <Modal visible={isEditProfileModalOpen} animationType="slide" transparent onRequestClose={() => setIsEditProfileModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} showsVerticalScrollIndicator={false}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="create-outline" size={24} color="#0066CC" style={{ marginRight: 8 }} />
                  <Text style={styles.modalTitle}>Edit Profile Details</Text>
                </View>
                <TouchableOpacity onPress={() => setIsEditProfileModalOpen(false)} style={styles.modalCloseButton}>
                  <Ionicons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalSubtitle}>
                Update your personal info, contact numbers, and identification details.
              </Text>

              {/* Full Name Input */}
              <View style={styles.modalInputGroup}>
                <Text style={styles.modalInputLabel}>Full Name *</Text>
                <View style={[styles.modalInputWrapper, editFormErrors.editUserName ? styles.modalInputError : null]}>
                  <Ionicons name="person-outline" size={20} color="#0066CC" style={{ marginRight: 8 }} />
                  <TextInput
                    style={styles.modalTextInput}
                    placeholder="e.g. Sunil Perera"
                    placeholderTextColor="#94A3B8"
                    value={editUserName}
                    onChangeText={setEditUserName}
                  />
                </View>
                {editFormErrors.editUserName && <Text style={styles.modalErrorText}>{editFormErrors.editUserName}</Text>}
              </View>

              {/* Email Input */}
              <View style={styles.modalInputGroup}>
                <Text style={styles.modalInputLabel}>Email Address *</Text>
                <View style={[styles.modalInputWrapper, editFormErrors.editEmail ? styles.modalInputError : null]}>
                  <Ionicons name="mail-outline" size={20} color="#0066CC" style={{ marginRight: 8 }} />
                  <TextInput
                    style={styles.modalTextInput}
                    placeholder="e.g. sunil.p@example.com"
                    placeholderTextColor="#94A3B8"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={editEmail}
                    onChangeText={setEditEmail}
                  />
                </View>
                {editFormErrors.editEmail && <Text style={styles.modalErrorText}>{editFormErrors.editEmail}</Text>}
              </View>

              {/* NIC Input */}
              <View style={styles.modalInputGroup}>
                <Text style={styles.modalInputLabel}>NIC Number *</Text>
                <View style={[styles.modalInputWrapper, editFormErrors.editNic ? styles.modalInputError : null]}>
                  <Ionicons name="card-outline" size={20} color="#0066CC" style={{ marginRight: 8 }} />
                  <TextInput
                    style={styles.modalTextInput}
                    placeholder="197512345678 or 751234567V"
                    placeholderTextColor="#94A3B8"
                    value={editNic}
                    onChangeText={setEditNic}
                  />
                </View>
                {editFormErrors.editNic && <Text style={styles.modalErrorText}>{editFormErrors.editNic}</Text>}
              </View>

              {/* Primary Phone Input */}
              <View style={styles.modalInputGroup}>
                <Text style={styles.modalInputLabel}>Primary Mobile Phone *</Text>
                <View style={[styles.modalInputWrapper, editFormErrors.editPhone ? styles.modalInputError : null]}>
                  <Ionicons name="call-outline" size={20} color="#0066CC" style={{ marginRight: 8 }} />
                  <TextInput
                    style={styles.modalTextInput}
                    placeholder="e.g. 0771234567"
                    placeholderTextColor="#94A3B8"
                    keyboardType="phone-pad"
                    value={editPhone}
                    onChangeText={setEditPhone}
                  />
                </View>
                {editFormErrors.editPhone && <Text style={styles.modalErrorText}>{editFormErrors.editPhone}</Text>}
              </View>

              {/* Secondary Phone Input */}
              <View style={styles.modalInputGroup}>
                <Text style={styles.modalInputLabel}>Secondary Mobile Phone (Optional)</Text>
                <View style={[styles.modalInputWrapper, editFormErrors.editSecondaryPhone ? styles.modalInputError : null]}>
                  <Ionicons name="phone-portrait-outline" size={20} color="#0066CC" style={{ marginRight: 8 }} />
                  <TextInput
                    style={styles.modalTextInput}
                    placeholder="e.g. 0719876543"
                    placeholderTextColor="#94A3B8"
                    keyboardType="phone-pad"
                    value={editSecondaryPhone}
                    onChangeText={setEditSecondaryPhone}
                  />
                </View>
                {editFormErrors.editSecondaryPhone && <Text style={styles.modalErrorText}>{editFormErrors.editSecondaryPhone}</Text>}
              </View>

              {/* Modal Actions */}
              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setIsEditProfileModalOpen(false)}
                  disabled={isSavingProfile}
                >
                  <Text style={styles.modalCancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalSaveBtn}
                  onPress={handleSaveProfileDetails}
                  disabled={isSavingProfile}
                >
                  {isSavingProfile ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.modalSaveBtnText}>Save Details</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  demoAgeBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  demoAgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284C7',
  },
  profileHeaderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    elevation: 3,
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 14,
  },
  avatarCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#0066CC',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#E0F2FE',
  },
  avatarInitials: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  userName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  passengerIdText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0066CC',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  tagContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  roleTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  passengerTag: {
    backgroundColor: '#2563EB',
  },
  adminTag: {
    backgroundColor: '#DC2626',
  },
  elderTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#8B5CF6',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  roleTagText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  /* Steps Section Styling */
  stepsCardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#3B82F6',
    elevation: 4,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  stepsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  stepsTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  stepsSubtitle: {
    fontSize: 13,
    color: '#475569',
    marginTop: 2,
  },
  progressCircleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRingOuter: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 5,
    borderColor: '#F59E0B',
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressRingOuterDone: {
    borderColor: '#10B981',
    backgroundColor: '#D1FAE5',
  },
  progressRingInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressRingInnerDone: {
    backgroundColor: '#ECFDF5',
  },
  progressText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#D97706',
  },
  progressTextDone: {
    color: '#059669',
  },

  /* Warning Banner */
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderWidth: 1.5,
    borderColor: '#FCD34D',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#B45309',
    marginBottom: 2,
  },
  warningText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
    lineHeight: 18,
  },

  /* Success Banner */
  successBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#ECFDF5',
    borderWidth: 1.5,
    borderColor: '#6EE7B7',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  successBannerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#047857',
    marginBottom: 2,
  },
  successBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#065F46',
    lineHeight: 18,
  },

  /* Step Item Card */
  stepItemCard: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stepIconColumn: {
    marginRight: 12,
  },
  stepCircleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  stepPendingCircle: {
    backgroundColor: '#F59E0B',
  },
  stepDoneCircle: {
    backgroundColor: '#10B981',
  },
  stepInfoColumn: {
    flex: 1,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  stepItemTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  statusBadgePending: {
    backgroundColor: '#FEF3C7',
  },
  statusBadgeDone: {
    backgroundColor: '#D1FAE5',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextPending: {
    color: '#B45309',
  },
  statusTextDone: {
    color: '#047857',
  },
  stepItemDescription: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 12,
    lineHeight: 18,
  },
  guardianSummaryBox: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 10,
    marginVertical: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#2563EB',
  },
  guardianSummaryName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E3A8A',
  },
  guardianSummaryDetail: {
    fontSize: 12,
    color: '#3B82F6',
    marginTop: 2,
  },
  stepActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0066CC',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 6,
  },
  stepActionButtonSecondary: {
    backgroundColor: '#0284C7',
  },
  stepActionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  /* Standard Section Styling */
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 14,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  infoTextContainer: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  actionRowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#1E293B',
    marginLeft: 12,
  },
  logoutButton: {
    flexDirection: 'row',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 16,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  logoutButtonText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '700',
  },

  /* Modal Styling */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 20,
  },
  modalInputGroup: {
    marginBottom: 16,
  },
  modalInputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  modalInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
  },
  modalInputError: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  modalTextInput: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
  },
  modalErrorText: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: 4,
    fontWeight: '600',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  modalCancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '700',
  },
  modalSaveBtn: {
    flex: 2,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#0066CC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSaveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  /* View Modal & Step Buttons Styling */
  stepButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  stepViewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  stepViewButtonText: {
    color: '#0066CC',
    fontSize: 14,
    fontWeight: '700',
  },
  viewModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    marginHorizontal: 16,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  viewBadgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 16,
  },
  viewBadgeText: {
    color: '#047857',
    fontSize: 13,
    fontWeight: '700',
  },
  viewDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  noGuardianTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 6,
  },
  noGuardianText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 12,
  },
  checkboxCardModal: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  checkboxCardModalSelected: {
    borderColor: '#7C3AED',
    backgroundColor: '#F5F3FF',
  },
  checkboxTitleModal: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 2,
  },
  checkboxSubtextModal: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
});
