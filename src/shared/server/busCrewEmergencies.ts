/**
 * The bus crew's side of an emergency (vehicle dashboard).
 *
 * Three operations, each on the authenticated bus's own emergencies only —
 * the caller passes the busId established by authoriseBusEmergencyAccess,
 * never one read from a request:
 *
 * - list    the bus's open (not RESOLVED) emergencies, newest first, as the
 *           narrow crew view (BusCrewEmergency)
 * - message append one BUS_CREW message to the dispatch thread; nothing else
 *           on the record changes
 * - resolve confirm the passenger was assisted. The workflow stays
 *           Pending -> Assigned -> Resolved: a PENDING emergency is first
 *           recorded as attended by this bus's crew, then resolved. An
 *           assignment dispatch already made is kept as it is.
 *
 * Everything written — sender, actor, responder, resolution text — is fixed
 * here and derived from the bus. An emergency of another bus, or one recorded
 * with no bus, is reported exactly like a missing one (404), so the console
 * cannot be used to learn which emergencies exist.
 */

import {
    BUS_CREW_MESSAGE_MAX_LENGTH,
    BusCrewEmergency,
    EmergencyDispatchMessage,
    EmergencyRequest,
} from '../../entities/emergency/model/types';
import { busCrewActorOf, busCrewOwnsEmergency } from './busEmergencyAuthorization';
import { EMERGENCIES_COLLECTION, EmergencyConflictError, updateEmergencyStatus } from './emergencies';

const NOT_FOUND_MESSAGE = 'Emergency request not found for this bus.';

/** The crew view of an emergency: no passenger id, phone, email or caregiver. */
export function toBusCrewEmergency(emergency: EmergencyRequest): BusCrewEmergency {
    return {
        id: emergency.id,
        busId: emergency.busId ?? '',
        status: emergency.status,
        priority: emergency.priority,
        passenger: {
            name: emergency.passenger?.name ?? '',
            ...(emergency.passenger?.specialAssistance
                ? { specialAssistance: emergency.passenger.specialAssistance }
                : {}),
        },
        vehicle: {
            ...(emergency.vehicle?.plateNumber ? { plateNumber: emergency.vehicle.plateNumber } : {}),
            ...(emergency.vehicle?.routeNumber ? { routeNumber: emergency.vehicle.routeNumber } : {}),
        },
        location: emergency.location,
        dispatchMessages: emergency.dispatchMessages ?? [],
        createdAt: emergency.createdAt,
        updatedAt: emergency.updatedAt,
    };
}

/** The bus's open emergencies, newest first. Only records stamped with this busId. */
export async function listOpenBusEmergencies(db: any, busId: string): Promise<BusCrewEmergency[]> {
    const snapshot = await db.collection(EMERGENCIES_COLLECTION).where('busId', '==', busId).get();
    const records: EmergencyRequest[] = [];

    snapshot.forEach((doc: any) => {
        const data = doc.data();
        records.push({ ...data, id: doc.id || data.id });
    });

    return records
        .filter((record) => busCrewOwnsEmergency(record, busId) && record.status !== 'RESOLVED')
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .map(toBusCrewEmergency);
}

/** The bus's own emergency `emergencyId`, or a 404 — never another bus's record. */
async function loadOwnEmergency(db: any, emergencyId: string, busId: string) {
    const docRef = db.collection(EMERGENCIES_COLLECTION).doc(emergencyId.trim());
    const doc = await docRef.get();
    const data = doc?.exists ? (doc.data() as EmergencyRequest | undefined) : undefined;

    if (!data || !busCrewOwnsEmergency(data, busId)) {
        throw new EmergencyConflictError(NOT_FOUND_MESSAGE, 404);
    }

    const emergency: EmergencyRequest = { ...data, id: doc.id || data.id };

    if (emergency.status === 'RESOLVED') {
        throw new EmergencyConflictError('This emergency is already resolved.', 409);
    }

    return { docRef, emergency };
}

/** Appends one crew message to the bus's own open emergency. */
export async function sendBusCrewMessage(
    db: any,
    emergencyId: string,
    busId: string,
    message: unknown
): Promise<BusCrewEmergency> {
    const text = typeof message === 'string' ? message.trim() : '';

    if (!text) {
        throw new EmergencyConflictError('A message is required.', 400);
    }
    if (text.length > BUS_CREW_MESSAGE_MAX_LENGTH) {
        throw new EmergencyConflictError(
            `Messages can be at most ${BUS_CREW_MESSAGE_MAX_LENGTH} characters.`,
            400
        );
    }

    const { docRef, emergency } = await loadOwnEmergency(db, emergencyId, busId);

    const sentAt = new Date().toISOString();
    const crewMessage: EmergencyDispatchMessage = {
        id: `MSG-${Date.now()}`,
        sender: 'BUS_CREW',
        senderName: busCrewActorOf(busId),
        message: text,
        sentAt,
    };
    const updates = {
        dispatchMessages: [...(emergency.dispatchMessages || []), crewMessage],
        updatedAt: sentAt,
    };

    await docRef.update(updates);

    return toBusCrewEmergency({ ...emergency, ...updates });
}

/** Confirms the bus's own open emergency resolved by its crew. */
export async function resolveBusEmergency(db: any, emergencyId: string, busId: string): Promise<BusCrewEmergency> {
    const { emergency } = await loadOwnEmergency(db, emergencyId, busId);
    const actor = busCrewActorOf(busId);

    if (emergency.status === 'PENDING') {
        // Pending -> Assigned: the crew on board is who attended.
        await updateEmergencyStatus(
            db,
            emergency.id,
            {
                status: 'ASSIGNED',
                responderName: `Onboard bus crew (${busId})`,
                responderContact: 'Bus dashboard dispatch chat',
                notes: 'Bus crew attended to the passenger onboard.',
            },
            actor
        );
    }

    const resolved = await updateEmergencyStatus(
        db,
        emergency.id,
        {
            status: 'RESOLVED',
            actionTaken: `Passenger safely assisted onboard by bus crew (${busId}). Normal transit operations resumed.`,
            notes: 'Resolved via Bus Dashboard Console',
        },
        actor
    );

    return toBusCrewEmergency({ ...resolved, id: emergency.id });
}
