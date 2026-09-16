import React, { useMemo } from 'react';
import { StyleSheet, Text as RNText, TextProps as RNTextProps } from 'react-native';
import { usePreferencesStore } from '../store/preferencesStore';
import { useAppTheme } from '../hooks/useAppTheme';

export interface AppTextProps extends RNTextProps {
    children?: React.ReactNode;
}

/**
 * AppText - Global Text Wrapper Component
 * Automatically scales font size based on the user's accessibility preferences (textSize).
 */
export const AppText: React.FC<AppTextProps> = ({ style, children, ...props }) => {
    const { preferences } = usePreferencesStore();

    // Determine scale multiplier based on preferences
    const scaleMultiplier = useMemo(() => {
        switch (preferences.textSize) {
            case 'large':
                return 1.25;
            case 'extra_large':
                return 1.5;
            case 'default':
            default:
                return 1.0;
        }
    }, [preferences.textSize]);

    const theme = useAppTheme();

    // Compute scaled style
    const scaledStyle = useMemo(() => {
        const flattenedStyle = StyleSheet.flatten(style) || {};
        
        // If a font size is explicitly provided, scale it. Otherwise scale a base size (14).
        const baseFontSize = flattenedStyle.fontSize !== undefined ? flattenedStyle.fontSize : 14;
        const scaledFontSize = Math.round(baseFontSize * scaleMultiplier);
        
        // Similarly scale lineHeight if it exists to maintain vertical rhythm
        let scaledLineHeight = flattenedStyle.lineHeight;
        if (scaledLineHeight !== undefined && typeof scaledLineHeight === 'number') {
            scaledLineHeight = Math.round(scaledLineHeight * scaleMultiplier);
        }

        // Apply High Contrast Colors
        let finalColor = flattenedStyle.color;
        if (theme.isHighContrast) {
            // In high contrast mode, we force text to be white or primary yellow
            // We'll use the theme's text color by default, which is white
            finalColor = theme.colors.text;
            
            // If the original text was a brand color (like blue), we might make it yellow
            if (flattenedStyle.color && typeof flattenedStyle.color === 'string') {
                const colorStr = flattenedStyle.color.toLowerCase();
                if (colorStr.includes('0066cc') || colorStr.includes('blue') || colorStr.includes('primary')) {
                    finalColor = theme.colors.primary; // Yellow
                }
            }
        }

        return [
            style,
            { 
                fontSize: scaledFontSize,
                ...(scaledLineHeight ? { lineHeight: scaledLineHeight } : {}),
                ...(finalColor ? { color: finalColor } : {})
            }
        ];
    }, [style, scaleMultiplier, theme]);

    return (
        <RNText style={scaledStyle} {...props}>
            {children}
        </RNText>
    );
};
