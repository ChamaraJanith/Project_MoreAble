import { useSyncExternalStore } from 'react';
import {
    JourneyGeoInformation,
    JourneySearchMatch,
    JourneySearchOption,
} from '../../../entities/route/model/types';

/**
 * The journey option the passenger tapped "View details" on.
 *
 * A matched route plus its chosen departure is a nested object, and expo-router
 * params are strings only, so the selection is handed over through this
 * session-only store instead of being serialised into the URL. Mirrors the
 * pattern already used by the booking flow's selectedVehicleStore.
 */
export interface SelectedJourney {
    route: JourneySearchMatch;
    option: JourneySearchOption;
    /** Best-effort map data from the search response; absent when unavailable. */
    geo: JourneyGeoInformation | null;
    travelDate?: string;
    travelTime?: string;
    selectedAt: number;
}

let currentSelection: SelectedJourney | null = null;
const listeners = new Set<() => void>();

function emitChange() {
    listeners.forEach((listener) => listener());
}

export function setSelectedJourney(selection: SelectedJourney | null) {
    currentSelection = selection;
    emitChange();
}

export function getSelectedJourney(): SelectedJourney | null {
    return currentSelection;
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Session-only hold on the route the passenger is viewing in detail (MOV-75). */
export function useSelectedJourney(): SelectedJourney | null {
    return useSyncExternalStore(subscribe, getSelectedJourney, getSelectedJourney);
}
