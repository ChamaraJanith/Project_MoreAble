// User & Guardian Entity Models and Types

export type UserRole = 'PASSENGER' | 'GUARDIAN' | 'ADMIN';

export interface Guardian {
  guardianId: string;
  userId: string;
  fullName: string;
  email: string;
  mobileNo: string;
  nicNo: string;
  relationship?: string;
  createdAt: string;
}

export interface User {
  uid: string;
  passengerId: string; // Auto-generated ID (e.g., PA-2026-1024)
  userName: string;
  email: string;
  nicNo: string;
  calculatedAge: number;
  isElderPerson: boolean;
  role: UserRole;
  phoneNumber?: string;
  secondaryPhoneNumber?: string | null;
  isVerified: boolean;
  guardianId?: string | null;
  accessibilityProfileId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The safe projection of a user document returned by the admin retrieval API.
 *
 * Built with an allow-list, so security-sensitive fields stored alongside the
 * user (passwordHash today, anything added later) can never leak into an API
 * response. The stored document itself is never modified.
 */
export interface AdminUserSummary {
  documentId: string;
  passengerId: string;
  userName: string;
  email: string;
  phoneNumber: string | null;
  secondaryPhoneNumber: string | null;
  nicNo: string;
  calculatedAge: number | null;
  isElderPerson: boolean;
  isVerified: boolean;
  role: UserRole;
  guardianId: string | null;
  accessibilityProfileId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UserRegistrationDTO {
  userName: string;
  email: string;
  password?: string;
  nicNo: string;
  phoneNumber?: string;
  secondaryPhoneNumber?: string | null;
  isElderPerson?: boolean;
  guardianDetails?: {
    fullName: string;
    email: string;
    mobileNo: string;
    nicNo: string;
    relationship?: string;
  };
}