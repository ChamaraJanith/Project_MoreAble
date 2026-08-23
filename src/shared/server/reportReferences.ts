/**
 * The bus and route a report points at, resolved against the fleet.
 *
 * A report stores two things per reference: the canonical document id, which
 * links it back to the fleet, and a snapshot of how that bus or route read on
 * the day the report was filed. The snapshot is not redundancy — a bus can be
 * retired and a route renamed long before anyone reviews the report, so without
 * it the card would eventually describe the wrong thing, or nothing.
 *
 * Shared by POST /api/reports and PUT /api/reports/[reportId] so an edited
 * report is resolved and snapshotted by exactly the rules that created it. The
 * alternative — the same forty lines twice — is how a reference accepted on
 * create comes to be refused on edit.
 */

export interface ReportVehicleSnapshotData {
    numberPlate: string;
    busModel?: string;
    manufacturer?: string;
}

export interface ReportRouteSnapshotData {
    routeNumber: string;
    routeName?: string;
    direction?: 'OUTBOUND' | 'RETURN';
}

/**
 * A resolved reference, or the response the caller should send.
 *
 * `status` travels with the message because the two failures are different
 * things: a malformed id is the caller's mistake (400), an id that resolves to
 * nothing is a bus that is not there (404).
 */
export type ReferenceResolution<T> =
    | { ok: true; value: T }
    | { ok: false; status: number; message: string };

/**
 * A Firestore document id cannot contain a slash, so a value carrying one is
 * malformed rather than merely missing: `.doc(id)` would throw on it instead of
 * answering "not found".
 */
export function isValidReferenceId(value: unknown): value is string {
    return typeof value === 'string' && !!value.trim() && !value.includes('/');
}

/** Whether the caller supplied this optional reference at all. */
export function isReferenceSupplied(value: unknown): boolean {
    return value !== undefined && value !== null && value !== '';
}

export function trimmedOrUndefined(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** What a report carries about its bus: nothing at all, or both halves. */
export interface ResolvedBusReference {
    busId?: string;
    vehicle?: ReportVehicleSnapshotData;
}

/**
 * Resolves the optional bus reference.
 *
 * The reference stays optional: a passenger who does not know which bus they
 * were on must still be able to report the issue. But one that IS supplied has
 * to point at something — an id that does not resolve is refused rather than
 * stored, so a report never carries a dangling reference that reads as a bus
 * nobody can look up.
 */
export async function resolveBusReference(
    adminDb: any,
    busId: unknown
): Promise<ReferenceResolution<ResolvedBusReference>> {
    if (!isReferenceSupplied(busId)) return { ok: true, value: {} };

    if (!isValidReferenceId(busId)) {
        return { ok: false, status: 400, message: 'Invalid bus reference.' };
    }

    const busDoc = await adminDb.collection('buses').doc(busId.trim()).get();

    if (!busDoc.exists) {
        return { ok: false, status: 404, message: 'Selected bus was not found.' };
    }

    const bus = busDoc.data() ?? {};
    const numberPlate = trimmedOrUndefined(bus.numberPlate);
    const busModel = trimmedOrUndefined(bus.busModel);
    const manufacturer = trimmedOrUndefined(bus.manufacturer);
    const resolvedBusId = busId.trim();

    return {
        ok: true,
        value: {
            busId: resolvedBusId,
            // Only the fields the fleet record actually holds are written, so
            // the snapshot never carries empty keys.
            vehicle: {
                // Falls back to the id so the snapshot always identifies
                // something, even against an incomplete fleet record.
                numberPlate: numberPlate ?? resolvedBusId,
                ...(busModel ? { busModel } : {}),
                ...(manufacturer ? { manufacturer } : {}),
            },
        },
    };
}

/** What a report carries about its route: nothing at all, or both halves. */
export interface ResolvedRouteReference {
    routeId?: string;
    route?: ReportRouteSnapshotData;
}

/** Resolves the optional route reference, by the same rules as the bus. */
export async function resolveRouteReference(
    adminDb: any,
    routeId: unknown
): Promise<ReferenceResolution<ResolvedRouteReference>> {
    if (!isReferenceSupplied(routeId)) return { ok: true, value: {} };

    if (!isValidReferenceId(routeId)) {
        return { ok: false, status: 400, message: 'Invalid route reference.' };
    }

    const routeDoc = await adminDb.collection('routes').doc(routeId.trim()).get();

    if (!routeDoc.exists) {
        return { ok: false, status: 404, message: 'Selected route was not found.' };
    }

    const route = routeDoc.data() ?? {};
    const routeNumber = trimmedOrUndefined(route.routeNumber);
    const routeName = trimmedOrUndefined(route.routeName);
    const direction = trimmedOrUndefined(route.direction);
    const resolvedRouteId = routeId.trim();

    return {
        ok: true,
        value: {
            routeId: resolvedRouteId,
            route: {
                routeNumber: routeNumber ?? resolvedRouteId,
                ...(routeName ? { routeName } : {}),
                // Every route created through /api/routes carries a direction,
                // but an older record without one is snapshotted without it
                // rather than being given a direction it never had.
                ...(direction === 'OUTBOUND' || direction === 'RETURN' ? { direction } : {}),
            },
        },
    };
}
