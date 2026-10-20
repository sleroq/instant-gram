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

async function active(page: Page, enabled: boolean) {
    await page
        .getByRole('switch', { name: 'Animations', checked: enabled })
        .waitFor();
}

test('device default follows live OS changes; On/Off persists and synchronizes windows', async () => {
    const { context, open } = await fixture();
    try {
        const first = await open();
        const second = await open();
        await active(first, false);
        await first.emulateMedia({ reducedMotion: 'no-preference' });
        await active(first, true);
        await first.emulateMedia({ reducedMotion: 'reduce' });
        await active(first, false);

        const toggle = first.getByRole('switch', { name: 'Animations' });
        await toggle.click();
        await active(first, true);
        await active(second, true);
        await second.reload();
        await active(second, true);
        await second.emulateMedia({ reducedMotion: 'no-preference' });
        const secondToggle = second.getByRole('switch', { name: 'Animations' });
        await secondToggle.click();
        await active(first, false);
        await active(second, false);

        await secondToggle.focus();
        await secondToggle.press('Space');
        await active(first, true);
        await active(second, true);
        assert.equal(
            await secondToggle.evaluate(
                (element) => element === document.activeElement,
            ),
            true,
        );
        await publish(context, false, 'sync');
        await active(first, true);
        await publish(context, undefined);
        await active(first, false);
        await active(second, true);
    } finally {
        await context.close();
    }
});

for (const value of ['unexpected', null, { mode: 'full' }]) {
    test(`invalid stored preference uses device default: ${JSON.stringify(value)}`, async () => {
        const { context, open } = await fixture({ value });
        try {
            const page = await open();
            await active(page, false);
            await publish(context, true);
            await active(page, true);
            await publish(context, undefined);
            await active(page, false);
        } finally {
            await context.close();
        }
    });
}

for (const [value, enabled] of [
    ['full', true],
    ['reduced', false],
    [true, true],
    [false, false],
] as const) {
    test(`saved animation choice is recognized: ${value}`, async () => {
        const { context, open } = await fixture({ value });
        try {
            const page = await open();
            await active(page, enabled);
            await page.getByRole('switch', { name: 'Animations' }).click();
            await active(page, !enabled);
            assert.deepEqual(
                await page.evaluate(() => window.readPreference()),
                { motion: !enabled },
            );
        } finally {
            await context.close();
        }
    });
}

test('preference resolution gates surfaces and newer storage events beat the initial read', async () => {
    const { context, open, releaseRead } = await fixture({
        value: true,
        holdRead: true,
    });
    try {
        const page = await open();
        await page.waitForFunction(() => window.preferenceTest.reads === 1);
        assert.equal(await page.getByRole('tab').count(), 0);
        assert.equal(await page.getByRole('switch').count(), 0);
        await publish(context, false);
        releaseRead();
        await active(page, false);
    } finally {
        releaseRead();
        await context.close();
    }
});

test('storage failures are honest and preserve the committed On/Off choice', async () => {
    const { context, open, failWrites } = await fixture({ failRead: true });
    try {
        const page = await open();
        await active(page, false);
        await page
            .getByRole('alert')
            .filter({ hasText: 'Could not load' })
            .waitFor();
        failWrites();
        await page.getByRole('switch', { name: 'Animations' }).click();
        await page
            .getByRole('alert')
            .filter({ hasText: 'Could not save' })
            .waitFor();
        await active(page, false);
    } finally {
        await context.close();
    }
});

test('Chats is the default tab and Settings uses the persistent keyboard-accessible sidebar', async () => {
    const { context, open } = await fixture({ value: false });
    try {
        const page = await open('#/');
        const chats = page.getByRole('tab', { name: 'Chats' });
        const settings = page.getByRole('tab', {
            name: 'Settings',
            exact: true,
        });
        const settingsNode = await settings.elementHandle();
        await page
            .getByRole('tab', { name: 'Chats', selected: true })
            .waitFor();
        await page
            .getByRole('tabpanel', { name: 'Chats', exact: true })
            .waitFor();

        await chats.focus();
        await chats.press('ArrowDown');
        await page
            .getByRole('tab', { name: 'Settings', selected: true })
            .waitFor();
        await page
            .getByRole('tabpanel', { name: 'Settings', exact: true })
            .waitFor();
        await active(page, false);
        assert.equal(
            await page.getByRole('region', { name: 'Primary inbox' }).count(),
            0,
        );
        assert.equal(
            await settingsNode!.evaluate(
                (element) => element === document.activeElement,
            ),
            true,
        );

        await settings.press('Tab');
        assert.equal(
            await page
                .getByRole('tabpanel', { name: 'Settings', exact: true })
                .evaluate((element) => element === document.activeElement),
            true,
        );
        await settings.focus();
        await settings.press('Home');
        await page
            .getByRole('tabpanel', { name: 'Chats', exact: true })
            .waitFor();
        assert.equal(await page.getByRole('switch').count(), 0);
        assert.equal(
            await chats.evaluate(
                (element) => element === document.activeElement,
            ),
            true,
        );
        await chats.press('End');
        await active(page, false);

        await page.goBack();
        await page
            .getByRole('tab', { name: 'Chats', selected: true })
            .waitFor();
        await page.goForward();
        await page
            .getByRole('tab', { name: 'Settings', selected: true })
            .waitFor();
        assert.equal(
            await settingsNode!.evaluate(
                (element) =>
                    element === document.querySelector('#settings-tab'),
            ),
            true,
        );
    } finally {
        await context.close();
    }
});

test('direct Settings route returns to Chats through the sidebar without delayed cleanup', async () => {
    const { context, open } = await fixture({ value: false });
    try {
        const page = await open();
        await page
            .getByRole('tab', { name: 'Settings', selected: true })
            .waitFor();
        await active(page, false);
        await page.getByRole('tab', { name: 'Chats' }).click();
        await page
            .getByRole('heading', { name: 'Messages', exact: true })
            .waitFor();
        assert.equal(await page.getByRole('switch').count(), 0);
        await page.goBack();
        await active(page, false);
        assert.equal(
            await page.getByRole('region', { name: 'Primary inbox' }).count(),
            0,
        );
    } finally {
        await context.close();
    }
});
