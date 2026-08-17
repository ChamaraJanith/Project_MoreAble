import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { API_BASE_URL } from '../src/shared/api/config';
import { useAuthStore } from '../src/shared/store/authStore';

type IssueCategory =
  | 'BROKEN_RAMP'
  | 'LIFT_NOT_WORKING'
  | 'PRIORITY_SEAT_MISUSE'
  | 'BUS_OVERCROWDED'
  | 'DRIVER_DID_NOT_ASSIST'
  | 'AUDIO_ANNOUNCEMENT_NOT_WORKING';

type ReportScope = 'all' | 'my' | 'verified';

interface Report {
  reportId: string;
  passengerId: string;
  issueCategory: IssueCategory;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_LABELS: Record<IssueCategory, string> = {
  BROKEN_RAMP: 'Broken Wheelchair Ramp',
  LIFT_NOT_WORKING: 'Lift Not Working',
  PRIORITY_SEAT_MISUSE: 'Priority Seat Misuse',
  BUS_OVERCROWDED: 'Bus Overcrowded',
  DRIVER_DID_NOT_ASSIST: "Driver Didn't Assist",
  AUDIO_ANNOUNCEMENT_NOT_WORKING: 'Audio Announcement Not Working',
};

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  PENDING: { bg: '#FEF3C7', text: '#D97706' },
  REVIEWED: { bg: '#E0F2FE', text: '#0284C7' },
  RESOLVED: { bg: '#D1FAE5', text: '#059669' },
  REJECTED: { bg: '#FEE2E2', text: '#DC2626' },
  VERIFIED: { bg: '#E0E7FF', text: '#4338CA' },
};

const SCOPE_FILTERS: { value: ReportScope; label: string }[] = [
  { value: 'all', label: 'All Reports' },
  { value: 'my', label: 'My Reports' },
  { value: 'verified', label: 'Verified Reports' },
];

export default function AccessibilityReportsScreen() {
  const { token, isAuthenticated } = useAuthStore();
  const [reports, setReports] = useState<Report[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<ReportScope>('all');

  const fetchReports = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setError('Authentication required.');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/reports?scope=${scope}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await response.json().catch(() => ({}));

      if (response.ok && result.success) {
        setReports(result.reports || []);
      } else {
        setError(result.message || 'Failed to retrieve accessibility reports.');
      }
    } catch (err) {
      console.error('Fetch Reports Error:', err);
      setError('Failed to retrieve accessibility reports.');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, token, scope]);

  useFocusEffect(
    useCallback(() => {
      fetchReports();
    }, [fetchReports])
  );

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const renderEmptyState = () => {
    if (scope === 'all') {
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="documents-outline" size={48} color="#94A3B8" style={{ marginBottom: 16 }} />
          <Text style={styles.emptyText}>No accessibility reports available.</Text>
        </View>
      );
    } else if (scope === 'my') {
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="documents-outline" size={48} color="#94A3B8" style={{ marginBottom: 16 }} />
          <Text style={styles.emptyText}>You haven't submitted any accessibility reports yet.</Text>
        </View>
      );
    } else {
      return (
        <View style={styles.centerContainer}>
          <Ionicons name="checkmark-circle-outline" size={48} color="#94A3B8" style={{ marginBottom: 16 }} />
          <Text style={styles.emptyText}>No verified accessibility reports yet.</Text>
        </View>
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go Back"
        >
          <Ionicons name="arrow-back" size={24} color="#1E293B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Accessibility Reports</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => router.push('/reports')}
          accessibilityRole="button"
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle-outline" size={24} color="#FFFFFF" style={{ marginRight: 8 }} />
          <Text style={styles.createButtonText}>Report Accessibility Issue</Text>
        </TouchableOpacity>

        {/* Status filter */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {SCOPE_FILTERS.map((filter) => {
            const isSelected = scope === filter.value;

            return (
              <TouchableOpacity
                key={filter.value}
                style={[styles.filterChip, isSelected && styles.filterChipSelected]}
                onPress={() => setScope(filter.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`View ${filter.label}`}
              >
                <Text style={[styles.filterChipText, isSelected && styles.filterChipTextSelected]}>
                  {filter.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color="#0066CC" />
            <Text style={styles.loadingText}>Loading reports...</Text>
          </View>
        ) : error ? (
          <View style={styles.centerContainer}>
            <Ionicons name="alert-circle-outline" size={48} color="#DC2626" style={{ marginBottom: 16 }} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={fetchReports}>
              <Text style={styles.retryButtonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : reports.length === 0 ? (
          renderEmptyState()
        ) : (
          reports.map((report) => (
            <View key={report.reportId} style={styles.reportCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.categoryTitle}>{CATEGORY_LABELS[report.issueCategory] || report.issueCategory}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: STATUS_COLORS[report.status]?.bg || '#F1F5F9' },
                  ]}
                >
                  <Text style={[styles.statusText, { color: STATUS_COLORS[report.status]?.text || '#64748B' }]}>
                    {report.status}
                  </Text>
                </View>
              </View>

              <Text style={styles.reportId}>{report.reportId}</Text>
              
              <Text style={styles.descriptionText}>{report.description}</Text>

              <View style={styles.cardFooter}>
                <Ionicons name="calendar-outline" size={16} color="#64748B" style={{ marginRight: 6 }} />
                <Text style={styles.dateText}>Submitted: {formatDate(report.createdAt)}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
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
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0066CC',
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 24,
    elevation: 2,
    shadowColor: '#0066CC',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  filterRow: {
    gap: 8,
    paddingBottom: 16,
    marginBottom: 8,
  },
  filterChip: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  filterChipSelected: {
    backgroundColor: '#0066CC',
    borderColor: '#0066CC',
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  filterChipTextSelected: {
    color: '#FFFFFF',
  },
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#64748B',
  },
  errorText: {
    fontSize: 16,
    color: '#334155',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
    marginRight: 12,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  reportId: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 12,
  },
  descriptionText: {
    fontSize: 15,
    color: '#334155',
    lineHeight: 22,
    marginBottom: 16,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  dateText: {
    fontSize: 14,
    color: '#64748B',
  },
});
