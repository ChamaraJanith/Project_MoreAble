import { Stack } from 'expo-router';
import React from 'react';

/**
 * The journey-planning stack.
 *
 * Journey planning is a sequence — plan a search, read the results, open one
 * route, read what other passengers said about its bus — and Back has to walk
 * back up it. Before this layout existed the four screens were four siblings of
 * the bottom-tab navigator, declared with `href: null` so they stayed off the
 * tab bar. That hid them, but it did not make them a stack: a tab router keeps
 * no push history, and its default `backBehavior` of 'firstRoute' answers every
 * Back with the FIRST tab, which is Home. So Route Details went to Home instead
 * of the results the passenger came from.
 *
 * Declaring a Stack here is the whole fix. `router.push('/journey/results')` now
 * pushes a frame the passenger can pop, and Back — the header arrow, the Android
 * hardware button and the iOS edge gesture alike, since all three dispatch the
 * same GO_BACK — pops one screen at a time:
 *
 *     /journey  ->  /journey/results  ->  /journey/route-details
 *                                     ->  /journey/community-feedback
 *
 * Back from `/journey` itself finds an empty stack, so GO_BACK travels up to the
 * tab navigator and lands on Home exactly as it always did. That is the intended
 * exit from journey planning, not a bug, so it is left alone.
 *
 * The URLs are unchanged: `index` is still `/journey`, and the rest still sit
 * beneath it. Only the navigator they belong to is different.
 */
export default function JourneyLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="results" />
            <Stack.Screen name="route-details" />
            <Stack.Screen name="community-feedback" />
        </Stack>
    );
}
