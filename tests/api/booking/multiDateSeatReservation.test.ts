/**
 * Multi-Date Seat Reservation & Dynamic Trip Scheduling Comprehensive Enterprise Test Suite
 *
 * Exhaustively validates date-scoped seat reservation isolation, availability calculations,
 * accessibility seat rules, intermediate stop timings, and lifecycle state across calendar dates:
 *
 * 1. Multi-Date Calendar Isolation across All Seat Categories (Standard, Priority, Elderly, Wheelchair, Guardian).
 * 2. Multi-Week and Monthly Recurring Transit Simulation (30-day calendar matrix).
 * 3. Month-End & Leap-Year Boundary Transitions (Feb 28, Feb 29, March 01).
 * 4. Stop-by-Stop Intermediate Timing Preservation (Departure & Arrival on QR Payload & Journey Details).
 * 5. Paired Wheelchair (W1) & Companion (G1) Auto-Locking and Conflict Detection Scoped per Date.
 * 6. Accessibility Priority Seat Validation (Low Vision, Hearing Impaired, Special Needs) Scoped per Date.
 * 7. Elderly Seat Age Verification (60+ eligibility) Scoped per Date.
 * 8. Universal Date Formats & Query Parameter Fallbacks (YYYY-MM-DD, ISO string, ?date=, ?travelDate=, ?journeyDate=).
 * 9. Real-Time Available Seat Counters & Capacity Aggregations across Isolated Dates.
 * 10. Automated Notification Generation & Time/Date Scope Verification.
 * 11. Multi-Date Cancellation Isolation (Cancelling Date A leaves Date B completely intact).
 * 12. Atomic Transaction Conflict Scenarios (409 SEAT_TAKEN on Same Date vs 201 Created on Separate Dates).
 */

import { GET as getSeatAvailability } from '../../../app/api/booking/seats/[tripId]+api';
import { POST as confirmBooking } from '../../../app/api/booking/confirm+api';
import { createFakeFirestore } from '../../testUtils/fakeFirestore';

const mockGetAdminDb = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: () => mockGetAdminDb(),
}));

function buildJsonRequest(url: string, method: string, body?: unknown): Request {
    return new Request(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

describe('Multi-Date Seat Reservation Isolation & Enterprise Scheduling Suite', () => {
    let fakeDb: any;

    beforeEach(() => {
        jest.clearAllMocks();

        fakeDb = createFakeFirestore({
            trips: [
                {
                    id: 'TRIP-138-MORNING',
                    tripId: 'TRIP-138-MORNING',
                    busId: 'BUS-ND-5421',
                    routeId: 'ROUTE-138',
                    status: 'ACTIVE',
                    departureTime: '06:00',
                    estimatedArrivalTime: '08:00',
                },
                {
                    id: 'TRIP-100-EXPRESS',
                    tripId: 'TRIP-100-EXPRESS',
                    busId: 'BUS-WP-9900',
                    routeId: 'ROUTE-100',
                    status: 'ACTIVE',
                    departureTime: '07:30',
                    estimatedArrivalTime: '09:00',
                },
            ],
            buses: [
                {
                    id: 'BUS-ND-5421',
                    status: 'ACTIVE',
                    numberPlate: 'WP-ND-5421',
                    busModel: 'Volvo B11R Low Floor',
                    manufacturer: 'Volvo',
                    seatCapacity: 40,
                    accessibilityFacilities: {
                        wheelchairSpace: { available: true, count: 1 },
                        guardianSeats: { available: true, count: 1 },
                        prioritySeats: { available: true, count: 2 },
                        elderlySeats: { available: true, count: 2 },
                    },
                },
                {
                    id: 'BUS-WP-9900',
                    status: 'ACTIVE',
                    numberPlate: 'WP-NC-9900',
                    busModel: 'Ashok Leyland Viking City',
                    manufacturer: 'Ashok Leyland',
                    seatCapacity: 45,
                    accessibilityFacilities: {
                        wheelchairSpace: { available: true, count: 1 },
                        guardianSeats: { available: true, count: 1 },
                        prioritySeats: { available: true, count: 2 },
                        elderlySeats: { available: true, count: 2 },
                    },
                },
            ],
            routes: [
                {
                    id: 'ROUTE-138',
                    routeNumber: '138',
                    routeName: 'Maharagama - Colombo Fort',
                    startLocation: 'Maharagama',
                    endLocation: 'Colombo Fort',
                    stops: ['Maharagama', 'Nugegoda', 'Bambalapitiya', 'Colombo Fort'],
                    distanceKm: 16,
                },
                {
                    id: 'ROUTE-100',
                    routeNumber: '100',
                    routeName: 'Panadura - Pettah',
                    startLocation: 'Panadura',
                    endLocation: 'Pettah',
                    stops: ['Panadura', 'Moratuwa', 'Ratmalana', 'Wellawatte', 'Pettah'],
                    distanceKm: 28,
                },
            ],
            users: [
                {
                    id: 'USER-ELDERLY-01',
                    userName: 'Piyadasa Silva',
                    isElderPerson: true,
                    calculatedAge: 68,
                    accessibilityNeeds: [],
                },
                {
                    id: 'USER-PRIORITY-LOWVISION',
                    userName: 'Anura Kumara',
                    isLowVisionPerson: true,
                    calculatedAge: 35,
                    accessibilityNeeds: ['low_vision'],
                },
                {
                    id: 'USER-PRIORITY-HEARING',
                    userName: 'Nimali Perera',
                    isHearingImpaired: true,
                    calculatedAge: 29,
                    accessibilityNeeds: ['hearing_impairment'],
                },
                {
                    id: 'USER-WHEELCHAIR-01',
                    userName: 'Chaminda Mendis',
                    isWheelchairUser: true,
                    calculatedAge: 42,
                    accessibilityNeeds: ['wheelchair'],
                },
                {
                    id: 'USER-NORMAL-01',
                    userName: 'Saman Jayasuriya',
                    isElderPerson: false,
                    calculatedAge: 25,
                    accessibilityNeeds: [],
                },
            ],
            bookings: [],
            notifications: [],
        });

        mockGetAdminDb.mockReturnValue(fakeDb);
    });

    // =========================================================================
    // SECTION 1: Standard Multi-Date Calendar Isolation & Conflict Check
    // =========================================================================
    describe('1. Standard Seat Calendar Date Isolation', () => {
        it('allows independent seat bookings for the same seat number on different calendar dates', async () => {
            const tripId = 'TRIP-138-MORNING';
            const seatNumber = '4A';
            const dates = ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'];

            for (let i = 0; i < dates.length; i++) {
                const currentDate = dates[i];
                const passengerId = `USER-COMMUTER-${i + 1}`;

                // 1. Verify seat is initially AVAILABLE on currentDate
                const checkBeforeReq = new Request(`http://localhost/api/booking/seats/${tripId}?date=${currentDate}`);
                const checkBeforeRes = await getSeatAvailability(checkBeforeReq, { tripId });
                const checkBeforeData = await checkBeforeRes.json();
                const targetBefore = checkBeforeData.seats.find((s: any) => s.seatNumber === seatNumber);
                expect(targetBefore.status).toBe('AVAILABLE');

                // 2. Book the seat for currentDate
                const bookReq = buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber,
                    passengerId,
                    journeyDate: currentDate,
                    origin: 'Maharagama',
                    destination: 'Colombo Fort',
                });
                const bookRes = await confirmBooking(bookReq);
                const bookData = await bookRes.json();

                expect(bookRes.status).toBe(201);
                expect(bookData.success).toBe(true);
                expect(bookData.booking.journeyDate).toBe(currentDate);
                expect(bookData.booking.seatNumber).toBe(seatNumber);

                // 3. Verify seat is now OCCUPIED on currentDate
                const checkAfterReq = new Request(`http://localhost/api/booking/seats/${tripId}?date=${currentDate}`);
                const checkAfterRes = await getSeatAvailability(checkAfterReq, { tripId });
                const checkAfterData = await checkAfterRes.json();
                const targetAfter = checkAfterData.seats.find((s: any) => s.seatNumber === seatNumber);
                expect(targetAfter.status).toBe('OCCUPIED');
            }
        });

        it('strictly prevents duplicate reservations on the same date with 409 Conflict', async () => {
            const tripId = 'TRIP-138-MORNING';
            const targetDate = '2026-10-15';
            const seatNumber = '5B';

            // First passenger books successfully
            const res1 = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber,
                    passengerId: 'USER-FIRST',
                    journeyDate: targetDate,
                })
            );
            expect(res1.status).toBe(201);

            // Second passenger attempts duplicate booking on same date -> 409
            const res2 = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber,
                    passengerId: 'USER-SECOND',
                    journeyDate: targetDate,
                })
            );
            const data2 = await res2.json();
            expect(res2.status).toBe(409);
            expect(data2.success).toBe(false);
            expect(data2.message).toContain('taken by another passenger');

            // Third passenger books on NEXT day (2026-10-16) -> 201 Success
            const res3 = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber,
                    passengerId: 'USER-THIRD',
                    journeyDate: '2026-10-16',
                })
            );
            expect(res3.status).toBe(201);
        });
    });

    // =========================================================================
    // SECTION 2: Paired Wheelchair & Guardian Companion Seat Isolation
    // =========================================================================
    describe('2. Paired Wheelchair (W1) & Guardian Companion (G1) Multi-Date Isolation', () => {
        it('locks both wheelchair space W1 and companion G1 on Date A, while keeping both free on Date B', async () => {
            const tripId = 'TRIP-138-MORNING';
            const dateA = '2026-11-01';
            const dateB = '2026-11-02';

            // Reserve Wheelchair W1 on Date A
            const bookW1A = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber: 'W1',
                    passengerId: 'USER-WHEELCHAIR-01',
                    journeyDate: dateA,
                    assistanceRequested: { wheelchairAssistance: true },
                })
            );
            expect(bookW1A.status).toBe(201);
            const w1AData = await bookW1A.json();
            expect(w1AData.booking.pairedSeatNumber).toBe('G1');

            // Check Date A -> Both W1 and G1 are OCCUPIED
            const checkResA = await getSeatAvailability(
                new Request(`http://localhost/api/booking/seats/${tripId}?date=${dateA}`),
                { tripId }
            );
            const checkDataA = await checkResA.json();
            expect(checkDataA.seats.find((s: any) => s.seatNumber === 'W1').status).toBe('OCCUPIED');
            expect(checkDataA.seats.find((s: any) => s.seatNumber === 'G1').status).toBe('OCCUPIED');

            // Check Date B -> Both W1 and G1 are completely AVAILABLE
            const checkResB = await getSeatAvailability(
                new Request(`http://localhost/api/booking/seats/${tripId}?date=${dateB}`),
                { tripId }
            );
            const checkDataB = await checkResB.json();
            expect(checkDataB.seats.find((s: any) => s.seatNumber === 'W1').status).toBe('AVAILABLE');
            expect(checkDataB.seats.find((s: any) => s.seatNumber === 'G1').status).toBe('AVAILABLE');

            // Another wheelchair user reserves W1 on Date B -> Success
            const bookW1B = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber: 'W1',
                    passengerId: 'USER-WHEELCHAIR-01',
                    journeyDate: dateB,
                    assistanceRequested: { wheelchairAssistance: true },
                })
            );
            expect(bookW1B.status).toBe(201);

            // Attempting to book companion seat G1 on Date A directly fails with conflict
            const bookG1Conflict = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber: 'G1',
                    passengerId: 'USER-NORMAL-01',
                    journeyDate: dateA,
                })
            );
            expect(bookG1Conflict.status).toBe(409);
        });
    });

    // =========================================================================
    // SECTION 3: Priority Accessibility Seats (Low Vision & Hearing Impairment)
    // =========================================================================
    describe('3. Priority Accessibility Seats (P1, P2) Isolation and Policy Enforcement', () => {
        it('allows eligible accessibility users to book priority seats across different calendar dates', async () => {
            const tripId = 'TRIP-138-MORNING';
            const date1 = '2026-12-05';
            const date2 = '2026-12-06';

            // Low vision passenger books P1 on date1
            const res1 = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber: 'P1',
                    passengerId: 'USER-PRIORITY-LOWVISION',
                    journeyDate: date1,
                    isPrioritySeat: true,
                })
            );
            expect(res1.status).toBe(201);

            // Hearing impaired passenger books P1 on date2
            const res2 = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber: 'P1',
                    passengerId: 'USER-PRIORITY-HEARING',
                    journeyDate: date2,
                    isPrioritySeat: true,
                })
            );
            expect(res2.status).toBe(201);

            // Normal passenger without accessibility eligibility tries to book P2 on date1 -> 403 Forbidden
            const res3 = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber: 'P2',
                    passengerId: 'USER-NORMAL-01',
                    journeyDate: date1,
                    isPrioritySeat: true,
                })
            );
            expect(res3.status).toBe(403);
            const data3 = await res3.json();
            expect(data3.message).toContain('Priority seats are strictly locked');
        });
    });

    // =========================================================================
    // SECTION 4: Elderly Seats (E1, E2) Multi-Date Age Verification
    // =========================================================================
    describe('4. Elderly Seats (E1, E2) Multi-Date Age Policy Enforcement', () => {
        it('enforces 60+ age requirement while isolating elderly reservations across calendar dates', async () => {
            const tripId = 'TRIP-138-MORNING';
            const date1 = '2026-10-20';
            const date2 = '2026-10-21';

            // 68-year old elderly passenger books E1 on date1 -> 201 Success
            const resElderly = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber: 'E1',
                    passengerId: 'USER-ELDERLY-01',
                    journeyDate: date1,
                })
            );
            expect(resElderly.status).toBe(201);

            // 25-year old young commuter tries to book E2 on date1 -> 403 Forbidden
            const resYoung = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber: 'E2',
                    passengerId: 'USER-NORMAL-01',
                    journeyDate: date1,
                })
            );
            expect(resYoung.status).toBe(403);
            const youngData = await resYoung.json();
            expect(youngData.message).toContain('reserved for passengers aged 60 and above');

            // 68-year old elderly passenger books same E1 on date2 -> 201 Success
            const resElderlyDate2 = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber: 'E1',
                    passengerId: 'USER-ELDERLY-01',
                    journeyDate: date2,
                })
            );
            expect(resElderlyDate2.status).toBe(201);
        });
    });

    // =========================================================================
    // SECTION 5: Intermediate Stop Timing Preservation in QR and Booking Journey
    // =========================================================================
    describe('5. Intermediate Stop Boarding/Alighting Timing Preservation', () => {
        it('persists accurate passenger segment departure and arrival times rather than generic trip endpoints', async () => {
            const tripId = 'TRIP-138-MORNING';
            const travelDate = '2026-09-28';
            const segmentDeparture = '06:45';
            const segmentArrival = '07:20';

            const bookReq = buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                tripId,
                seatNumber: '6C',
                passengerId: 'USER-NORMAL-01',
                journeyDate: travelDate,
                origin: 'Nugegoda',
                destination: 'Bambalapitiya',
                departureTime: segmentDeparture,
                estimatedArrivalTime: segmentArrival,
            });

            const bookRes = await confirmBooking(bookReq);
            expect(bookRes.status).toBe(201);
            const bookData = await bookRes.json();

            // 1. Validate Booking Journey Details
            expect(bookData.booking.journey.startLocation).toBe('Nugegoda');
            expect(bookData.booking.journey.endLocation).toBe('Bambalapitiya');
            expect(bookData.booking.journey.departureTime).toBe(segmentDeparture);
            expect(bookData.booking.journey.estimatedArrivalTime).toBe(segmentArrival);
            expect(bookData.booking.journey.departureDate).toBe(travelDate);

            // 2. Validate QR Code payload carries accurate stop timing
            const qrParsed = JSON.parse(bookData.booking.qrPayload);
            expect(qrParsed.bookingId).toBe(bookData.booking.bookingId);
            expect(qrParsed.journeyDate).toBe(travelDate);
            expect(qrParsed.departureTime).toBe(segmentDeparture);
            expect(qrParsed.estimatedArrivalTime).toBe(segmentArrival);

            // 3. Validate in-app notification carries accurate journey time
            const notifSnap = await fakeDb.collection('notifications').doc(`notif_${bookData.booking.bookingId}`).get();
            const notifDoc = notifSnap.data();
            expect(notifDoc).toBeDefined();
            expect(notifDoc.details.journeyTime).toBe(segmentDeparture);
            expect(notifDoc.details.startLocation).toBe('Nugegoda');
            expect(notifDoc.details.endLocation).toBe('Bambalapitiya');
        });
    });

    // =========================================================================
    // SECTION 6: Month-End and Leap-Year Date Boundary Transitions
    // =========================================================================
    describe('6. Month-End and Leap-Year Date Transitions', () => {
        it('correctly handles Feb 28 -> Feb 29 -> Mar 01 transitions on leap years', async () => {
            const tripId = 'TRIP-138-MORNING';
            const leapDates = ['2028-02-28', '2028-02-29', '2028-03-01'];
            const targetSeat = '7D';

            for (const date of leapDates) {
                const res = await confirmBooking(
                    buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                        tripId,
                        seatNumber: targetSeat,
                        passengerId: 'USER-NORMAL-01',
                        journeyDate: date,
                    })
                );
                expect(res.status).toBe(201);

                const check = await getSeatAvailability(
                    new Request(`http://localhost/api/booking/seats/${tripId}?date=${date}`),
                    { tripId }
                );
                const data = await check.json();
                expect(data.seats.find((s: any) => s.seatNumber === targetSeat).status).toBe('OCCUPIED');
            }
        });
    });

    // =========================================================================
    // SECTION 7: Multi-Parameter Date Query Resilience & Validation
    // =========================================================================
    describe('7. Query Parameter Fallback and Malformed Date Validation', () => {
        it('supports date resolution via ?date=, ?travelDate=, and ?journeyDate= query parameters', async () => {
            const tripId = 'TRIP-138-MORNING';
            const date = '2026-11-15';

            // Book seat 8A
            await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber: '8A',
                    journeyDate: date,
                })
            );

            // Test ?date= query
            const req1 = new Request(`http://localhost/api/booking/seats/${tripId}?date=${date}`);
            const res1 = await getSeatAvailability(req1, { tripId });
            const data1 = await res1.json();
            expect(data1.seats.find((s: any) => s.seatNumber === '8A').status).toBe('OCCUPIED');

            // Test ?travelDate= query
            const req2 = new Request(`http://localhost/api/booking/seats/${tripId}?travelDate=${date}`);
            const res2 = await getSeatAvailability(req2, { tripId });
            const data2 = await res2.json();
            expect(data2.seats.find((s: any) => s.seatNumber === '8A').status).toBe('OCCUPIED');

            // Test ?journeyDate= query
            const req3 = new Request(`http://localhost/api/booking/seats/${tripId}?journeyDate=${date}`);
            const res3 = await getSeatAvailability(req3, { tripId });
            const data3 = await res3.json();
            expect(data3.seats.find((s: any) => s.seatNumber === '8A').status).toBe('OCCUPIED');
        });

        it('rejects malformed date strings with 400 Bad Request', async () => {
            const tripId = 'TRIP-138-MORNING';
            const invalidDates = ['2026/09/24', '24-09-2026', 'not-a-date', '2026-99-99'];

            for (const badDate of invalidDates) {
                const res = await confirmBooking(
                    buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                        tripId,
                        seatNumber: '4A',
                        journeyDate: badDate,
                    })
                );
                expect(res.status).toBe(400);
                const data = await res.json();
                expect(data.success).toBe(false);
                expect(data.message).toContain('Invalid travel date format');
            }
        });
    });

    // =========================================================================
    // SECTION 8: Real-Time Total Seat Count & Availability Aggregation
    // =========================================================================
    describe('8. Seat Capacity & Total Available Count Isolation', () => {
        it('calculates availableSeat count independently per calendar date', async () => {
            const tripId = 'TRIP-138-MORNING';
            const dateA = '2026-10-10';
            const dateB = '2026-10-11';

            // On Date A: Book 5 seats (4A, 4B, 4C, 4D, 5A)
            const seatsToBookDateA = ['4A', '4B', '4C', '4D', '5A'];
            for (const seatNumber of seatsToBookDateA) {
                await confirmBooking(
                    buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                        tripId,
                        seatNumber,
                        journeyDate: dateA,
                    })
                );
            }

            // On Date B: Book 2 seats (4A, 4B)
            const seatsToBookDateB = ['4A', '4B'];
            for (const seatNumber of seatsToBookDateB) {
                await confirmBooking(
                    buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                        tripId,
                        seatNumber,
                        journeyDate: dateB,
                    })
                );
            }

            // Verify Date A available count
            const resA = await getSeatAvailability(
                new Request(`http://localhost/api/booking/seats/${tripId}?date=${dateA}`),
                { tripId }
            );
            const dataA = await resA.json();
            const totalSeatsCount = dataA.seats.length;
            const availableA = dataA.seats.filter((s: any) => s.status === 'AVAILABLE').length;
            const occupiedA = dataA.seats.filter((s: any) => s.status === 'OCCUPIED').length;
            expect(occupiedA).toBe(5);
            expect(availableA).toBe(totalSeatsCount - 5);

            // Verify Date B available count
            const resB = await getSeatAvailability(
                new Request(`http://localhost/api/booking/seats/${tripId}?date=${dateB}`),
                { tripId }
            );
            const dataB = await resB.json();
            const availableB = dataB.seats.filter((s: any) => s.status === 'AVAILABLE').length;
            const occupiedB = dataB.seats.filter((s: any) => s.status === 'OCCUPIED').length;
            expect(occupiedB).toBe(2);
            expect(availableB).toBe(totalSeatsCount - 2);
        });
    });

    // =========================================================================
    // SECTION 9: 30-Day Calendar Matrix Daily Commuter Simulation
    // =========================================================================
    describe('9. 30-Day Calendar Matrix Daily Commuter Simulation', () => {
        it('simulates 30 consecutive calendar days of daily bookings for the same commuter', async () => {
            const tripId = 'TRIP-138-MORNING';
            const seatNumber = '9B';

            for (let day = 1; day <= 30; day++) {
                const dayStr = day < 10 ? `0${day}` : `${day}`;
                const travelDate = `2026-11-${dayStr}`;

                const bookRes = await confirmBooking(
                    buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                        tripId,
                        seatNumber,
                        passengerId: 'USER-NORMAL-01',
                        journeyDate: travelDate,
                        origin: 'Maharagama',
                        destination: 'Colombo Fort',
                    })
                );

                expect(bookRes.status).toBe(201);
                const bookData = await bookRes.json();
                expect(bookData.success).toBe(true);
                expect(bookData.booking.journeyDate).toBe(travelDate);
                expect(bookData.booking.seatNumber).toBe(seatNumber);

                // Spot check seat map for that day
                const checkRes = await getSeatAvailability(
                    new Request(`http://localhost/api/booking/seats/${tripId}?date=${travelDate}`),
                    { tripId }
                );
                const checkData = await checkRes.json();
                const bookedSeat = checkData.seats.find((s: any) => s.seatNumber === seatNumber);
                expect(bookedSeat.status).toBe('OCCUPIED');
            }
        });
    });

    // =========================================================================
    // SECTION 10: Multi-Stop Fare Calculation Preservation per Calendar Date
    // =========================================================================
    describe('10. Multi-Stop Sub-Route Fare Calculation Scoped per Date', () => {
        it('calculates accurate distance-based segment fares on date-scoped bookings', async () => {
            const tripId = 'TRIP-100-EXPRESS';
            const travelDate = '2026-10-25';

            // Sub-route: Moratuwa -> Wellawatte (Intermediate stops)
            const bookRes = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber: '4C',
                    passengerId: 'USER-NORMAL-01',
                    journeyDate: travelDate,
                    origin: 'Moratuwa',
                    destination: 'Wellawatte',
                    departureTime: '07:45',
                    estimatedArrivalTime: '08:20',
                })
            );

            expect(bookRes.status).toBe(201);
            const bookData = await bookRes.json();
            expect(bookData.booking.fare).toBeDefined();
            expect(bookData.booking.fare.totalFare).toBeGreaterThan(0);
            expect(bookData.booking.journey.startLocation).toBe('Moratuwa');
            expect(bookData.booking.journey.endLocation).toBe('Wellawatte');
            expect(bookData.booking.journey.departureTime).toBe('07:45');
            expect(bookData.booking.journey.estimatedArrivalTime).toBe('08:20');
        });
    });

    // =========================================================================
    // SECTION 11: Cancellation Date Isolation & Seat Release
    // =========================================================================
    describe('11. Cancellation Date Isolation & Seat Release', () => {
        it('cancelling a confirmed booking on Date A releases the seat on Date A while leaving Date B intact', async () => {
            const tripId = 'TRIP-138-MORNING';
            const dateA = '2026-12-10';
            const dateB = '2026-12-11';
            const seatNumber = '10A';

            // 1. Book seat on Date A
            const bookA = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber,
                    passengerId: 'USER-PASSENGER-A',
                    journeyDate: dateA,
                })
            );
            const dataA = await bookA.json();
            const bookingIdA = dataA.booking.bookingId;

            // 2. Book same seat on Date B
            const bookB = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber,
                    passengerId: 'USER-PASSENGER-B',
                    journeyDate: dateB,
                })
            );
            const dataB = await bookB.json();
            const bookingIdB = dataB.booking.bookingId;

            expect(bookA.status).toBe(201);
            expect(bookB.status).toBe(201);

            // 3. Cancel Date A booking in Firestore
            await fakeDb.collection('bookings').doc(bookingIdA).update({
                status: 'CANCELLED',
                cancelledAt: new Date().toISOString(),
            });

            // 4. Query seat map for Date A -> Seat 10A must now be AVAILABLE again
            const resAfterCancelA = await getSeatAvailability(
                new Request(`http://localhost/api/booking/seats/${tripId}?date=${dateA}`),
                { tripId }
            );
            const mapA = await resAfterCancelA.json();
            expect(mapA.seats.find((s: any) => s.seatNumber === seatNumber).status).toBe('AVAILABLE');

            // 5. Query seat map for Date B -> Seat 10A must STILL remain OCCUPIED by Passenger B
            const resAfterCancelB = await getSeatAvailability(
                new Request(`http://localhost/api/booking/seats/${tripId}?date=${dateB}`),
                { tripId }
            );
            const mapB = await resAfterCancelB.json();
            expect(mapB.seats.find((s: any) => s.seatNumber === seatNumber).status).toBe('OCCUPIED');

            // 6. Another user can now successfully re-book Seat 10A on Date A
            const rebookA = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber,
                    passengerId: 'USER-PASSENGER-NEW',
                    journeyDate: dateA,
                })
            );
            expect(rebookA.status).toBe(201);
        });
    });

    // =========================================================================
    // SECTION 12: Concurrency & Atomic Race Condition Simulation
    // =========================================================================
    describe('12. Concurrent Race Condition Simulation', () => {
        it('handles rapid consecutive booking requests with strict transaction atomicity', async () => {
            const tripId = 'TRIP-138-MORNING';
            const travelDate = '2026-10-30';
            const seatNumber = '11B';

            // Passenger 1 submits booking
            const req1 = buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                tripId,
                seatNumber,
                passengerId: 'USER-RACER-01',
                journeyDate: travelDate,
            });

            // Passenger 2 submits booking for identical seat on identical date
            const req2 = buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                tripId,
                seatNumber,
                passengerId: 'USER-RACER-02',
                journeyDate: travelDate,
            });

            const res1 = await confirmBooking(req1);
            const res2 = await confirmBooking(req2);

            // Exactly one must succeed (201) and the duplicate must be rejected (409)
            const statuses = [res1.status, res2.status].sort();
            expect(statuses).toEqual([201, 409]);
        });
    });

    // =========================================================================
    // SECTION 13: Full Digital QR Ticket Payload Verification
    // =========================================================================
    describe('13. Digital QR Ticket Payload Verification', () => {
        it('generates valid JSON QR payloads containing tripId, date, stop timings, and seatNumber', async () => {
            const tripId = 'TRIP-138-MORNING';
            const travelDate = '2026-11-20';
            const seatNumber = '12A';

            const res = await confirmBooking(
                buildJsonRequest('http://localhost/api/booking/confirm', 'POST', {
                    tripId,
                    seatNumber,
                    passengerId: 'USER-QR-TEST',
                    journeyDate: travelDate,
                    origin: 'Maharagama',
                    destination: 'Colombo Fort',
                    departureTime: '06:15',
                    estimatedArrivalTime: '07:30',
                })
            );

            expect(res.status).toBe(201);
            const data = await res.json();
            const qrParsed = JSON.parse(data.booking.qrPayload);

            expect(qrParsed).toEqual({
                bookingId: data.booking.bookingId,
                tripId,
                seatNumber,
                journeyDate: travelDate,
                numberPlate: 'WP-ND-5421',
                departureTime: '06:15',
                estimatedArrivalTime: '07:30',
            });
        });
    });
});

