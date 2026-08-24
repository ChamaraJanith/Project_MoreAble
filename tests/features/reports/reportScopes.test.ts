// What each tab of the list screen asks the API for (MOV-272).
//
// The screen's three tabs are all answered by GET /api/reports and differ only
// by the `scope` parameter. That mapping is a pure function rather than a
// condition buried in the screen, both because this project's Jest setup is
// node-only with no React renderer, and because it is the thing worth pinning
// down: Verified Reports shipped as a placeholder that never called the API,
// and the fix was this parameter rather than a second list screen.

import { ReportScope } from '../../../src/entities/report/model/types';
import { reportsRequestPath } from '../../../src/features/reports/utils/reportScopes';

/** Every scope the screen can be in, so none of them goes untested. */
const ALL_SCOPES: ReportScope[] = ['all', 'my', 'verified'];

describe('the reports request path', () => {
    it('asks for every report on All Reports', () => {
        expect(reportsRequestPath('all')).toBe('/api/reports?scope=all');
    });

    it('asks for the caller‘s own reports on My Reports', () => {
        expect(reportsRequestPath('my')).toBe('/api/reports?scope=my');
    });

    it('asks for the verified reports on Verified Reports', () => {
        // The scope the backend has answered since MOV-163; before MOV-272 the
        // tab drew a "Coming Soon" card instead of requesting it.
        expect(reportsRequestPath('verified')).toBe('/api/reports?scope=verified');
    });

    it('always states the scope rather than leaving it to the default', () => {
        ALL_SCOPES.forEach((scope) => {
            expect(reportsRequestPath(scope)).toContain(`scope=${scope}`);
        });
    });

    it('sends a different path for every tab', () => {
        const paths = ALL_SCOPES.map(reportsRequestPath);

        expect(new Set(paths).size).toBe(ALL_SCOPES.length);
    });

    it('names one endpoint for all three scopes', () => {
        // Reused deliberately: a tab is a parameter on the existing route, not
        // a listing endpoint of its own.
        ALL_SCOPES.forEach((scope) => {
            expect(reportsRequestPath(scope).split('?')[0]).toBe('/api/reports');
        });
    });

    it('never asks for the admin review queue', () => {
        // `scope=review` is answered by the same endpoint but refused to a
        // passenger session. No passenger tab may request it.
        ALL_SCOPES.forEach((scope) => {
            expect(reportsRequestPath(scope)).not.toContain('review');
        });
    });

    it('builds a path that needs no escaping', () => {
        // The scope values are a closed set of plain words, so the screen can
        // interpolate them straight into the URL.
        ALL_SCOPES.forEach((scope) => {
            expect(reportsRequestPath(scope)).toBe(encodeURI(reportsRequestPath(scope)));
        });
    });
});
