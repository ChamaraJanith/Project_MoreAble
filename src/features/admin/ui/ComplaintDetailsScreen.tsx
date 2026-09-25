import { AppText as Text } from '../../../shared/ui/AppText';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    View,
} from 'react-native';
import { ComplaintAction } from '../../../entities/complaint/model/types';
import { AdminUserSummary } from '../../../entities/user/model/types';
import { useAuthStore } from '../../../shared/store/authStore';
import {
    ReportEmptySection,
    ReportJourneyRow,
    ReportSectionTitle,
    reportDetailStyles,
} from '../../reports/ui/ReportDetailSections';
import { ReportTextArea } from '../../reports/ui/ReportFormFields';
import {
    reportCategoryIcon,
    reportCategoryLabel,
} from '../../reports/ui/reportCategories';
import { formatReportDateTime } from '../../reports/utils/reportFormat';
import {
    ComplaintActionOutcome,
    ComplaintResult,
    assignComplaint,
    getComplaint,
    reassignComplaint,
    resolveComplaint,
    startComplaint,
} from '../api/complaintAdminApi';
import { getUsers } from '../api/userAdminApi';
import {
    AdminComplaint,
    ComplaintSourceReport,
    MAX_RESOLUTION_NOTE_LENGTH,
    complaintActionAvailability,
    complaintActorLabel,
    complaintAssigneeLabel,
    complaintAssigneeOptions,
    complaintErrorMessage,
    complaintStatusLabel,
    isComplaintIdParam,
    resolutionNoteError,
    shouldReloadComplaintAfterFailure,
} from '../utils/complaintWorkflow';
import { AdminScreenHeader } from './AdminScreenHeader';
import { AdminSelectModal } from './AdminSelectModal';
import { AdminEmptyState, AdminErrorState, AdminListSkeleton, ConfirmDialog } from './AdminStates';
import { StatusBadge } from './StatusBadge';
import { adminColors, adminShadow } from './adminTheme';

type LoadStatus = 'loading' | 'ready' | 'missing' | 'failed';

/** An assignment or a start, waiting on the admin's confirmation. */
type PendingConfirmation =
    | { action: 'ASSIGN' | 'REASSIGN'; assignedTo: string; assigneeName: string }
    | { action: 'START' };

/**
 * One complaint, and the workflow that gets it fixed (MOV-176).
 *
 * The actions on offer are read off the complaint's status through the same
 * transition table the API enforces (complaintActionAvailability), so a button
 * is never drawn for an action the route would refuse. Every action is
 * confirmed first, sent as an ACTION rather than a status, and followed by a
 * reload so the page shows what is stored.
 *
 * A 409 means another admin moved the complaint while this page was open. It is
 * said as much, and the page reloads rather than leaving the stale action on
 * offer — the action is never retried.
 *
 * The source report is shown read-only. Its status is the report workflow's
 * (VERIFIED: the issue was confirmed); the complaint's status is this one's
 * (RESOLVED: the issue was fixed). Nothing on this screen changes the report.
 */
export const ComplaintDetailsScreen = () => {
    const { token, isAuthenticated, user } = useAuthStore();
    const params = useLocalSearchParams<{ complaintId?: string | string[] }>();

    const rawComplaintId = Array.isArray(params.complaintId)
        ? params.complaintId[0]
        : params.complaintId;

    // Checked before any request: an id that cannot name a complaint is said to
    // be invalid on the spot rather than sent to the API to be refused.
    const complaintId = isComplaintIdParam(rawComplaintId) ? rawComplaintId : null;
    const isValidId = complaintId !== null;

    const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading');
    const [loadError, setLoadError] = useState<string | null>(null);
    const [complaint, setComplaint] = useState<AdminComplaint | null>(null);
    const [sourceReport, setSourceReport] = useState<ComplaintSourceReport | null>(null);

    const [pendingAction, setPendingAction] = useState<ComplaintAction | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const [admins, setAdmins] = useState<AdminUserSummary[] | null>(null);
    const [isLoadingAdmins, setIsLoadingAdmins] = useState(false);
    const [picker, setPicker] = useState<'ASSIGN' | 'REASSIGN' | null>(null);
    const [confirming, setConfirming] = useState<PendingConfirmation | null>(null);

    const [isResolveOpen, setIsResolveOpen] = useState(false);
    const [resolutionNote, setResolutionNote] = useState('');
    const [noteTouched, setNoteTouched] = useState(false);

    // Guards a second press landing before React has re-rendered the buttons
    // disabled — the same job the review screen's reducer state does.
    const inFlight = useRef(false);

    const loadComplaint = useCallback(async () => {
        if (!complaintId) {
            setLoadStatus('missing');
            return;
        }

        if (!isAuthenticated || !token) {
            setLoadError(complaintErrorMessage(401));
            setLoadStatus('failed');
            return;
        }

        setLoadStatus('loading');

        const result = await getComplaint(complaintId, token);

        if (result.ok) {
            setComplaint(result.value.complaint);
            setSourceReport(result.value.sourceReport);
            setLoadError(null);
            setLoadStatus('ready');
            return;
        }

        if (result.status === 404) {
            setComplaint(null);
            setLoadStatus('missing');
            return;
        }

        setLoadError(complaintErrorMessage(result.status, result.message));
        setLoadStatus('failed');
    }, [complaintId, isAuthenticated, token]);

    // Reloaded on focus, so a complaint moved elsewhere is not still showing an
    // action it no longer offers when this screen comes back into view.
    useFocusEffect(
        useCallback(() => {
            loadComplaint();
        }, [loadComplaint])
    );

    /**
     * Sends one workflow action.
     *
     * On success the complaint the API returned goes on screen at once, and the
     * page reloads behind it so the source report is current too. On a 409 or
     * a 404 the complaint on screen no longer exists in that form, so it
     * reloads there as well.
     */
    const runAction = useCallback(
        async (
            action: ComplaintAction,
            send: (id: string, sessionToken: string) => Promise<ComplaintResult<ComplaintActionOutcome>>
        ): Promise<boolean> => {
            if (!complaintId || !token || inFlight.current) return false;

            inFlight.current = true;
            setPendingAction(action);
            setActionError(null);
            setSuccessMessage(null);

            const result = await send(complaintId, token);

            inFlight.current = false;
            setPendingAction(null);

            if (result.ok) {
                setComplaint(result.value.complaint);
                setSuccessMessage(result.value.message);
                loadComplaint();
                return true;
            }

            setActionError(complaintErrorMessage(result.status, result.message));

            if (shouldReloadComplaintAfterFailure(result.status)) loadComplaint();

            return false;
        },
        [complaintId, token, loadComplaint]
    );

    /**
     * Opens the administrator picker, loading the administrators the first
     * time. Only active ADMIN accounts are offered, never the current assignee.
     */
    const openPicker = async (mode: 'ASSIGN' | 'REASSIGN') => {
        setActionError(null);

        if (admins === null) {
            setIsLoadingAdmins(true);

            try {
                setAdmins(await getUsers('ADMIN'));
            } catch (error: any) {
                setIsLoadingAdmins(false);
                setActionError(
                    error?.message
                        ? `Unable to load administrators. ${error.message}`
                        : 'Unable to load administrators. Please try again.'
                );
                return;
            }

            setIsLoadingAdmins(false);
        }

        setPicker(mode);
    };

    const assigneeOptions = useMemo(
        () =>
            complaintAssigneeOptions(admins ?? [], complaint?.assignedTo).map((option) => ({
                ...option,
                label: option.value === user?.passengerId ? `${option.label} (you)` : option.label,
            })),
        [admins, complaint?.assignedTo, user?.passengerId]
    );

    const selectAssignee = (value: string) => {
        const mode = picker;
        const option = assigneeOptions.find((candidate) => candidate.value === value);

        setPicker(null);

        if (!mode || !option) return;

        setConfirming({ action: mode, assignedTo: value, assigneeName: option.label });
    };

    const confirmPending = async () => {
        const pending = confirming;

        setConfirming(null);

        if (!pending) return;

        if (pending.action === 'START') {
            await runAction('START', startComplaint);
            return;
        }

        const send = pending.action === 'ASSIGN' ? assignComplaint : reassignComplaint;

        await runAction(pending.action, (id, sessionToken) =>
            send(id, pending.assignedTo, sessionToken)
        );
    };

    const noteError = resolutionNoteError(resolutionNote);

    const openResolve = () => {
        setActionError(null);
        setNoteTouched(false);
        setIsResolveOpen(true);
    };

    const submitResolve = async () => {
        setNoteTouched(true);

        if (noteError) return;

        const note = resolutionNote.trim();
        const resolved = await runAction('RESOLVE', (id, sessionToken) =>
            resolveComplaint(id, note, sessionToken)
        );

        // Closed either way: on success there is nothing left to resolve, and a
        // failure is said on the page, which is also where a 409 reloads.
        setIsResolveOpen(false);

        if (resolved) {
            setResolutionNote('');
            setNoteTouched(false);
        }
    };

    const busy = pendingAction !== null;

    // ------------------------------------------------------------------

    const renderBody = () => {
        if (!isValidId) {
            return (
                <AdminEmptyState
                    icon="alert-circle-outline"
                    title="Invalid complaint ID"
                    description="This link does not point to a complaint. Complaint IDs look like CMP-00001."
                />
            );
        }

        if (loadStatus === 'loading' && !complaint) return <AdminListSkeleton count={3} />;

        if (loadStatus === 'missing') {
            return (
                <AdminEmptyState
                    icon="document-outline"
                    title="Complaint not found"
                    description={`No complaint exists with the ID ${complaintId}.`}
                />
            );
        }

        if (!complaint) {
            return (
                <AdminErrorState
                    title="Unable to load complaint"
                    message={loadError ?? complaintErrorMessage(undefined)}
                    retryLabel="Try Again"
                    onRetry={loadComplaint}
                />
            );
        }

        const actions = complaintActionAvailability(complaint.status);
        const assignee = complaintAssigneeLabel(complaint);
        const isMine = !!user?.passengerId && complaint.assignedTo === user.passengerId;

        return (
            <>
                {/* ---------------- Summary ---------------- */}
                <View style={reportDetailStyles.hero}>
                    <View style={reportDetailStyles.heroIconCircle}>
                        <Ionicons
                            name={reportCategoryIcon(complaint.issueCategory)}
                            size={30}
                            color={adminColors.primary}
                        />
                    </View>

                    <Text style={reportDetailStyles.heroTitle} accessibilityRole="header">
                        {reportCategoryLabel(complaint.issueCategory)}
                    </Text>

                    <View style={reportDetailStyles.heroBadge}>
                        <StatusBadge status={complaint.status} />
                    </View>

                    <Text style={reportDetailStyles.heroDate}>
                        {complaint.complaintId} · Opened {formatReportDateTime(complaint.createdAt)}
                    </Text>
                </View>

                {loadStatus === 'loading' && (
                    <View style={styles.refreshing} accessibilityLiveRegion="polite">
                        <ActivityIndicator size="small" color={adminColors.primary} />
                        <Text style={styles.refreshingText}>Refreshing complaint…</Text>
                    </View>
                )}

                {loadStatus === 'failed' && !!loadError && (
                    <InlineMessage tone="error" message={loadError} />
                )}

                {/* ---------------- Workflow ---------------- */}
                <ReportSectionTitle>Complaint Workflow</ReportSectionTitle>

                <View style={reportDetailStyles.card}>
                    <DetailRow
                        icon="flag-outline"
                        label="Complaint Status"
                        value={complaintStatusLabel(complaint.status)}
                        isFirst
                    />
                    <DetailRow
                        icon="person-outline"
                        label="Assigned Admin"
                        value={assignee ? `${assignee}${isMine ? ' (you)' : ''}` : null}
                        secondary={assignee && complaint.assignedTo !== assignee ? complaint.assignedTo : undefined}
                        emptyLabel="Not assigned yet"
                    />
                    {!!complaint.assignedBy && (
                        <DetailRow
                            icon="person-add-outline"
                            label="Assigned By"
                            value={complaintActorLabel(complaint.assignedBy, user?.uid)}
                        />
                    )}
                    <DetailRow
                        icon="calendar-outline"
                        label="Assigned At"
                        value={complaint.assignedAt ? formatReportDateTime(complaint.assignedAt) : null}
                        emptyLabel="Not assigned yet"
                    />
                    <DetailRow
                        icon="play-circle-outline"
                        label="Started At"
                        value={complaint.startedAt ? formatReportDateTime(complaint.startedAt) : null}
                        emptyLabel="Not started yet"
                    />
                    <DetailRow
                        icon="checkmark-done-outline"
                        label="Resolved At"
                        value={complaint.resolvedAt ? formatReportDateTime(complaint.resolvedAt) : null}
                        emptyLabel="Not resolved yet"
                    />
                    <DetailRow
                        icon="shield-checkmark-outline"
                        label="Resolved By"
                        value={complaintActorLabel(complaint.resolvedBy, user?.uid)}
                        emptyLabel="Not resolved yet"
                    />
                    <DetailRow
                        icon="time-outline"
                        label="Created At"
                        value={formatReportDateTime(complaint.createdAt)}
                    />
                    <DetailRow
                        icon="refresh-outline"
                        label="Updated At"
                        value={formatReportDateTime(complaint.updatedAt)}
                    />

                    {!!complaint.resolutionNote && (
                        <View style={styles.noteQuote}>
                            <Text style={styles.noteQuoteLabel}>Resolution Note</Text>
                            <Text style={styles.noteQuoteText}>{complaint.resolutionNote}</Text>
                        </View>
                    )}
                </View>

                {actionError && <InlineMessage tone="error" message={actionError} />}
                {successMessage && <InlineMessage tone="success" message={successMessage} />}

                {/* ---------------- Actions ---------------- */}
                {actions.assign || actions.reassign || actions.start || actions.resolve ? (
                    <View style={styles.actions}>
                        {actions.assign && (
                            <ActionButton
                                label="Assign Complaint"
                                busyLabel={isLoadingAdmins ? 'Loading administrators…' : 'Assigning…'}
                                icon="person-add"
                                tone="primary"
                                busy={pendingAction === 'ASSIGN' || isLoadingAdmins}
                                disabled={busy || isLoadingAdmins}
                                onPress={() => openPicker('ASSIGN')}
                            />
                        )}

                        {actions.start && (
                            <ActionButton
                                label="Start Complaint"
                                busyLabel="Starting…"
                                icon="play"
                                tone="primary"
                                busy={pendingAction === 'START'}
                                disabled={busy || isLoadingAdmins}
                                onPress={() => setConfirming({ action: 'START' })}
                            />
                        )}

                        {actions.resolve && (
                            <ActionButton
                                label="Resolve Complaint"
                                busyLabel="Resolving…"
                                icon="checkmark-done"
                                tone="success"
                                busy={pendingAction === 'RESOLVE'}
                                disabled={busy || isLoadingAdmins}
                                onPress={openResolve}
                            />
                        )}

                        {actions.reassign && (
                            <ActionButton
                                label="Reassign"
                                busyLabel={isLoadingAdmins ? 'Loading administrators…' : 'Reassigning…'}
                                icon="swap-horizontal"
                                tone="secondary"
                                busy={pendingAction === 'REASSIGN' || isLoadingAdmins}
                                disabled={busy || isLoadingAdmins}
                                onPress={() => openPicker('REASSIGN')}
                            />
                        )}
                    </View>
                ) : (
                    <View style={styles.finalNotice} accessibilityLiveRegion="polite">
                        <StatusBadge status={complaint.status} />
                        <Text style={styles.finalNoticeText}>
                            This complaint has been resolved. No further workflow actions are
                            available.
                        </Text>
                    </View>
                )}

                {/* ---------------- The complaint's own copy ---------------- */}
                <ReportSectionTitle>Issue Description</ReportSectionTitle>

                <View style={reportDetailStyles.card}>
                    <Text style={reportDetailStyles.descriptionText}>{complaint.description}</Text>
                </View>

                <ReportSectionTitle>Bus and Route</ReportSectionTitle>

                <View style={reportDetailStyles.card}>
                    <JourneyRows
                        busId={complaint.busId}
                        vehicle={complaint.vehicle}
                        routeId={complaint.routeId}
                        route={complaint.route}
                    />
                </View>

                {/* ---------------- Source report (read only) ---------------- */}
                <ReportSectionTitle>Source Report</ReportSectionTitle>

                <SourceReportCard reportId={complaint.reportId} report={sourceReport} />
            </>
        );
    };

    return (
        <View style={styles.container}>
            <AdminScreenHeader title="Complaint Details" subtitle={complaintId ?? undefined} />

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {renderBody()}
            </ScrollView>

            <AdminSelectModal
                visible={picker !== null}
                title={picker === 'REASSIGN' ? 'Reassign To' : 'Assign To'}
                options={assigneeOptions}
                selectedValue={null}
                emptyMessage={
                    picker === 'REASSIGN'
                        ? 'No other active administrators are available.'
                        : 'No active administrators are available.'
                }
                onClose={() => setPicker(null)}
                onSelect={selectAssignee}
            />

            <ConfirmDialog
                visible={confirming !== null}
                title={confirmationCopy(confirming).title}
                message={confirmationCopy(confirming).message}
                confirmLabel={confirmationCopy(confirming).confirmLabel}
                isBusy={busy}
                onCancel={() => setConfirming(null)}
                onConfirm={confirmPending}
            />

            <ResolveDialog
                visible={isResolveOpen}
                note={resolutionNote}
                error={noteTouched ? noteError : null}
                canSubmit={!noteError}
                isBusy={pendingAction === 'RESOLVE'}
                onChangeNote={(text) => {
                    setResolutionNote(text);
                    setNoteTouched(true);
                }}
                onCancel={() => setIsResolveOpen(false)}
                onSubmit={submitResolve}
            />
        </View>
    );
};

// ------------------------------------------------------------------

function confirmationCopy(pending: PendingConfirmation | null) {
    if (!pending) return { title: '', message: '', confirmLabel: '' };

    switch (pending.action) {
        case 'ASSIGN':
            return {
                title: 'Assign Complaint?',
                message: `${pending.assigneeName} will be responsible for fixing this issue. The complaint moves to Assigned.`,
                confirmLabel: 'Assign',
            };
        case 'REASSIGN':
            return {
                title: 'Reassign Complaint?',
                message: `${pending.assigneeName} will take over this complaint. Its status stays the same.`,
                confirmLabel: 'Reassign',
            };
        case 'START':
            return {
                title: 'Start Complaint?',
                message: 'This records that work on the issue has begun. The complaint moves to In Progress.',
                confirmLabel: 'Start Complaint',
            };
    }
}

/** A labelled fact, drawn as the report screens draw theirs. */
function DetailRow({
    icon,
    label,
    value,
    secondary,
    emptyLabel = 'Not available',
    isFirst = false,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string | null;
    secondary?: string;
    emptyLabel?: string;
    isFirst?: boolean;
}) {
    return (
        <View style={[styles.detailRow, !isFirst && reportDetailStyles.divided]}>
            <Ionicons name={icon} size={17} color={adminColors.textSecondary} />
            <Text style={styles.detailLabel}>{label}</Text>
            <View style={styles.detailValueGroup}>
                <Text style={[styles.detailValue, !value && styles.detailValueEmpty]}>
                    {value ?? emptyLabel}
                </Text>
                {!!value && !!secondary && <Text style={styles.detailSecondary}>{secondary}</Text>}
            </View>
        </View>
    );
}

/** The bus and the route, as the report screens show a journey. */
function JourneyRows({
    busId,
    vehicle,
    routeId,
    route,
}: Pick<AdminComplaint, 'busId' | 'vehicle' | 'routeId' | 'route'>) {
    const busSecondary = [vehicle?.manufacturer, vehicle?.busModel].filter(Boolean).join(' ');
    const routeSecondary = [route?.routeName, route?.direction].filter(Boolean).join(' · ');

    return (
        <>
            <ReportJourneyRow
                isFirst
                entry={{
                    icon: 'bus-outline',
                    label: 'Vehicle',
                    primary: vehicle?.numberPlate ?? busId ?? null,
                    secondary: busSecondary || undefined,
                }}
            />
            <ReportJourneyRow
                isFirst={false}
                entry={{
                    icon: 'git-branch-outline',
                    label: 'Route',
                    primary: route?.routeNumber ? `Route ${route.routeNumber}` : (routeId ?? null),
                    secondary: routeSecondary || undefined,
                }}
            />
        </>
    );
}

/**
 * The report the complaint was opened from, read only.
 *
 * Its status badge is the REPORT's — VERIFIED means the issue was confirmed —
 * and it is labelled as such, so it is never read as the complaint's progress.
 * Once the passenger deletes the report this says so; the complaint above
 * still carries its own copy of the issue, bus and route.
 */
function SourceReportCard({
    reportId,
    report,
}: {
    reportId: string;
    report: ComplaintSourceReport | null;
}) {
    if (!report) {
        return (
            <View style={reportDetailStyles.card}>
                <DetailRow icon="document-text-outline" label="Report ID" value={reportId} isFirst />
                <View style={reportDetailStyles.divided}>
                    <ReportEmptySection
                        icon="trash-outline"
                        message="The source report is no longer available — the passenger may have deleted it. This complaint keeps its own copy of the issue, bus and route."
                    />
                </View>
            </View>
        );
    }

    return (
        <View style={reportDetailStyles.card}>
            <View style={styles.readOnlyBanner}>
                <Ionicons name="lock-closed-outline" size={13} color={adminColors.textMuted} />
                <Text style={styles.readOnlyText}>
                    Read only. The report is managed in Review Reports.
                </Text>
            </View>

            <DetailRow icon="document-text-outline" label="Report ID" value={report.reportId} isFirst />

            <View style={[styles.detailRow, reportDetailStyles.divided]}>
                <Ionicons name="shield-checkmark-outline" size={17} color={adminColors.textSecondary} />
                <Text style={styles.detailLabel}>Report Status</Text>
                {report.status ? (
                    <StatusBadge status={report.status} size="small" />
                ) : (
                    <Text style={[styles.detailValue, styles.detailValueEmpty]}>Not available</Text>
                )}
            </View>

            <DetailRow
                icon="alert-circle-outline"
                label="Issue Category"
                value={report.issueCategory ? reportCategoryLabel(report.issueCategory) : null}
            />

            {!!report.reviewedAt && (
                <DetailRow
                    icon="calendar-outline"
                    label="Verified At"
                    value={formatReportDateTime(report.reviewedAt)}
                />
            )}

            {!!report.createdAt && (
                <DetailRow
                    icon="time-outline"
                    label="Reported At"
                    value={formatReportDateTime(report.createdAt)}
                />
            )}

            {!!report.description && (
                <View style={styles.noteQuote}>
                    <Text style={styles.noteQuoteLabel}>Passenger&apos;s Description</Text>
                    <Text style={styles.noteQuoteText}>{report.description}</Text>
                </View>
            )}

            <View style={[reportDetailStyles.divided, styles.sourceJourney]}>
                <JourneyRows
                    busId={report.busId}
                    vehicle={report.vehicle}
                    routeId={report.routeId}
                    route={report.route}
                />
            </View>
        </View>
    );
}

function ActionButton({
    label,
    busyLabel,
    icon,
    tone,
    busy,
    disabled,
    onPress,
}: {
    label: string;
    busyLabel: string;
    icon: keyof typeof Ionicons.glyphMap;
    tone: 'primary' | 'success' | 'secondary';
    busy: boolean;
    disabled: boolean;
    onPress: () => void;
}) {
    const isSecondary = tone === 'secondary';
    const foreground = isSecondary ? adminColors.primary : '#FFFFFF';

    return (
        <TouchableOpacity
            style={[
                styles.actionButton,
                tone === 'primary' && styles.actionPrimary,
                tone === 'success' && styles.actionSuccess,
                isSecondary && styles.actionSecondary,
                disabled && !busy && styles.buttonDisabled,
            ]}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled, busy }}
        >
            {busy ? (
                <ActivityIndicator size="small" color={foreground} />
            ) : (
                <Ionicons name={icon} size={18} color={foreground} />
            )}
            <Text style={[styles.actionText, { color: foreground }]}>{busy ? busyLabel : label}</Text>
        </TouchableOpacity>
    );
}

/**
 * The resolution form. The note is required, trimmed, and at most 500
 * characters — what the API accepts — and Resolve stays disabled until it is.
 */
function ResolveDialog({
    visible,
    note,
    error,
    canSubmit,
    isBusy,
    onChangeNote,
    onCancel,
    onSubmit,
}: {
    visible: boolean;
    note: string;
    error: string | null;
    canSubmit: boolean;
    isBusy: boolean;
    onChangeNote: (text: string) => void;
    onCancel: () => void;
    onSubmit: () => void;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
            <KeyboardAvoidingView
                style={styles.dialogBackdrop}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={styles.dialogCard} accessibilityViewIsModal>
                    <Text style={styles.dialogTitle} accessibilityRole="header">
                        Resolve Complaint
                    </Text>
                    <Text style={styles.dialogMessage}>
                        Describe how the accessibility issue was fixed. A resolved complaint is final
                        and cannot be changed afterwards. The source report is not affected.
                    </Text>

                    <ReportTextArea
                        label="Resolution Note"
                        value={note}
                        onChangeText={onChangeNote}
                        placeholder="e.g. Wheelchair ramp was repaired and tested."
                        helper="Required."
                        maxLength={MAX_RESOLUTION_NOTE_LENGTH}
                        editable={!isBusy}
                        error={error ?? undefined}
                    />

                    <TouchableOpacity
                        style={[
                            styles.actionButton,
                            styles.actionSuccess,
                            (!canSubmit || isBusy) && styles.buttonDisabled,
                        ]}
                        onPress={onSubmit}
                        disabled={!canSubmit || isBusy}
                        accessibilityRole="button"
                        accessibilityLabel="Resolve Complaint"
                        accessibilityState={{ disabled: !canSubmit || isBusy, busy: isBusy }}
                    >
                        {isBusy ? (
                            <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                            <Ionicons name="checkmark-done" size={18} color="#FFFFFF" />
                        )}
                        <Text style={[styles.actionText, { color: '#FFFFFF' }]}>
                            {isBusy ? 'Resolving…' : 'Resolve Complaint'}
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.dialogCancelButton}
                        onPress={onCancel}
                        disabled={isBusy}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                    >
                        <Text style={styles.dialogCancelText}>Cancel</Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

/** Something that happened, said in place — the review screen's pattern. */
function InlineMessage({ tone, message }: { tone: 'error' | 'success'; message: string }) {
    const isError = tone === 'error';

    return (
        <View
            style={[styles.inlineMessage, isError ? styles.inlineError : styles.inlineSuccess]}
            accessibilityLiveRegion="polite"
        >
            <Ionicons
                name={isError ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                size={16}
                color={isError ? adminColors.danger : adminColors.success}
            />
            <Text
                style={[
                    styles.inlineMessageText,
                    { color: isError ? adminColors.danger : adminColors.success },
                ]}
            >
                {message}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: adminColors.background },
    content: { padding: 20, paddingBottom: 40 },

    refreshing: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 12 },
    refreshingText: { fontSize: 12, color: adminColors.textMuted },

    detailRow: { flexDirection: 'row', alignItems: 'center' },
    detailLabel: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 10,
    },
    detailValueGroup: { flexShrink: 1, alignItems: 'flex-end', maxWidth: '55%' },
    detailValue: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textPrimary,
        textAlign: 'right',
    },
    detailValueEmpty: { color: adminColors.textPlaceholder, fontWeight: '600' },
    detailSecondary: {
        fontSize: 11,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginTop: 2,
        textAlign: 'right',
    },

    noteQuote: {
        backgroundColor: adminColors.surfaceMuted,
        borderLeftWidth: 3,
        borderLeftColor: adminColors.primary,
        borderRadius: 10,
        padding: 13,
        marginTop: 14,
    },
    noteQuoteLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: adminColors.textMuted,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    noteQuoteText: {
        fontSize: 14,
        color: adminColors.textPrimary,
        lineHeight: 21,
        marginTop: 6,
    },

    readOnlyBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: adminColors.surfaceMuted,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginBottom: 14,
    },
    readOnlyText: { flexShrink: 1, fontSize: 12, fontWeight: '600', color: adminColors.textMuted },
    sourceJourney: { marginTop: 14 },

    actions: { marginTop: 20, gap: 10 },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 52,
        borderRadius: 12,
        paddingHorizontal: 16,
    },
    actionPrimary: { backgroundColor: adminColors.primary, ...adminShadow.card },
    actionSuccess: { backgroundColor: adminColors.success, ...adminShadow.card },
    actionSecondary: {
        backgroundColor: adminColors.surface,
        borderWidth: 1.5,
        borderColor: adminColors.primary,
    },
    actionText: { fontSize: 15, fontWeight: '700', marginLeft: 8, letterSpacing: 0.3 },
    buttonDisabled: { opacity: 0.5 },

    finalNotice: {
        backgroundColor: adminColors.surface,
        borderRadius: 12,
        padding: 16,
        marginTop: 20,
        alignItems: 'center',
        ...adminShadow.card,
    },
    finalNoticeText: {
        fontSize: 13,
        color: adminColors.textSecondary,
        lineHeight: 20,
        textAlign: 'center',
        marginTop: 10,
    },

    inlineMessage: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 10,
        paddingHorizontal: 13,
        paddingVertical: 11,
        marginTop: 16,
    },
    inlineError: { backgroundColor: adminColors.dangerSoft },
    inlineSuccess: { backgroundColor: adminColors.successSoft },
    inlineMessageText: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 19,
        marginLeft: 8,
    },

    dialogBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(26, 37, 48, 0.5)',
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    dialogCard: {
        backgroundColor: adminColors.surface,
        borderRadius: 16,
        padding: 22,
    },
    dialogTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginBottom: 8,
    },
    dialogMessage: {
        fontSize: 14,
        color: adminColors.textSecondary,
        lineHeight: 20,
        marginBottom: 12,
    },
    dialogCancelButton: {
        minHeight: 46,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 8,
    },
    dialogCancelText: { color: adminColors.textSecondary, fontSize: 15, fontWeight: '600' },
});
