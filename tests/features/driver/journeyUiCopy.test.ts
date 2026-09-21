// The words the driver and passenger see for a running journey (MOV-294).
//
// The project has no React renderer, so these screens are not rendered. What
// they say comes from the locale files and from literals in two components;
// this pins those directly, so the wording cannot quietly drift back.
//
// Letters refer to the lifecycle test plan (A–U).

import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..', '..');
const source = (path: string) => readFileSync(join(root, path), 'utf-8');
const locale = (lang: string) => JSON.parse(source(`src/shared/i18n/locales/${lang}.json`));

describe('Activities card', () => {
    it('O. labels a running journey "Ongoing", not "In Progress"', () => {
        expect(locale('en').activities.ongoingStatus).toBe('Ongoing');
        expect(JSON.stringify(locale('en').activities)).not.toContain('In Progress');
        expect(locale('si').activities.ongoingStatus).toBe(locale('si').activities.ongoingTab);

        const card = source('src/features/activities/ui/ActivityJourneyCard.tsx');
        expect(card).toContain("t('activities.ongoingStatus', 'Ongoing')");
        expect(card).not.toContain('In Progress');
    });
});

describe('Trip Control, active journey', () => {
    const tab = source('src/features/driver/ui/TripControlTab.tsx');

    it('P. no longer explains when the journey stops being shown', () => {
        expect(tab).not.toContain('Shown to booked passengers');
    });

    it('Q. has no "sharing is off" state for a running journey', () => {
        expect(tab).not.toContain('Location sharing is off on this device');
    });

    it('R. has no "Resume location sharing" action', () => {
        expect(tab).not.toMatch(/Resume location sharing/i);
    });

    it('still shows the actual start time, and the live card whose control is End Journey', () => {
        expect(tab).toContain('Journey started at');
        expect(tab).toContain('<LocationStatusCard');
    });
});
