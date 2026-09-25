// What the Complaint Management screens show and offer (MOV-176).
//
// Component rendering is not covered: the project's Jest setup is
// `testEnvironment: node` with no React Native renderer. What the screens
// decide — which actions a complaint offers, who can be picked, what a failure
// says — lives in complaintWorkflow.ts so it can be tested here.

import {
    AdminComplaint,
    COMPLAINT_CONFLICT_MESSAGE,
    COMPLAINT_STATUS_FILTERS,
    DUPLICATE_COMPLAINT_MESSAGE,
    MAX_RESOLUTION_NOTE_LENGTH,
    canCreateComplaintFromReport,
    readDuplicateComplaint,
    complaintActionAvailability,
    complaintActorLabel,
    complaintAssigneeLabel,
    complaintAssigneeOptions,
    complaintDetailsPath,
    complaintErrorMessage,
    complaintListPath,
    complaintListQuery,
    complaintStatusLabel,
    countComplaintsByStatus,
    filterComplaintsBySearch,
    hasComplaintActions,
    isComplaintIdParam,
    resolutionNoteError,
    shouldReloadComplaintAfterFailure,
} from '../../../src/features/admin/utils/complaintWorkflow';
import { AdminUserSummary } from '../../../src/entities/user/model/types';

function complaint(overrides: Partial<AdminComplaint> = {}): AdminComplaint {
    return {
        complaintId: 'CMP-00001',
        reportId: 'REP-00025',
        status: 'PENDING',
        issueCategory: 'BROKEN_RAMP',
        description: 'The wheelchair ramp would not fold down at Pettah station.',
        busId: 'BUS-00007',
        vehicle: { numberPlate: 'NB-1234' },
        routeId: 'R-138-OUT',
        route: { routeNumber: '138', routeName: 'Colombo - Kandy' },
        createdBy: 'UID-ADMIN',
        createdAt: '2026-09-01T08:00:00.000Z',
        updatedAt: '2026-09-01T08:00:00.000Z',
        ...overrides,
    };
}

function admin(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
    return {
        documentId: 'ADM-2026-00001',
        passengerId: 'ADM-2026-00001',
        userName: 'System Admin',
        email: 'admin@moreable.lk',
        phoneNumber: null,
        secondaryPhoneNumber: null,
        nicNo: '000000000V',
        calculatedAge: null,
        isElderPerson: false,
        isVerified: true,
        accountStatus: 'ACTIVE',
        role: 'ADMIN',
        guardianId: null,
        accessibilityProfileId: null,
        createdAt: null,
        updatedAt: null,
        ...overrides,
    };
}

describe('complaintActionAvailability', () => {
    it.each([
        ['PENDING', { assign: true, reassign: false, start: false, resolve: false }],
        ['ASSIGNED', { assign: false, reassign: true, start: true, resolve: false }],
        ['IN_PROGRESS', { assign: false, reassign: true, start: false, resolve: true }],
        ['RESOLVED', { assign: false, reassign: false, start: false, resolve: false }],
    ])('offers exactly the allowed actions for %s', (status, expected) => {
        expect(complaintActionAvailability(status)).toEqual(expected);
    });

    it('offers nothing for a status it does not know', () => {
        expect(complaintActionAvailability('VERIFIED')).toEqual({
            assign: false,
            reassign: false,
            start: false,
            resolve: false,
        });
    });

    it('treats RESOLVED as final', () => {
        expect(hasComplaintActions('RESOLVED')).toBe(false);
        expect(hasComplaintActions('PENDING')).toBe(true);
    });
});

describe('complaintAssigneeOptions', () => {
    const users = [
        admin({ documentId: 'ADM-2026-00002', userName: 'Zara Admin' }),
        admin({ documentId: 'ADM-2026-00001', userName: 'Amal Admin' }),
        admin({ documentId: 'ADM-2026-00003', userName: 'Suspended', accountStatus: 'SUSPENDED' }),
        admin({ documentId: 'PAS-2026-00001', userName: 'Passenger', role: 'PASSENGER' }),
        admin({ documentId: 'ADM-2026-00004', userName: '   ' }),
    ];

    it('offers only active ADMIN accounts, by user document id, sorted by name', () => {
        const options = complaintAssigneeOptions(users);

        expect(options.map((option) => option.value)).toEqual([
            'ADM-2026-00004',
            'ADM-2026-00001',
            'ADM-2026-00002',
        ]);
        expect(options[1].label).toBe('Amal Admin');
    });

    it('falls back to the document id for a blank name', () => {
        expect(complaintAssigneeOptions(users)[0].label).toBe('ADM-2026-00004');
    });

    it('never offers the current assignee', () => {
        const values = complaintAssigneeOptions(users, 'ADM-2026-00001').map((option) => option.value);

        expect(values).not.toContain('ADM-2026-00001');
        expect(values).toContain('ADM-2026-00002');
    });
});

describe('resolutionNoteError', () => {
    it.each([
        ['empty', ''],
        ['whitespace only', ' \n\t '],
    ])('refuses a %s note', (_case, note) => {
        expect(resolutionNoteError(note)).toBe('A resolution note is required.');
    });

    it('accepts exactly 500 characters and refuses 501', () => {
        expect(MAX_RESOLUTION_NOTE_LENGTH).toBe(500);
        expect(resolutionNoteError('x'.repeat(500))).toBeNull();
        expect(resolutionNoteError('x'.repeat(501))).toBe(
            'A resolution note can be at most 500 characters.'
        );
    });

    it('measures the note after trimming, as the API does', () => {
        expect(resolutionNoteError(`   ${'x'.repeat(500)}   `)).toBeNull();
    });
});

describe('complaintErrorMessage', () => {
    it('explains a 409 as another administrator changing the complaint', () => {
        expect(complaintErrorMessage(409, 'Cannot START a complaint that is IN_PROGRESS.')).toBe(
            COMPLAINT_CONFLICT_MESSAGE
        );
    });

    it("keeps the API's wording for a 400", () => {
        expect(complaintErrorMessage(400, 'Invalid assignedTo.')).toBe('Invalid assignedTo.');
    });

    it.each([
        [401, 'Your session has expired. Please sign in again.'],
        [403, 'Only an administrator can manage complaints.'],
        [404, 'This complaint could not be found.'],
        [500, 'The server could not complete the request. Please try again.'],
    ])('words a %s for the admin', (status, message) => {
        expect(complaintErrorMessage(status, 'raw server text')).toBe(message);
    });

    it('reloads after a 404 or a 409 only', () => {
        expect(shouldReloadComplaintAfterFailure(409)).toBe(true);
        expect(shouldReloadComplaintAfterFailure(404)).toBe(true);
        expect(shouldReloadComplaintAfterFailure(400)).toBe(false);
        expect(shouldReloadComplaintAfterFailure(undefined)).toBe(false);
    });
});

describe('list helpers', () => {
    it('counts complaints by status', () => {
        expect(
            countComplaintsByStatus([
                complaint(),
                complaint({ status: 'ASSIGNED' }),
                complaint({ status: 'ASSIGNED' }),
                complaint({ status: 'RESOLVED' }),
            ])
        ).toEqual({ PENDING: 1, ASSIGNED: 2, IN_PROGRESS: 0, RESOLVED: 1 });
    });

    it('offers All and every status as tabs, in lifecycle order', () => {
        expect(COMPLAINT_STATUS_FILTERS.map((tab) => tab.label)).toEqual([
            'All',
            'Pending',
            'Assigned',
            'In Progress',
            'Resolved',
        ]);
    });

    it("builds the API's own filter query", () => {
        expect(complaintListQuery({})).toBe('');
        expect(complaintListQuery({ status: 'ALL' })).toBe('');
        expect(complaintListQuery({ status: 'IN_PROGRESS', assignedTo: 'ADM-2026-00001' })).toBe(
            '?status=IN_PROGRESS&assignedTo=ADM-2026-00001'
        );
    });

    it('searches what a card shows', () => {
        const items = [
            complaint(),
            complaint({
                complaintId: 'CMP-00002',
                issueCategory: 'LIFT_NOT_WORKING',
                vehicle: { numberPlate: 'NC-9999' },
                assignedTo: 'ADM-2026-00002',
                assignedToName: 'Zara Admin',
            }),
        ];

        expect(filterComplaintsBySearch(items, 'cmp-00002').map((c) => c.complaintId)).toEqual(['CMP-00002']);
        expect(filterComplaintsBySearch(items, 'nc-99')).toHaveLength(1);
        expect(filterComplaintsBySearch(items, 'zara')).toHaveLength(1);
        expect(filterComplaintsBySearch(items, '138')).toHaveLength(2);
        expect(
            filterComplaintsBySearch(items, 'lift', (category) =>
                category === 'LIFT_NOT_WORKING' ? 'Lift not working' : category
            )
        ).toHaveLength(1);
        expect(filterComplaintsBySearch(items, '   ')).toHaveLength(2);
    });
});

describe('opening a complaint from a report', () => {
    it('is offered only for a VERIFIED issue report', () => {
        expect(canCreateComplaintFromReport({ status: 'VERIFIED' })).toBe(true);
        expect(canCreateComplaintFromReport({ status: 'VERIFIED', type: 'ISSUE' })).toBe(true);
    });

    it.each([
        ['VERIFIED positive feedback', { status: 'VERIFIED', type: 'POSITIVE' }],
        ['a PENDING issue report', { status: 'PENDING' }],
        ['a REJECTED issue report', { status: 'REJECTED' }],
        ['a report with no status', {}],
    ])('is not offered for %s', (_case, report) => {
        expect(canCreateComplaintFromReport(report)).toBe(false);
    });

    it('recognises a duplicate and reads the existing complaint id', () => {
        expect(
            readDuplicateComplaint(409, 'A complaint already exists for this report (CMP-00007).')
        ).toEqual({ isDuplicate: true, complaintId: 'CMP-00007' });
    });

    it('recognises a duplicate whose message names no id', () => {
        expect(readDuplicateComplaint(409, 'A complaint already exists for this report.')).toEqual({
            isDuplicate: true,
            complaintId: null,
        });
    });

    it('does not treat another 409, or another status, as a duplicate', () => {
        expect(
            readDuplicateComplaint(
                409,
                'A complaint can only be created from a VERIFIED report (this report is PENDING).'
            ).isDuplicate
        ).toBe(false);
        expect(readDuplicateComplaint(500, 'already exists').isDuplicate).toBe(false);
        expect(readDuplicateComplaint(409, undefined).isDuplicate).toBe(false);
        expect(DUPLICATE_COMPLAINT_MESSAGE).toBe('Complaint already exists for this report.');
    });
});

describe('labels and paths', () => {
    it('words complaint statuses', () => {
        expect(complaintStatusLabel('IN_PROGRESS')).toBe('In Progress');
        expect(complaintStatusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    });

    it('prefers the assignee name, then the id', () => {
        expect(complaintAssigneeLabel({ assignedTo: 'ADM-1', assignedToName: 'Amal' })).toBe('Amal');
        expect(complaintAssigneeLabel({ assignedTo: 'ADM-1' })).toBe('ADM-1');
        expect(complaintAssigneeLabel({})).toBeNull();
    });

    it('calls this session "You" and shows any other actor id as recorded', () => {
        expect(complaintActorLabel('UID-ADMIN', 'UID-ADMIN')).toBe('You');
        expect(complaintActorLabel('UID-OTHER', 'UID-ADMIN')).toBe('UID-OTHER');
        expect(complaintActorLabel(undefined, 'UID-ADMIN')).toBeNull();
    });

    it('builds the admin routes', () => {
        expect(complaintListPath()).toBe('/(admin)/complaints');
        expect(complaintDetailsPath('CMP-00001')).toBe('/(admin)/complaints/CMP-00001');
    });

    it('recognises a complaint id route parameter', () => {
        expect(isComplaintIdParam('CMP-00001')).toBe(true);
        expect(isComplaintIdParam('CMP-123456')).toBe(true);
        expect(isComplaintIdParam('REP-00001')).toBe(false);
        expect(isComplaintIdParam(undefined)).toBe(false);
    });
});
