import '../lib/bridge';
import { defineBackground } from 'wxt/utils/define-background';
import { onMessage, sendMessage } from 'webext-bridge/background';
import browser from 'webextension-polyfill';

type JsonPayload =
    | null
    | boolean
    | number
    | string
    | JsonPayload[]
    | { [key: string]: JsonPayload };

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

async function routeToAnchor<T>(
    name: 'getInbox' | 'getThread' | 'getReelMedia' | 'debugAuth',
    payload: unknown,
): Promise<T> {
    const tabId = await ensureAnchorTab();
    return sendMessage(
        name,
        payload as JsonPayload,
        `content-script@${tabId}`,
    ) as Promise<T>;
}

function pinPayload(data: unknown): { threadKey: string } {
    if (
        typeof data === 'object' &&
        data !== null &&
        'threadKey' in data &&
        typeof data.threadKey === 'string'
    )
        return { threadKey: data.threadKey };
    throw new Error('Invalid pin payload');
}

export default defineBackground(() => {
    browser.action.onClicked.addListener(async () => {
        await ensureAnchorTab();
        await browser.tabs.create({ url: browser.runtime.getURL('/ui.html') });
    });

    onMessage('getInbox', ({ data }) => routeToAnchor('getInbox', data));
    onMessage('getThread', ({ data }) => routeToAnchor('getThread', data));
    onMessage('getReelMedia', ({ data }) =>
        routeToAnchor('getReelMedia', data),
    );
    onMessage('debugAuth', ({ data }) => routeToAnchor('debugAuth', data));

    onMessage('getPins', async () => ({ pinned: await getPinned() }));
    onMessage('togglePin', async ({ data }) => {
        const payload = pinPayload(data);
        const pinned = await getPinned();
        const next = pinned.includes(payload.threadKey)
            ? pinned.filter(key => key !== payload.threadKey)
            : [payload.threadKey, ...pinned];
        await browser.storage.local.set({ pinned: next });
        return { pinned: next };
    });
});
