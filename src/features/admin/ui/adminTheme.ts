// Design tokens lifted from the existing Admin Dashboard so every management
// screen shares one visual language instead of re-deriving colours per file.
export const adminColors = {
    background: '#F4F7FB',
    surface: '#FFFFFF',
    surfaceMuted: '#F8FAFC',
    border: '#E4EAF1',
    borderSubtle: '#F1F5F9',

    textPrimary: '#1A2530',
    textSecondary: '#71808D',
    textMuted: '#7A8793',
    textPlaceholder: '#9AA7B2',

    primary: '#1976D2',
    primarySoft: '#EEF5FF',
    success: '#388E3C',
    successSoft: '#EEF8EF',
    warning: '#F57C00',
    warningSoft: '#FFF4E5',
    danger: '#D32F2F',
    dangerSoft: '#FEF4F4',
    dangerBorder: '#F7D4D4',
    accent: '#0288D1',
    accentSoft: '#E5F4FB',
    purple: '#7B1FA2',
} as const;

export const adminShadow = {
    card: {
        elevation: 2,
        shadowColor: '#000',
        shadowOpacity: 0.05,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
    },
    header: {
        elevation: 3,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 4,
        shadowOffset: { width: 0, height: 2 },
    },
} as const;