import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
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
import { API_BASE_URL } from '../../src/shared/api/config';
import { useAuthStore } from '../../src/shared/store/authStore';

type IssueCategory =
  | 'BROKEN_RAMP'
  | 'LIFT_NOT_WORKING'
  | 'PRIORITY_SEAT_MISUSE'
  | 'BUS_OVERCROWDED'
  | 'DRIVER_DID_NOT_ASSIST'
  | 'AUDIO_ANNOUNCEMENT_NOT_WORKING';

interface CategoryOption {
  value: IssueCategory;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const CATEGORY_OPTIONS: CategoryOption[] = [
  { value: 'BROKEN_RAMP', label: 'Broken Wheelchair Ramp', icon: 'construct-outline' },
  { value: 'LIFT_NOT_WORKING', label: 'Accessibility Lift Not Working', icon: 'arrow-up-circle-outline' },
  { value: 'PRIORITY_SEAT_MISUSE', label: 'Priority Seat Misuse', icon: 'person-remove-outline' },
  { value: 'BUS_OVERCROWDED', label: 'Bus Overcrowded', icon: 'people-outline' },
  { value: 'DRIVER_DID_NOT_ASSIST', label: 'Driver Did Not Provide Assistance', icon: 'warning-outline' },
  { value: 'AUDIO_ANNOUNCEMENT_NOT_WORKING', label: 'Audio Announcement Not Working', icon: 'volume-mute-outline' },
];

export default function ReportAccessibilityIssueScreen() {
  const { token, isAuthenticated } = useAuthStore();
  const [issueCategory, setIssueCategory] = useState<IssueCategory | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCategoryOption = CATEGORY_OPTIONS.find((opt) => opt.value === issueCategory);

  const handleSubmit = async () => {
    setError(null);

    if (!isAuthenticated || !token) {
      setError('Authentication required. Please log in again.');
      return;
    }

    if (!issueCategory) {
      setError('Please select an issue category.');
      return;
    }

    const trimmedDescription = description.trim();
    if (!trimmedDescription) {
      setError('Please provide a description of the issue.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          issueCategory,
          description: trimmedDescription,
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        Alert.alert(
          'Report Submitted',
          `Your accessibility report has been submitted successfully.\n\nReport ID: ${result.report?.reportId || 'N/A'}`,
          [{ text: 'Done', onPress: () => router.back() }]
        );
      } else {
        if (response.status === 401) {
          setError('Authentication required. Please log in again.');
        } else if (response.status === 403) {
          setError('Only passengers can submit accessibility reports.');
        } else if (response.status === 400) {
          setError(result.message || 'Invalid request. Please check your inputs.');
        } else {
          setError('Unable to submit the report right now. Please try again.');
        }
      }
    } catch (err) {
      console.error('Report Submission Error:', err);
      setError('Unable to connect to the server. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.headerBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go Back"
          >
            <Ionicons name="arrow-back" size={24} color="#1E293B" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Report Issue</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          <View style={styles.introCard}>
            <Ionicons name="information-circle" size={28} color="#0066CC" style={{ marginBottom: 8 }} />
            <Text style={styles.introText}>
              Help us improve accessibility by reporting issues you experience during your journey.
            </Text>
          </View>

          <View style={styles.formCard}>
            {error && (
              <View style={styles.errorContainer} accessibilityRole="alert">
                <Ionicons name="alert-circle" size={20} color="#DC2626" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Issue Category *</Text>
              <TouchableOpacity
                style={styles.selectorButton}
                onPress={() => setIsCategoryModalOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Select Issue Category"
              >
                {selectedCategoryOption ? (
                  <View style={styles.selectorContent}>
                    <Ionicons name={selectedCategoryOption.icon} size={20} color="#0066CC" />
                    <Text style={styles.selectorTextSelected}>{selectedCategoryOption.label}</Text>
                  </View>
                ) : (
                  <Text style={styles.selectorTextPlaceholder}>Select a category</Text>
                )}
                <Ionicons name="chevron-down" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Describe the Issue *</Text>
              <TextInput
                style={styles.textArea}
                placeholder="Please describe what happened and where the accessibility problem occurred."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={4}
                value={description}
                onChangeText={setDescription}
                textAlignVertical="top"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitButton, (!issueCategory || !description.trim() || isSubmitting) && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={!issueCategory || !description.trim() || isSubmitting}
              accessibilityRole="button"
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Ionicons name="paper-plane-outline" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.submitButtonText}>Submit Report</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={isCategoryModalOpen} animationType="slide" transparent onRequestClose={() => setIsCategoryModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Select Category</Text>
              <TouchableOpacity onPress={() => setIsCategoryModalOpen(false)} style={styles.modalCloseButton} accessibilityRole="button" accessibilityLabel="Close Modal">
                <Ionicons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {CATEGORY_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.categoryOption, issueCategory === opt.value && styles.categoryOptionSelected]}
                  onPress={() => {
                    setIssueCategory(opt.value);
                    setIsCategoryModalOpen(false);
                  }}
                  accessibilityRole="button"
                >
                  <View style={styles.categoryOptionContent}>
                    <View style={[styles.categoryIconCircle, issueCategory === opt.value && styles.categoryIconCircleSelected]}>
                      <Ionicons name={opt.icon} size={20} color={issueCategory === opt.value ? '#FFFFFF' : '#0066CC'} />
                    </View>
                    <Text style={[styles.categoryOptionText, issueCategory === opt.value && styles.categoryOptionTextSelected]}>
                      {opt.label}
                    </Text>
                  </View>
                  {issueCategory === opt.value && (
                    <Ionicons name="checkmark-circle" size={24} color="#0066CC" />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#F8FAFC',
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
  introCard: {
    backgroundColor: '#E0F2FE',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  introText: {
    fontSize: 16,
    color: '#0369A1',
    lineHeight: 24,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    elevation: 3,
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  errorText: {
    color: '#DC2626',
    marginLeft: 8,
    fontSize: 14,
    flex: 1,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
  },
  selectorButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 56,
  },
  selectorContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectorTextSelected: {
    fontSize: 16,
    color: '#0F172A',
    marginLeft: 10,
  },
  selectorTextPlaceholder: {
    fontSize: 16,
    color: '#94A3B8',
  },
  textArea: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#0F172A',
    minHeight: 120,
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: '#0066CC',
    borderRadius: 12,
    paddingVertical: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalCloseButton: {
    padding: 4,
  },
  categoryOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  categoryOptionSelected: {
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    borderBottomWidth: 0,
    marginBottom: 4,
  },
  categoryOptionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  categoryIconCircleSelected: {
    backgroundColor: '#0066CC',
  },
  categoryOptionText: {
    fontSize: 16,
    color: '#334155',
    flex: 1,
  },
  categoryOptionTextSelected: {
    color: '#0066CC',
    fontWeight: '600',
  },
});
