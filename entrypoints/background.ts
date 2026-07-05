import '../lib/bridge';
import { defineBackground } from 'wxt/utils/define-background';
import { onMessage, sendMessage } from 'webext-bridge/background';
import browser from 'webextension-polyfill';
import type { Page, ReelMedia, Result, Thread, ThreadMessages } from '../lib/domain';

type PinStore = { pinned?: string[] };

async function getPinned(): Promise<string[]> {
    const stored = (await browser.storage.local.get('pinned')) as PinStore;
    return stored.pinned ?? [];
}

async function ensureAnchorTab(): Promise<number> {
    // This takes 2 ms at most, but maybe we should still cache this in the future
    // to prevent checking the tab on every network request
    const tabs = await browser.tabs.query({
        url: 'https://www.instagram.com/*',
    });

    const existing = tabs.find(tab => typeof tab.id === 'number');
    if (existing?.id) return existing.id;

    const created = await browser.tabs.create({
        url: 'https://www.instagram.com/direct/inbox/',
        active: false,
    });

    if (typeof created.id !== 'number')
        throw new Error('Could not create Instagram anchor tab');

    return created.id;
}

async function routeToAnchor(
    name: 'getInbox',
    payload: { cursor?: string },
): Promise<Result<Page<Thread>>>;
async function routeToAnchor(
    name: 'getThread',
    payload: { threadKey: string; cursor?: string },
): Promise<Result<ThreadMessages>>;
async function routeToAnchor(
    name: 'getReelMedia',
    payload: { shortcode: string; mediaId?: string },
): Promise<Result<ReelMedia>>;
async function routeToAnchor(
    name: 'getInbox' | 'getThread' | 'getReelMedia',
    payload:
        | { cursor?: string }
        | { threadKey: string; cursor?: string }
        | { shortcode: string; mediaId?: string },
) {
    const tabId = await ensureAnchorTab();
    if (name === 'getInbox')
        return sendMessage<Result<Page<Thread>>, 'getInbox'>(name, payload, `content-script@${tabId}`);
    if (name === 'getThread')
        return sendMessage<Result<ThreadMessages>, 'getThread'>(name, payload, `content-script@${tabId}`);
    return sendMessage<Result<ReelMedia>, 'getReelMedia'>(name, payload, `content-script@${tabId}`);
}

export default defineBackground(() => {
    browser.action.onClicked.addListener(async () => {
        await ensureAnchorTab();
        await browser.tabs.create({ url: browser.runtime.getURL('/ui.html') });
    });

    onMessage<{ cursor?: string }, 'getInbox'>('getInbox', ({ data }) => routeToAnchor('getInbox', data));
    onMessage<{ threadKey: string; cursor?: string }, 'getThread'>('getThread', ({ data }) => routeToAnchor('getThread', data));
    onMessage<{ shortcode: string; mediaId?: string }, 'getReelMedia'>('getReelMedia', ({ data }) =>
        routeToAnchor('getReelMedia', data),
    );
    onMessage<null, 'getPins'>('getPins', async () => ({ pinned: await getPinned() }));
    onMessage<{ threadKey: string }, 'togglePin'>('togglePin', async ({ data }) => {
        const pinned = await getPinned();
        const next = pinned.includes(data.threadKey)
            ? pinned.filter(key => key !== data.threadKey)
            : [data.threadKey, ...pinned];
        await browser.storage.local.set({ pinned: next });
        return { pinned: next };
    });
});
