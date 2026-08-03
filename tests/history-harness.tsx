import { createElement } from '../vendor/teact/src/teact/teact';
import TeactDOM from '../vendor/teact/src/teact/teact-dom';
import type { Message, Result, ThreadMessages } from '../lib/domain';
import App from '../entrypoints/ui/App';
import type { CompleteUiRpc } from '../entrypoints/ui/rpc';
import { createFrontendStore } from '../entrypoints/ui/store';
import '../entrypoints/ui/styles.scss';

type Scenario = 'continuous' | 'delayed' | 'resize' | 'selection' | 'image' | 'mutations' |
    'older-send' | 'thread-state';

let activeStore: ReturnType<typeof createFrontendStore> | undefined;
let resolveVisible: ((result: Result<ThreadMessages>) => void) | undefined;
let calls: Array<string | undefined> = [];
let resolveSend: (() => void) | undefined;
let failedOnce = false;
let sentCount = 0;

const thread = {
    key: 'thread',
    threadFbid: 'thread-fbid',
    title: 'History harness',
    isGroup: false,
    isMuted: false,
    folder: 'PRIMARY' as const,
    lastActivityMs: 0,
    serverIsPin: false,
    users: [],
};

const secondThread = {
    ...thread,
    key: 'second-thread',
    title: 'Second history',
};

const imageMessage: Message = {
    kind: 'image',
    id: 'image-message',
    senderId: 'sender',
    ts: 1_000,
    images: [{
        url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        width: 430,
        height: 960,
    }],
};

function messages(start: number, end: number, variable = false): Message[] {
    return Array.from({ length: end - start }, (_, index) => {
        const number = start + index;
        return {
            kind: 'text',
            id: `m${number}`,
            senderId: 'sender',
            ts: number * 1_000,
            text: variable ? `message ${number} ${'variable '.repeat(number % 7)}` : `message ${number}`,
        };
    });
}

function page(start: number, end: number, cursor?: string, hasNextPage = false, variable = false) {
    return {
        ok: true as const,
        value: { items: messages(start, end, variable), cursor, hasNextPage, viewerId: 'viewer' },
    };
}

async function mount(scenario: Scenario) {
    if (activeStore) {
        TeactDOM.render(undefined, document.querySelector('#app')!);
        activeStore = undefined;
    }
    calls = [];
    resolveVisible = undefined;
    resolveSend = undefined;
    failedOnce = false;
    sentCount = 0;
    document.querySelector('#history-harness-style')?.remove();
    if (scenario === 'continuous') {
        const style = document.createElement('style');
        style.id = 'history-harness-style';
        style.textContent = `
            .messages { height: 80px; padding: 4px; flex: none; }
            .messages__content, .messages__rows { gap: 0; }
            .message { height: 6px; min-height: 6px; animation: none; }
            .message__bubble { padding: 0 2px; font-size: 6px; }
            .message-date { display: none; }
        `;
        document.head.append(style);
    }
    const initial = scenario === 'continuous'
        ? page(40, 60, 'c1', true)
        : scenario === 'delayed' || scenario === 'selection'
            ? page(40, 80, 'c1', true, true)
            : scenario === 'image'
                ? { ok: true as const, value: { items: [imageMessage], hasNextPage: false, viewerId: 'viewer' } }
                : scenario === 'older-send' || scenario === 'thread-state'
                    ? page(0, 120, undefined, false, true)
                    : page(0, 40, undefined, false, true);
    const rpc: CompleteUiRpc = {
        getInbox: async () => ({
            ok: true,
            value: {
                items: scenario === 'selection' || scenario === 'thread-state'
                    ? [thread, secondThread]
                    : scenario === 'image'
                        ? [{ ...thread, lastMessage: imageMessage }]
                        : [thread],
                hasNextPage: false,
            },
        }),
        getPins: async () => ({ pinned: [] }),
        togglePin: async () => ({ pinned: [] }),
        sendText: payload => {
            if (scenario !== 'mutations' && scenario !== 'older-send' && scenario !== 'thread-state') {
                return Promise.resolve({ ok: false, error: { message: 'not used' } });
            }
            if (payload.text === 'deferred') {
                return new Promise(resolve => {
                    resolveSend = () => resolve({
                        ok: true,
                        value: {
                            messageId: 'server-deferred',
                            timestampMs: Date.now(),
                            clientRequestId: payload.offlineThreadingId,
                        },
                    });
                });
            }
            if (payload.text === 'fail once' && !failedOnce) {
                failedOnce = true;
                return new Promise(resolve => window.setTimeout(() => resolve({
                    ok: false,
                    error: { message: 'Harness send failure' },
                }), 50));
            }
            sentCount++;
            return Promise.resolve({
                ok: true,
                value: {
                    messageId: `server-${sentCount}`,
                    timestampMs: Date.now(),
                    clientRequestId: payload.offlineThreadingId,
                },
            });
        },
        setReaction: async payload => ({
            ok: true,
            value: {
                messageId: payload.messageId,
                reactions: [{ senderId: 'viewer', reaction: payload.emoji, timestampMs: Date.now() }],
            },
        }),
        getReelMedia: async () => ({ ok: false, error: { message: 'not used' } }),
        getThread: payload => {
            calls.push(payload.cursor);
            if (payload.threadKey === secondThread.key) {
                return Promise.resolve(scenario === 'thread-state'
                    ? page(0, 120, undefined, false, true)
                    : page(0, 40));
            }
            if (!payload.cursor) return Promise.resolve(initial);
            if (payload.cursor === 'c1' && (scenario === 'delayed' || scenario === 'selection')) {
                return new Promise(resolve => { resolveVisible = resolve; });
            }
            if (payload.cursor === 'c1') return Promise.resolve(page(20, 40, 'c2', true));
            return Promise.resolve(page(0, 20));
        },
    };
    activeStore = createFrontendStore(rpc);
    TeactDOM.render(createElement(App, { store: activeStore }) as never, document.querySelector('#app')!);
    await waitFor(() => activeStore?.state.inbox.status === 'ready');
    activeStore.selectThread('thread');
    await waitFor(() => activeStore?.state.histories.thread?.status === 'ready');
}

async function waitFor(predicate: () => boolean) {
    const deadline = performance.now() + 5_000;
    while (!predicate()) {
        if (performance.now() > deadline) throw new Error('Harness timed out');
        await new Promise(resolve => setTimeout(resolve, 16));
    }
}

window.historyHarness = {
    mount,
    calls: () => calls,
    resolveVisible: () => {
        if (!resolveVisible) throw new Error('No delayed visible request');
        resolveVisible(page(20, 40, 'c2', true, true));
        resolveVisible = undefined;
    },
    resolveSend: () => {
        if (!resolveSend) throw new Error('No delayed send');
        resolveSend();
        resolveSend = undefined;
    },
    select: (threadId: string) => activeStore?.selectThread(threadId),
    revealOlder: (threadId: string) => activeStore?.revealOlderHistory(threadId),
    showInbox: () => activeStore?.showInbox(),
    historyState: (threadId: string) => {
        const history = activeStore?.state.histories[threadId];
        return {
            selected: activeStore?.state.selectedThreadId,
            viewportIds: history?.viewportIds,
            listedIds: history?.listedIds,
            isReplacingViewport: history?.isReplacingViewport,
            scrollAnchor: history?.scrollAnchor,
            draft: history?.draft,
            replyTargetId: history?.replyTargetId,
        };
    },
};

declare global {
    interface Window {
        historyHarness: {
            mount: (scenario: Scenario) => Promise<void>;
            calls: () => Array<string | undefined>;
            resolveVisible: () => void;
            resolveSend: () => void;
            select: (threadId: string) => void;
            revealOlder: (threadId: string) => void;
            showInbox: () => void;
            historyState: (threadId: string) => {
                selected?: string;
                viewportIds?: string[];
                listedIds?: string[];
                isReplacingViewport?: boolean;
                scrollAnchor?: { id: string; offset: number };
                draft?: string;
                replyTargetId?: string;
            };
        };
    }
}
