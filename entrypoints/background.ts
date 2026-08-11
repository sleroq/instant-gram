import '../lib/bridge';
import { defineBackground } from 'wxt/utils/define-background';
import browser from 'webextension-polyfill';
import type { ReelAuthor, ReelMedia, Result, RpcMap } from '../lib/domain';
import { createSerialTaskQueue } from '../lib/errors';
import { loadTrustedProfileImageDataUrl } from '../lib/media-proxy';

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

type RemoteRpcName = Exclude<keyof RpcMap, 'getPins'>;
type DirectRemoteRpcName = Exclude<RemoteRpcName, 'togglePin'>;
type RpcPayload<K extends keyof RpcMap> = Parameters<RpcMap[K]>[0];
type RpcResult<K extends keyof RpcMap> = Awaited<ReturnType<RpcMap[K]>>;

async function proxyOptionalProfileImage(author: ReelAuthor): Promise<ReelAuthor> {
    if (!author.picUrl) return author;
    let picUrl: string | null = null;
    try {
        picUrl = await loadTrustedProfileImageDataUrl(author.picUrl);
    } catch {
        // Optional profile media must not discard otherwise valid API data.
    }
    return { ...author, picUrl };
}

const REMOTE_RPC_NAMES = [
    'getInbox',
    'getThread',
    'getReelMedia',
    'getReelComments',
    'getReelCommentReplies',
    'createReelComment',
    'setReelCommentLiked',
    'setReelLiked',
    'setReelSaved',
    'sendText',
    'editText',
    'forwardMessage',
    'setReaction',
    'markThreadRead',
] as const satisfies readonly DirectRemoteRpcName[];
const enqueuePinMutation = createSerialTaskQueue();

async function routeToAnchor<K extends RemoteRpcName>(
    name: K,
    payload: RpcPayload<K>,
): Promise<RpcResult<K>> {
    // Keep webext-bridge out of top-level imports: WXT evaluates this module
    // during build with a fake browser that does not implement runtime.onConnect.
    const { sendMessage } = await import('webext-bridge/background');
    const tabId = await ensureAnchorTab();
    const result = (await sendMessage<RpcResult<K>, K>(
        name,
        payload as never,
        `content-script@${tabId}`,
    )) as RpcResult<K>;
    if (name === 'getReelMedia') {
        const mediaResult = result as Result<ReelMedia>;
        if (!mediaResult.ok) return result;
        const [author, followedLikers] = await Promise.all([
            proxyOptionalProfileImage(mediaResult.value.author),
            Promise.all((mediaResult.value.followedLikers ?? []).map(proxyOptionalProfileImage)),
        ]);
        return {
            ok: true,
            value: {
                ...mediaResult.value,
                author,
                ...(followedLikers.length ? { followedLikers } : {}),
            },
        } as RpcResult<K>;
    }
    return result;
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
        onMessage<Parameters<RpcMap['togglePin']>[0], 'togglePin'>(
            'togglePin',
            ({ data }) => {
                const run = enqueuePinMutation(async (): Promise<Awaited<ReturnType<RpcMap['togglePin']>>> => {
                    const result = await routeToAnchor('togglePin', data);
                    if (!result.ok) return result;
                    const pinned = [...new Set(await getPinned())];
                    const next = data.pin
                        ? [data.threadKey, ...pinned.filter(key => key !== data.threadKey)]
                        : pinned.filter(key => key !== data.threadKey);
                    await browser.storage.local.set({ pinned: next });
                    return { ok: true, value: { pinned: next, receipt: result.value.receipt } };
                }).catch((error): Result<never> => ({
                    ok: false,
                    error: { message: error instanceof Error ? error.message : 'Could not update conversation pin' },
                }));
                return run;
            },
        );
    });
});
