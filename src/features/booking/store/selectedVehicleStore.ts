import { useSyncExternalStore } from 'react';
import { SelectedVehicle } from '../../../entities/booking/model/types';

let currentSelection: SelectedVehicle | null = null;
const listeners = new Set<() => void>();

function emitChange() {
    listeners.forEach((listener) => listener());
}

export function setSelectedVehicle(selection: SelectedVehicle | null) {
    currentSelection = selection;
    emitChange();
}

export function getSelectedVehicle(): SelectedVehicle | null {
    return currentSelection;
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Session-only hold on the vehicle the passenger just picked (US02). */
export function useSelectedVehicle(): SelectedVehicle | null {
    return useSyncExternalStore(subscribe, getSelectedVehicle, getSelectedVehicle);
}