// Which tab talks to the API, and what it asks for.
//
// The list screen's three tabs are not equivalent: two are answered by
// GET /api/reports and one is still a placeholder. That distinction is a pure
// function rather than a condition buried in the screen, both because the
// project's Jest setup is node-only with no React renderer, and because it is
// the thing worth pinning down — a Verified Reports tab that started issuing
// requests would hit a Firestore index that does not exist yet.

import { ReportScope } from '../../../src/entities/report/model/types';
import {
    FetchableReportScope,
    isFetchableReportScope,
    reportsRequestPath,
} from '../../../src/features/reports/utils/reportScopes';

/** Every scope the screen can be in, so none of them goes untested. */
const ALL_SCOPES: ReportScope[] = ['all', 'my', 'verified'];

describe('which report scopes are fetched', () => {
    it('fetches All Reports', () => {
        expect(isFetchableReportScope('all')).toBe(true);
    });

    it('fetches My Reports', () => {
        expect(isFetchableReportScope('my')).toBe(true);
    });

    it('does not fetch Verified Reports while it is a placeholder', () => {
        expect(isFetchableReportScope('verified')).toBe(false);
    });

    it('classifies every scope the screen can hold', () => {
        // A scope added to the model without a decision here would fall through
        // to the placeholder branch silently.
        expect(ALL_SCOPES.filter(isFetchableReportScope)).toEqual(['all', 'my']);
    });
});

describe('the reports request path', () => {
    it('asks for the caller‘s own reports on My Reports', () => {
        expect(reportsRequestPath('my')).toBe('/api/reports?scope=my');
    });

    it('asks for every report on All Reports', () => {
        expect(reportsRequestPath('all')).toBe('/api/reports?scope=all');
    });

    it('always states the scope rather than leaving it to the default', () => {
        const fetchable: FetchableReportScope[] = ['all', 'my'];

        fetchable.forEach((scope) => {
            expect(reportsRequestPath(scope)).toContain(`scope=${scope}`);
        });
    });

    it('sends a different path for each tab', () => {
        expect(reportsRequestPath('my')).not.toBe(reportsRequestPath('all'));
    });

    it('names one endpoint for both scopes', () => {
        // Reused deliberately: `my` is a parameter on the existing route, not a
        // second endpoint.
        const path = (scope: FetchableReportScope) => reportsRequestPath(scope).split('?')[0];

        expect(path('my')).toBe('/api/reports');
        expect(path('all')).toBe('/api/reports');
    });

    it('builds a path that needs no escaping', () => {
        // The scope values are a closed set of plain words, so the screen can
        // interpolate them straight into the URL.
        expect(reportsRequestPath('my')).toBe(encodeURI(reportsRequestPath('my')));
    });
});
