import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AUTH_PROBE_EVENT,
    harvestTokens,
    startAuthProbeListener,
} from '../lib/ig-auth.ts';

test('auth listener ignores invalid probe events without replacing valid tokens', async () => {
    const originalWindow = Object.getOwnPropertyDescriptor(
        globalThis,
        'window',
    );
    const originalDocument = Object.getOwnPropertyDescriptor(
        globalThis,
        'document',
    );
    const target = new EventTarget();
    const fakeWindow = Object.assign(target, {
        setTimeout(callback: () => void) {
            queueMicrotask(callback);
            return 1;
        },
        clearTimeout() {},
    });
    const fakeDocument = {
        querySelectorAll() {
            return [];
        },
        documentElement: { innerHTML: '' },
        scripts: [],
        cookie: 'csrftoken=csrf-valid',
    };

    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: fakeWindow,
    });
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: fakeDocument,
    });

    try {
        startAuthProbeListener();
        const now = Date.now();
        const valid = {
            fbDtsg: 'dtsg-valid',
            lsd: 'lsd-valid',
            jazoest: 'jazoest-valid',
            deviceId: 'device-valid',
            viewerId: '12345',
            at: now,
            requireAvailable: true,
            sources: {
                fbDtsg: 'test',
                lsd: 'test',
                jazoest: 'test',
                deviceId: 'test',
                viewerId: 'test',
            },
        };
        fakeWindow.dispatchEvent(
            new CustomEvent(AUTH_PROBE_EVENT, {
                detail: JSON.stringify(valid),
            }),
        );

        for (const detail of [
            '{',
            JSON.stringify({ ...valid, at: 'invalid' }),
            JSON.stringify({ ...valid, fbDtsg: 'stale', at: now - 60_001 }),
            JSON.stringify({ ...valid, fbDtsg: 'future', at: now + 60_000 }),
        ]) {
            assert.doesNotThrow(() => {
                fakeWindow.dispatchEvent(
                    new CustomEvent(AUTH_PROBE_EVENT, { detail }),
                );
            });
        }

        assert.deepEqual(await harvestTokens(true), {
            fbDtsg: 'dtsg-valid',
            lsd: 'lsd-valid',
            jazoest: 'jazoest-valid',
            csrfToken: 'csrf-valid',
            deviceId: 'device-valid',
            viewerId: '12345',
        });
    } finally {
        if (originalWindow)
            Object.defineProperty(globalThis, 'window', originalWindow);
        else Reflect.deleteProperty(globalThis, 'window');
        if (originalDocument)
            Object.defineProperty(globalThis, 'document', originalDocument);
        else Reflect.deleteProperty(globalThis, 'document');
    }
});
