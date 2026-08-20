import { Bus } from '../../../entities/bus/model/types';
import { Route } from '../../../entities/route/model/types';
import { getBuses } from '../../admin/api/busAdminApi';
import { getRoutes } from '../../admin/api/routeAdminApi';

// The report form needs the same fleet and route lists the management screens
// show, so it reuses those clients rather than duplicating the requests — the
// same arrangement trip scheduling already uses.
export { getBuses, getRoutes };

export interface ReportReferenceData {
    buses: Bus[];
    routes: Route[];
    /** Set when the fleet list failed; routes may still have loaded. */
    busError: string | null;
    /** Set when the route list failed; buses may still have loaded. */
    routeError: string | null;
}

/**
 * Loads both lists in parallel, reporting their failures separately.
 *
 * Settled rather than all-or-nothing on purpose: the two lists are independent,
 * so one being unavailable should not hide the other. A passenger who can still
 * pick a route is better served than one shown a single combined error.
 */
export async function loadReportReferenceData(): Promise<ReportReferenceData> {
    const [busResult, routeResult] = await Promise.allSettled([getBuses(), getRoutes()]);

    return {
        buses: busResult.status === 'fulfilled' ? busResult.value : [],
        routes: routeResult.status === 'fulfilled' ? routeResult.value : [],
        busError:
            busResult.status === 'rejected'
                ? 'Unable to load buses. Please try again.'
                : null,
        routeError:
            routeResult.status === 'rejected'
                ? 'Unable to load routes. Please try again.'
                : null,
    };
}
