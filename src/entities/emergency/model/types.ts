/**
 * Emergency Request Entity Models and Types (MOV-236 / MOV-24)
 *
 * "As an admin, I want to manage emergency requests so that I can coordinate support."
 *
 * Acceptance Criteria:
 * - Admin should view active emergency requests.
 *   Information displayed: Passenger details, Location, Vehicle, Emergency time.
 * - Admin can update status: Pending -> Assigned -> Resolved.
 * - System records status history.
 */

export const EMERGENCY_STATUSES = ['PENDING', 'ASSIGNED', 'RESOLVED'] as const;

export type EmergencyStatus = (typeof EMERGENCY_STATUSES)[number];

export const EMERGENCY_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type EmergencyPriority = (typeof EMERGENCY_PRIORITIES)[number];

export function isEmergencyStatus(value: unknown): value is EmergencyStatus {
    if (typeof value !== 'string') return false;
    const upper = value.toUpperCase();
    return (EMERGENCY_STATUSES as readonly string[]).includes(upper);
}

export function normalizeEmergencyStatus(value: unknown): EmergencyStatus | null {
    if (typeof value !== 'string') return null;
    const upper = value.trim().toUpperCase();
    if (upper === 'ACTIVE') return 'PENDING';
    if ((EMERGENCY_STATUSES as readonly string[]).includes(upper)) {
        return upper as EmergencyStatus;
    }
    return null;
}

/** Allowed transitions: PENDING -> ASSIGNED -> RESOLVED */
export const EMERGENCY_ALLOWED_TRANSITIONS: Record<EmergencyStatus, EmergencyStatus[]> = {
    PENDING: ['ASSIGNED'],
    ASSIGNED: ['ASSIGNED', 'RESOLVED'], // Can update assignment or resolve
    RESOLVED: [], // Terminal state
};

export function isValidEmergencyTransition(current: EmergencyStatus, target: EmergencyStatus): boolean {
    const allowed = EMERGENCY_ALLOWED_TRANSITIONS[current] || [];
    return allowed.includes(target);
}

export interface EmergencyLocation {
    latitude: number;
    longitude: number;
    address?: string;
    stopName?: string;
    landmark?: string;
}

export interface EmergencyPassenger {
    id: string;
    name: string;
    phone: string;
    email?: string;
    specialAssistance?: string;
}

export interface EmergencyVehicle {
    plateNumber: string;
    model: string;
    driverId?: string;
    driverName?: string;
    routeNumber?: string;
}

export interface EmergencyStatusHistoryEntry {
    status: EmergencyStatus;
    changedAt: string; // ISO string
    changedBy: string; // Admin / Dispatcher name or ID
    notes?: string;
    responderName?: string;
    responderContact?: string;
    etaMinutes?: number;
    actionTaken?: string;
}

export interface EmergencyAssignment {
    responderName: string;
    responderContact: string;
    etaMinutes?: number;
    assignedAt: string;
    assignedBy: string;
    notes?: string;
}

export interface EmergencyResolution {
    resolvedAt: string;
    resolvedBy: string;
    actionTaken?: string;
    notes?: string;
}

export interface EmergencyRequest {
    id: string;
    bookingId?: string;
    passenger: EmergencyPassenger;
    vehicle: EmergencyVehicle;
    location: EmergencyLocation;
    status: EmergencyStatus;
    priority: EmergencyPriority;
    alertRecipients?: {
        caregiver?: string | null;
        driver?: string | null;
        admin?: string;
    };
    assignment?: EmergencyAssignment;
    resolution?: EmergencyResolution;
    statusHistory: EmergencyStatusHistoryEntry[];
    createdAt: string; // ISO timestamp (Emergency time)
    updatedAt: string;
}

export interface CreateEmergencyInput {
    bookingId?: string;
    passenger: {
        id?: string;
        name: string;
        phone: string;
        email?: string;
        specialAssistance?: string;
    };
    vehicle?: {
        plateNumber?: string;
        model?: string;
        driverId?: string;
        driverName?: string;
        routeNumber?: string;
    };
    location: {
        latitude: number;
        longitude: number;
        address?: string;
        stopName?: string;
        landmark?: string;
    };
    priority?: EmergencyPriority;
    alertRecipients?: {
        caregiver?: string | null;
        driver?: string | null;
        admin?: string;
    };
    notes?: string;
}

export interface UpdateEmergencyStatusInput {
    status: EmergencyStatus;
    changedBy?: string;
    notes?: string;
    // When assigning
    responderName?: string;
    responderContact?: string;
    etaMinutes?: number;
    // When resolving
    actionTaken?: string;
}
