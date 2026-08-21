// Report photo evidence uploads to Cloudinary (MOV-126).
//
// The rule this service exists to hold: what ends up on a report is the
// `secure_url` Cloudinary returned, and nothing else. A device uri, a response
// without a URL, or a failed request all have to leave the photo unuploaded and
// say why — because the form blocks Submit until every photo has a real URL,
// and a plausible-looking value here would put a broken photo on the report
// instead.
//
// The other rule is what is NOT sent: an unsigned preset means the request
// carries the cloud name and the preset name only. An API key or secret in a
// mobile bundle is a published secret.

const CLOUD_NAME = 'moreable-test';
const UPLOAD_PRESET = 'moreable_report_photos';

/**
 * Loads the service with a given configuration.
 *
 * The cloud name and preset are read once when the module is evaluated — Metro
 * inlines them at bundle time — so each configuration needs a fresh module.
 */
function loadUploader(
    config: { cloud?: string; preset?: string } = { cloud: CLOUD_NAME, preset: UPLOAD_PRESET }
) {
    jest.resetModules();
    process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME = config.cloud ?? '';
    process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET = config.preset ?? '';

    // require, not import: the module has to be re-evaluated after the env
    // vars change, and a static import is hoisted above them.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../../../src/features/reports/api/reportPhotoUpload') as typeof import('../../../src/features/reports/api/reportPhotoUpload');
}

/** A 1x1 PNG, small enough to keep the fixtures readable. */
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const SECURE_URL = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/v1755739200/reports/ramp.jpg`;

/** A photo in the shape the picker hands over. */
function photo(overrides: Record<string, any> = {}) {
    return {
        uri: 'file:///data/user/0/cache/ramp.jpg',
        base64: PNG_BASE64,
        mimeType: 'image/png',
        fileName: 'ramp.png',
        ...overrides,
    };
}

/** Stands in for Cloudinary; returns whatever the test needs it to. */
function mockCloudinary(response: { ok?: boolean; status?: number; body?: any }): jest.Mock {
    const fetchMock: jest.Mock = jest.fn(async () => ({
        ok: response.ok ?? true,
        status: response.status ?? 200,
        json: async () => response.body,
    }));

    (global as any).fetch = fetchMock;

    return fetchMock;
}

/** The multipart fields of the request that was made. */
function sentFields(fetchMock: jest.Mock): Record<string, any> {
    // Typed loosely: the Jest tsconfig has no DOM lib, so FormData here is
    // whatever the Node runtime provides rather than the browser interface.
    const form = fetchMock.mock.calls[0][1].body as any;
    const fields: Record<string, any> = {};

    form.forEach((value: any, key: string) => {
        fields[key] = value;
    });

    return fields;
}

const realFetch = global.fetch;

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    (global as any).fetch = realFetch;
    jest.restoreAllMocks();
});

// ==================================================================
// A successful upload
// ==================================================================
describe('uploadReportPhoto - success', () => {
    it('returns the secure_url Cloudinary responded with', async () => {
        mockCloudinary({ body: { secure_url: SECURE_URL, public_id: 'reports/ramp' } });

        const result = await loadUploader().uploadReportPhoto(photo());

        expect(result).toEqual({ ok: true, url: SECURE_URL });
    });

    it('posts to the configured cloud, unsigned', async () => {
        const fetchMock = mockCloudinary({ body: { secure_url: SECURE_URL } });

        await loadUploader().uploadReportPhoto(photo());

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

        expect(url).toBe(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`);
        expect(init.method).toBe('POST');
        expect(sentFields(fetchMock).upload_preset).toBe(UPLOAD_PRESET);
    });

    it('never sends an API key or secret', async () => {
        // The whole reason the preset is unsigned. A signature would need the
        // secret, and a secret in a mobile bundle is a published secret.
        const fetchMock = mockCloudinary({ body: { secure_url: SECURE_URL } });

        await loadUploader().uploadReportPhoto(photo());

        const fields = sentFields(fetchMock);

        expect(Object.keys(fields).sort()).toEqual(['file', 'upload_preset']);
        expect(JSON.stringify(fields)).not.toMatch(/api_key|api_secret|signature/i);
    });

    it('sends the image data, not the device uri', async () => {
        const fetchMock = mockCloudinary({ body: { secure_url: SECURE_URL } });

        await loadUploader().uploadReportPhoto(photo());

        const file = sentFields(fetchMock).file as string;

        expect(file.startsWith('data:image/png;base64,')).toBe(true);
        expect(file).toContain(PNG_BASE64);
        expect(file).not.toMatch(/file:\/\//);
    });

    it('falls back to image/jpeg when the picker gave no mime type', async () => {
        const fetchMock = mockCloudinary({ body: { secure_url: SECURE_URL } });

        await loadUploader().uploadReportPhoto(photo({ mimeType: null }));

        expect((sentFields(fetchMock).file as string).startsWith('data:image/jpeg;base64,')).toBe(
            true
        );
    });
});

// ==================================================================
// Configuration
// ==================================================================
describe('uploadReportPhoto - configuration', () => {
    it('reports the account as configured when both values are present', () => {
        expect(loadUploader().isCloudinaryConfigured()).toBe(true);
    });

    it('refuses to upload without a cloud name, and never calls out', async () => {
        const fetchMock = mockCloudinary({ body: { secure_url: SECURE_URL } });
        const uploader = loadUploader({ cloud: '', preset: UPLOAD_PRESET });

        const result = await uploader.uploadReportPhoto(photo());

        expect(uploader.isCloudinaryConfigured()).toBe(false);
        expect(result).toEqual({
            ok: false,
            message: uploader.CLOUDINARY_NOT_CONFIGURED_MESSAGE,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses to upload without an upload preset', async () => {
        const uploader = loadUploader({ cloud: CLOUD_NAME, preset: '' });

        expect(uploader.isCloudinaryConfigured()).toBe(false);
        expect((await uploader.uploadReportPhoto(photo())).ok).toBe(false);
    });
});

// ==================================================================
// Failures
//
// Every one of these has to come back as a result rather than a throw: the
// picker renders it on that one thumbnail and offers a retry, and a rejected
// promise would take the whole form down instead.
// ==================================================================
describe('uploadReportPhoto - failures', () => {
    it('fails a photo the picker returned no data for', async () => {
        const fetchMock = mockCloudinary({ body: { secure_url: SECURE_URL } });

        const result = await loadUploader().uploadReportPhoto(photo({ base64: null }));

        expect(result.ok).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces the reason Cloudinary rejected the upload', async () => {
        mockCloudinary({
            ok: false,
            status: 400,
            body: { error: { message: 'Upload preset not found' } },
        });

        const result = await loadUploader().uploadReportPhoto(photo());

        expect(result).toEqual({ ok: false, message: 'Upload preset not found' });
    });

    it('still fails cleanly when the error body is unreadable', async () => {
        (global as any).fetch = jest.fn(async () => ({
            ok: false,
            status: 500,
            json: async () => {
                throw new Error('not json');
            },
        }));

        const result = await loadUploader().uploadReportPhoto(photo());

        expect(result.ok).toBe(false);
        expect((result as { message: string }).message).toMatch(/try again/i);
    });

    it('treats a 200 without a secure_url as a failure', async () => {
        // Nothing usable came back, and storing anything else would put a
        // permanently broken photo on the report.
        mockCloudinary({ body: { public_id: 'reports/ramp' } });

        const result = await loadUploader().uploadReportPhoto(photo());

        expect(result.ok).toBe(false);
    });

    it('rejects a non-https secure_url', async () => {
        mockCloudinary({ body: { secure_url: 'http://res.cloudinary.com/x/a.jpg' } });

        expect((await loadUploader().uploadReportPhoto(photo())).ok).toBe(false);
    });

    it('fails without throwing when the network is down', async () => {
        (global as any).fetch = jest.fn(async () => {
            throw new Error('Network request failed');
        });

        const result = await loadUploader().uploadReportPhoto(photo());

        expect(result.ok).toBe(false);
        expect((result as { message: string }).message).toMatch(/connection/i);
    });

    it('reports a timeout as a timeout', async () => {
        (global as any).fetch = jest.fn(async () => {
            const aborted = new Error('Aborted');
            aborted.name = 'AbortError';
            throw aborted;
        });

        const result = await loadUploader().uploadReportPhoto(photo());

        expect((result as { message: string }).message).toMatch(/timed out/i);
    });

    it('refuses a photo over the 10MB Cloudinary limit before sending it', async () => {
        const fetchMock = mockCloudinary({ body: { secure_url: SECURE_URL } });

        // 11MB of base64 payload.
        const oversized = 'A'.repeat(Math.ceil((11 * 1024 * 1024 * 4) / 3));

        const result = await loadUploader().uploadReportPhoto(photo({ base64: oversized }));

        expect(result.ok).toBe(false);
        expect((result as { message: string }).message).toMatch(/larger than 10MB/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
