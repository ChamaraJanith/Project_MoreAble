import { calculateFare, DEFAULT_FARE_POLICY, FareCalculationOptions } from '../../../src/shared/utils/fare';
import { FarePolicy, FareBreakdown } from '../../../src/entities/booking/model/types';
import { GET as getFarePolicyApi, PUT as updateFarePolicyApi, POST as resetFarePolicyApi } from '../../../app/api/fare-policy+api';
import { GET as getBookingFareApi } from '../../../app/api/booking/fare+api';

// Mock Firebase Admin SDK for testing
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDoc = jest.fn();
const mockCollection = jest.fn();
const mockWhere = jest.fn();
const mockLimit = jest.fn();

jest.mock('../../../src/shared/config/firebaseAdmin', () => ({
    getAdminDb: jest.fn(() => ({
        collection: mockCollection,
    })),
}));

jest.mock('../../../src/shared/server/routeDistance', () => ({
    computeRouteSegmentDistance: jest.fn().mockImplementation((_db, _stops, originIndex, destIndex, routeTotalKm) => {
        const diff = Math.max(1, destIndex - originIndex);
        const segmentKm = routeTotalKm ? (routeTotalKm / 10) * diff : diff * 3.5;
        return Promise.resolve({
            distanceKm: Math.round(segmentKm * 10) / 10,
            isPrecise: true,
        });
    }),
}));

describe('Dynamic Fare Policy Engine & Admin Pricing Management - Enterprise Test Suite', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCollection.mockReturnValue({
            doc: mockDoc.mockReturnValue({
                get: mockGet,
                set: mockSet,
            }),
            where: mockWhere.mockReturnValue({
                limit: mockLimit.mockReturnValue({
                    get: mockGet,
                }),
                get: mockGet,
            }),
        });
    });

    // =========================================================================
    // 1. BASELINE MATHEMATICAL FARE CALCULATIONS & BOUNDARY INVARIANTS
    // =========================================================================
    describe('1. Baseline Mathematical Calculations & Boundary Invariants', () => {
        it('calculates exact minimum base fare for journeys strictly under 1 km (0.2 km)', () => {
            const fare = calculateFare(0.2, true);
            expect(fare.distanceKm).toBe(0.2);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(0);
            expect(fare.subtotalFare).toBe(30);
            expect(fare.totalFare).toBe(30);
            expect(fare.currency).toBe('LKR');
            expect(fare.isEstimate).toBe(false);
        });

        it('calculates exact minimum base fare for journeys strictly under 1 km (0.5 km)', () => {
            const fare = calculateFare(0.5, true);
            expect(fare.distanceKm).toBe(0.5);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(0);
            expect(fare.subtotalFare).toBe(30);
            expect(fare.totalFare).toBe(30);
        });

        it('calculates minimum base fare for journeys at 1.0 km', () => {
            const fare = calculateFare(1.0, true);
            expect(fare.distanceKm).toBe(1.0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(0);
            expect(fare.totalFare).toBe(30);
        });

        it('calculates minimum base fare for journeys at 1.5 km', () => {
            const fare = calculateFare(1.5, true);
            expect(fare.distanceKm).toBe(1.5);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(0);
            expect(fare.totalFare).toBe(30);
        });

        it('calculates minimum base fare for journeys at 1.9 km (just under base distance)', () => {
            const fare = calculateFare(1.9, true);
            expect(fare.distanceKm).toBe(1.9);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(0);
            expect(fare.totalFare).toBe(30);
        });

        it('calculates minimum base fare at exact threshold of 2.0 km', () => {
            const fare = calculateFare(2.0, true);
            expect(fare.distanceKm).toBe(2.0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(0);
            expect(fare.totalFare).toBe(30);
        });

        it('calculates incremental distance fare at 2.1 km (0.1 billable km @ Rs 8.50/km)', () => {
            // Billable: 0.1km. 0.1 * 8.5 = 0.85 -> ceil is 1 LKR. Base = 30 -> 31 LKR.
            const fare = calculateFare(2.1, true);
            expect(fare.distanceKm).toBe(2.1);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(1);
            expect(fare.subtotalFare).toBe(31);
            expect(fare.totalFare).toBe(31);
        });

        it('calculates incremental distance fare at 2.5 km (0.5 billable km @ Rs 8.50/km)', () => {
            // Billable: 0.5km. 0.5 * 8.5 = 4.25 -> ceil is 5 LKR. Base = 30 -> 35 LKR.
            const fare = calculateFare(2.5, true);
            expect(fare.distanceKm).toBe(2.5);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(5);
            expect(fare.subtotalFare).toBe(35);
            expect(fare.totalFare).toBe(35);
        });

        it('calculates incremental distance fare at 3.0 km (1.0 billable km @ Rs 8.50/km)', () => {
            // Billable: 1.0km. 1.0 * 8.5 = 8.5 -> ceil is 9 LKR. Base = 30 -> 39 LKR.
            const fare = calculateFare(3.0, true);
            expect(fare.distanceKm).toBe(3.0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(9);
            expect(fare.subtotalFare).toBe(39);
            expect(fare.totalFare).toBe(39);
        });

        it('calculates incremental distance fare at 4.0 km (2.0 billable km @ Rs 8.50/km)', () => {
            // Billable: 2.0km. 2.0 * 8.5 = 17 LKR. Base = 30 -> 47 LKR.
            const fare = calculateFare(4.0, true);
            expect(fare.distanceKm).toBe(4.0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(17);
            expect(fare.subtotalFare).toBe(47);
            expect(fare.totalFare).toBe(47);
        });

        it('calculates incremental distance fare at 5.0 km (3.0 billable km @ Rs 8.50/km)', () => {
            // Billable: 3.0km. 3.0 * 8.5 = 25.5 -> ceil is 26 LKR. Base = 30 -> 56 LKR.
            const fare = calculateFare(5.0, true);
            expect(fare.distanceKm).toBe(5.0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(26);
            expect(fare.subtotalFare).toBe(56);
            expect(fare.totalFare).toBe(56);
        });

        it('calculates incremental distance fare at 7.5 km (5.5 billable km @ Rs 8.50/km)', () => {
            // Billable: 5.5km. 5.5 * 8.5 = 46.75 -> ceil 47 LKR. Base = 30 -> 77 LKR.
            const fare = calculateFare(7.5, true);
            expect(fare.distanceKm).toBe(7.5);
            expect(fare.distanceFare).toBe(47);
            expect(fare.totalFare).toBe(77);
        });

        it('calculates incremental distance fare at 10.0 km (8.0 billable km @ Rs 8.50/km)', () => {
            // Billable: 8.0km. 8.0 * 8.5 = 68.0 -> ceil is 68 LKR. Base = 30 -> 98 LKR.
            const fare = calculateFare(10.0, true);
            expect(fare.distanceKm).toBe(10.0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(68);
            expect(fare.subtotalFare).toBe(98);
            expect(fare.totalFare).toBe(98);
        });

        it('calculates incremental distance fare at 15.0 km (13.0 billable km @ Rs 8.50/km)', () => {
            // Billable: 13.0km. 13.0 * 8.5 = 110.5 -> ceil 111 LKR. Base = 30 -> 141 LKR.
            const fare = calculateFare(15.0, true);
            expect(fare.distanceKm).toBe(15.0);
            expect(fare.distanceFare).toBe(111);
            expect(fare.totalFare).toBe(141);
        });

        it('calculates incremental distance fare at 20.0 km (18.0 billable km @ Rs 8.50/km)', () => {
            // Billable: 18.0km. 18.0 * 8.5 = 153 LKR. Base = 30 -> 183 LKR.
            const fare = calculateFare(20.0, true);
            expect(fare.distanceKm).toBe(20.0);
            expect(fare.distanceFare).toBe(153);
            expect(fare.totalFare).toBe(183);
        });

        it('calculates incremental distance fare at 25.0 km (23.0 billable km @ Rs 8.50/km)', () => {
            // Billable: 23.0km. 23.0 * 8.5 = 195.5 -> ceil is 196 LKR. Base = 30 -> 226 LKR.
            const fare = calculateFare(25.0, true);
            expect(fare.distanceKm).toBe(25.0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(196);
            expect(fare.subtotalFare).toBe(226);
            expect(fare.totalFare).toBe(226);
        });

        it('calculates incremental distance fare at 30.0 km (28.0 billable km @ Rs 8.50/km)', () => {
            // Billable: 28.0km. 28.0 * 8.5 = 238 LKR. Base = 30 -> 268 LKR.
            const fare = calculateFare(30.0, true);
            expect(fare.distanceKm).toBe(30.0);
            expect(fare.distanceFare).toBe(238);
            expect(fare.totalFare).toBe(268);
        });

        it('calculates long-haul transit fare at 50.0 km (48.0 billable km @ Rs 8.50/km)', () => {
            // Billable: 48.0km. 48.0 * 8.5 = 408 LKR. Base = 30 -> 438 LKR.
            const fare = calculateFare(50.0, true);
            expect(fare.distanceKm).toBe(50.0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(408);
            expect(fare.subtotalFare).toBe(438);
            expect(fare.totalFare).toBe(438);
        });

        it('calculates long-haul transit fare at 75.0 km (73.0 billable km @ Rs 8.50/km)', () => {
            // Billable: 73.0km. 73.0 * 8.5 = 620.5 -> ceil 621 LKR. Base = 30 -> 651 LKR.
            const fare = calculateFare(75.0, true);
            expect(fare.distanceKm).toBe(75.0);
            expect(fare.distanceFare).toBe(621);
            expect(fare.totalFare).toBe(651);
        });

        it('calculates long-haul transit fare at 100.0 km (98.0 billable km @ Rs 8.50/km)', () => {
            // Billable: 98.0km. 98.0 * 8.5 = 833 LKR. Base = 30 -> 863 LKR.
            const fare = calculateFare(100.0, true);
            expect(fare.distanceKm).toBe(100.0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(833);
            expect(fare.subtotalFare).toBe(863);
            expect(fare.totalFare).toBe(863);
        });

        it('calculates intercity long-distance transit fare at 150.0 km', () => {
            // Billable: 148.0km. 148.0 * 8.5 = 1258 LKR. Base = 30 -> 1288 LKR.
            const fare = calculateFare(150.0, true);
            expect(fare.distanceKm).toBe(150.0);
            expect(fare.distanceFare).toBe(1258);
            expect(fare.totalFare).toBe(1288);
        });

        it('calculates intercity long-distance transit fare at 200.0 km', () => {
            // Billable: 198.0km. 198.0 * 8.5 = 1683 LKR. Base = 30 -> 1713 LKR.
            const fare = calculateFare(200.0, true);
            expect(fare.distanceKm).toBe(200.0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(1683);
            expect(fare.subtotalFare).toBe(1713);
            expect(fare.totalFare).toBe(1713);
        });

        it('calculates cross-country long-distance transit fare at 350.0 km', () => {
            // Billable: 348.0km. 348.0 * 8.5 = 2958 LKR. Base = 30 -> 2988 LKR.
            const fare = calculateFare(350.0, true);
            expect(fare.distanceKm).toBe(350.0);
            expect(fare.distanceFare).toBe(2958);
            expect(fare.totalFare).toBe(2988);
        });

        it('handles fractional kilometer precision with 1 decimal rounding', () => {
            const fare = calculateFare(12.345, true);
            expect(fare.distanceKm).toBe(12.3);
            // Billable: 10.3km. 10.3 * 8.5 = 87.55 -> ceil 88. Base = 30 -> 118 LKR.
            expect(fare.distanceFare).toBe(88);
            expect(fare.totalFare).toBe(118);
        });

        it('handles zero distance cleanly by returning base minimum fare', () => {
            const fare = calculateFare(0, true);
            expect(fare.distanceKm).toBe(0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(0);
            expect(fare.totalFare).toBe(30);
        });

        it('handles negative distance cleanly by treating as 0 km', () => {
            const fare = calculateFare(-15.5, true);
            expect(fare.distanceKm).toBe(0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(0);
            expect(fare.totalFare).toBe(30);
        });

        it('handles NaN distance cleanly by treating as 0 km', () => {
            const fare = calculateFare(NaN, true);
            expect(fare.distanceKm).toBe(0);
            expect(fare.baseFare).toBe(30);
            expect(fare.distanceFare).toBe(0);
            expect(fare.totalFare).toBe(30);
        });

        it('sets isEstimate flag accurately according to isPrecise flag', () => {
            const preciseFare = calculateFare(12.0, true);
            expect(preciseFare.isEstimate).toBe(false);

            const estimatedFare = calculateFare(12.0, false);
            expect(estimatedFare.isEstimate).toBe(true);
        });
    });

    // =========================================================================
    // 2. ACCESSIBILITY & COMMUNITY CONCESSION DISCOUNT MATRIX
    // =========================================================================
    describe('2. Accessibility & Community Concession Discounts', () => {
        it('applies 20% accessibility discount on minimum fare (30 LKR -> 24 LKR)', () => {
            const fare = calculateFare(1.5, true, { isAccessibilityEligible: true });
            expect(fare.subtotalFare).toBe(30);
            expect(fare.concessionType).toBe('ACCESSIBILITY');
            expect(fare.concessionDiscountPercent).toBe(20);
            expect(fare.concessionDiscount).toBe(6); // 20% of 30 = 6
            expect(fare.totalFare).toBe(24);
        });

        it('applies 20% accessibility discount on 5 km trip (56 LKR -> 45 LKR)', () => {
            const fare = calculateFare(5.0, true, { isAccessibilityEligible: true });
            expect(fare.subtotalFare).toBe(56);
            expect(fare.concessionDiscount).toBe(11); // 20% of 56 = 11.2 -> 11
            expect(fare.totalFare).toBe(45);
        });

        it('applies 20% accessibility discount on 10 km trip (98 LKR -> 78 LKR)', () => {
            const fare = calculateFare(10.0, true, { isAccessibilityEligible: true });
            expect(fare.subtotalFare).toBe(98);
            expect(fare.concessionDiscount).toBe(20); // 20% of 98 = 19.6 -> 20
            expect(fare.totalFare).toBe(78);
        });

        it('applies 20% accessibility discount on 15 km trip (141 LKR -> 113 LKR)', () => {
            const fare = calculateFare(15.0, true, { isAccessibilityEligible: true });
            expect(fare.subtotalFare).toBe(141);
            expect(fare.concessionDiscount).toBe(28); // 20% of 141 = 28.2 -> 28
            expect(fare.totalFare).toBe(113);
        });

        it('applies 20% accessibility discount on 25 km trip (226 LKR -> 181 LKR)', () => {
            const fare = calculateFare(25.0, true, { isAccessibilityEligible: true });
            expect(fare.subtotalFare).toBe(226);
            expect(fare.concessionDiscount).toBe(45); // 20% of 226 = 45.2 -> 45
            expect(fare.totalFare).toBe(181);
        });

        it('applies 20% accessibility discount on 50 km trip (438 LKR -> 350 LKR)', () => {
            const fare = calculateFare(50.0, true, { isAccessibilityEligible: true });
            expect(fare.subtotalFare).toBe(438);
            expect(fare.concessionDiscount).toBe(88); // 20% of 438 = 87.6 -> 88
            expect(fare.totalFare).toBe(350);
        });

        it('applies 20% accessibility discount on 100 km trip (863 LKR -> 690 LKR)', () => {
            const fare = calculateFare(100.0, true, { isAccessibilityEligible: true });
            expect(fare.subtotalFare).toBe(863);
            expect(fare.concessionDiscount).toBe(173); // 20% of 863 = 172.6 -> 173
            expect(fare.totalFare).toBe(690);
        });

        it('applies 20% accessibility discount on 200 km trip (1713 LKR -> 1370 LKR)', () => {
            const fare = calculateFare(200.0, true, { isAccessibilityEligible: true });
            expect(fare.subtotalFare).toBe(1713);
            expect(fare.concessionDiscount).toBe(343); // 20% of 1713 = 342.6 -> 343
            expect(fare.totalFare).toBe(1370);
        });

        it('does not apply discount for non-eligible standard commuter', () => {
            const fare = calculateFare(10.0, true, { isAccessibilityEligible: false });
            expect(fare.concessionType).toBe('NONE');
            expect(fare.concessionDiscountPercent).toBe(0);
            expect(fare.concessionDiscount).toBe(0);
            expect(fare.totalFare).toBe(98);
        });
    });

    // =========================================================================
    // 3. SENIOR CITIZEN (60+) CONCESSION DISCOUNT MATRIX
    // =========================================================================
    describe('3. Senior Citizen (60+) Concession Discount Matrix', () => {
        it('applies 15% elderly discount on minimum fare (30 LKR -> 25 LKR)', () => {
            const fare = calculateFare(1.5, true, { isElderlyEligible: true });
            expect(fare.subtotalFare).toBe(30);
            expect(fare.concessionType).toBe('ELDERLY');
            expect(fare.concessionDiscountPercent).toBe(15);
            expect(fare.concessionDiscount).toBe(5); // 15% of 30 = 4.5 -> 5
            expect(fare.totalFare).toBe(25);
        });

        it('applies 15% elderly discount on 5 km trip (56 LKR -> 48 LKR)', () => {
            const fare = calculateFare(5.0, true, { isElderlyEligible: true });
            expect(fare.subtotalFare).toBe(56);
            expect(fare.concessionDiscount).toBe(8); // 15% of 56 = 8.4 -> 8
            expect(fare.totalFare).toBe(48);
        });

        it('applies 15% elderly discount on 10 km trip (98 LKR -> 83 LKR)', () => {
            const fare = calculateFare(10.0, true, { isElderlyEligible: true });
            expect(fare.subtotalFare).toBe(98);
            expect(fare.concessionDiscount).toBe(15); // 15% of 98 = 14.7 -> 15
            expect(fare.totalFare).toBe(83);
        });

        it('applies 15% elderly discount on 15 km trip (141 LKR -> 120 LKR)', () => {
            const fare = calculateFare(15.0, true, { isElderlyEligible: true });
            expect(fare.subtotalFare).toBe(141);
            expect(fare.concessionDiscount).toBe(21); // 15% of 141 = 21.15 -> 21
            expect(fare.totalFare).toBe(120);
        });

        it('applies 15% elderly discount on 25 km trip (226 LKR -> 192 LKR)', () => {
            const fare = calculateFare(25.0, true, { isElderlyEligible: true });
            expect(fare.subtotalFare).toBe(226);
            expect(fare.concessionDiscount).toBe(34); // 15% of 226 = 33.9 -> 34
            expect(fare.totalFare).toBe(192);
        });

        it('applies 15% elderly discount on 50 km trip (438 LKR -> 372 LKR)', () => {
            const fare = calculateFare(50.0, true, { isElderlyEligible: true });
            expect(fare.subtotalFare).toBe(438);
            expect(fare.concessionDiscount).toBe(66); // 15% of 438 = 65.7 -> 66
            expect(fare.totalFare).toBe(372);
        });

        it('applies 15% elderly discount on 100 km trip (863 LKR -> 734 LKR)', () => {
            const fare = calculateFare(100.0, true, { isElderlyEligible: true });
            expect(fare.subtotalFare).toBe(863);
            expect(fare.concessionDiscount).toBe(129); // 15% of 863 = 129.45 -> 129
            expect(fare.totalFare).toBe(734);
        });

        it('gives priority to Accessibility concession over Elderly concession when passenger qualifies for both', () => {
            // Accessibility is 20% vs Elderly 15%. Accessibility discount should be applied.
            const fare = calculateFare(10.0, true, {
                isAccessibilityEligible: true,
                isElderlyEligible: true,
            });

            expect(fare.concessionType).toBe('ACCESSIBILITY');
            expect(fare.concessionDiscountPercent).toBe(20);
            expect(fare.concessionDiscount).toBe(20);
            expect(fare.totalFare).toBe(78);
        });
    });

    // =========================================================================
    // 4. CONDUCTOR DEDICATED ASSISTANCE SERVICE SURCHARGE
    // =========================================================================
    describe('4. Conductor Dedicated Assistance Service Surcharge', () => {
        it('adds exact Rs. 50 assistance surcharge on short trip (30 + 50 = 80 LKR)', () => {
            const fare = calculateFare(1.0, true, { hasAssistanceRequested: true });
            expect(fare.baseFare).toBe(30);
            expect(fare.subtotalFare).toBe(30);
            expect(fare.assistanceFee).toBe(50);
            expect(fare.totalFare).toBe(80);
        });

        it('adds exact Rs. 50 assistance surcharge on 5 km trip (56 + 50 = 106 LKR)', () => {
            const fare = calculateFare(5.0, true, { hasAssistanceRequested: true });
            expect(fare.subtotalFare).toBe(56);
            expect(fare.assistanceFee).toBe(50);
            expect(fare.totalFare).toBe(106);
        });

        it('adds exact Rs. 50 assistance surcharge on 10 km trip (98 + 50 = 148 LKR)', () => {
            const fare = calculateFare(10.0, true, { hasAssistanceRequested: true });
            expect(fare.subtotalFare).toBe(98);
            expect(fare.assistanceFee).toBe(50);
            expect(fare.totalFare).toBe(148);
        });

        it('adds exact Rs. 50 assistance surcharge on 25 km trip (226 + 50 = 276 LKR)', () => {
            const fare = calculateFare(25.0, true, { hasAssistanceRequested: true });
            expect(fare.subtotalFare).toBe(226);
            expect(fare.assistanceFee).toBe(50);
            expect(fare.totalFare).toBe(276);
        });

        it('adds exact Rs. 50 assistance surcharge on 50 km trip (438 + 50 = 488 LKR)', () => {
            const fare = calculateFare(50.0, true, { hasAssistanceRequested: true });
            expect(fare.subtotalFare).toBe(438);
            expect(fare.assistanceFee).toBe(50);
            expect(fare.totalFare).toBe(488);
        });

        it('does not add assistance surcharge when hasAssistanceRequested is false or undefined', () => {
            const fareFalse = calculateFare(10.0, true, { hasAssistanceRequested: false });
            expect(fareFalse.assistanceFee).toBe(0);
            expect(fareFalse.totalFare).toBe(98);

            const fareUndefined = calculateFare(10.0, true, {});
            expect(fareUndefined.assistanceFee).toBe(0);
            expect(fareUndefined.totalFare).toBe(98);
        });

        it('seamlessly combines Accessibility Concession Discount with Assistance Surcharge', () => {
            // 10 km: Subtotal 98 LKR. 20% accessibility discount = 20 LKR. Net = 78 LKR.
            // Assistance surcharge = 50 LKR. Total = 78 + 50 = 128 LKR.
            const fare = calculateFare(10.0, true, {
                isAccessibilityEligible: true,
                hasAssistanceRequested: true,
            });

            expect(fare.subtotalFare).toBe(98);
            expect(fare.concessionType).toBe('ACCESSIBILITY');
            expect(fare.concessionDiscount).toBe(20);
            expect(fare.assistanceFee).toBe(50);
            expect(fare.totalFare).toBe(128);
        });

        it('seamlessly combines Elderly Concession Discount with Assistance Surcharge', () => {
            // 10 km: Subtotal 98 LKR. 15% elderly discount = 15 LKR. Net = 83 LKR.
            // Assistance surcharge = 50 LKR. Total = 83 + 50 = 133 LKR.
            const fare = calculateFare(10.0, true, {
                isElderlyEligible: true,
                hasAssistanceRequested: true,
            });

            expect(fare.subtotalFare).toBe(98);
            expect(fare.concessionType).toBe('ELDERLY');
            expect(fare.concessionDiscount).toBe(15);
            expect(fare.assistanceFee).toBe(50);
            expect(fare.totalFare).toBe(133);
        });
    });

    // =========================================================================
    // 5. CUSTOM ADMIN POLICY MODULATION & CONFIGURATION PERMUTATIONS
    // =========================================================================
    describe('5. Custom Admin Policy Modulation & Permutations', () => {
        const premiumExpressPolicy: FarePolicy = {
            id: 'default',
            currency: 'LKR',
            baseFare: 50,
            baseDistanceKm: 3.0,
            ratePerKm: 12.0,
            accessibilityDiscountPercent: 30,
            elderlyDiscountPercent: 25,
            assistanceSurchargeLkr: 75,
            guardianCompanionRatePercent: 100,
            updatedAt: '2026-09-21T18:00:00Z',
            updatedBy: 'Chief Transit Officer',
        };

        const budgetAffordablePolicy: FarePolicy = {
            id: 'default',
            currency: 'LKR',
            baseFare: 25,
            baseDistanceKm: 2.0,
            ratePerKm: 7.0,
            accessibilityDiscountPercent: 35,
            elderlyDiscountPercent: 30,
            assistanceSurchargeLkr: 30,
            guardianCompanionRatePercent: 100,
            updatedAt: '2026-09-21T18:00:00Z',
            updatedBy: 'Community Transport Council',
        };

        it('correctly calculates fare under premium express policy on base distance', () => {
            const fare = calculateFare(2.5, true, { policy: premiumExpressPolicy });
            expect(fare.baseFare).toBe(50);
            expect(fare.distanceFare).toBe(0);
            expect(fare.subtotalFare).toBe(50);
            expect(fare.totalFare).toBe(50);
        });

        it('correctly calculates incremental distance fare under premium express policy (10 km)', () => {
            // Billable: 10 - 3 = 7 km. 7 * 12 = 84 LKR. Base = 50 -> Subtotal = 134 LKR.
            const fare = calculateFare(10.0, true, { policy: premiumExpressPolicy });
            expect(fare.baseFare).toBe(50);
            expect(fare.distanceFare).toBe(84);
            expect(fare.subtotalFare).toBe(134);
            expect(fare.totalFare).toBe(134);
        });

        it('correctly applies custom 30% accessibility discount under premium policy', () => {
            // Subtotal 134 LKR. 30% discount = 40.2 -> 40 LKR. Net = 94 LKR.
            const fare = calculateFare(10.0, true, {
                policy: premiumExpressPolicy,
                isAccessibilityEligible: true,
            });

            expect(fare.concessionDiscountPercent).toBe(30);
            expect(fare.concessionDiscount).toBe(40);
            expect(fare.totalFare).toBe(94);
        });

        it('correctly applies custom 25% elderly discount under premium policy', () => {
            // Subtotal 134 LKR. 25% discount = 33.5 -> 34 LKR. Net = 100 LKR.
            const fare = calculateFare(10.0, true, {
                policy: premiumExpressPolicy,
                isElderlyEligible: true,
            });

            expect(fare.concessionDiscountPercent).toBe(25);
            expect(fare.concessionDiscount).toBe(34);
            expect(fare.totalFare).toBe(100);
        });

        it('correctly adds custom Rs. 75 assistance surcharge under premium policy', () => {
            // Subtotal 134 LKR. Assistance = 75 LKR. Total = 209 LKR.
            const fare = calculateFare(10.0, true, {
                policy: premiumExpressPolicy,
                hasAssistanceRequested: true,
            });

            expect(fare.subtotalFare).toBe(134);
            expect(fare.assistanceFee).toBe(75);
            expect(fare.totalFare).toBe(209);
        });

        it('correctly combines custom accessibility discount and custom assistance surcharge under premium policy', () => {
            // Subtotal 134 LKR. 30% discount = 40 LKR. Net = 94 LKR. Assistance = 75 LKR. Total = 169 LKR.
            const fare = calculateFare(10.0, true, {
                policy: premiumExpressPolicy,
                isAccessibilityEligible: true,
                hasAssistanceRequested: true,
            });

            expect(fare.subtotalFare).toBe(134);
            expect(fare.concessionDiscount).toBe(40);
            expect(fare.assistanceFee).toBe(75);
            expect(fare.totalFare).toBe(169);
        });

        it('correctly calculates fare under budget affordable policy (10 km)', () => {
            // Billable: 8km * 7 = 56 LKR. Base = 25 -> Subtotal = 81 LKR.
            const fare = calculateFare(10.0, true, { policy: budgetAffordablePolicy });
            expect(fare.baseFare).toBe(25);
            expect(fare.distanceFare).toBe(56);
            expect(fare.subtotalFare).toBe(81);
            expect(fare.totalFare).toBe(81);
        });

        it('correctly applies 35% accessibility discount under budget policy (81 LKR -> 53 LKR)', () => {
            // 35% of 81 = 28.35 -> 28. Net = 53 LKR.
            const fare = calculateFare(10.0, true, {
                policy: budgetAffordablePolicy,
                isAccessibilityEligible: true,
            });

            expect(fare.concessionDiscount).toBe(28);
            expect(fare.totalFare).toBe(53);
        });

        it('falls back gracefully to baseline values when partial policy fields are omitted', () => {
            const partialPolicy: Partial<FarePolicy> = {
                baseFare: 45,
                // baseDistanceKm, ratePerKm, etc. omitted
            };

            const fare = calculateFare(10.0, true, { policy: partialPolicy });
            expect(fare.baseFare).toBe(45);
            // Default ratePerKm (8.5) and baseDistanceKm (2) used: Billable 8km * 8.5 = 68. Total = 45 + 68 = 113.
            expect(fare.distanceFare).toBe(68);
            expect(fare.totalFare).toBe(113);
        });
    });

    // =========================================================================
    // 6. REAL-WORLD SRI LANKAN TRANSIT ROUTE SIMULATION SUITES
    // =========================================================================
    describe('6. Real-World Transit Route Simulation Matrix', () => {
        // Route 138: Pettah - Homagama
        describe('Route 138 (Pettah - Homagama)', () => {
            it('Pettah to Nugegoda (11.5 km)', () => {
                // Billable: 9.5km. 9.5 * 8.5 = 80.75 -> ceil 81. Base = 30 -> 111 LKR.
                const fareStandard = calculateFare(11.5, true);
                expect(fareStandard.totalFare).toBe(111);

                const fareAccessibility = calculateFare(11.5, true, { isAccessibilityEligible: true });
                // 20% of 111 = 22.2 -> 22. Net = 89 LKR.
                expect(fareAccessibility.totalFare).toBe(89);

                const fareWheelchairAssist = calculateFare(11.5, true, {
                    isAccessibilityEligible: true,
                    hasAssistanceRequested: true,
                });
                // Net 89 + 50 = 139 LKR.
                expect(fareWheelchairAssist.totalFare).toBe(139);
            });

            it('Pettah to Maharagama (16.2 km)', () => {
                // Billable: 14.2km. 14.2 * 8.5 = 120.7 -> ceil 121. Base = 30 -> 151 LKR.
                const fareStandard = calculateFare(16.2, true);
                expect(fareStandard.totalFare).toBe(151);

                const fareElderly = calculateFare(16.2, true, { isElderlyEligible: true });
                // 15% of 151 = 22.65 -> 23. Net = 128 LKR.
                expect(fareElderly.totalFare).toBe(128);
            });

            it('Pettah to Homagama Full Route (24.8 km)', () => {
                // Billable: 22.8km. 22.8 * 8.5 = 193.8 -> ceil 194. Base = 30 -> 224 LKR.
                const fareStandard = calculateFare(24.8, true);
                expect(fareStandard.totalFare).toBe(224);
            });
        });

        // Route 177: Kollupitiya - Kaduwela
        describe('Route 177 (Kollupitiya - Kaduwela)', () => {
            it('Kollupitiya to Battaramulla (9.8 km)', () => {
                // Billable: 7.8km. 7.8 * 8.5 = 66.3 -> ceil 67. Base = 30 -> 97 LKR.
                const fare = calculateFare(9.8, true);
                expect(fare.totalFare).toBe(97);
            });

            it('Kollupitiya to Malabe SLIIT (14.5 km)', () => {
                // Billable: 12.5km. 12.5 * 8.5 = 106.25 -> ceil 107. Base = 30 -> 137 LKR.
                const fare = calculateFare(14.5, true);
                expect(fare.totalFare).toBe(137);

                const fareAssist = calculateFare(14.5, true, { hasAssistanceRequested: true });
                expect(fareAssist.totalFare).toBe(187);
            });

            it('Kollupitiya to Kaduwela Bus Stand (19.2 km)', () => {
                // Billable: 17.2km. 17.2 * 8.5 = 146.2 -> ceil 147. Base = 30 -> 177 LKR.
                const fare = calculateFare(19.2, true);
                expect(fare.totalFare).toBe(177);
            });
        });

        // Route 120: Pettah - Horana
        describe('Route 120 (Pettah - Horana)', () => {
            it('Pettah to Piliyandala (18.4 km)', () => {
                // Billable: 16.4km. 16.4 * 8.5 = 139.4 -> ceil 140. Base = 30 -> 170 LKR.
                const fare = calculateFare(18.4, true);
                expect(fare.totalFare).toBe(170);
            });

            it('Pettah to Horana Terminal (35.2 km)', () => {
                // Billable: 33.2km. 33.2 * 8.5 = 282.2 -> ceil 283. Base = 30 -> 313 LKR.
                const fare = calculateFare(35.2, true);
                expect(fare.totalFare).toBe(313);

                const fareAccessibility = calculateFare(35.2, true, { isAccessibilityEligible: true });
                // 20% of 313 = 62.6 -> 63. Net = 250 LKR.
                expect(fareAccessibility.totalFare).toBe(250);
            });
        });

        // Route 100: Panadura - Pettah
        describe('Route 100 (Panadura - Pettah)', () => {
            it('Panadura to Moratuwa (7.5 km)', () => {
                // Billable: 5.5km. 5.5 * 8.5 = 46.75 -> ceil 47. Base = 30 -> 77 LKR.
                const fare = calculateFare(7.5, true);
                expect(fare.totalFare).toBe(77);
            });

            it('Panadura to Pettah (27.5 km)', () => {
                // Billable: 25.5km. 25.5 * 8.5 = 216.75 -> ceil 217. Base = 30 -> 247 LKR.
                const fare = calculateFare(27.5, true);
                expect(fare.totalFare).toBe(247);
            });
        });

        // Route 255: Kottawa - Mount Lavinia
        describe('Route 255 (Kottawa - Mount Lavinia)', () => {
            it('Kottawa to Piliyandala (7.8 km)', () => {
                // Billable: 5.8km. 5.8 * 8.5 = 49.3 -> ceil 50. Base = 30 -> 80 LKR.
                const fare = calculateFare(7.8, true);
                expect(fare.totalFare).toBe(80);
            });

            it('Kottawa to Mount Lavinia (16.2 km)', () => {
                // Billable: 14.2km. 14.2 * 8.5 = 120.7 -> ceil 121. Base = 30 -> 151 LKR.
                const fare = calculateFare(16.2, true);
                expect(fare.totalFare).toBe(151);
            });
        });

        // Southern Expressway EX01: Makumbura MMC - Galle
        describe('Southern Expressway EX01 (Makumbura MMC - Galle)', () => {
            it('Makumbura to Galle Multi-modal (115.0 km)', () => {
                // Billable: 113.0km. 113.0 * 8.5 = 960.5 -> ceil 961. Base = 30 -> 991 LKR.
                const fare = calculateFare(115.0, true);
                expect(fare.totalFare).toBe(991);

                const fareElderlyAssist = calculateFare(115.0, true, {
                    isElderlyEligible: true,
                    hasAssistanceRequested: true,
                });
                // Subtotal 991. 15% discount = 148.65 -> 149. Net = 842. Assist = 50. Total = 892 LKR.
                expect(fareElderlyAssist.totalFare).toBe(892);
            });
        });

        // Long Inter-Provincial Routes
        describe('Inter-Provincial Long Routes', () => {
            it('Route 01 Colombo to Kandy (115.0 km)', () => {
                const fare = calculateFare(115.0, true);
                expect(fare.totalFare).toBe(991);
            });

            it('Route 04 Colombo to Anuradhapura (206.0 km)', () => {
                // Billable: 204.0km. 204.0 * 8.5 = 1734. Base = 30 -> 1764 LKR.
                const fare = calculateFare(206.0, true);
                expect(fare.totalFare).toBe(1764);
            });

            it('Route 87 Colombo to Jaffna (396.0 km)', () => {
                // Billable: 394.0km. 394.0 * 8.5 = 3349. Base = 30 -> 3379 LKR.
                const fare = calculateFare(396.0, true);
                expect(fare.totalFare).toBe(3379);

                const fareAccAssist = calculateFare(396.0, true, {
                    isAccessibilityEligible: true,
                    hasAssistanceRequested: true,
                });
                // Subtotal 3379. 20% discount = 675.8 -> 676. Net = 2703. Assist = 50. Total = 2753 LKR.
                expect(fareAccAssist.totalFare).toBe(2753);
            });
        });
    });

    // =========================================================================
    // 7. ADMIN FARE POLICY BACKEND API (GET / PUT / POST LIFECYCLE)
    // =========================================================================
    describe('7. Admin Fare Policy Backend API Lifecycle & Validation', () => {
        it('GET /api/fare-policy loads existing document successfully', async () => {
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    baseFare: 38,
                    baseDistanceKm: 2.5,
                    ratePerKm: 9.5,
                    accessibilityDiscountPercent: 25,
                    elderlyDiscountPercent: 20,
                    assistanceSurchargeLkr: 60,
                    updatedAt: '2026-09-21T14:30:00Z',
                    updatedBy: 'Transit Admin',
                }),
            });

            const res = await getFarePolicyApi();
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.policy.baseFare).toBe(38);
            expect(data.policy.baseDistanceKm).toBe(2.5);
            expect(data.policy.ratePerKm).toBe(9.5);
            expect(data.policy.accessibilityDiscountPercent).toBe(25);
            expect(data.policy.elderlyDiscountPercent).toBe(20);
            expect(data.policy.assistanceSurchargeLkr).toBe(60);
        });

        it('GET /api/fare-policy handles database errors gracefully with default fallback', async () => {
            mockGet.mockRejectedValueOnce(new Error('Firestore connection timeout'));

            const res = await getFarePolicyApi();
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.policy.baseFare).toBe(DEFAULT_FARE_POLICY.baseFare);
        });

        it('PUT /api/fare-policy rejects negative base fare', async () => {
            const req = new Request('http://localhost/api/fare-policy', {
                method: 'PUT',
                body: JSON.stringify({
                    baseFare: -5,
                    baseDistanceKm: 2,
                    ratePerKm: 8.5,
                    accessibilityDiscountPercent: 20,
                    elderlyDiscountPercent: 15,
                    assistanceSurchargeLkr: 50,
                }),
            });

            const res = await updateFarePolicyApi(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
            expect(data.message).toContain('Base fare must be a positive number');
        });

        it('PUT /api/fare-policy rejects non-numeric base distance', async () => {
            const req = new Request('http://localhost/api/fare-policy', {
                method: 'PUT',
                body: JSON.stringify({
                    baseFare: 30,
                    baseDistanceKm: 'invalid_distance',
                    ratePerKm: 8.5,
                    accessibilityDiscountPercent: 20,
                    elderlyDiscountPercent: 15,
                    assistanceSurchargeLkr: 50,
                }),
            });

            const res = await updateFarePolicyApi(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
            expect(data.message).toContain('Base distance (km) must be a positive number');
        });

        it('PUT /api/fare-policy rejects negative rate per km', async () => {
            const req = new Request('http://localhost/api/fare-policy', {
                method: 'PUT',
                body: JSON.stringify({
                    baseFare: 30,
                    baseDistanceKm: 2,
                    ratePerKm: -8.5,
                    accessibilityDiscountPercent: 20,
                    elderlyDiscountPercent: 15,
                    assistanceSurchargeLkr: 50,
                }),
            });

            const res = await updateFarePolicyApi(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
            expect(data.message).toContain('Rate per km must be a positive number');
        });

        it('PUT /api/fare-policy rejects accessibility discount < 0% or > 100%', async () => {
            const reqNegative = new Request('http://localhost/api/fare-policy', {
                method: 'PUT',
                body: JSON.stringify({
                    baseFare: 30,
                    baseDistanceKm: 2,
                    ratePerKm: 8.5,
                    accessibilityDiscountPercent: -10,
                    elderlyDiscountPercent: 15,
                    assistanceSurchargeLkr: 50,
                }),
            });

            const resNegative = await updateFarePolicyApi(reqNegative);
            const dataNegative = await resNegative.json();
            expect(resNegative.status).toBe(400);
            expect(dataNegative.message).toContain('Accessibility discount must be between 0% and 100%');

            const reqOver = new Request('http://localhost/api/fare-policy', {
                method: 'PUT',
                body: JSON.stringify({
                    baseFare: 30,
                    baseDistanceKm: 2,
                    ratePerKm: 8.5,
                    accessibilityDiscountPercent: 105,
                    elderlyDiscountPercent: 15,
                    assistanceSurchargeLkr: 50,
                }),
            });

            const resOver = await updateFarePolicyApi(reqOver);
            const dataOver = await resOver.json();
            expect(resOver.status).toBe(400);
            expect(dataOver.message).toContain('Accessibility discount must be between 0% and 100%');
        });

        it('PUT /api/fare-policy rejects elderly discount < 0% or > 100%', async () => {
            const reqOver = new Request('http://localhost/api/fare-policy', {
                method: 'PUT',
                body: JSON.stringify({
                    baseFare: 30,
                    baseDistanceKm: 2,
                    ratePerKm: 8.5,
                    accessibilityDiscountPercent: 20,
                    elderlyDiscountPercent: 150,
                    assistanceSurchargeLkr: 50,
                }),
            });

            const resOver = await updateFarePolicyApi(reqOver);
            const dataOver = await resOver.json();
            expect(resOver.status).toBe(400);
            expect(dataOver.message).toContain('Elderly discount must be between 0% and 100%');
        });

        it('PUT /api/fare-policy rejects negative assistance surcharge fee', async () => {
            const req = new Request('http://localhost/api/fare-policy', {
                method: 'PUT',
                body: JSON.stringify({
                    baseFare: 30,
                    baseDistanceKm: 2,
                    ratePerKm: 8.5,
                    accessibilityDiscountPercent: 20,
                    elderlyDiscountPercent: 15,
                    assistanceSurchargeLkr: -25,
                }),
            });

            const res = await updateFarePolicyApi(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
            expect(data.message).toContain('Assistance surcharge must be a positive number');
        });

        it('PUT /api/fare-policy accepts valid update payload and persists to Firestore', async () => {
            mockSet.mockResolvedValueOnce(undefined);

            const req = new Request('http://localhost/api/fare-policy', {
                method: 'PUT',
                body: JSON.stringify({
                    baseFare: 35.0,
                    baseDistanceKm: 2.5,
                    ratePerKm: 9.0,
                    accessibilityDiscountPercent: 25,
                    elderlyDiscountPercent: 20,
                    assistanceSurchargeLkr: 60.0,
                    updatedBy: 'Test Admin Lead',
                }),
            });

            const res = await updateFarePolicyApi(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.policy.baseFare).toBe(35);
            expect(data.policy.baseDistanceKm).toBe(2.5);
            expect(data.policy.ratePerKm).toBe(9.0);
            expect(data.policy.accessibilityDiscountPercent).toBe(25);
            expect(data.policy.elderlyDiscountPercent).toBe(20);
            expect(data.policy.assistanceSurchargeLkr).toBe(60);
            expect(mockSet).toHaveBeenCalledWith(
                expect.objectContaining({
                    baseFare: 35,
                    ratePerKm: 9,
                    assistanceSurchargeLkr: 60,
                }),
                { merge: true }
            );
        });

        it('POST /api/fare-policy resets policy cleanly to NTC baseline defaults', async () => {
            mockSet.mockResolvedValueOnce(undefined);

            const req = new Request('http://localhost/api/fare-policy', {
                method: 'POST',
                body: JSON.stringify({ updatedBy: 'System Superadmin' }),
            });

            const res = await resetFarePolicyApi(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.policy.baseFare).toBe(DEFAULT_FARE_POLICY.baseFare);
            expect(data.policy.baseDistanceKm).toBe(DEFAULT_FARE_POLICY.baseDistanceKm);
            expect(data.policy.ratePerKm).toBe(DEFAULT_FARE_POLICY.ratePerKm);
            expect(data.policy.accessibilityDiscountPercent).toBe(DEFAULT_FARE_POLICY.accessibilityDiscountPercent);
            expect(data.policy.elderlyDiscountPercent).toBe(DEFAULT_FARE_POLICY.elderlyDiscountPercent);
            expect(data.policy.assistanceSurchargeLkr).toBe(DEFAULT_FARE_POLICY.assistanceSurchargeLkr);
            expect(mockSet).toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 8. BOOKING FARE CALCULATION API INTEGRATION (GET /api/booking/fare)
    // =========================================================================
    describe('8. Booking Fare Calculation API Endpoint (GET /api/booking/fare)', () => {
        it('returns 400 if routeId is missing', async () => {
            const req = new Request('http://localhost/api/booking/fare?origin=Colombo&destination=Kandy');
            const res = await getBookingFareApi(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
            expect(data.message).toContain('routeId, origin and destination are required');
        });

        it('returns 400 if origin is missing', async () => {
            const req = new Request('http://localhost/api/booking/fare?routeId=r1&destination=Kandy');
            const res = await getBookingFareApi(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
        });

        it('returns 400 if destination is missing', async () => {
            const req = new Request('http://localhost/api/booking/fare?routeId=r1&origin=Colombo');
            const res = await getBookingFareApi(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
        });

        it('returns 404 if route document does not exist in Firestore', async () => {
            mockGet.mockResolvedValueOnce({ exists: false });

            const req = new Request('http://localhost/api/booking/fare?routeId=nonexistent&origin=Colombo&destination=Kandy');
            const res = await getBookingFareApi(req);
            const data = await res.json();

            expect(res.status).toBe(404);
            expect(data.success).toBe(false);
            expect(data.message).toBe('Route not found.');
        });

        it('returns 400 if origin or destination stop does not exist on route', async () => {
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    stops: ['Colombo Fort', 'Nugegoda', 'Maharagama'],
                }),
            });

            const req = new Request('http://localhost/api/booking/fare?routeId=r138&origin=Jaffna&destination=Nugegoda');
            const res = await getBookingFareApi(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
            expect(data.message).toContain('do not form a valid journey on this route');
        });

        it('returns 400 if destination is before origin (reverse direction)', async () => {
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    stops: ['Colombo Fort', 'Nugegoda', 'Maharagama'],
                }),
            });

            const req = new Request('http://localhost/api/booking/fare?routeId=r138&origin=Maharagama&destination=Colombo Fort');
            const res = await getBookingFareApi(req);
            const data = await res.json();

            expect(res.status).toBe(400);
            expect(data.success).toBe(false);
            expect(data.message).toContain('do not form a valid journey on this route');
        });

        it('calculates fare successfully for valid journey without passenger ID', async () => {
            // Route doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    stops: ['Colombo Fort', 'Nugegoda', 'Maharagama', 'Homagama'],
                    distanceKm: 24.0,
                }),
            });
            // Fare policy doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => DEFAULT_FARE_POLICY,
            });

            const req = new Request(
                'http://localhost/api/booking/fare?routeId=r138&origin=Colombo Fort&destination=Maharagama'
            );
            const res = await getBookingFareApi(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.fare).toBeDefined();
            expect(data.fare.baseFare).toBe(30);
            expect(data.fare.totalFare).toBeGreaterThan(0);
        });

        it('resolves accessibility profile and applies concession for verified user', async () => {
            // Route doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    stops: ['Colombo Fort', 'Nugegoda', 'Maharagama', 'Homagama'],
                    distanceKm: 24.0,
                }),
            });
            // Fare policy doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => DEFAULT_FARE_POLICY,
            });
            // User doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    passengerId: 'p_acc_01',
                    userName: 'Kamal Perera',
                    isWheelchairUser: true,
                }),
            });

            const req = new Request(
                'http://localhost/api/booking/fare?routeId=r138&origin=Colombo Fort&destination=Homagama&passengerId=p_acc_01'
            );
            const res = await getBookingFareApi(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.fare.concessionType).toBe('ACCESSIBILITY');
            expect(data.fare.concessionDiscountPercent).toBe(20);
            expect(data.fare.concessionDiscount).toBeGreaterThan(0);
        });

        it('resolves elderly profile (60+) and applies elderly concession', async () => {
            // Route doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    stops: ['Colombo Fort', 'Nugegoda', 'Maharagama', 'Homagama'],
                    distanceKm: 24.0,
                }),
            });
            // Fare policy doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => DEFAULT_FARE_POLICY,
            });
            // User doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    passengerId: 'p_eld_01',
                    userName: 'Sirisena Silva',
                    calculatedAge: 68,
                    isElderPerson: true,
                }),
            });

            const req = new Request(
                'http://localhost/api/booking/fare?routeId=r138&origin=Colombo Fort&destination=Homagama&passengerId=p_eld_01'
            );
            const res = await getBookingFareApi(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.fare.concessionType).toBe('ELDERLY');
            expect(data.fare.concessionDiscountPercent).toBe(15);
            expect(data.fare.concessionDiscount).toBeGreaterThan(0);
        });

        it('applies assistance surcharge when hasAssistance=true in query', async () => {
            // Route doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    stops: ['Colombo Fort', 'Nugegoda', 'Maharagama', 'Homagama'],
                    distanceKm: 24.0,
                }),
            });
            // Fare policy doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => DEFAULT_FARE_POLICY,
            });

            const req = new Request(
                'http://localhost/api/booking/fare?routeId=r138&origin=Colombo Fort&destination=Homagama&hasAssistance=true'
            );
            const res = await getBookingFareApi(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.fare.assistanceFee).toBe(50);
        });

        it('applies paired wheelchair guardian fare when isWheelchair=true in booking fare query', async () => {
            // Route doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    stops: ['Colombo Fort', 'Nugegoda', 'Maharagama', 'Homagama'],
                    distanceKm: 24.0,
                }),
            });
            // Fare policy doc
            mockGet.mockResolvedValueOnce({
                exists: true,
                data: () => DEFAULT_FARE_POLICY,
            });

            const req = new Request(
                'http://localhost/api/booking/fare?routeId=r138&origin=Colombo Fort&destination=Homagama&isWheelchair=true'
            );
            const res = await getBookingFareApi(req);
            const data = await res.json();

            expect(res.status).toBe(200);
            expect(data.success).toBe(true);
            expect(data.fare.isWheelchairPaired).toBe(true);
            expect(data.fare.pairedSeatNumber).toBe('G1');
            expect(data.fare.guardianRatePercent).toBe(100);
            expect(data.fare.guardianFare).toBe(data.fare.subtotalFare);
            expect(data.fare.totalFare).toBe(data.fare.subtotalFare + data.fare.guardianFare);
        });
    });

    // =========================================================================
    // 9. WHEELCHAIR GUARDIAN COMPANION SEAT PRICING CALCULATIONS
    // =========================================================================
    describe('9. Wheelchair Companion & Guardian Seat Pricing Logic', () => {
        it('charges 100% guardian companion fare by default when wheelchair space is booked', () => {
            const distance = 10; // subtotal: 30 + (8 * 8.5) = 98 LKR
            const fare = calculateFare(distance, true, {
                isWheelchairPaired: true,
            });

            expect(fare.subtotalFare).toBe(98);
            expect(fare.isWheelchairPaired).toBe(true);
            expect(fare.pairedSeatNumber).toBe('G1');
            expect(fare.guardianRatePercent).toBe(100);
            expect(fare.guardianFare).toBe(98);
            expect(fare.totalFare).toBe(98 + 98); // 196
        });

        it('supports customized companion rate percentage (e.g. 50% subsidized companion)', () => {
            const customPolicy: FarePolicy = {
                ...DEFAULT_FARE_POLICY,
                guardianCompanionRatePercent: 50,
            };
            const distance = 10; // subtotal: 98 LKR
            const fare = calculateFare(distance, true, {
                policy: customPolicy,
                isWheelchairPaired: true,
            });

            expect(fare.guardianRatePercent).toBe(50);
            expect(fare.guardianFare).toBe(49); // round(98 * 0.5) = 49
            expect(fare.totalFare).toBe(98 + 49); // 147
        });

        it('correctly calculates combined accessibility concession + assistance fee + paired guardian seat', () => {
            const distance = 10; // subtotal: 98 LKR
            // Accessibility discount (20%): round(98 * 0.2) = 20 LKR discount -> net passenger = 78 LKR
            // Assistance fee: +50 LKR
            // Guardian companion fare (100%): +98 LKR
            // Total: 78 + 50 + 98 = 226 LKR
            const fare = calculateFare(distance, true, {
                isAccessibilityEligible: true,
                hasAssistanceRequested: true,
                isWheelchairPaired: true,
            });

            expect(fare.subtotalFare).toBe(98);
            expect(fare.concessionDiscount).toBe(20);
            expect(fare.assistanceFee).toBe(50);
            expect(fare.guardianFare).toBe(98);
            expect(fare.totalFare).toBe(226);
        });

        it('sets guardianFare to 0 when isWheelchairPaired is false', () => {
            const fare = calculateFare(10, true, {
                isWheelchairPaired: false,
            });

            expect(fare.isWheelchairPaired).toBe(false);
            expect(fare.guardianFare).toBe(0);
            expect(fare.pairedSeatNumber).toBeNull();
        });
    });

    // =========================================================================
    // 10. HIGH-THROUGHPUT STRESS & CONCURRENCY SIMULATION
    // =========================================================================
    describe('10. High-Throughput Invariant Stress Simulation', () => {
        it('accurately computes 500 varied random journey fare permutations without NaN or negative outputs', () => {
            for (let i = 0; i < 500; i++) {
                const randomDistance = Math.round(Math.random() * 80 * 10) / 10;
                const isAcc = Math.random() > 0.5;
                const isEld = !isAcc && Math.random() > 0.5;
                const isAssist = Math.random() > 0.5;
                const isWc = Math.random() > 0.5;

                const fare = calculateFare(randomDistance, true, {
                    isAccessibilityEligible: isAcc,
                    isElderlyEligible: isEld,
                    hasAssistanceRequested: isAssist,
                    isWheelchairPaired: isWc,
                });

                expect(typeof fare.totalFare).toBe('number');
                expect(isNaN(fare.totalFare)).toBe(false);
                expect(fare.totalFare).toBeGreaterThan(0);
                expect(fare.distanceKm).toBe(randomDistance);
                expect(fare.currency).toBe('LKR');
                expect(fare.totalFare % 1).toBe(0); // whole number guarantee
            }
        });
    });
});
