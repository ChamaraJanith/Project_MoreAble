import { Route, RouteDirection, RouteStatus } from '../../../entities/route/model/types';
import { adminFetch } from './adminHttp';

export interface CreateRoutePayload {
    routeId: string;
    routeNumber: string;
    routeName: string;
    direction: RouteDirection;
    startLocation: string;
    endLocation: string;
    startStopId: string;
    endStopId: string;
    stops: string[];
    distanceKm: number | null;
    estimatedDuration: string | null;
    status: RouteStatus;
}

// routeId is the Firestore document id, so it identifies the route rather than
// being an editable field.
export type UpdateRoutePayload = Omit<CreateRoutePayload, 'routeId'>;

/** GET /api/routes */
export async function getRoutes(): Promise<Route[]> {
    const data = await adminFetch('/api/routes');
    return Array.isArray(data.routes) ? (data.routes as Route[]) : [];
}

/** GET /api/routes/:routeId */
export async function getRoute(routeId: string): Promise<Route> {
    const data = await adminFetch(`/api/routes/${encodeURIComponent(routeId)}`);
    return data.route as Route;
}

/** POST /api/routes */
export async function createRoute(payload: CreateRoutePayload): Promise<Route> {
    const data = await adminFetch('/api/routes', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    return data.route as Route;
}

/** PUT /api/routes/:routeId */
export async function updateRoute(routeId: string, payload: UpdateRoutePayload): Promise<Route> {
    const data = await adminFetch(`/api/routes/${encodeURIComponent(routeId)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
    });
    return data.route as Route;
}

/** DELETE /api/routes/:routeId — permanent removal. */
export async function deleteRoute(routeId: string): Promise<void> {
    await adminFetch(`/api/routes/${encodeURIComponent(routeId)}`, { method: 'DELETE' });
}

/** Convenience wrapper for the preferred, non-destructive workflow. */
export async function setRouteStatus(route: Route, status: RouteStatus): Promise<Route> {
    return updateRoute(route.routeId, {
        routeNumber: route.routeNumber,
        routeName: route.routeName,
        direction: route.direction ?? 'OUTBOUND',
        startLocation: route.startLocation,
        endLocation: route.endLocation,
        startStopId: route.startStopId ?? '',
        endStopId: route.endStopId ?? '',
        stops: route.stops,
        distanceKm: route.distanceKm,
        estimatedDuration: route.estimatedDuration,
        status,
    });
}