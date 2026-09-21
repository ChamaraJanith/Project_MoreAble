// Navigation around the passenger journey, and the planning map (MOV-298).
//
// Jest here runs in node without a renderer, so — like the other Activities
// suites — screens are checked through their route helpers and their source:
// which button goes where, and what the planning map is given. The route
// helpers themselves are called, so a wrong destination fails on the value,
// not just on the text.

import * as fs from 'fs';
import * as path from 'path';
import {
    completedJourneyDetailsHref,
    completedJourneyHref,
    ongoingActivitiesHref,
    ongoingJourneyHref,
} from '../../../src/features/activities/utils/activityRoutes';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** The JSX element that contains `marker`, from its opening `<Tag` to its closing tag. */
function elementAround(source: string, marker: string, tag = 'TouchableOpacity'): string {
    const at = source.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    const start = source.lastIndexOf(`<${tag}`, at);
    const end = source.indexOf(`</${tag}>`, at);
    return source.slice(start, end);
}

const liveScreen = read('src/features/activities/ui/OngoingJourneyScreen.tsx');
const completedScreen = read('src/features/activities/ui/CompletedJourneyScreen.tsx');
const activities = read('app/(tabs)/activities/index.tsx');

// ------------------------------------------------------------------
describe('Live Journey → Back to Ongoing', () => {
    it('goes to the existing Activities route, asking for its Ongoing tab', () => {
        expect(ongoingActivitiesHref()).toEqual({ pathname: '/activities', params: { tab: 'ongoing' } });
        expect(fs.existsSync(path.join(ROOT, 'app/(tabs)/activities/index.tsx'))).toBe(true);
    });

    it('is wired to that destination, and completes nothing', () => {
        const button = elementAround(liveScreen, "'Back to Ongoing'");

        expect(button).toContain('onPress={() => router.navigate(ongoingActivitiesHref())}');
        expect(button).not.toMatch(/handleEndJourney|endPassengerJourney|stopTracking/);
    });

    it('opens Activities on the Ongoing tab, then forgets the request', () => {
        expect(activities).toContain("useLocalSearchParams<{ tab?: string }>()");
        expect(activities).toMatch(/tab === 'ongoing' && activeTab !== 'ONGOING'\) setActiveTab\('ONGOING'\)/);
        expect(activities).toMatch(/router\.setParams\(\{ tab: undefined \}\)/);
        // Ongoing is also where Activities starts.
        expect(activities).toContain("useState<ActivityTab>('ONGOING')");
    });
});

// ------------------------------------------------------------------
describe('Live Journey action row', () => {
    it('puts Back to Ongoing and End Journey side by side, equal in size', () => {
        expect(liveScreen).toMatch(/<View style=\{styles\.actionRow\}>[\s\S]*'Back to Ongoing'[\s\S]*'End Journey'/);

        expect(liveScreen).toMatch(/actionRow: \{\s*flexDirection: 'row',/);
        // One shared style for both: same flex share, so same width and height.
        expect(liveScreen).toMatch(/actionButton: \{\s*flex: 1,[\s\S]*?minHeight: 52,/);
        expect(liveScreen).toMatch(/style=\{\[styles\.actionButton, styles\.actionButtonBack\]\}/);
        expect(liveScreen).toMatch(/style=\{\[styles\.actionButton, styles\.actionButtonEnd\]\}/);
    });

    it('colours Back blue and End Journey red, both with white text', () => {
        expect(liveScreen).toMatch(/actionButtonBack: \{\s*backgroundColor: '#0066CC',/);
        expect(liveScreen).toMatch(/actionButtonEnd: \{\s*backgroundColor: '#DC2626',/);
        expect(liveScreen).toMatch(/actionButtonText: \{[\s\S]*?color: '#FFFFFF',/);
    });

    it('End Journey asks first; it does not complete on the tap', () => {
        const button = elementAround(liveScreen, "t('ongoingJourney.endJourneyLabel'");

        expect(button).toContain('onPress={handleEndJourney}');
        expect(liveScreen).toContain('createEndJourneyAction<EndJourneyResult');
        expect(liveScreen).toMatch(/createEndJourneyAction<[\s\S]*?>\(\s*confirmEndJourney,/);
    });
});

// ------------------------------------------------------------------
describe('Completed Journey → Back to Activities', () => {
    it('goes to the Activities tab, never back through tab history', () => {
        const button = elementAround(completedScreen, "t('completedJourney.backToActivities', 'Back to Activities')");

        expect(button).toContain("onPress={() => router.navigate('/activities')}");
        expect(button).not.toContain('router.back');
    });
});

// ------------------------------------------------------------------
describe('where each journey opens', () => {
    it('Activities → Ongoing → View Journey opens the Live Journey screen', () => {
        expect(ongoingJourneyHref('BK-A').pathname).toBe('/activities/journey/[bookingId]');
        expect(read('app/(tabs)/activities/journey/[bookingId].tsx')).toContain('OngoingJourneyScreen');
    });

    it('Activities → Completed → View Details opens the Completed Journey screen', () => {
        expect(completedJourneyDetailsHref('BK-A').pathname).toBe('/activities/completed/[bookingId]');
        expect(read('app/(tabs)/activities/completed/[bookingId].tsx')).toContain('CompletedJourneyScreen');
    });

    it('Booking → View Ticket still opens the ticket, never the Live Journey', () => {
        expect(completedJourneyHref('BK-A').pathname).toBe('/booking/ticket/[bookingId]');
        const ticket = read('app/(tabs)/booking/ticket/[bookingId].tsx');
        expect(ticket).not.toMatch(/OngoingJourneyScreen|useOngoingJourneyTracking|getOngoingJourneys/);
    });

    it('keeps the journey screens out of the tab bar', () => {
        const tabs = read('app/(tabs)/_layout.tsx');
        for (const screen of ['activities/journey/[bookingId]', 'activities/completed/[bookingId]']) {
            const entry = tabs.slice(tabs.indexOf(`name="${screen}"`), tabs.indexOf('/>', tabs.indexOf(`name="${screen}"`)));
            expect(entry).toContain('href: null');
        }
    });
});

// ------------------------------------------------------------------
describe('planning map (MOV-293 regression)', () => {
    const planning = read('src/features/journey/ui/RouteDetailsScreen.tsx');

    it('draws the planned route and stops, with no live bus', () => {
        const map = planning.slice(planning.indexOf('<RouteMapCard'), planning.indexOf('/>', planning.indexOf('<RouteMapCard')));

        expect(map).toMatch(/geo=\{geo\}/);
        expect(map).toMatch(/stops=\{mapStops\.stops\}/);
        expect(map).toMatch(/road=\{route\.road\}/);
        expect(map).not.toMatch(/vehicle/);
    });

    it('shows no live tracking card or live position anywhere on the screen', () => {
        expect(planning).not.toMatch(/LiveStatusCard|liveStatus|resolveVehiclePosition|liveVehicleFor|useOngoingJourneyTracking/);
    });
});
