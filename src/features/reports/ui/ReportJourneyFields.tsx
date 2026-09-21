import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Bus } from '../../../entities/bus/model/types';
import { Route } from '../../../entities/route/model/types';
import { AdminSelectModal, AdminSelectOption } from '../../admin/ui/AdminSelectModal';
import { adminColors } from '../../admin/ui/adminTheme';
import { loadReportReferenceData, ReportReferenceData } from '../api/reportReferenceData';
import { isBusSelectionUnlocked } from '../utils/reportFormValidation';
import { ReportSelectField } from './ReportFormFields';

const DIRECTION_LABELS: Record<string, string> = {
    OUTBOUND: 'Outbound',
    RETURN: 'Return',
};

export interface ReportJourneySelection {
    /** Canonical route document id, never the display text. */
    routeId: string | null;
    /** Canonical bus document id, never the number plate. */
    busId: string | null;
}

interface ReportJourneyFieldsProps extends ReportJourneySelection {
    onChange: (selection: ReportJourneySelection) => void;
    /** Labels both fields "Optional" instead of marking them required. */
    optional?: boolean;
}

/**
 * The route and bus pickers shared by every report form.
 *
 * Extracted from the issue report form so positive feedback (MOV-300) asks for
 * the journey exactly the same way: the same reference data, the same
 * route-then-bus ordering and the same retry when the fleet cannot be loaded.
 * The selection itself stays with the form, which is what decides whether it
 * is required and what is sent.
 */
export function ReportJourneyFields({
    routeId,
    busId,
    onChange,
    optional = false,
}: ReportJourneyFieldsProps) {
    const [buses, setBuses] = useState<Bus[]>([]);
    const [routes, setRoutes] = useState<Route[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [busError, setBusError] = useState<string | null>(null);
    const [routeError, setRouteError] = useState<string | null>(null);
    const [activePicker, setActivePicker] = useState<'bus' | 'route' | null>(null);

    const applyReferenceData = useCallback((data: ReportReferenceData) => {
        setBuses(data.buses);
        setRoutes(data.routes);
        setBusError(data.busError);
        setRouteError(data.routeError);
        setIsLoading(false);
    }, []);

    // Loaded once on mount. State is only set once the request settles, so
    // nothing is written synchronously inside the effect.
    useEffect(() => {
        let isActive = true;

        loadReportReferenceData().then((data) => {
            if (isActive) applyReferenceData(data);
        });

        return () => {
            isActive = false;
        };
    }, [applyReferenceData]);

    const retry = () => {
        setIsLoading(true);
        loadReportReferenceData().then(applyReferenceData);
    };

    // Whether a bus may be chosen yet. The route is asked for first, so
    // changing it drops a bus picked under the previous one rather than
    // leaving a stale selection behind.
    const isBusUnlocked = isBusSelectionUnlocked(routeId);

    const selectedBus = useMemo(
        () => buses.find((bus) => bus.busId === busId) ?? null,
        [buses, busId]
    );

    const selectedRoute = useMemo(
        () => routes.find((route) => route.routeId === routeId) ?? null,
        [routes, routeId]
    );

    // Every bus is offered, whatever its status: a passenger may well be
    // reporting the very fault that put the vehicle into maintenance.
    const busOptions = useMemo<AdminSelectOption[]>(
        () =>
            buses.map((bus) => ({
                value: bus.busId,
                label: bus.numberPlate,
                description: [bus.busModel, bus.manufacturer].filter(Boolean).join(' · '),
                status: bus.status,
            })),
        [buses]
    );

    // A route number exists once per direction, so the label has to carry the
    // direction too — "138" alone would be ambiguous.
    const routeOptions = useMemo<AdminSelectOption[]>(
        () =>
            routes.map((route) => ({
                value: route.routeId,
                label: `${route.routeNumber} · ${route.routeName}`,
                description: [
                    `${route.startLocation} → ${route.endLocation}`,
                    route.direction ? DIRECTION_LABELS[route.direction] ?? route.direction : null,
                ]
                    .filter(Boolean)
                    .join(' · '),
                status: route.status,
            })),
        [routes]
    );

    if (isLoading) {
        return (
            <View style={styles.loadingRow} accessibilityLiveRegion="polite">
                <ActivityIndicator size="small" color={adminColors.primary} />
                <Text style={styles.loadingText}>Loading buses and routes...</Text>
            </View>
        );
    }

    return (
        <>
            {(!!busError || !!routeError) && (
                <View style={styles.errorBanner} accessibilityRole="alert">
                    <Ionicons name="cloud-offline-outline" size={18} color={adminColors.danger} />
                    <Text style={styles.errorText}>
                        {[busError, routeError].filter(Boolean).join(' ')}
                    </Text>
                    <TouchableOpacity
                        onPress={retry}
                        style={styles.retryButton}
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading buses and routes"
                    >
                        <Text style={styles.retryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Route first: the bus field stays locked until a route is
                chosen, so the journey is established before the vehicle that
                ran it. */}
            <ReportSelectField
                label="Route"
                optional={optional}
                value={
                    selectedRoute ? `${selectedRoute.routeNumber} · ${selectedRoute.routeName}` : null
                }
                secondary={
                    selectedRoute
                        ? [
                              `${selectedRoute.startLocation} → ${selectedRoute.endLocation}`,
                              selectedRoute.direction
                                  ? DIRECTION_LABELS[selectedRoute.direction] ??
                                    selectedRoute.direction
                                  : null,
                          ]
                              .filter(Boolean)
                              .join(' · ')
                        : undefined
                }
                placeholder={routes.length === 0 ? 'No routes available' : 'Select Route'}
                icon="git-branch-outline"
                showSelectedTick
                disabled={routes.length === 0}
                onPress={() => setActivePicker('route')}
            />

            <ReportSelectField
                label="Bus / Vehicle"
                optional={optional}
                value={selectedBus?.numberPlate ?? null}
                secondary={[selectedBus?.busModel, selectedBus?.manufacturer]
                    .filter(Boolean)
                    .join(' · ')}
                placeholder={
                    !isBusUnlocked
                        ? 'Select Route first'
                        : buses.length === 0
                          ? 'No buses available'
                          : 'Select Bus'
                }
                icon="bus-outline"
                showSelectedTick
                disabled={!isBusUnlocked || buses.length === 0}
                onPress={() => setActivePicker('bus')}
                helper={
                    isBusUnlocked
                        ? 'The route and vehicle together let us trace the exact bus involved.'
                        : 'Choose the route you travelled on to pick the bus.'
                }
            />

            {(!!busId || !!routeId) && (
                <TouchableOpacity
                    style={styles.clearSelectionButton}
                    onPress={() => onChange({ routeId: null, busId: null })}
                    accessibilityRole="button"
                    accessibilityLabel="Clear bus and route selection"
                >
                    <Ionicons
                        name="close-circle-outline"
                        size={16}
                        color={adminColors.textSecondary}
                    />
                    <Text style={styles.clearSelectionText}>Clear selection</Text>
                </TouchableOpacity>
            )}

            <AdminSelectModal
                visible={activePicker === 'route'}
                title="Select Route"
                options={routeOptions}
                selectedValue={routeId}
                emptyMessage="No routes are available to select."
                onClose={() => setActivePicker(null)}
                onSelect={(value) => {
                    onChange({ routeId: value, busId: value === routeId ? busId : null });
                    setActivePicker(null);
                }}
            />

            <AdminSelectModal
                visible={activePicker === 'bus'}
                title="Select Bus"
                options={busOptions}
                selectedValue={busId}
                emptyMessage="No buses are available to select."
                onClose={() => setActivePicker(null)}
                onSelect={(value) => {
                    onChange({ routeId, busId: value });
                    setActivePicker(null);
                }}
            />
        </>
    );
}

const styles = StyleSheet.create({
    loadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
    },
    loadingText: {
        fontSize: 14,
        color: adminColors.textSecondary,
        marginLeft: 10,
    },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: adminColors.dangerSoft,
        borderWidth: 1,
        borderColor: adminColors.dangerBorder,
        borderRadius: 10,
        padding: 12,
        marginBottom: 16,
    },
    errorText: {
        flex: 1,
        fontSize: 12,
        fontWeight: '600',
        color: adminColors.danger,
        marginLeft: 8,
        lineHeight: 17,
    },
    retryButton: {
        minHeight: 32,
        justifyContent: 'center',
        paddingHorizontal: 10,
    },
    retryText: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.danger,
    },

    clearSelectionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        minHeight: 40,
        paddingRight: 8,
    },
    clearSelectionText: {
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 6,
    },
});
