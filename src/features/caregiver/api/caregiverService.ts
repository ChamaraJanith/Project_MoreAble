/**
 * Caregiver Feature Client Service (MOV-227 / MOV-228 / MOV-229 / MOV-230)
 *
 * Provides typed frontend API methods to interact with backend caregiver endpoints.
 */

import {
  CaregiverAlertPayload,
  CaregiverLink,
  CaregiverLiveTrackingData,
  CaregiverPermissions,
  CaregiverSafetyLog,
} from '../../../entities/caregiver/model/types';
import { API_BASE_URL } from '../../../shared/api/config';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
};

export async function fetchPassengerCaregivers(passengerId: string): Promise<CaregiverLink[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/caregiver/link?passengerId=${encodeURIComponent(passengerId)}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch caregivers (Status ${res.status})`);
    }
    const data = await res.json();
    return data.caregivers || [];
  } catch (error) {
    console.error('fetchPassengerCaregivers error:', error);
    return [];
  }
}

export interface LinkCaregiverInput {
  passengerId: string;
  fullName: string;
  mobileNo: string;
  email: string;
  nicNo?: string;
  relationship?: string;
  notes?: string;
  permissions?: CaregiverPermissions;
}

export async function linkNewCaregiver(input: LinkCaregiverInput): Promise<{ success: boolean; link?: CaregiverLink; message?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/caregiver/link`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(input),
    });
    const data = await res.json();
    return {
      success: res.ok && data.success,
      link: data.link,
      message: data.message,
    };
  } catch (error: any) {
    console.error('linkNewCaregiver error:', error);
    return { success: false, message: error.message || 'Network error occurred.' };
  }
}

export async function removeCaregiverLink(linkId: string, passengerId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${API_BASE_URL}/api/caregiver/link?linkId=${encodeURIComponent(linkId)}&passengerId=${encodeURIComponent(passengerId)}`,
      { method: 'DELETE' }
    );
    const data = await res.json();
    return res.ok && data.success;
  } catch (error) {
    console.error('removeCaregiverLink error:', error);
    return false;
  }
}

export async function updateCaregiverPermissions(
  linkId: string,
  passengerId: string,
  permissions: Partial<CaregiverPermissions>
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/caregiver/permissions`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ linkId, passengerId, permissions }),
    });
    const data = await res.json();
    return res.ok && data.success;
  } catch (error) {
    console.error('updateCaregiverPermissions error:', error);
    return false;
  }
}

export async function setMasterSharingStatus(passengerId: string, masterSharingActive: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/caregiver/permissions`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ passengerId, masterSharingActive }),
    });
    const data = await res.json();
    return res.ok && data.success;
  } catch (error) {
    console.error('setMasterSharingStatus error:', error);
    return false;
  }
}

export async function fetchLiveTrackingByToken(token: string): Promise<CaregiverLiveTrackingData | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/caregiver/track?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      throw new Error(`Failed to load tracking data (Status ${res.status})`);
    }
    const data = await res.json();
    return data.tracking || null;
  } catch (error) {
    console.error('fetchLiveTrackingByToken error:', error);
    return null;
  }
}

export async function triggerEmergencySosBeacon(payload: Partial<CaregiverAlertPayload>): Promise<{ success: boolean; message?: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/caregiver/sos-alert`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return {
      success: res.ok && data.success,
      message: data.message,
    };
  } catch (error: any) {
    console.error('triggerEmergencySosBeacon error:', error);
    return { success: false, message: error.message };
  }
}

export async function fetchCaregiverSafetyLogs(passengerId: string): Promise<CaregiverSafetyLog[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/caregiver/logs?passengerId=${encodeURIComponent(passengerId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.logs || [];
  } catch (error) {
    console.error('fetchCaregiverSafetyLogs error:', error);
    return [];
  }
}
