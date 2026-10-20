import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
    AUTH_PROBE_EVENT,
    AUTH_PROBE_REQUEST_EVENT,
    currentInstagramAccountId,
    harvestTokens,
    startMainWorldAuthProbe,
} from '../lib/ig-auth.ts';

function authFixture(t: TestContext) {
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    const target = Object.assign(new EventTarget(), {
        setTimeout(callback: () => void) {
            timers.set(++nextTimer, callback);
            return nextTimer;
        },
        clearTimeout(id: number) {
            timers.delete(id);
        },
    });

    const document = {
        cookie: 'csrftoken=csrf-valid; ds_user_id=12345',
        get documentElement(): never {
            throw new Error('Authentication must not inspect page HTML');
        },
        get scripts(): never {
            throw new Error('Authentication must not inspect page scripts');
        },
        querySelectorAll(): never {
            throw new Error('Authentication must not query page contents');
        },
    };
    const storage = new Map<string, string>();
    const replacements = {
        window: target,
        document,
        localStorage: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
        },
    };

    for (const [key, value] of Object.entries(replacements)) {
        const original = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, {
            configurable: true,
            value,
        });
        t.after(() => {
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
    }

    function emit(detail: string) {
        target.dispatchEvent(new CustomEvent(AUTH_PROBE_EVENT, { detail }));
    }
    return { target, timers, document, storage, emit };
}

function validProbe() {
    return {
        fbDtsg: 'abc',
        lsd: 'lsd-valid',
        deviceId: 'device-valid',
        viewerId: '67890',
        at: Date.now(),
    };
}

const expectedTokens = {
    fbDtsg: 'abc',
    lsd: 'lsd-valid',
    jazoest: '2294',
    csrfToken: 'csrf-valid',
    deviceId: 'device-valid',
    viewerId: '67890',
};

test('auth uses probe tokens and cookies without inspecting page contents', async (t) => {
    const fixture = authFixture(t);
    let requests = 0;
    fixture.target.addEventListener(AUTH_PROBE_REQUEST_EVENT, () => {
        requests++;
        fixture.emit(JSON.stringify(validProbe()));
    });
    assert.deepEqual(await harvestTokens(true), expectedTokens);
    assert.equal(currentInstagramAccountId(), '12345');
    assert.equal(fixture.timers.size, 0);
    assert.deepEqual(await harvestTokens(), expectedTokens);
    assert.equal(requests, 1);
    await harvestTokens(true);
    assert.equal(requests, 2);
});

test('auth ignores malformed, stale, and future probe events while awaiting its response', async (t) => {
    const fixture = authFixture(t);
    fixture.target.addEventListener(AUTH_PROBE_REQUEST_EVENT, () => {
        const valid = validProbe();
        for (const detail of [
            '{',
            JSON.stringify({ ...valid, at: 'invalid' }),
            JSON.stringify({ ...valid, fbDtsg: 1 }),
            JSON.stringify({ ...valid, fbDtsg: 'stale', at: valid.at - 60_001 }),
            JSON.stringify({ ...valid, fbDtsg: 'future', at: valid.at + 60_000 }),
        ]) {
            assert.doesNotThrow(() => fixture.emit(detail));
        }
        fixture.emit(JSON.stringify(valid));
    });
    assert.deepEqual(await harvestTokens(true), expectedTokens);
    assert.equal(fixture.timers.size, 0);
});

test('concurrent token harvests share a probe request', async (t) => {
    const fixture = authFixture(t);
    let requests = 0;
    fixture.target.addEventListener(AUTH_PROBE_REQUEST_EVENT, () => requests++);
    const first = harvestTokens(true);
    const second = harvestTokens(true);
    assert.equal(requests, 1);
    fixture.emit(JSON.stringify(validProbe()));
    assert.deepEqual(await first, expectedTokens);
    assert.deepEqual(await second, expectedTokens);
});

test('missing probe fields or CSRF cookie fail rather than falling back to scraped or account identity', async (t) => {
    const fixture = authFixture(t);
    let response = validProbe();
    fixture.target.addEventListener(AUTH_PROBE_REQUEST_EVENT, () => {
        fixture.emit(JSON.stringify(response));
    });
    for (const key of ['fbDtsg', 'lsd', 'deviceId', 'viewerId'] as const) {
        response = validProbe();
        Reflect.deleteProperty(response, key);
        await assert.rejects(harvestTokens(true), /auth tokens were not found/);
    }
    response = validProbe();
    fixture.document.cookie = 'ds_user_id=12345';
    await assert.rejects(harvestTokens(true), /auth tokens were not found/);
    assert.equal(fixture.timers.size, 0);
});

test('probe timeout clears pending work and allows a fresh retry', async (t) => {
    const fixture = authFixture(t);
    const pending = harvestTokens(true);
    assert.equal(fixture.timers.size, 1);
    for (const timeout of fixture.timers.values()) timeout();
    await assert.rejects(pending, /probe is unavailable/);
    assert.equal(fixture.timers.size, 0);
    fixture.target.addEventListener(AUTH_PROBE_REQUEST_EVENT, () => {
        fixture.emit(JSON.stringify(validProbe()));
    });
    assert.deepEqual(await harvestTokens(true), expectedTokens);
});

test('MAIN-world probe responds on demand, uses page modules, and reuses its device ID', async (t) => {
    const fixture = authFixture(t);
    Object.defineProperty(fixture.target, 'require', {
        value(name: string) {
            switch (name) {
                case 'DTSGInitialData':
                    return { token: 'abc' };
                case 'LSD':
                    return { token: 'lsd-valid' };
                case 'CurrentUserInitialData':
                    return { viewer_fbid: '67890' };
            }
        },
    });
    let replies = 0;
    fixture.target.addEventListener(AUTH_PROBE_EVENT, (event) => {
        assert(event instanceof CustomEvent);
        const payload = JSON.parse(event.detail);
        assert.deepEqual(Object.keys(payload).sort(), [
            'at',
            'deviceId',
            'fbDtsg',
            'lsd',
            'viewerId',
        ]);
        replies++;
    });
    startMainWorldAuthProbe();
    startMainWorldAuthProbe();
    assert.equal(replies, 0);
    assert.equal(fixture.timers.size, 0);
    const first = await harvestTokens(true);
    assert.deepEqual(first, {
        ...expectedTokens,
        deviceId: fixture.storage.get('chatd-deviceid'),
    });
    assert.deepEqual(await harvestTokens(true), first);
    assert.equal(replies, 2);
});
