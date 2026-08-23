import React from 'react';
import { ReportFormScreen } from './ReportFormScreen';

/**
 * Filing a new accessibility report.
 *
 * The form lives in ReportFormScreen, which also backs editing an existing
 * report: the fields, the required-field rules and the photo picker are the
 * same either way, and a second copy of them is how the two would drift apart.
 * This screen is the create half of it.
 */
export const ReportIssueScreen = () => <ReportFormScreen mode="create" />;
