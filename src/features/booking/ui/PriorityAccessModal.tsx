import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

interface Props {
    visible: boolean;
    onCancel: () => void;
    onConfirm: (reason: string) => void;
}

const REASON_MIN_LENGTH = 5;

export function PriorityAccessModal({ visible, onCancel, onConfirm }: Props) {
    const [reason, setReason] = useState('');
    const isValid = reason.trim().length >= REASON_MIN_LENGTH;

    function handleConfirm() {
        if (!isValid) return;

        onConfirm(reason.trim());
        setReason('');
    }

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onCancel}
        >
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.backdrop}
            >
                <View style={styles.card}>
                    <View style={styles.iconCircle}>
                        <Ionicons
                            name="accessibility"
                            size={26}
                            color="#0066CC"
                        />
                    </View>

                    <Text style={styles.title}>
                        Request Priority Seating
                    </Text>

                    <Text style={styles.description}>
                        Priority seats are reserved for passengers with accessibility needs. Please briefly tell
                        us why you need this seat — this helps us keep priority seating available for those who
                        need it most.
                    </Text>

                    <TextInput
                        style={styles.input}
                        placeholder="e.g. I have a mobility impairment / I am pregnant / temporary injury"
                        placeholderTextColor="#94A3B8"
                        value={reason}
                        onChangeText={setReason}
                        multiline
                        accessibilityLabel="Reason for requesting a priority seat"
                    />

                    {!isValid && reason.length > 0 && (
                        <Text style={styles.hint}>
                            Please provide a few more details ({REASON_MIN_LENGTH}+ characters).
                        </Text>
                    )}

                    <TouchableOpacity
                        style={[
                            styles.confirmButton,
                            !isValid && styles.confirmButtonDisabled
                        ]}
                        onPress={handleConfirm}
                        disabled={!isValid}
                        accessibilityRole="button"
                        accessibilityLabel="Confirm priority seat request"
                        accessibilityState={{ disabled: !isValid }}
                    >
                        <Text style={styles.confirmButtonText}>
                            REQUEST THIS SEAT
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.cancelButton}
                        onPress={onCancel}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                    >
                        <Text style={styles.cancelButtonText}>
                            Choose a different seat
                        </Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.5)',
        justifyContent: 'center',
        paddingHorizontal: 24
    },

    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 24,
        alignItems: 'center'
    },

    iconCircle: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#EBF3FA',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 14
    },

    title: {
        fontSize: 18,
        fontWeight: '800',
        color: '#0F172A',
        textAlign: 'center',
        marginBottom: 8
    },

    description: {
        fontSize: 13,
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 19,
        marginBottom: 16
    },

    input: {
        alignSelf: 'stretch',
        minHeight: 80,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 12,
        padding: 12,
        fontSize: 14,
        color: '#0F172A',
        textAlignVertical: 'top',
        backgroundColor: '#F8FAFC'
    },

    hint: {
        alignSelf: 'flex-start',
        fontSize: 11,
        color: '#D97706',
        marginTop: 6
    },

    confirmButton: {
        alignSelf: 'stretch',
        backgroundColor: '#0066CC',
        minHeight: 50,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 18
    },

    confirmButtonDisabled: {
        backgroundColor: '#94A3B8'
    },

    confirmButtonText: {
        color: '#FFFFFF',
        fontWeight: '800',
        fontSize: 14,
        letterSpacing: 0.5
    },

    cancelButton: {
        marginTop: 10,
        minHeight: 40,
        justifyContent: 'center'
    },

    cancelButtonText: {
        color: '#64748B',
        fontWeight: '600',
        fontSize: 13
    }
});