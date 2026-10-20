import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { openDevUi } from '../lib/dev-browser.ts';

const endpoint = 'http://127.0.0.1:9223';
const url = 'chrome-extension://dev-id/ui.html';

function browserFixture(
    t: TestContext,
    pages: Array<{ id: string; type: string; url: string }>,
    openStatus = 200,
) {
    const requests: Array<{ url: string; method: string }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const requestUrl = String(input);
        requests.push({ url: requestUrl, method: init?.method ?? 'GET' });
        if (requestUrl === `${endpoint}/json/list`) return Response.json(pages);
        return new Response(null, {
            status: requestUrl.includes('/json/new?') ? openStatus : 200,
        });
    };
    t.after(() => {
        globalThis.fetch = original;
    });
    return requests;
}

test('opens Messages before closing launcher placeholders, preserving other pages', async (t) => {
    const requests = browserFixture(t, [
        { id: 'blank', type: 'page', url: 'about:blank' },
        { id: 'new-tab', type: 'page', url: 'chrome://newtab/' },
        { id: 'instagram', type: 'page', url: 'https://www.instagram.com/' },
        { id: 'worker', type: 'service_worker', url: 'about:blank' },
    ]);
    await openDevUi(endpoint, url);
    assert.deepEqual(requests, [
        { url: `${endpoint}/json/list`, method: 'GET' },
        { url: `${endpoint}/json/new?${url}`, method: 'PUT' },
        { url: `${endpoint}/json/close/blank`, method: 'GET' },
        { url: `${endpoint}/json/close/new-tab`, method: 'GET' },
    ]);
});

test('keeps an existing Messages route without duplicating or refocusing it', async (t) => {
    const requests = browserFixture(t, [
        { id: 'messages', type: 'page', url: `${url}#/thread/123` },
    ]);
    await openDevUi(endpoint, url);
    assert.deepEqual(requests, [
        { url: `${endpoint}/json/list`, method: 'GET' },
    ]);
});

test('replaces a closed Messages tab on the next worker initialization', async (t) => {
    const pages = [{ id: 'messages', type: 'page', url }];
    const requests = browserFixture(t, pages);
    await openDevUi(endpoint, url);
    pages.length = 0;
    await openDevUi(endpoint, url);
    assert.deepEqual(requests, [
        { url: `${endpoint}/json/list`, method: 'GET' },
        { url: `${endpoint}/json/list`, method: 'GET' },
        { url: `${endpoint}/json/new?${url}`, method: 'PUT' },
    ]);
});

test('leaves the last blank tab open when opening Messages fails', async (t) => {
    const requests = browserFixture(
        t,
        [{ id: 'blank', type: 'page', url: 'about:blank' }],
        500,
    );
    await assert.rejects(openDevUi(endpoint, url), /Cannot open dev UI: 500/);
    assert.equal(requests.length, 2);
});
