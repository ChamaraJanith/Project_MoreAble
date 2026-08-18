// Frontend data-layer tests for Vehicle Management.
//
// The admin Bus screens (list / form / details) all read and write through this
// client, so these tests cover the UI's data path. Component rendering is not
// covered because the project's Jest setup is `testEnvironment: node` with no
// React Native renderer configured - see the MOV-167 report.

import { Bus } from '../../../src/entities/bus/model/types';
import {
    createBus,
    deleteBus,
    getBus,
    getBuses,
    setBusStatus,
    updateBus,
} from '../../../src/features/admin/api/busAdminApi';
import { buildTestPassword, buildTooShortTestPassword } from '../../testUtils/testPassword';

// Hoisted above the imports by ts-jest, so the module graph never pulls in
// react-native / expo-constants, which cannot load under the node environment.
jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: '' }));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function jsonResponse(body: unknown, ok = true) {
    return { ok, json: async () => body };
}

const sampleBus: Bus = {
    busId: 'BUS-00001',
    numberPlate: 'NB-1234',
    chassisNumber: 'CHS-2026-00001',
    busModel: 'Ashok Leyland Viking',
    manufacturer: 'Ashok Leyland',
    manufactureYear: 2025,
    seatCapacity: 54,
    accessibilityFacilities: {
        wheelchairRamp: true,
        audioAnnouncement: true,
        lowFloorVehicle: true,
        walkingAssistance: false,
        wheelchairSpace: { available: true, count: 2 },
        guardianSeats: { available: true, count: 2 },
        prioritySeats: { available: true, count: 2 },
        elderlySeats: { available: true, count: 2 },
    },
    status: 'ACTIVE',
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('getBuses', () => {
    it('returns the bus list from the API', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true, buses: [sampleBus] }));

        const buses = await getBuses();

        expect(buses).toHaveLength(1);
        expect(buses[0].numberPlate).toBe('NB-1234');
        expect(String(mockFetch.mock.calls[0][0])).toContain('/api/buses');
    });

    it('returns an empty list when the fleet is empty', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true, buses: [] }));

        expect(await getBuses()).toEqual([]);
    });

    it('tolerates a response without a buses array', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true }));

        expect(await getBuses()).toEqual([]);
    });

    it('surfaces the backend message when the request fails', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse({ success: false, message: 'Failed to retrieve buses.' }, false)
        );

        await expect(getBuses()).rejects.toThrow('Failed to retrieve buses.');
    });

    it('reports a friendly message on network failure', async () => {
        mockFetch.mockRejectedValue(new Error('socket hang up'));

        await expect(getBuses()).rejects.toThrow(/network error/i);
    });
});

describe('getBus', () => {
    it('looks a bus up by number plate', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true, bus: sampleBus }));

        const bus = await getBus('NB-1234');

        expect(bus.numberPlate).toBe('NB-1234');
        expect(String(mockFetch.mock.calls[0][0])).toContain('/api/buses/NB-1234');
    });

    it('surfaces a not-found message', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: false, message: 'Bus not found.' }, false));

        await expect(getBus('BUS-99999')).rejects.toThrow('Bus not found.');
    });
});

describe('createBus', () => {
    const payload = {
        numberPlate: 'NB-5678',
        chassisNumber: 'CHS-2026-00002',
        busModel: 'Tata Starbus',
        manufacturer: 'Tata',
        manufactureYear: 2024,
        seatCapacity: 48,
        accessibilityFacilities: sampleBus.accessibilityFacilities,
        status: 'ACTIVE' as const,
        password: buildTestPassword('create'),
    };

    it('POSTs the bus and returns the created record', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse({ success: true, bus: { ...sampleBus, numberPlate: 'NB-5678' } })
        );

        const bus = await createBus(payload);

        const [url, init] = mockFetch.mock.calls[0];
        expect(String(url)).toContain('/api/buses');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toMatchObject({
            numberPlate: 'NB-5678',
            seatCapacity: 48,
        });
        expect(bus.numberPlate).toBe('NB-5678');
    });

    it('surfaces a duplicate-plate rejection to the form', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse(
                { success: false, message: 'A bus with this number plate already exists.' },
                false
            )
        );

        await expect(createBus(payload)).rejects.toThrow(/already exists/i);
    });
});

describe('updateBus', () => {
    it('PUTs to the identifier and returns the updated record', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse({ success: true, bus: { ...sampleBus, busModel: 'Tata Starbus' } })
        );

        const bus = await updateBus('NB-1234', {
            chassisNumber: sampleBus.chassisNumber,
            busModel: 'Tata Starbus',
            manufacturer: sampleBus.manufacturer,
            manufactureYear: sampleBus.manufactureYear,
            seatCapacity: sampleBus.seatCapacity,
            accessibilityFacilities: sampleBus.accessibilityFacilities,
            status: 'ACTIVE',
        });

        const [url, init] = mockFetch.mock.calls[0];
        expect(String(url)).toContain('/api/buses/NB-1234');
        expect(init.method).toBe('PUT');
        expect(bus.busModel).toBe('Tata Starbus');
    });

    it('never sends numberPlate, which the backend refuses to update', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true, bus: sampleBus }));

        await updateBus('NB-1234', {
            chassisNumber: sampleBus.chassisNumber,
            busModel: sampleBus.busModel,
            manufacturer: sampleBus.manufacturer,
            manufactureYear: sampleBus.manufactureYear,
            seatCapacity: sampleBus.seatCapacity,
            accessibilityFacilities: sampleBus.accessibilityFacilities,
            status: 'ACTIVE',
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.numberPlate).toBeUndefined();
    });

    it('surfaces a validation rejection to the form', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse(
                { success: false, message: 'Seat capacity must be a positive number.' },
                false
            )
        );

        await expect(
            updateBus('NB-1234', {
                chassisNumber: sampleBus.chassisNumber,
                busModel: sampleBus.busModel,
                manufacturer: sampleBus.manufacturer,
                manufactureYear: sampleBus.manufactureYear,
                seatCapacity: -1,
                accessibilityFacilities: sampleBus.accessibilityFacilities,
                status: 'ACTIVE',
            })
        ).rejects.toThrow(/positive number/i);
    });
});

describe('setBusStatus', () => {
    it('sends the full record with only the status changed', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse({ success: true, bus: { ...sampleBus, status: 'INACTIVE' } })
        );

        const bus = await setBusStatus(sampleBus, 'INACTIVE');

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.status).toBe('INACTIVE');
        // Other fields are preserved so a status change never blanks them.
        expect(body.busModel).toBe('Ashok Leyland Viking');
        expect(body.seatCapacity).toBe(54);
        expect(body.numberPlate).toBeUndefined();
        expect(bus.status).toBe('INACTIVE');
    });
});

describe('deleteBus', () => {
    it('DELETEs the identifier', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true, busId: 'BUS-00001' }));

        await deleteBus('NB-1234');

        const [url, init] = mockFetch.mock.calls[0];
        expect(String(url)).toContain('/api/buses/NB-1234');
        expect(init.method).toBe('DELETE');
    });

    it('surfaces a delete failure', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: false, message: 'Bus not found.' }, false));

        await expect(deleteBus('BUS-99999')).rejects.toThrow('Bus not found.');
    });
});
// ==================================================================
// BUS LOGIN PASSWORD
//
// What the admin form sends. The rule that matters is the omission one: a
// status change or a seat-count edit must not carry a password key at all,
// because the backend reads an absent key as "leave the credential alone" and
// anything else would quietly wipe it.
// ==================================================================
describe('bus password over the wire', () => {
    const editPayload = {
        chassisNumber: sampleBus.chassisNumber,
        busModel: sampleBus.busModel,
        manufacturer: sampleBus.manufacturer,
        manufactureYear: sampleBus.manufactureYear,
        seatCapacity: sampleBus.seatCapacity,
        accessibilityFacilities: sampleBus.accessibilityFacilities,
        status: 'ACTIVE' as const,
    };

    /** The parsed body of the request the client actually sent. */
    function sentBody() {
        return JSON.parse(mockFetch.mock.calls[0][1].body);
    }

    it('sends the password when creating a bus', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true, bus: sampleBus }));

        const password = buildTestPassword('create');
        await createBus({
            numberPlate: 'NB-5678',
            chassisNumber: 'CHS-2026-00002',
            busModel: 'Tata Starbus',
            manufacturer: 'Tata',
            manufactureYear: 2024,
            seatCapacity: 48,
            accessibilityFacilities: sampleBus.accessibilityFacilities,
            status: 'ACTIVE',
            password,
        });

        expect(sentBody().password).toBe(password);
    });

    it('sends a new password when the admin changes one', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true, bus: sampleBus }));

        const password = buildTestPassword('replacement');
        await updateBus('NB-1234', { ...editPayload, password });

        expect(sentBody().password).toBe(password);
    });

    it('omits the password key entirely from an edit that does not change it', async () => {
        mockFetch.mockResolvedValue(jsonResponse({ success: true, bus: sampleBus }));

        await updateBus('NB-1234', editPayload);

        const body = sentBody();
        // Not null, not an empty string — absent. Any present value would be
        // validated and stored, replacing the working credential.
        expect('password' in body).toBe(false);
        expect(body.seatCapacity).toBe(54);
    });

    it('never carries a password through a status change', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse({ success: true, bus: { ...sampleBus, status: 'INACTIVE' } })
        );

        // setBusStatus resends the whole record; the credential is not part of
        // that record and must not become part of it.
        await setBusStatus(sampleBus, 'INACTIVE');

        const body = sentBody();
        expect('password' in body).toBe(false);
        expect(body.status).toBe('INACTIVE');
    });

    it('surfaces the backend password rejection to the form', async () => {
        mockFetch.mockResolvedValue(
            jsonResponse(
                { success: false, message: 'Bus password must be at least 6 characters.' },
                false
            )
        );

        await expect(
            updateBus('NB-1234', { ...editPayload, password: buildTooShortTestPassword() })
        ).rejects.toThrow(/at least/i);
    });
});