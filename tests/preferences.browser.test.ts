import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    chromium,
    type Browser,
    type BrowserContext,
    type Page,
} from 'playwright';
import { preview, type PreviewServer } from 'vite';
import { buildExtension } from './browser-build';

type StoredPreferences = { motion?: unknown };

declare global {
    interface Window {
        readPreference(): Promise<StoredPreferences>;
        writePreference(values: StoredPreferences): Promise<void>;
        preferenceTest: {
            read(): Promise<StoredPreferences>;
            write(values: StoredPreferences): Promise<void>;
            change(value: StoredPreferences['motion'], area?: string): void;
            reads: number;
        };
    }
}

let browser: Browser;
let server: PreviewServer;
let baseUrl: string;

test.before(async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    await buildExtension(root);
    server = await preview({
        configFile: false,
        root,
        build: { outDir: '.output/chrome-mv3' },
        preview: { port: 0, host: '127.0.0.1' },
    });
    baseUrl = server.resolvedUrls!.local[0];
    browser = await chromium.launch({ headless: true });
});

test.after(async () => {
    await browser.close();
    await new Promise<void>((resolve, reject) =>
        server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
});

async function fixture(
    options: { value?: unknown; holdRead?: boolean; failRead?: boolean } = {},
) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    context.setDefaultTimeout(5_000);

    let value = options.value;
    let failWrite = false;
    let releaseRead: (() => void) | undefined;
    const gate = options.holdRead
        ? new Promise<void>((resolve) => {
              releaseRead = resolve;
          })
        : Promise.resolve();
    await context.exposeBinding('readPreference', async () => {
        const snapshot = { motion: value };
        await gate;
        if (options.failRead) throw new Error('Storage unavailable');
        return snapshot;
    });
    await context.exposeBinding(
        'writePreference',
        async (_source, values: StoredPreferences) => {
            if (failWrite) throw new Error('Storage unavailable');
            value = values.motion;
            await publish(context, value);
        },
    );
    await context.addInitScript(() => {
        type StorageListener = (
            changes: Record<string, { newValue: unknown }>,
            area: string,
        ) => void;
        const listeners = new Set<StorageListener>();

        type FixtureRuntime = {
            id: string;
            lastError: { message: string } | undefined;
            connect(): {
                onMessage: { addListener(): void; removeListener(): void };
                onDisconnect: { addListener(): void; removeListener(): void };
                postMessage(): void;
                disconnect(): void;
            };
        };
        const runtime: FixtureRuntime = {
            id: 'test',
            lastError: undefined,
            connect() {
                return {
                    onMessage: { addListener() {}, removeListener() {} },
                    onDisconnect: { addListener() {}, removeListener() {} },
                    postMessage() {},
                    disconnect() {},
                };
            },
        };
        window.preferenceTest = {
            reads: 0,
            read: () => window.readPreference(),
            write: (values) => window.writePreference(values),
            change(value, area = 'local') {
                listeners.forEach((listener) =>
                    listener({ motion: { newValue: value } }, area),
                );
            },
        };

        function failed(callback: (value?: StoredPreferences) => void) {
            runtime.lastError = { message: 'Storage unavailable' };
            callback();
            runtime.lastError = undefined;
        }
        Object.assign(globalThis, {
            chrome: {
                runtime,
                storage: {
                    local: {
                        get(
                            _key: string,
                            callback: (value?: StoredPreferences) => void,
                        ) {
                            window.preferenceTest.reads++;
                            void window
                                .readPreference()
                                .then(callback, () => failed(callback));
                        },
                        set(values: StoredPreferences, callback: () => void) {
                            void window
                                .writePreference(values)
                                .then(callback, () => failed(callback));
                        },
                    },
                    onChanged: {
                        addListener: (listener: StorageListener) =>
                            listeners.add(listener),
                        removeListener: (listener: StorageListener) =>
                            listeners.delete(listener),
                    },
                },
            },
        });
    });
    async function open(hash = '#/settings') {
        const page = await context.newPage();
        await page.goto(`${baseUrl}ui.html${hash}`);
        return page;
    }
    return {
        context,
        open,
        releaseRead: () => releaseRead?.(),
        failWrites: () => {
            failWrite = true;
        },
    };
}

async function publish(
    context: BrowserContext,
    value: StoredPreferences['motion'],
    area = 'local',
) {
    await Promise.all(
        context
            .pages()
            .map((page) =>
                page.evaluate(
                    ({ value, area }) =>
                        window.preferenceTest?.change(value, area),
                    { value, area },
                ),
            ),
    );
}

async function active(page: Page, mode: 'Reduced' | 'Full') {
    await page
        .getByRole('status')
        .filter({ hasText: `${mode} motion is active.` })
        .waitFor();
}

test('System follows initial and live OS changes; explicit modes persist and synchronize windows', async () => {
    const { context, open } = await fixture();
    try {
        const first = await open();
        const second = await open();
        assert.equal(
            await first
                .getByRole('radio', { name: 'System', exact: true })
                .isChecked(),
            true,
        );
        await active(first, 'Reduced');
        await first.emulateMedia({ reducedMotion: 'no-preference' });
        await active(first, 'Full');
        await first.emulateMedia({ reducedMotion: 'reduce' });
        await active(first, 'Reduced');

        await first.getByRole('radio', { name: 'Full', exact: true }).check();
        await active(first, 'Full');
        await active(second, 'Full');
        assert.equal(
            await second
                .getByRole('radio', { name: 'Full', exact: true })
                .isChecked(),
            true,
        );
        await second.reload();
        await active(second, 'Full');
        await second.emulateMedia({ reducedMotion: 'no-preference' });
        await second
            .getByRole('radio', { name: 'Reduced', exact: true })
            .check();
        await active(first, 'Reduced');
        await active(second, 'Reduced');

        // Native radios remain keyboard operable and keep focus after saving.
        const reduced = second.getByRole('radio', {
            name: 'Reduced',
            exact: true,
        });
        await reduced.focus();
        await reduced.press('ArrowLeft');
        await active(second, 'Full');
        await second.waitForFunction(
            () => document.activeElement?.getAttribute('value') === 'system',
        );
        await active(first, 'Reduced');
        await publish(context, 'full', 'sync');
        assert.equal(
            await first
                .getByRole('radio', { name: 'System', exact: true })
                .isChecked(),
            true,
        );
    } finally {
        await context.close();
    }
});

for (const value of ['unexpected', null, { mode: 'full' }]) {
    test(`invalid stored preference defaults to System: ${JSON.stringify(value)}`, async () => {
        const { context, open } = await fixture({ value });
        try {
            const page = await open();
            await active(page, 'Reduced');
            assert.equal(
                await page
                    .getByRole('radio', { name: 'System', exact: true })
                    .isChecked(),
                true,
            );
            await publish(context, 'full');
            await active(page, 'Full');
            await publish(context, undefined);
            await active(page, 'Reduced');
            assert.equal(
                await page
                    .getByRole('radio', { name: 'System', exact: true })
                    .isChecked(),
                true,
            );
        } finally {
            await context.close();
        }
    });
}

test('preference resolution gates surfaces and newer storage events beat the initial read', async () => {
    const { context, open, releaseRead } = await fixture({
        value: 'full',
        holdRead: true,
    });
    try {
        const page = await open();
        await page.waitForFunction(() => window.preferenceTest.reads === 1);
        assert.equal(await page.getByRole('heading').count(), 0);
        assert.equal(await page.getByRole('radio').count(), 0);
        await publish(context, 'reduced');
        releaseRead();
        await active(page, 'Reduced');
        assert.equal(
            await page
                .getByRole('radio', { name: 'Reduced', exact: true })
                .isChecked(),
            true,
        );
    } finally {
        releaseRead();
        await context.close();
    }
});

test('storage failures are honest and preserve the last preference', async () => {
    const { context, open, failWrites } = await fixture({ failRead: true });
    try {
        const page = await open();
        await active(page, 'Reduced');
        await page
            .getByRole('alert')
            .filter({ hasText: 'Could not load' })
            .waitFor();
        failWrites();
        await page.getByRole('radio', { name: 'Full', exact: true }).click();
        await page
            .getByRole('alert')
            .filter({ hasText: 'Could not save' })
            .waitFor();
        await active(page, 'Reduced');
        assert.equal(
            await page
                .getByRole('radio', { name: 'System', exact: true })
                .isChecked(),
            true,
        );
    } finally {
        await context.close();
    }
});

test('direct Settings route has an immediate accessible Messages return in Reduced mode', async () => {
    const { context, open } = await fixture({ value: 'reduced' });
    try {
        const page = await open();
        await page.waitForFunction(
            () => document.activeElement?.textContent === 'Settings',
        );
        await page.getByRole('link', { name: 'Back to Messages' }).click();
        await page
            .getByRole('heading', { name: 'Messages', exact: true })
            .waitFor();
        assert.equal(
            await page.getByRole('group', { name: 'Motion' }).count(),
            0,
        );
        await page.waitForFunction(
            () => document.activeElement?.getAttribute('href') === '#/settings',
        );
        await page
            .getByRole('link', { name: 'Settings', exact: true })
            .press('Enter');
        await page.getByRole('group', { name: 'Motion' }).waitFor();
        assert.equal(
            await page.getByRole('region', { name: 'Primary inbox' }).count(),
            0,
        );
        await page.goBack();
        await page
            .getByRole('heading', { name: 'Messages', exact: true })
            .waitFor();
        assert.equal(await page.getByRole('radio').count(), 0);
    } finally {
        await context.close();
    }
});
