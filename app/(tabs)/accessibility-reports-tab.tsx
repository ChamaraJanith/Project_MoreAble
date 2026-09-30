import { Href, Redirect } from 'expo-router';
import React from 'react';
import { accessibilityReportsPath } from '../../src/features/reports/utils/reportRoutes';

/**
 * The Accessibility Reports bottom tab. The screen itself lives in the root
 * stack at `/accessibility-reports` (reached from Profile too), so the tab
 * press is intercepted in `(tabs)/_layout.tsx` and pushes that route instead.
 * This file only exists because a tab needs a route; a deep link that lands
 * here is forwarded to the real screen.
 */
export default function AccessibilityReportsTab() {
    return <Redirect href={accessibilityReportsPath() as Href} />;
}
