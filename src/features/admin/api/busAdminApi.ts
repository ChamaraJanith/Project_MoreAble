import { Bus, BusAccessibilityFacilities, BusStatus } from '../../../entities/bus/model/types';
import { adminFetch } from './adminHttp';

export interface CreateBusPayload {
    numberPlate: string;
    chassisNumber: string;
    busModel: string;
    manufacturer: string;
    manufactureYear: number;
    seatCapacity: number;
    accessibilityFacilities: BusAccessibilityFacilities;
    status: BusStatus;
}

// The backend deliberately does not accept numberPlate on update — it is the
// unique business identifier, so it stays read-only once the bus is created.
export type UpdateBusPayload = Omit<CreateBusPayload, 'numberPlate'>;

/** GET /api/buses */
export async function getBuses(): Promise<Bus[]> {
    const data = await adminFetch('/api/buses');
    return Array.isArray(data.buses) ? (data.buses as Bus[]) : [];
}

/**
 * GET /api/buses/:identifier
 * The endpoint resolves either a busId or a number plate, so the UI can look a
 * bus up by the plate the admin actually sees.
 */
export async function getBus(identifier: string): Promise<Bus> {
    const data = await adminFetch(`/api/buses/${encodeURIComponent(identifier)}`);
    return data.bus as Bus;
}

/** POST /api/buses */
export async function createBus(payload: CreateBusPayload): Promise<Bus> {
    const data = await adminFetch('/api/buses', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    return data.bus as Bus;
}

/** PUT /api/buses/:identifier */
export async function updateBus(identifier: string, payload: UpdateBusPayload): Promise<Bus> {
    const data = await adminFetch(`/api/buses/${encodeURIComponent(identifier)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    });
    return data.bus as Bus;
}

/** DELETE /api/buses/:identifier — permanent removal. */
export async function deleteBus(identifier: string): Promise<void> {
    await adminFetch(`/api/buses/${encodeURIComponent(identifier)}`, { method: 'DELETE' });
}

/** Convenience wrapper for the preferred, non-destructive "retire" workflow. */
export async function setBusStatus(bus: Bus, status: BusStatus): Promise<Bus> {
    return updateBus(bus.numberPlate, {
        chassisNumber: bus.chassisNumber,
        busModel: bus.busModel,
        manufacturer: bus.manufacturer,
        manufactureYear: bus.manufactureYear,
        seatCapacity: bus.seatCapacity,
        accessibilityFacilities: bus.accessibilityFacilities,
        status,
    });
}