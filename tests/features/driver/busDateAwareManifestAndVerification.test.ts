


import { POST as confirmBoardingPost } from '../../../app/api/booking/confirm-boarding+api';
import { GET as getBookingHistory } from '../../../app/api/booking/history+api';
import { POST as verifyTicketPost } from '../../../app/api/booking/verify-ticket+api';
import { getAdminDb } from '../../../src/shared/config/firebaseAdmin';

jest.mock('../../../src/shared/config/firebaseAdmin');
jest.mock('../../../src/shared/services/pushNotificationDispatcher', () => ({
    dispatchBoardingAlert: jest.fn().mockResolvedValue(true),
    dispatchCaregiverJourneyAlert: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../../src/features/caregiver/services/caregiverAlertService', () => ({
    dispatchCaregiverSafetyAlert: jest.fn().mockResolvedValue(true),
}));

describe('Enterprise Bus Transit Operations: Date-Aware Manifest & Ticket Verification', () => {
    let mockBookings: any[] = [];
    let mockUsers: any[] = [];
    let mockGuardians: any[] = [];

    beforeEach(() => {
        jest.clearAllMocks();

        mockBookings = [
            {
                id: 'BK-TODAY-01',
                bookingId: 'BK-TODAY-01',
                userId: 'PAS-001',
                busId: 'BUS-101',
                tripId: 'TRIP-101',
                seatNumber: '14',
                travelDate: '2026-09-26',
                journeyDate: '2026-09-26',
                departureDate: '2026-09-26',
                status: 'CONFIRMED',
                boardingStatus: 'NOT_BOARDED',
                paymentStatus: 'COLLECT_CASH',
                fare: { totalFare: 150, currency: 'LKR' },
                journey: {
                    startLocation: 'Colombo Fort',
                    endLocation: 'Moratuwa',
                    departureTime: '08:00 AM',
                    estimatedArrivalTime: '08:45 AM',
                },
                vehicle: {
                    numberPlate: 'NC-3456',
                    busModel: 'Leyland Transit',
                },
                createdAt: '2026-09-20T10:00:00Z',
            },
            {
                id: 'BK-TODAY-02-WHEELCHAIR',
                bookingId: 'BK-TODAY-02-WHEELCHAIR',
                userId: 'PAS-002',
                busId: 'BUS-101',
                tripId: 'TRIP-101',
                seatNumber: 'W1',
                pairedSeatNumber: '02',
                travelDate: '2026-09-26',
                journeyDate: '2026-09-26',
                status: 'CONFIRMED',
                boardingStatus: 'NOT_BOARDED',
                paymentStatus: 'PAID',
                fare: { totalFare: 225, currency: 'LKR' },
                assistanceRequested: {
                    wheelchairAssistance: true,
                    boardingAssistance: true,
                    walkingAssistance: false,
                    prioritySeatAssistance: false,
                },
                journey: {
                    startLocation: 'Bambalapitiya',
                    endLocation: 'Mount Lavinia',
                    departureTime: '08:15 AM',
                    estimatedArrivalTime: '08:35 AM',
                },
                vehicle: {
                    numberPlate: 'NC-3456',
                },
                createdAt: '2026-09-21T11:00:00Z',
            },
            {
                id: 'BK-TOMORROW-01',
                bookingId: 'BK-TOMORROW-01',
                userId: 'PAS-003',
                busId: 'BUS-101',
                tripId: 'TRIP-101',
                seatNumber: '14', // Same seat 14 on tomorrow's date!
                travelDate: '2026-09-27',
                journeyDate: '2026-09-27',
                status: 'CONFIRMED',
                boardingStatus: 'NOT_BOARDED',
                paymentStatus: 'COLLECT_CASH',
                fare: { totalFare: 150, currency: 'LKR' },
                journey: {
                    startLocation: 'Colombo Fort',
                    endLocation: 'Moratuwa',
                },
                vehicle: {
                    numberPlate: 'NC-3456',
                },
                createdAt: '2026-09-22T12:00:00Z',
            },
            {
                id: 'BK-OTHER-BUS-01',
                bookingId: 'BK-OTHER-BUS-01',
                userId: 'PAS-004',
                busId: 'BUS-999',
                tripId: 'TRIP-999',
                seatNumber: '05',
                travelDate: '2026-09-26',
                status: 'CONFIRMED',
                boardingStatus: 'NOT_BOARDED',
                paymentStatus: 'PAID',
                fare: { totalFare: 200, currency: 'LKR' },
                vehicle: {
                    numberPlate: 'ND-9999',
                },
            },
        ];

        mockUsers = [
            {
                id: 'PAS-001',
                passengerId: 'PAS-001',
                fullName: 'Kasun Bandara',
                guardianId: 'GRD-01',
            },
            {
                id: 'PAS-002',
                passengerId: 'PAS-002',
                fullName: 'Nimali Fernando',
            },
            {
                id: 'PAS-003',
                passengerId: 'PAS-003',
                fullName: 'Sahan Perera',
            },
        ];

        mockGuardians = [
            {
                id: 'GRD-01',
                fullName: 'Sunil Bandara',
                mobileNo: '+94771234567',
                relationship: 'Father',
            },
        ];

        (getAdminDb as jest.Mock).mockReturnValue({
            collection: (col: string) => {
                if (col === 'bookings') {
                    return {
                        where: (field: string, op: string, val: string) => ({
                            get: async () => ({
                                docs: mockBookings
                                    .filter((b) => b[field] === val)
                                    .map((b) => ({
                                        id: b.id,
                                        data: () => b,
                                    })),
                            }),
                        }),
                        doc: (id: string) => ({
                            get: async () => {
                                const found = mockBookings.find((b) => b.id === id || b.bookingId === id);
                                return {
                                    exists: !!found,
                                    id: found?.id || id,
                                    data: () => found,
                                };
                            },
                            update: async (patch: any) => {
                                const found = mockBookings.find((b) => b.id === id || b.bookingId === id);
                                if (found) Object.assign(found, patch);
                            },
                        }),
                    };
                }
                if (col === 'users') {
                    return {
                        doc: (uid: string) => ({
                            get: async () => {
                                const found = mockUsers.find((u) => u.id === uid || u.passengerId === uid);
                                return {
                                    exists: !!found,
                                    data: () => found,
                                };
                            },
                        }),
                        where: (field: string, op: string, val: string) => ({
                            limit: () => ({
                                get: async () => {
                                    const matches = mockUsers.filter((u) => u[field] === val);
                                    return {
                                        empty: matches.length === 0,
                                        docs: matches.map((m) => ({
                                            exists: true,
                                            data: () => m,
                                        })),
                                    };
                                },
                            }),
                        }),
                    };
                }
                if (col === 'guardians') {
                    return {
                        doc: (gid: string) => ({
                            get: async () => {
                                const found = mockGuardians.find((g) => g.id === gid);
                                return {
                                    exists: !!found,
                                    data: () => found,
                                };
                            },
                        }),
                    };
                }
                if (col === 'notifications') {
                    return {
                        doc: () => ({ set: async () => { } }),
                    };
                }
                return {
                    doc: () => ({ get: async () => ({ exists: false, data: () => null }) }),
                };
            },
        });
    });

    describe('1. Booking History Manifest API: Date Filtering Isolation', () => {
        it('fetches all bookings for busId when no date parameter is passed', async () => {
            const req = new Request('http://localhost/api/booking/history?busId=BUS-101');
            const res = await getBookingHistory(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.bookings.length).toBe(3); // 2 today + 1 tomorrow
        });

        it('strictly filters only TODAY bookings when ?date=2026-09-26 is supplied', async () => {
            const req = new Request('http://localhost/api/booking/history?busId=BUS-101&date=2026-09-26');
            const res = await getBookingHistory(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.bookings.length).toBe(2);
            expect(data.bookings.map((b: any) => b.bookingId)).toEqual([
                'BK-TODAY-02-WHEELCHAIR',
                'BK-TODAY-01',
            ]);
            expect(data.bookings[0].passengerName).toBe('Nimali Fernando');
            expect(data.bookings[1].passengerName).toBe('Kasun Bandara');
        });

        it('strictly filters only TOMORROW bookings when ?date=2026-09-27 is supplied', async () => {
            const req = new Request('http://localhost/api/booking/history?busId=BUS-101&date=2026-09-27');
            const res = await getBookingHistory(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.bookings.length).toBe(1);
            expect(data.bookings[0].bookingId).toBe('BK-TOMORROW-01');
            expect(data.bookings[0].passengerName).toBe('Sahan Perera');
        });

        it('returns empty array if querying a future date with no reservations', async () => {
            const req = new Request('http://localhost/api/booking/history?busId=BUS-101&date=2026-10-15');
            const res = await getBookingHistory(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.bookings.length).toBe(0);
        });
    });

    describe('2. Conductor Ticket QR Verification API: Date & Vehicle Rejections', () => {
        it('successfully verifies ticket with valid: true and isBoardingAllowed: true when date and bus match', async () => {
            const req = new Request('http://localhost/api/booking/verify-ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: 'BK-TODAY-01',
                    busId: 'BUS-101',
                    date: '2026-09-26',
                }),
            });

            const res = await verifyTicketPost(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.valid).toBe(true);
            expect(data.isBoardingAllowed).toBe(true);
            expect(data.rejectionReason).toBeNull();
            expect(data.dateMismatchWarning).toBeNull();
            expect(data.busMismatchWarning).toBeNull();
            expect(data.travelDate).toBe('2026-09-26');
            expect(data.passengerName).toBe('Kasun Bandara');
            expect(data.guardianInfo).toEqual({
                guardianId: 'GRD-01',
                fullName: 'Sunil Bandara',
                mobileNo: '+94771234567',
                relationship: 'Father',
            });
        });

        it('strictly REJECTS ticket (valid: false, isBoardingAllowed: false) when presented on wrong travel date', async () => {
            const req = new Request('http://localhost/api/booking/verify-ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: 'BK-TOMORROW-01',
                    busId: 'BUS-101',
                    date: '2026-09-26', // Conductor checking today (26th), ticket is for tomorrow (27th)!
                }),
            });

            const res = await verifyTicketPost(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.valid).toBe(false);
            expect(data.isBoardingAllowed).toBe(false);
            expect(data.rejectionReason).toBe('DATE_MISMATCH');
            expect(data.travelDate).toBe('2026-09-27');
            expect(data.dateMismatchWarning).toContain('Travel Date Mismatch');
            expect(data.dateMismatchWarning).toContain('2026-09-27');
            expect(data.dateMismatchWarning).toContain('2026-09-26');
        });

        it('strictly REJECTS ticket (valid: false, isBoardingAllowed: false) when presented on wrong bus vehicle', async () => {
            const req = new Request('http://localhost/api/booking/verify-ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: 'BK-OTHER-BUS-01',
                    busId: 'BUS-101', // Conductor is on BUS-101, but passenger booked BUS-999
                    date: '2026-09-26',
                }),
            });

            const res = await verifyTicketPost(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.valid).toBe(false);
            expect(data.isBoardingAllowed).toBe(false);
            expect(data.rejectionReason).toBe('BUS_MISMATCH');
            expect(data.busMismatchWarning).toContain('Bus Mismatch');
            expect(data.busMismatchWarning).toContain('ND-9999');
        });

        it('extracts wheelchair and paired companion seat details during verification', async () => {
            const req = new Request('http://localhost/api/booking/verify-ticket', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    qrPayload: JSON.stringify({ bookingId: 'BK-TODAY-02-WHEELCHAIR' }),
                    busId: 'BUS-101',
                    date: '2026-09-26',
                }),
            });

            const res = await verifyTicketPost(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.valid).toBe(true);
            expect(data.isBoardingAllowed).toBe(true);
            expect(data.isWheelchair).toBe(true);
            expect(data.seatNumber).toBe('W1');
            expect(data.pairedSeatNumber).toBe('02');
            expect(data.assistanceRequested.wheelchairAssistance).toBe(true);
            expect(data.paymentStatus).toBe('PAID');
        });
    });







    // jest.mock('../../../src/shared/config/firebaseAdmin');
    // jest.mock('../../../src/shared/services/pushNotificationDispatcher', () => ({
    //     dispatchBoardingAlert: jest.fn().mockResolvedValue(true),
    //     dispatchCaregiverJourneyAlert: jest.fn().mockResolvedValue(true),
    // }));
    // jest.mock('../../../src/features/caregiver/services/caregiverAlertService', () => ({
    //     dispatchCaregiverSafetyAlert: jest.fn().mockResolvedValue(true),
    // }));

    // describe('Enterprise Bus Transit Operations: Date-Aware Manifest & Ticket Verification', () => {
    //     let mockBookings: any[] = [];
    //     let mockUsers: any[] = [];
    //     let mockGuardians: any[] = [];

    //     beforeEach(() => {
    //         jest.clearAllMocks();

    //         mockBookings = [
    //             {
    //                 id: 'BK-TODAY-01',
    //                 bookingId: 'BK-TODAY-01',
    //                 userId: 'PAS-001',
    //                 busId: 'BUS-101',
    //                 tripId: 'TRIP-101',
    //                 seatNumber: '14',
    //                 travelDate: '2026-09-26',
    //                 journeyDate: '2026-09-26',
    //                 departureDate: '2026-09-26',
    //                 status: 'CONFIRMED',
    //                 boardingStatus: 'NOT_BOARDED',
    //                 paymentStatus: 'COLLECT_CASH',
    //                 fare: { totalFare: 150, currency: 'LKR' },
    //                 journey: {
    //                     startLocation: 'Colombo Fort',
    //                     endLocation: 'Moratuwa',
    //                     departureTime: '08:00 AM',
    //                     estimatedArrivalTime: '08:45 AM',
    //                 },
    //                 vehicle: {
    //                     numberPlate: 'NC-3456',
    //                     busModel: 'Leyland Transit',
    //                 },
    //                 createdAt: '2026-09-20T10:00:00Z',
    //             },
    //             {
    //                 id: 'BK-TODAY-02-WHEELCHAIR',
    //                 bookingId: 'BK-TODAY-02-WHEELCHAIR',
    //                 userId: 'PAS-002',
    //                 busId: 'BUS-101',
    //                 tripId: 'TRIP-101',
    //                 seatNumber: 'W1',
    //                 pairedSeatNumber: '02',
    //                 travelDate: '2026-09-26',
    //                 journeyDate: '2026-09-26',
    //                 status: 'CONFIRMED',
    //                 boardingStatus: 'NOT_BOARDED',
    //                 paymentStatus: 'PAID',
    //                 fare: { totalFare: 225, currency: 'LKR' },
    //                 assistanceRequested: {
    //                     wheelchairAssistance: true,
    //                     boardingAssistance: true,
    //                     walkingAssistance: false,
    //                     prioritySeatAssistance: false,
    //                 },
    //                 journey: {
    //                     startLocation: 'Bambalapitiya',
    //                     endLocation: 'Mount Lavinia',
    //                     departureTime: '08:15 AM',
    //                     estimatedArrivalTime: '08:35 AM',
    //                 },
    //                 vehicle: {
    //                     numberPlate: 'NC-3456',
    //                 },
    //                 createdAt: '2026-09-21T11:00:00Z',
    //             },
    //             {
    //                 id: 'BK-TOMORROW-01',
    //                 bookingId: 'BK-TOMORROW-01',
    //                 userId: 'PAS-003',
    //                 busId: 'BUS-101',
    //                 tripId: 'TRIP-101',
    //                 seatNumber: '14', // Same seat 14 on tomorrow's date!
    //                 travelDate: '2026-09-27',
    //                 journeyDate: '2026-09-27',
    //                 status: 'CONFIRMED',
    //                 boardingStatus: 'NOT_BOARDED',
    //                 paymentStatus: 'COLLECT_CASH',
    //                 fare: { totalFare: 150, currency: 'LKR' },
    //                 journey: {
    //                     startLocation: 'Colombo Fort',
    //                     endLocation: 'Moratuwa',
    //                 },
    //                 vehicle: {
    //                     numberPlate: 'NC-3456',
    //                 },
    //                 createdAt: '2026-09-22T12:00:00Z',
    //             },
    //             {
    //                 id: 'BK-OTHER-BUS-01',
    //                 bookingId: 'BK-OTHER-BUS-01',
    //                 userId: 'PAS-004',
    //                 busId: 'BUS-999',
    //                 tripId: 'TRIP-999',
    //                 seatNumber: '05',
    //                 travelDate: '2026-09-26',
    //                 status: 'CONFIRMED',
    //                 boardingStatus: 'NOT_BOARDED',
    //                 paymentStatus: 'PAID',
    //                 fare: { totalFare: 200, currency: 'LKR' },
    //                 vehicle: {
    //                     numberPlate: 'ND-9999',
    //                 },
    //             },
    //         ];

    //         mockUsers = [
    //             {
    //                 id: 'PAS-001',
    //                 passengerId: 'PAS-001',
    //                 fullName: 'Kasun Bandara',
    //                 guardianId: 'GRD-01',
    //             },
    //             {
    //                 id: 'PAS-002',
    //                 passengerId: 'PAS-002',
    //                 fullName: 'Nimali Fernando',
    //             },
    //             {
    //                 id: 'PAS-003',
    //                 passengerId: 'PAS-003',
    //                 fullName: 'Sahan Perera',
    //             },
    //         ];

    //         mockGuardians = [
    //             {
    //                 id: 'GRD-01',
    //                 fullName: 'Sunil Bandara',
    //                 mobileNo: '+94771234567',
    //                 relationship: 'Father',
    //             },
    //         ];

    //         (getAdminDb as jest.Mock).mockReturnValue({
    //             collection: (col: string) => {
    //                 if (col === 'bookings') {
    //                     return {
    //                         where: (field: string, op: string, val: string) => ({
    //                             get: async () => ({
    //                                 docs: mockBookings
    //                                     .filter((b) => b[field] === val)
    //                                     .map((b) => ({
    //                                         id: b.id,
    //                                         data: () => b,
    //                                     })),
    //                             }),
    //                         }),
    //                         doc: (id: string) => ({
    //                             get: async () => {
    //                                 const found = mockBookings.find((b) => b.id === id || b.bookingId === id);
    //                                 return {
    //                                     exists: !!found,
    //                                     id: found?.id || id,
    //                                     data: () => found,
    //                                 };
    //                             },
    //                             update: async (patch: any) => {
    //                                 const found = mockBookings.find((b) => b.id === id || b.bookingId === id);
    //                                 if (found) Object.assign(found, patch);
    //                             },
    //                         }),
    //                     };
    //                 }
    //                 if (col === 'users') {
    //                     return {
    //                         doc: (uid: string) => ({
    //                             get: async () => {
    //                                 const found = mockUsers.find((u) => u.id === uid || u.passengerId === uid);
    //                                 return {
    //                                     exists: !!found,
    //                                     data: () => found,
    //                                 };
    //                             },
    //                         }),
    //                         where: (field: string, op: string, val: string) => ({
    //                             limit: () => ({
    //                                 get: async () => {
    //                                     const matches = mockUsers.filter((u) => u[field] === val);
    //                                     return {
    //                                         empty: matches.length === 0,
    //                                         docs: matches.map((m) => ({
    //                                             exists: true,
    //                                             data: () => m,
    //                                         })),
    //                                     };
    //                                 },
    //                             }),
    //                         }),
    //                     };
    //                 }
    //                 if (col === 'guardians') {
    //                     return {
    //                         doc: (gid: string) => ({
    //                             get: async () => {
    //                                 const found = mockGuardians.find((g) => g.id === gid);
    //                                 return {
    //                                     exists: !!found,
    //                                     data: () => found,
    //                                 };
    //                             },
    //                         }),
    //                     };
    //                 }
    //                 if (col === 'notifications') {
    //                     return {
    //                         doc: () => ({ set: async () => {} }),
    //                     };
    //                 }
    //                 return {
    //                     doc: () => ({ get: async () => ({ exists: false, data: () => null }) }),
    //                 };
    //             },
    //         });
    //     });

    //     describe('1. Booking History Manifest API: Date Filtering Isolation', () => {
    //         it('fetches all bookings for busId when no date parameter is passed', async () => {
    //             const req = new Request('http://localhost/api/booking/history?busId=BUS-101');
    //             const res = await getBookingHistory(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(200);
    //             expect(data.bookings.length).toBe(3); // 2 today + 1 tomorrow
    //         });

    //         it('strictly filters only TODAY bookings when ?date=2026-09-26 is supplied', async () => {
    //             const req = new Request('http://localhost/api/booking/history?busId=BUS-101&date=2026-09-26');
    //             const res = await getBookingHistory(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(200);
    //             expect(data.bookings.length).toBe(2);
    //             expect(data.bookings.map((b: any) => b.bookingId)).toEqual([
    //                 'BK-TODAY-02-WHEELCHAIR',
    //                 'BK-TODAY-01',
    //             ]);
    //             expect(data.bookings[0].passengerName).toBe('Nimali Fernando');
    //             expect(data.bookings[1].passengerName).toBe('Kasun Bandara');
    //         });

    //         it('strictly filters only TOMORROW bookings when ?date=2026-09-27 is supplied', async () => {
    //             const req = new Request('http://localhost/api/booking/history?busId=BUS-101&date=2026-09-27');
    //             const res = await getBookingHistory(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(200);
    //             expect(data.bookings.length).toBe(1);
    //             expect(data.bookings[0].bookingId).toBe('BK-TOMORROW-01');
    //             expect(data.bookings[0].passengerName).toBe('Sahan Perera');
    //         });

    //         it('returns empty array if querying a future date with no reservations', async () => {
    //             const req = new Request('http://localhost/api/booking/history?busId=BUS-101&date=2026-10-15');
    //             const res = await getBookingHistory(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(200);
    //             expect(data.bookings.length).toBe(0);
    //         });
    //     });

    //     describe('2. Conductor Ticket QR Verification API: Date & Vehicle Rejections', () => {
    //         it('successfully verifies ticket with valid: true and isBoardingAllowed: true when date and bus match', async () => {
    //             const req = new Request('http://localhost/api/booking/verify-ticket', {
    //                 method: 'POST',
    //                 headers: { 'Content-Type': 'application/json' },
    //                 body: JSON.stringify({
    //                     bookingId: 'BK-TODAY-01',
    //                     busId: 'BUS-101',
    //                     date: '2026-09-26',
    //                 }),
    //             });

    //             const res = await verifyTicketPost(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(200);
    //             expect(data.valid).toBe(true);
    //             expect(data.isBoardingAllowed).toBe(true);
    //             expect(data.rejectionReason).toBeNull();
    //             expect(data.dateMismatchWarning).toBeNull();
    //             expect(data.busMismatchWarning).toBeNull();
    //             expect(data.travelDate).toBe('2026-09-26');
    //             expect(data.passengerName).toBe('Kasun Bandara');
    //             expect(data.guardianInfo).toEqual({
    //                 guardianId: 'GRD-01',
    //                 fullName: 'Sunil Bandara',
    //                 mobileNo: '+94771234567',
    //                 relationship: 'Father',
    //             });
    //         });

    //         it('strictly REJECTS ticket (valid: false, isBoardingAllowed: false) when presented on wrong travel date', async () => {
    //             const req = new Request('http://localhost/api/booking/verify-ticket', {
    //                 method: 'POST',
    //                 headers: { 'Content-Type': 'application/json' },
    //                 body: JSON.stringify({
    //                     bookingId: 'BK-TOMORROW-01',
    //                     busId: 'BUS-101',
    //                     date: '2026-09-26', // Conductor checking today (26th), ticket is for tomorrow (27th)!
    //                 }),
    //             });

    //             const res = await verifyTicketPost(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(200);
    //             expect(data.valid).toBe(false);
    //             expect(data.isBoardingAllowed).toBe(false);
    //             expect(data.rejectionReason).toBe('DATE_MISMATCH');
    //             expect(data.travelDate).toBe('2026-09-27');
    //             expect(data.dateMismatchWarning).toContain('Travel Date Mismatch');
    //             expect(data.dateMismatchWarning).toContain('2026-09-27');
    //             expect(data.dateMismatchWarning).toContain('2026-09-26');
    //         });

    //         it('strictly REJECTS ticket (valid: false, isBoardingAllowed: false) when presented on wrong bus vehicle', async () => {
    //             const req = new Request('http://localhost/api/booking/verify-ticket', {
    //                 method: 'POST',
    //                 headers: { 'Content-Type': 'application/json' },
    //                 body: JSON.stringify({
    //                     bookingId: 'BK-OTHER-BUS-01',
    //                     busId: 'BUS-101', // Conductor is on BUS-101, but passenger booked BUS-999
    //                     date: '2026-09-26',
    //                 }),
    //             });

    //             const res = await verifyTicketPost(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(200);
    //             expect(data.valid).toBe(false);
    //             expect(data.isBoardingAllowed).toBe(false);
    //             expect(data.rejectionReason).toBe('BUS_MISMATCH');
    //             expect(data.busMismatchWarning).toContain('Bus Mismatch');
    //             expect(data.busMismatchWarning).toContain('ND-9999');
    //         });

    //         it('extracts wheelchair and paired companion seat details during verification', async () => {
    //             const req = new Request('http://localhost/api/booking/verify-ticket', {
    //                 method: 'POST',
    //                 headers: { 'Content-Type': 'application/json' },
    //                 body: JSON.stringify({
    //                     qrPayload: JSON.stringify({ bookingId: 'BK-TODAY-02-WHEELCHAIR' }),
    //                     busId: 'BUS-101',
    //                     date: '2026-09-26',
    //                 }),
    //             });

    //             const res = await verifyTicketPost(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(200);
    //             expect(data.valid).toBe(true);
    //             expect(data.isBoardingAllowed).toBe(true);
    //             expect(data.isWheelchair).toBe(true);
    //             expect(data.seatNumber).toBe('W1');
    //             expect(data.pairedSeatNumber).toBe('02');
    //             expect(data.assistanceRequested.wheelchairAssistance).toBe(true);
    //             expect(data.paymentStatus).toBe('PAID');
    //         });
    //     });

    //     describe('3. Confirm Boarding API: Strict Server-Side Guard Rails', () => {
    //         it('blocks boarding and rejects with HTTP 400 when travel date mismatches', async () => {
    //             const req = new Request('http://localhost/api/booking/confirm-boarding', {
    //                 method: 'POST',
    //                 headers: { 'Content-Type': 'application/json' },
    //                 body: JSON.stringify({
    //                     bookingId: 'BK-TOMORROW-01',
    //                     busId: 'BUS-101',
    //                     date: '2026-09-26', // Attempting to board on 26th with 27th ticket!
    //                     cashCollected: true,
    //                 }),
    //             });

    //             const res = await confirmBoardingPost(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(400);
    //             expect(data.success).toBe(false);
    //             expect(data.message).toContain('Boarding Rejected: Travel date mismatch');
    //             expect(data.message).toContain('2026-09-27');
    //         });

    //         it('blocks boarding and rejects with HTTP 400 when bus vehicle mismatches', async () => {
    //             const req = new Request('http://localhost/api/booking/confirm-boarding', {
    //                 method: 'POST',
    //                 headers: { 'Content-Type': 'application/json' },
    //                 body: JSON.stringify({
    //                     bookingId: 'BK-OTHER-BUS-01',
    //                     busId: 'BUS-101', // Booked on BUS-999
    //                     date: '2026-09-26',
    //                     cashCollected: true,
    //                 }),
    //             });

    //             const res = await confirmBoardingPost(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(400);
    //             expect(data.success).toBe(false);
    //             expect(data.message).toContain('Boarding Rejected: Vehicle mismatch');
    //         });

    //         it('successfully confirms boarding and updates payment when date and vehicle match', async () => {
    //             const req = new Request('http://localhost/api/booking/confirm-boarding', {
    //                 method: 'POST',
    //                 headers: { 'Content-Type': 'application/json' },
    //                 body: JSON.stringify({
    //                     bookingId: 'BK-TODAY-01',
    //                     busId: 'BUS-101',
    //                     date: '2026-09-26',
    //                     cashCollected: true,
    //                     conductorId: 'COND-007',
    //                 }),
    //             });

    //             const res = await confirmBoardingPost(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(200);
    //             expect(data.success).toBe(true);
    //             expect(data.boardingStatus).toBe('BOARDED');
    //             expect(data.bookingId).toBe('BK-TODAY-01');

    //             const updatedBooking = mockBookings.find((b) => b.bookingId === 'BK-TODAY-01');
    //             expect(updatedBooking.boardingStatus).toBe('BOARDED');
    //             expect(updatedBooking.paymentStatus).toBe('PAID');
    //             expect(updatedBooking.conductorVerifiedBy).toBe('COND-007');
    //         });

    //         it('blocks re-boarding if passenger is already marked as boarded', async () => {
    //             // First mark as boarded
    //             const firstBooking = mockBookings.find((b) => b.bookingId === 'BK-TODAY-01');
    //             firstBooking.boardingStatus = 'BOARDED';
    //             firstBooking.boardedAt = '2026-09-26T08:05:00Z';

    //             const req = new Request('http://localhost/api/booking/confirm-boarding', {
    //                 method: 'POST',
    //                 headers: { 'Content-Type': 'application/json' },
    //                 body: JSON.stringify({
    //                     bookingId: 'BK-TODAY-01',
    //                     busId: 'BUS-101',
    //                     date: '2026-09-26',
    //                     cashCollected: true,
    //                 }),
    //             });

    //             const res = await confirmBoardingPost(req);
    //             const data = await res.json();

    //             expect(res.status).toBe(400);
    //             expect(data.success).toBe(false);
    //             expect(data.message).toContain('already boarded');
    //         });
    //     });
    // });















    describe('3. Confirm Boarding API: Strict Server-Side Guard Rails', () => {
        it('blocks boarding and rejects with HTTP 400 when travel date mismatches', async () => {
            const req = new Request('http://localhost/api/booking/confirm-boarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: 'BK-TOMORROW-01',
                    busId: 'BUS-101',
                    date: '2026-09-26', // Attempting to board on 26th with 27th ticket!
                    cashCollected: true,
                }),
            });

            const res = await confirmBoardingPost(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
            expect(data.message).toContain('Boarding Rejected: Travel date mismatch');
            expect(data.message).toContain('2026-09-27');
        });

        it('blocks boarding and rejects with HTTP 400 when bus vehicle mismatches', async () => {
            const req = new Request('http://localhost/api/booking/confirm-boarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: 'BK-OTHER-BUS-01',
                    busId: 'BUS-101', // Booked on BUS-999
                    date: '2026-09-26',
                    cashCollected: true,
                }),
            });

            const res = await confirmBoardingPost(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
            expect(data.message).toContain('Boarding Rejected: Vehicle mismatch');
        });

        it('successfully confirms boarding and updates payment when date and vehicle match', async () => {
            const req = new Request('http://localhost/api/booking/confirm-boarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: 'BK-TODAY-01',
                    busId: 'BUS-101',
                    date: '2026-09-26',
                    cashCollected: true,
                    conductorId: 'COND-007',
                }),
            });

            const res = await confirmBoardingPost(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.boardingStatus).toBe('BOARDED');
            expect(data.bookingId).toBe('BK-TODAY-01');

            const updatedBooking = mockBookings.find((b) => b.bookingId === 'BK-TODAY-01');
            expect(updatedBooking.boardingStatus).toBe('BOARDED');
            expect(updatedBooking.paymentStatus).toBe('PAID');
            expect(updatedBooking.conductorVerifiedBy).toBe('COND-007');
        });

        it('blocks re-boarding if passenger is already marked as boarded', async () => {
            // First mark as boarded
            const firstBooking = mockBookings.find((b) => b.bookingId === 'BK-TODAY-01');
            firstBooking.boardingStatus = 'BOARDED';
            firstBooking.boardedAt = '2026-09-26T08:05:00Z';

            const req = new Request('http://localhost/api/booking/confirm-boarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: 'BK-TODAY-01',
                    busId: 'BUS-101',
                    date: '2026-09-26',
                    cashCollected: true,
                }),
            });

            const res = await confirmBoardingPost(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
            expect(data.message).toContain('already boarded');
        });
    });
});




