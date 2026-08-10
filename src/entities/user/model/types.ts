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
  isVerified: boolean;
  guardianId?: string | null;
  accessibilityProfileId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRegistrationDTO {
  userName: string;
  email: string;
  password?: string;
  nicNo: string;
  phoneNumber?: string;
  isElderPerson?: boolean;
  guardianDetails?: {
    fullName: string;
    email: string;
    mobileNo: string;
    nicNo: string;
    relationship?: string;
  };
}
