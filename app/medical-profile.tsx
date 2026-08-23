import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TextInput, 
  TouchableOpacity, 
  Alert,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../src/shared/store/authStore';

export default function MedicalProfileScreen() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [bloodType, setBloodType] = useState('');
  const [allergies, setAllergies] = useState('');
  const [currentMedications, setCurrentMedications] = useState('');
  const [chronicConditions, setChronicConditions] = useState('');
  const [emergencyNotes, setEmergencyNotes] = useState('');
  
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = () => {
    setIsSaving(true);
    // TODO: MOV-257 Hook up API save call here
    setTimeout(() => {
      setIsSaving(false);
      Alert.alert(
        "Medical Information Saved",
        "Your optional medical details have been updated successfully.",
        [{ text: "OK", onPress: () => router.back() }]
      );
    }, 1000);
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Medical Information</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle" size={24} color="#0284C7" style={{ marginRight: 10 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoBannerText}>
              All fields are <Text style={{ fontWeight: 'bold' }}>optional</Text>. This information is securely stored and will only be used by authorized personnel during transit emergencies.
            </Text>
          </View>
        </View>

        {/* Form Fields */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Blood Type (Optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. O+, A-, AB+"
            placeholderTextColor="#94A3B8"
            value={bloodType}
            onChangeText={setBloodType}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Allergies (Optional)</Text>
          <TextInput
            style={styles.textArea}
            placeholder="e.g. Penicillin, Peanuts"
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            value={allergies}
            onChangeText={setAllergies}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Current Medications (Optional)</Text>
          <TextInput
            style={styles.textArea}
            placeholder="List any medications you are taking"
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            value={currentMedications}
            onChangeText={setCurrentMedications}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Chronic Conditions (Optional)</Text>
          <TextInput
            style={styles.textArea}
            placeholder="e.g. Asthma, Diabetes, Heart Condition"
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            value={chronicConditions}
            onChangeText={setChronicConditions}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.label}>Emergency Notes (Optional)</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Any specific instructions for emergency responders"
            placeholderTextColor="#94A3B8"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            value={emergencyNotes}
            onChangeText={setEmergencyNotes}
          />
        </View>
        
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Bottom Save Button */}
      <View style={styles.bottomBar}>
        <TouchableOpacity 
          style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]} 
          onPress={handleSave}
          disabled={isSaving}
        >
          <Text style={styles.saveBtnText}>
            {isSaving ? 'Saving...' : 'Save Medical Information'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  scrollContent: {
    padding: 20,
  },
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: '#F0F9FF',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    marginBottom: 24,
  },
  infoBannerText: {
    fontSize: 14,
    color: '#0369A1',
    lineHeight: 20,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0F172A',
  },
  textArea: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: '#0F172A',
    minHeight: 100,
  },
  bottomBar: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  saveBtn: {
    backgroundColor: '#E11D48',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: '#FDA4AF',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
