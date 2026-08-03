import '../lib/bridge';
import { defineBackground } from 'wxt/utils/define-background';
import browser from 'webextension-polyfill';
import type { RpcMap } from '../lib/domain';

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

type RemoteRpcName = Exclude<keyof RpcMap, 'getPins' | 'togglePin'>;
type RpcPayload<K extends keyof RpcMap> = Parameters<RpcMap[K]>[0];
type RpcResult<K extends keyof RpcMap> = Awaited<ReturnType<RpcMap[K]>>;

const REMOTE_RPC_NAMES = [
    'getInbox',
    'getThread',
    'getReelMedia',
    'getMessageRequests',
    'getThreadInfo',
    'getMessageActions',
    'getUnreadCount',
    'sendText',
    'setReaction',
    'markThreadRead',
    'pinMessage',
    'sendCutoutSticker',
    'executeInstagramGraphql',
] as const satisfies readonly RemoteRpcName[];

async function routeToAnchor<K extends RemoteRpcName>(
    name: K,
    payload: RpcPayload<K>,
): Promise<RpcResult<K>> {
    // Keep webext-bridge out of top-level imports: WXT evaluates this module
    // during build with a fake browser that does not implement runtime.onConnect.
    const { sendMessage } = await import('webext-bridge/background');
    const tabId = await ensureAnchorTab();
    return (await sendMessage<RpcResult<K>, K>(
        name,
        payload as never,
        `content-script@${tabId}`,
    )) as RpcResult<K>;
}

export default defineBackground(() => {
    browser.action.onClicked.addListener(async () => {
        await ensureAnchorTab();
        await browser.tabs.create({ url: browser.runtime.getURL('/ui.html') });
    });

    // Keep webext-bridge out of top-level imports: WXT evaluates this module
    // during build with a fake browser that does not implement runtime.onConnect.
    import('webext-bridge/background').then(({ onMessage }) => {
        for (const name of REMOTE_RPC_NAMES)
            onMessage(name, ({ data }) => routeToAnchor(name, data as never));
        onMessage<null, 'getPins'>('getPins', async () => ({
            pinned: await getPinned(),
        }));
        onMessage<{ threadKey: string }, 'togglePin'>(
            'togglePin',
            async ({ data }) => {
                const pinned = await getPinned();
                const next = pinned.includes(data.threadKey)
                    ? pinned.filter(key => key !== data.threadKey)
                    : [data.threadKey, ...pinned];
                await browser.storage.local.set({ pinned: next });
                return { pinned: next };
            },
        );
    });
});
