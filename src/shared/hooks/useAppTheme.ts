// Dynamic Theme Provider based on App Preferences

import { useMemo } from 'react';
import { usePreferencesStore } from '../store/preferencesStore';

export const useAppTheme = () => {
    const { preferences } = usePreferencesStore();
    const isHighContrast = preferences.highContrast;

    const theme = useMemo(() => {
        if (isHighContrast) {
            return {
                colors: {
                    background: '#000000',
                    surface: '#121212',
                    surfaceCard: '#1E1E1E',
                    primary: '#FFD700', // Yellow against black
                    text: '#FFFFFF',
                    textSecondary: '#E0E0E0',
                    border: '#333333',
                    error: '#FF5252',
                    success: '#4CAF50',
                    disabled: '#777777',
                    iconPrimary: '#FFD700',
                    iconSecondary: '#E0E0E0',
                },
                isHighContrast: true,
            };
        }

        return {
            colors: {
                background: '#F0F4F8',
                surface: '#FFFFFF',
                surfaceCard: '#FFFFFF',
                primary: '#0066CC',
                text: '#0F172A',
                textSecondary: '#64748B',
                border: '#E2E8F0',
                error: '#D32F2F',
                success: '#059669',
                disabled: '#CBD5E1',
                iconPrimary: '#0066CC',
                iconSecondary: '#94A3B8',
            },
            isHighContrast: false,
        };
    }, [isHighContrast]);

    return theme;
};
