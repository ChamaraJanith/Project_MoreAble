import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
    Image,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { StatusBadge } from '../../admin/ui/StatusBadge';
import { adminColors, adminShadow } from '../../admin/ui/adminTheme';
import {
    ReportGalleryPhoto,
    ReportJourneyEntry,
    galleryColumnsForWidth,
} from '../utils/reportSummary';

/**
 * The pieces one report is drawn from, shared by everybody who draws one.
 *
 * These were the passenger details screen's own components until the admin
 * review page needed the same report rendered the same way. They are lifted
 * here rather than copied, so the two screens cannot drift into showing the
 * same evidence differently — the reviewer deciding a report has to be looking
 * at what the passenger filed, not at a second rendering of it.
 *
 * Nothing here fetches, decides, or knows which screen it is on. Each piece
 * takes what it draws, which is what lets the review page put the same photo
 * gallery under a different set of actions.
 */

// ------------------------------------------------------------------
// Hero
// ------------------------------------------------------------------

interface ReportHeroProps {
    icon: keyof typeof Ionicons.glyphMap;
    /** The issue category, in the wording the picker offered it in. */
    title: string;
    status: string;
    submittedLabel: string;
    /** Anything the screen needs under the date, e.g. a review flag. */
    children?: React.ReactNode;
}

/** What this report is, at a glance: the issue, where it stands, and when. */
export function ReportHero({
    icon,
    title,
    status,
    submittedLabel,
    children,
}: ReportHeroProps) {
    return (
        <View style={reportDetailStyles.hero}>
            <View style={reportDetailStyles.heroIconCircle}>
                <Ionicons name={icon} size={30} color={adminColors.primary} />
            </View>

            <Text style={reportDetailStyles.heroTitle} accessibilityRole="header">
                {title}
            </Text>

            <View style={reportDetailStyles.heroBadge}>
                <StatusBadge status={status} />
            </View>

            <Text style={reportDetailStyles.heroDate}>{submittedLabel}</Text>

            {children}
        </View>
    );
}

// ------------------------------------------------------------------
// Section heading
// ------------------------------------------------------------------

export function ReportSectionTitle({ children }: { children: string }) {
    return (
        <Text style={reportDetailStyles.sectionTitle} accessibilityRole="header">
            {children}
        </Text>
    );
}

// ------------------------------------------------------------------
// Journey
// ------------------------------------------------------------------

/**
 * The bus, or the route.
 *
 * Both rows are always drawn. One the passenger did not fill in reads as "Not
 * provided" rather than vanishing, so the section keeps its shape and the
 * absence is stated instead of implied by a gap.
 */
export function ReportJourneyRow({
    entry,
    isFirst,
}: {
    entry: ReportJourneyEntry;
    isFirst: boolean;
}) {
    const isMissing = !entry.primary;

    return (
        <View style={[reportDetailStyles.journeyRow, !isFirst && reportDetailStyles.divided]}>
            <View
                style={[
                    reportDetailStyles.journeyIcon,
                    isMissing && reportDetailStyles.journeyIconMuted,
                ]}
            >
                <Ionicons
                    name={entry.icon}
                    size={20}
                    color={isMissing ? adminColors.textPlaceholder : adminColors.primary}
                />
            </View>

            <View style={reportDetailStyles.journeyText}>
                <Text style={reportDetailStyles.journeyLabel}>{entry.label}</Text>

                {isMissing ? (
                    <Text style={reportDetailStyles.journeyMissing}>Not provided</Text>
                ) : (
                    <>
                        <Text style={reportDetailStyles.journeyPrimary}>{entry.primary}</Text>

                        {!!entry.secondary && (
                            <Text style={reportDetailStyles.journeySecondary}>
                                {entry.secondary}
                            </Text>
                        )}
                    </>
                )}
            </View>
        </View>
    );
}

// ------------------------------------------------------------------
// Empty section
// ------------------------------------------------------------------

/** Shown where a report simply has nothing recorded for a section. */
export function ReportEmptySection({
    icon,
    message,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    message: string;
}) {
    return (
        <View style={reportDetailStyles.emptySection}>
            <View style={reportDetailStyles.emptySectionIcon}>
                <Ionicons name={icon} size={20} color={adminColors.textPlaceholder} />
            </View>
            <Text style={reportDetailStyles.emptySectionText}>{message}</Text>
        </View>
    );
}

// ------------------------------------------------------------------
// Photo gallery
// ------------------------------------------------------------------

const GALLERY_GAP = 10;

// The grid sits inside a card, itself inside a padded screen: 20pt of screen
// padding and 16pt of card padding on each side.
const GALLERY_HORIZONTAL_INSET = 2 * 20 + 2 * 16;

/** Every attached photo, as square tiles that reflow with the screen width. */
export function ReportPhotoGallery({
    photos,
    onOpen,
}: {
    photos: ReportGalleryPhoto[];
    onOpen: (index: number) => void;
}) {
    const { width } = useWindowDimensions();

    const columns = galleryColumnsForWidth(width);
    const tileSize = Math.floor(
        (width - GALLERY_HORIZONTAL_INSET - GALLERY_GAP * (columns - 1)) / columns
    );

    return (
        <>
            <View style={reportDetailStyles.galleryGrid}>
                {photos.map((photo, index) => (
                    <TouchableOpacity
                        key={photo.url}
                        style={[reportDetailStyles.galleryTile, { width: tileSize }]}
                        onPress={() => onOpen(index)}
                        activeOpacity={0.8}
                        accessibilityRole="imagebutton"
                        accessibilityLabel={photo.accessibilityLabel}
                    >
                        {/* Square and cropped to fill, so a portrait photo and
                            a landscape one sit in the grid the same way. */}
                        <Image
                            source={{ uri: photo.url }}
                            style={reportDetailStyles.galleryImage}
                            resizeMode="cover"
                        />
                    </TouchableOpacity>
                ))}
            </View>

            <Text style={reportDetailStyles.galleryHint}>
                Tap a photo to view it full screen.
            </Text>
        </>
    );
}

/**
 * One photo, full screen.
 *
 * `index` doubles as the open/closed state: there is no separate visible flag
 * to fall out of step with which photo is being shown.
 */
export function ReportPhotoViewer({
    photos,
    index,
    onChangeIndex,
    onClose,
}: {
    photos: ReportGalleryPhoto[];
    index: number | null;
    onChangeIndex: (index: number) => void;
    onClose: () => void;
}) {
    const photo = index !== null ? photos[index] : undefined;

    return (
        <Modal
            visible={!!photo}
            transparent
            animationType="fade"
            onRequestClose={onClose}
            supportedOrientations={['portrait', 'landscape']}
        >
            <View style={reportDetailStyles.viewerBackdrop}>
                <View style={reportDetailStyles.viewerBar}>
                    <Text style={reportDetailStyles.viewerCounter}>
                        {photo ? `Photo ${photo.position} of ${photo.total}` : ''}
                    </Text>

                    <TouchableOpacity
                        style={reportDetailStyles.viewerCloseButton}
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel="Close photo"
                    >
                        <Ionicons name="close" size={24} color="#FFFFFF" />
                    </TouchableOpacity>
                </View>

                {!!photo && (
                    <Image
                        source={{ uri: photo.url }}
                        style={reportDetailStyles.viewerImage}
                        resizeMode="contain"
                        accessibilityLabel={`Photo evidence ${photo.position} of ${photo.total}`}
                    />
                )}

                {photos.length > 1 && index !== null && (
                    <View style={reportDetailStyles.viewerNav}>
                        <TouchableOpacity
                            style={[
                                reportDetailStyles.viewerNavButton,
                                index === 0 && reportDetailStyles.viewerNavButtonDisabled,
                            ]}
                            onPress={() => onChangeIndex(index - 1)}
                            disabled={index === 0}
                            accessibilityRole="button"
                            accessibilityLabel="Previous photo"
                            accessibilityState={{ disabled: index === 0 }}
                        >
                            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[
                                reportDetailStyles.viewerNavButton,
                                index === photos.length - 1 &&
                                    reportDetailStyles.viewerNavButtonDisabled,
                            ]}
                            onPress={() => onChangeIndex(index + 1)}
                            disabled={index === photos.length - 1}
                            accessibilityRole="button"
                            accessibilityLabel="Next photo"
                            accessibilityState={{ disabled: index === photos.length - 1 }}
                        >
                            <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </Modal>
    );
}

/**
 * The spacing, radii and type the report screens share.
 *
 * Exported whole rather than piecemeal so a screen adding a section of its own
 * reaches for `card` and `sectionTitle` here instead of restating them at a
 * slightly different radius.
 */
export const reportDetailStyles = StyleSheet.create({
    card: {
        backgroundColor: adminColors.surface,
        borderRadius: 14,
        padding: 16,
        ...adminShadow.card,
    },

    sectionTitle: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textMuted,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginTop: 24,
        marginBottom: 10,
    },

    // ---- Hero ----
    hero: {
        backgroundColor: adminColors.surface,
        borderRadius: 16,
        paddingVertical: 24,
        paddingHorizontal: 20,
        alignItems: 'center',
        ...adminShadow.card,
    },
    heroIconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    heroTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: adminColors.textPrimary,
        textAlign: 'center',
        marginTop: 14,
    },
    heroBadge: { marginTop: 12 },
    heroDate: {
        fontSize: 13,
        fontWeight: '600',
        color: adminColors.textMuted,
        marginTop: 12,
    },

    descriptionText: {
        fontSize: 15,
        color: adminColors.textSecondary,
        lineHeight: 23,
    },

    // ---- Journey ----
    divided: {
        borderTopWidth: 1,
        borderTopColor: adminColors.borderSubtle,
        marginTop: 14,
        paddingTop: 14,
    },
    journeyRow: { flexDirection: 'row', alignItems: 'center' },
    journeyIcon: {
        width: 42,
        height: 42,
        borderRadius: 12,
        backgroundColor: adminColors.primarySoft,
        justifyContent: 'center',
        alignItems: 'center',
    },
    journeyIconMuted: { backgroundColor: adminColors.surfaceMuted },
    journeyText: { flex: 1, marginLeft: 14 },
    journeyLabel: {
        fontSize: 11,
        fontWeight: '700',
        color: adminColors.textMuted,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    journeyPrimary: {
        fontSize: 16,
        fontWeight: '700',
        color: adminColors.textPrimary,
        marginTop: 4,
    },
    journeySecondary: {
        fontSize: 13,
        color: adminColors.textSecondary,
        marginTop: 3,
    },
    journeyMissing: {
        fontSize: 15,
        fontWeight: '600',
        color: adminColors.textPlaceholder,
        marginTop: 4,
    },

    // ---- Timeline ----
    timelineRow: { flexDirection: 'row', alignItems: 'center' },
    timelineLabel: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: adminColors.textSecondary,
        marginLeft: 10,
    },
    timelineValue: {
        fontSize: 13,
        fontWeight: '700',
        color: adminColors.textPrimary,
    },

    // ---- Empty section ----
    emptySection: { flexDirection: 'row', alignItems: 'center' },
    emptySectionIcon: {
        width: 42,
        height: 42,
        borderRadius: 12,
        backgroundColor: adminColors.surfaceMuted,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptySectionText: {
        flex: 1,
        fontSize: 14,
        color: adminColors.textPlaceholder,
        marginLeft: 14,
        lineHeight: 20,
    },

    // ---- Gallery ----
    galleryGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: GALLERY_GAP,
    },
    galleryTile: {
        aspectRatio: 1,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: adminColors.borderSubtle,
    },
    galleryImage: { width: '100%', height: '100%' },
    galleryHint: {
        fontSize: 12,
        color: adminColors.textMuted,
        marginTop: 12,
    },

    // ---- Full-screen viewer ----
    viewerBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.92)',
        justifyContent: 'center',
    },
    viewerBar: {
        position: 'absolute',
        top: 44,
        left: 16,
        right: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        zIndex: 1,
    },
    viewerCounter: {
        fontSize: 14,
        fontWeight: '700',
        color: '#FFFFFF',
    },
    viewerCloseButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.14)',
    },
    viewerImage: { width: '100%', height: '78%' },
    viewerNav: {
        position: 'absolute',
        bottom: 44,
        left: 16,
        right: 16,
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    viewerNavButton: {
        width: 52,
        height: 52,
        borderRadius: 26,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.14)',
    },
    viewerNavButtonDisabled: { opacity: 0.3 },
});
