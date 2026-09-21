// The Live Journey screen's refresh cycle, through its hook (MOV-298).
//
// ongoingJourneyTracking.test.ts pins the poller and the reducer on their own.
// This drives useOngoingJourneyTracking itself — the piece that wires them to
// screen focus — to check the whole cycle: one request on focus, one timer,
// nothing after the screen is left, one new cycle when it is reopened, and no
// late answer overwriting a newer one.
//
// Jest runs in node with no React renderer, so React's three hooks used here
// are stood in by the smallest shim that keeps their contract for a single
// mounted instance (refs persist, callbacks are stable), and expo-router's
// useFocusEffect hands back its callback so a test can focus and blur the
// screen. Everything below the hook is real: the API client builds the URL and
// parses the response; only `fetch` is faked, one controllable answer at a time.

import { OngoingJourneyRoute, PassengerOngoingJourney } from '../../../src/entities/booking/model/types';
// jest.mock calls below are hoisted above these imports, so the hook sees the shims.
import { useOngoingJourneyTracking } from '../../../src/features/activities/hooks/useOngoingJourneyTracking';
import { ONGOING_JOURNEY_POLL_INTERVAL_MS, TrackingState } from '../../../src/features/activities/utils/ongoingJourneyTracking';

// ---- React shim: one mounted instance ----
let mockStates: { value: any }[] = [];
let mockStateIndex = 0;

jest.mock('react', () => ({
    useState: (initial: any) => {
        const slot = { value: typeof initial === 'function' ? initial() : initial };
        mockStates[mockStateIndex++] = slot;
        return [slot.value, (next: any) => (slot.value = typeof next === 'function' ? next(slot.value) : next)];
    },
    useRef: (initial: any) => ({ current: initial }),
    useCallback: (fn: any) => fn,
}));

// ---- expo-router: focus is driven by the test ----
let mockFocusEffect: (() => void | (() => void)) | null = null;

jest.mock('expo-router', () => ({
    useFocusEffect: (effect: () => void | (() => void)) => {
        mockFocusEffect = effect;
    },
}));

jest.mock('../../../src/shared/api/config', () => ({ API_BASE_URL: 'http://api.test' }));

// The hook runs outside a component here, on the shim above; called through an
// alias so the linter's hook-placement rule does not apply to this harness.
const runTrackingHook = useOngoingJourneyTracking;

// ------------------------------------------------------------------
// fetch, one pending answer per request
// ------------------------------------------------------------------
interface PendingRequest {
    url: string;
    answer: (journeys: PassengerOngoingJourney[]) => Promise<void>;
    fail: (status: number) => Promise<void>;
}

let requests: PendingRequest[] = [];

function installFetch() {
    requests = [];
    (global as any).fetch = jest.fn(
        (url: string) =>
            new Promise((resolve) => {
                const respond = async (status: number, body: unknown) => {
                    resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
                    // Let the hook's awaits run before the test looks.
                    await flush();
                };
                requests.push({
                    url,
                    answer: (journeys) => respond(200, { success: true, journeys }),
                    fail: (status) => respond(status, { success: false, message: 'Refused.' }),
                });
            })
    );
}

async function flush() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

// ------------------------------------------------------------------
// The journey
// ------------------------------------------------------------------
const ROUTE: OngoingJourneyRoute = {
    stops: ['Kaduwela', 'Malabe', 'Koswatta', 'Rajagiriya'],
    journeyStops: ['Malabe', 'Koswatta', 'Rajagiriya'],
    stopPoints: [
        { name: 'Malabe', latitude: 6.9061, longitude: 79.9696 },
        { name: 'Koswatta', latitude: 6.9076, longitude: 79.9281 },
        { name: 'Rajagiriya', latitude: 6.9094, longitude: 79.8943 },
    ],
    segmentDurationsMinutes: null,
    road: null,
};

/** A journey as the server sends it; `withRoute` for the first, `?include=route` load. */
function journey(latitude: number, longitude: number, withRoute = false): PassengerOngoingJourney {
    return {
        ...(withRoute ? { route: ROUTE } : {}),
        booking: {
            bookingId: 'BK-A',
            userId: 'PAS-2026-00001',
            tripId: 'TRIP-001',
            routeId: 'ROUTE-177',
            busId: 'BUS-A',
            seatNumber: '05A',
            pairedSeatNumber: null,
            status: 'CONFIRMED',
            journey: {
                routeNumber: '177',
                routeName: 'Kaduwela - Kollupitiya',
                startLocation: 'Malabe',
                endLocation: 'Rajagiriya',
                departureTime: '06:00',
                estimatedArrivalTime: '07:15',
            },
            vehicle: { numberPlate: 'NB-8899', busModel: 'Viking', manufacturer: 'Ashok Leyland' },
            fare: { totalFare: 56, currency: 'LKR', isEstimate: false },
        },
        activeJourney: { tripId: 'TRIP-001', startedAt: '2026-09-22T03:30:00.000Z', expiresAt: '2026-09-23T02:30:00.000Z' },
        busId: 'BUS-A',
        liveStatus: {
            available: true,
            location: { busId: 'BUS-A', latitude, longitude, recordedAt: '2026-09-22T03:40:00.000Z' },
            locationAgeSeconds: 5,
        },
    };
}

// ------------------------------------------------------------------
// Mounting and focus
// ------------------------------------------------------------------
function mount() {
    mockStates = [];
    mockStateIndex = 0;
    mockFocusEffect = null;
    const tracking = runTrackingHook('BK-A', 'passenger-token');
    let cleanup: (() => void) | null = null;

    return {
        tracking,
        state: () => mockStates[0].value as TrackingState,
        focus: async () => {
            cleanup = (mockFocusEffect!() as (() => void) | undefined) ?? null;
            await flush();
        },
        // Leaving the screen and unmounting it run the same cleanup.
        blur: () => {
            cleanup?.();
            cleanup = null;
        },
    };
}

async function tick(ms = ONGOING_JOURNEY_POLL_INTERVAL_MS) {
    await jest.advanceTimersByTimeAsync(ms);
    await flush();
}

const busAt = (state: TrackingState) => state.journey?.liveStatus?.location;

beforeEach(() => {
    jest.useFakeTimers();
    installFetch();
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
});

// ------------------------------------------------------------------
describe('opening the screen', () => {
    it('asks once for the journey with its planned path, then refreshes without it', async () => {
        const screen = mount();
        await screen.focus();

        expect(requests.map((request) => request.url)).toEqual(['http://api.test/api/journeys/ongoing?include=route']);
        await requests[0].answer([journey(6.9061, 79.9696, true)]);
        expect(screen.state().phase).toBe('ACTIVE');

        await tick();
        expect(requests.map((request) => request.url)).toEqual([
            'http://api.test/api/journeys/ongoing?include=route',
            'http://api.test/api/journeys/ongoing',
        ]);
    });

    it('runs exactly one timer, at the intended interval', async () => {
        const screen = mount();
        await screen.focus();
        await requests[0].answer([journey(6.9061, 79.9696, true)]);

        expect(ONGOING_JOURNEY_POLL_INTERVAL_MS).toBe(15_000);
        expect(jest.getTimerCount()).toBe(1);

        await tick(ONGOING_JOURNEY_POLL_INTERVAL_MS - 1);
        expect(requests).toHaveLength(1);
        await tick(1);
        expect(requests).toHaveLength(2);
    });

    it('starts no timer when nothing is running for this booking', async () => {
        const screen = mount();
        await screen.focus();
        await requests[0].answer([]);

        expect(screen.state().phase).toBe('NOT_FOUND');
        expect(jest.getTimerCount()).toBe(0);
    });
});

// ------------------------------------------------------------------
describe('leaving and coming back', () => {
    it('stops refreshing when the screen is left or unmounted', async () => {
        const screen = mount();
        await screen.focus();
        await requests[0].answer([journey(6.9061, 79.9696, true)]);

        screen.blur();

        expect(jest.getTimerCount()).toBe(0);
        await tick(ONGOING_JOURNEY_POLL_INTERVAL_MS * 4);
        expect(requests).toHaveLength(1);
    });

    it('drops an answer that arrives after the screen was left, and starts nothing', async () => {
        const screen = mount();
        await screen.focus();
        screen.blur();

        await requests[0].answer([journey(6.9061, 79.9696, true)]);

        expect(screen.state().phase).toBe('LOADING');
        expect(jest.getTimerCount()).toBe(0);
    });

    it('reopening creates exactly one new refresh cycle, however often it was left', async () => {
        const screen = mount();

        for (let visit = 0; visit < 3; visit++) {
            await screen.focus();
            await requests[requests.length - 1].answer([journey(6.9061, 79.9696, visit === 0)]);
            screen.blur();
        }
        expect(jest.getTimerCount()).toBe(0);

        await screen.focus();
        const opened = requests.length;
        await requests[opened - 1].answer([journey(6.9061, 79.9696)]);

        expect(jest.getTimerCount()).toBe(1);
        await tick();
        expect(requests).toHaveLength(opened + 1);
        // The path arrived on the first visit, so it is not asked for again.
        expect(requests[opened - 1].url).toBe('http://api.test/api/journeys/ongoing');
    });
});

// ------------------------------------------------------------------
describe('answers arriving out of order', () => {
    it('never lets a slow earlier answer overwrite a newer one', async () => {
        const screen = mount();
        await screen.focus();
        await requests[0].answer([journey(6.9061, 79.9696, true)]);

        await tick(); // the poll goes out and hangs
        const slowPoll = requests[1];
        screen.tracking.refresh(); // the passenger taps Refresh
        await flush();
        const refresh = requests[2];

        await refresh.answer([journey(6.9076, 79.9281)]);
        await slowPoll.answer([journey(6.9061, 79.9696)]);

        expect(busAt(screen.state())).toMatchObject({ latitude: 6.9076, longitude: 79.9281 });
    });

    it('skips a tick while the previous refresh is still out', async () => {
        const screen = mount();
        await screen.focus();
        await requests[0].answer([journey(6.9061, 79.9696, true)]);

        await tick();
        await tick();
        await tick();

        expect(requests).toHaveLength(2);
    });
});

// ------------------------------------------------------------------
describe('stopping for good', () => {
    it('stops when the session is refused, and asks nothing on the next visit', async () => {
        const screen = mount();
        await screen.focus();
        await requests[0].answer([journey(6.9061, 79.9696, true)]);

        await tick();
        await requests[1].fail(401);

        expect(screen.state().phase).toBe('UNAUTHORIZED');
        expect(screen.state().journey).toBeNull();
        expect(jest.getTimerCount()).toBe(0);

        screen.blur();
        await screen.focus();
        expect(requests).toHaveLength(2);
    });

    it('stops when the bus ends the journey, keeping its details but not the bus', async () => {
        const screen = mount();
        await screen.focus();
        await requests[0].answer([journey(6.9061, 79.9696, true)]);

        await tick();
        await requests[1].answer([]);

        expect(screen.state().phase).toBe('ENDED');
        expect(screen.state().journey?.booking.bookingId).toBe('BK-A');
        expect(screen.state().journey?.liveStatus.available).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it("stops when the passenger ends their journey, and ignores a refresh already in flight", async () => {
        const screen = mount();
        await screen.focus();
        await requests[0].answer([journey(6.9061, 79.9696, true)]);
        await tick();

        screen.tracking.stopTracking();
        await requests[1].answer([journey(6.9076, 79.9281)]);

        expect(screen.state().phase).toBe('ENDED');
        expect(screen.state().journey?.liveStatus.available).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('keeps refreshing through a failed refresh, with the bus hidden until it recovers', async () => {
        const screen = mount();
        await screen.focus();
        await requests[0].answer([journey(6.9061, 79.9696, true)]);

        await tick();
        await requests[1].fail(503);
        expect(screen.state()).toMatchObject({ phase: 'ACTIVE', connectionLost: true });
        expect(jest.getTimerCount()).toBe(1);

        await tick();
        await requests[2].answer([journey(6.9076, 79.9281)]);
        expect(screen.state()).toMatchObject({ phase: 'ACTIVE', connectionLost: false });
    });
});
