/**
 * Emergency Request Server Logic (MOV-236 / MOV-239)
 *
 * Implements:
 * - Listing active emergency requests (MOV-237)
 * - Filtering by status (PENDING, ASSIGNED, RESOLVED, ALL)
 * - Creation with initial PENDING state and initial history entry
 * - Strict transition enforcement (Pending -> Assigned -> Resolved)
 * - Status history audit trail recording (MOV-236)
 * - Integration with push notification alerts
 */

import {
    CreateEmergencyInput,
    EmergencyRequest,
    EmergencyStatus,
    EmergencyStatusHistoryEntry,
    UpdateEmergencyStatusInput,
    isValidEmergencyTransition,
    normalizeEmergencyStatus,
} from '../../entities/emergency/model/types';
import { dispatchEmergencySOSAlert } from '../services/pushNotificationDispatcher';

export const EMERGENCIES_COLLECTION = 'emergencies';

export class EmergencyConflictError extends Error {
    constructor(message: string, public readonly statusCode: number = 400) {
        super(message);
        this.name = 'EmergencyConflictError';
    }
}

export const emergencyCorsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function emergencyErrorResponse(
    status: number,
    message: string,
    headers: Record<string, string> = emergencyCorsHeaders
): Response {
    return Response.json({ success: false, message }, { status, headers });
}

/** Formats a Date to an ISO 8601 string. */
function nowIso(): string {
    return new Date().toISOString();
}

/** Generates an emergency request identifier like EMG-98213 */
export function generateEmergencyId(): string {
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    return `EMG-${randomSuffix}`;
}

/**
 * Creates a new emergency request.
 * Initial state is strictly 'PENDING', with an initial history entry.
 */
export async function createEmergency(
    db: any,
    input: CreateEmergencyInput,
    creatorName: string = 'Passenger SOS'
): Promise<EmergencyRequest> {
    if (!input.passenger?.name || !input.passenger?.phone) {
        throw new EmergencyConflictError('Passenger name and phone are required for emergency alerts.', 400);
    }

    if (!input.location || typeof input.location.latitude !== 'number' || typeof input.location.longitude !== 'number') {
        throw new EmergencyConflictError('Valid GPS coordinates (latitude, longitude) are required.', 400);
    }

    const timestamp = nowIso();
    const id = generateEmergencyId();

    const initialHistoryEntry: EmergencyStatusHistoryEntry = {
        status: 'PENDING',
        changedAt: timestamp,
        changedBy: creatorName,
        notes: input.notes || 'Emergency SOS initiated by commuter',
    };

    const emergencyRecord: EmergencyRequest = {
        id,
        bookingId: input.bookingId || undefined,
        passenger: {
            id: input.passenger.id || `PAS-${Math.floor(100 + Math.random() * 900)}`,
            name: input.passenger.name.trim(),
            phone: input.passenger.phone.trim(),
            email: input.passenger.email?.trim(),
            specialAssistance: input.passenger.specialAssistance?.trim(),
        },
        vehicle: {
            plateNumber: input.vehicle?.plateNumber?.trim() || 'UNKNOWN-VEHICLE',
            model: input.vehicle?.model?.trim() || 'Transit Bus',
            driverId: input.vehicle?.driverId?.trim(),
            driverName: input.vehicle?.driverName?.trim(),
            routeNumber: input.vehicle?.routeNumber?.trim(),
        },
        location: {
            latitude: input.location.latitude,
            longitude: input.location.longitude,
            address: input.location.address?.trim(),
            stopName: input.location.stopName?.trim(),
            landmark: input.location.landmark?.trim(),
        },
        status: 'PENDING',
        priority: input.priority || 'CRITICAL',
        alertRecipients: input.alertRecipients,
        statusHistory: [initialHistoryEntry],
        createdAt: timestamp,
        updatedAt: timestamp,
    };

    // Save to Firestore
    await db.collection(EMERGENCIES_COLLECTION).doc(id).set(emergencyRecord);

    // Send push notification alerts to designated recipients asynchronously
    try {
        const recipients: string[] = [];
        if (input.alertRecipients?.caregiver) recipients.push(input.alertRecipients.caregiver);
        if (input.alertRecipients?.driver) recipients.push(input.alertRecipients.driver);

        if (recipients.length > 0) {
            dispatchEmergencySOSAlert(recipients, {
                passengerName: emergencyRecord.passenger.name,
                passengerId: emergencyRecord.passenger.id,
                vehicleNumber: emergencyRecord.vehicle.plateNumber,
                routeNumber: emergencyRecord.vehicle.routeNumber,
                locationName: emergencyRecord.location.stopName || emergencyRecord.location.address,
                latitude: emergencyRecord.location.latitude,
                longitude: emergencyRecord.location.longitude,
                contactPhone: emergencyRecord.passenger.phone,
            }).catch((err) => {
                console.warn('[EmergencyServer] Background SOS push dispatch warning:', err);
            });
        }
    } catch (err) {
        console.warn('[EmergencyServer] Failed to trigger push alerts:', err);
    }

    return emergencyRecord;
}

/**
 * Lists emergency requests with optional status filtering and search.
 * Ordered by newest first (descending).
 */
export async function listEmergencies(
    db: any,
    filters: {
        status?: string;
        search?: string;
        limit?: number;
    } = {}
): Promise<EmergencyRequest[]> {
    let query = db.collection(EMERGENCIES_COLLECTION);

    const normalizedStatus = filters.status ? normalizeEmergencyStatus(filters.status) : null;
    if (normalizedStatus) {
        query = query.where('status', '==', normalizedStatus);
    }

    const snapshot = await query.get();
    let records: EmergencyRequest[] = [];

    snapshot.forEach((doc: any) => {
        const data = doc.data();
        records.push({
            ...data,
            id: doc.id || data.id,
        });
    });

    // Sort by createdAt descending
    records.sort((a, b) => {
        const timeA = new Date(a.createdAt || 0).getTime();
        const timeB = new Date(b.createdAt || 0).getTime();
        return timeB - timeA;
    });

    // Apply text search if requested
    if (filters.search && filters.search.trim()) {
        const term = filters.search.trim().toLowerCase();
        records = records.filter((item) => {
            return (
                item.id.toLowerCase().includes(term) ||
                item.passenger?.name?.toLowerCase().includes(term) ||
                item.passenger?.phone?.includes(term) ||
                item.vehicle?.plateNumber?.toLowerCase().includes(term) ||
                item.bookingId?.toLowerCase().includes(term)
            );
        });
    }

    if (filters.limit && filters.limit > 0) {
        records = records.slice(0, filters.limit);
    }

    return records;
}

/**
 * Retrieves a single emergency request by ID.
 */
export async function getEmergencyDetail(db: any, emergencyId: string): Promise<EmergencyRequest | null> {
    if (!emergencyId) return null;
    const doc = await db.collection(EMERGENCIES_COLLECTION).doc(emergencyId.trim()).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return {
        ...data,
        id: doc.id || data.id,
    };
}

/**
 * Updates emergency status following strict workflow:
 * PENDING -> ASSIGNED -> RESOLVED
 *
 * Appends an audit entry to `statusHistory` on each change.
 */
export async function updateEmergencyStatus(
    db: any,
    emergencyId: string,
    input: UpdateEmergencyStatusInput,
    actorId: string = 'Admin Dispatcher'
): Promise<EmergencyRequest> {
    const trimmedId = emergencyId.trim();
    const docRef = db.collection(EMERGENCIES_COLLECTION).doc(trimmedId);

    const doc = await docRef.get();
    if (!doc.exists) {
        throw new EmergencyConflictError(`Emergency request '${emergencyId}' not found.`, 404);
    }

    const current: EmergencyRequest = doc.data();
    const targetStatus = normalizeEmergencyStatus(input.status);

    if (!targetStatus) {
        throw new EmergencyConflictError(`Invalid target status: '${input.status}'. Allowed: PENDING, ASSIGNED, RESOLVED.`, 400);
    }

    // Validate workflow transition
    if (current.status === targetStatus && targetStatus !== 'ASSIGNED') {
        throw new EmergencyConflictError(`Emergency is already in status '${targetStatus}'.`, 400);
    }

    if (!isValidEmergencyTransition(current.status, targetStatus)) {
        throw new EmergencyConflictError(
            `Invalid status transition: Cannot transition from '${current.status}' to '${targetStatus}'. The emergency workflow is: Pending -> Assigned -> Resolved.`,
            400
        );
    }

    const timestamp = nowIso();
    const historyEntry: EmergencyStatusHistoryEntry = {
        status: targetStatus,
        changedAt: timestamp,
        changedBy: actorId,
        notes: input.notes?.trim() || undefined,
        responderName: input.responderName?.trim() || undefined,
        responderContact: input.responderContact?.trim() || undefined,
        etaMinutes: input.etaMinutes,
        actionTaken: input.actionTaken?.trim() || undefined,
    };

    const updatedHistory = [...(current.statusHistory || []), historyEntry];

    const updates: Partial<EmergencyRequest> = {
        status: targetStatus,
        statusHistory: updatedHistory,
        updatedAt: timestamp,
    };

    if (targetStatus === 'ASSIGNED') {
        if (!input.responderName || !input.responderContact) {
            throw new EmergencyConflictError(
                'Responder name and contact number are required when assigning support to an emergency.',
                400
            );
        }
        updates.assignment = {
            responderName: input.responderName.trim(),
            responderContact: input.responderContact.trim(),
            etaMinutes: input.etaMinutes,
            assignedAt: timestamp,
            assignedBy: actorId,
            notes: input.notes?.trim(),
        };
    } else if (targetStatus === 'RESOLVED') {
        if (!input.actionTaken && !input.notes) {
            throw new EmergencyConflictError(
                'Resolution notes or action taken must be provided to resolve an emergency.',
                400
            );
        }
        updates.resolution = {
            resolvedAt: timestamp,
            resolvedBy: actorId,
            actionTaken: input.actionTaken?.trim() || input.notes?.trim(),
            notes: input.notes?.trim(),
        };
    }

    await docRef.update(updates);

    return {
        ...current,
        ...updates,
    };
}
