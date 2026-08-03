import { createElement } from '../vendor/teact/src/teact/teact';
import TeactDOM from '../vendor/teact/src/teact/teact-dom';
import type { Message, Result, ThreadMessages } from '../lib/domain';
import App from '../entrypoints/ui/App';
import type { CompleteUiRpc } from '../entrypoints/ui/rpc';
import { createFrontendStore } from '../entrypoints/ui/store';
import '../entrypoints/ui/styles.scss';

type Scenario = 'continuous' | 'delayed' | 'resize' | 'selection' | 'image' | 'mutations' |
    'older-send' | 'thread-state' | 'identity-pm' | 'identity-group';

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

const identityUsers = [
    { id: 'bob', username: 'bob', fullName: 'Bob', picUrl: null },
    { id: 'ai', username: 'metaai', fullName: 'Meta AI', picUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
    { id: 'peer', username: 'alice', fullName: 'Alice', picUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' },
];

function identityMessages(scenario: 'identity-pm' | 'identity-group'): Message[] {
    if (scenario === 'identity-pm') {
        return [
            { kind: 'text', id: 'peer-1', senderId: 'peer', ts: 1_000, text: 'ordinary peer' },
            { kind: 'text', id: 'peer-2', senderId: 'peer', ts: 2_000, text: 'still ordinary' },
            { kind: 'text', id: 'ai-1', senderId: 'ai', ts: 3_000, text: 'AI answer one' },
            { kind: 'text', id: 'ai-2', senderId: 'ai', ts: 4_000, text: 'AI answer two' },
            { kind: 'text', id: 'unknown-1', senderId: 'unknown', ts: 4_500, text: 'unknown sender' },
            { kind: 'text', id: 'viewer-1', senderId: 'viewer', ts: 5_000, text: 'thanks' },
        ];
    }
    return [
        ...Array.from({ length: 16 }, (_, index): Message => ({
            kind: 'text',
            id: `alice-${index}`,
            senderId: 'peer',
            ts: (index + 1) * 1_000,
            text: `Alice message ${index} ${'long group content '.repeat(3)}`,
        })),
        { kind: 'text', id: 'viewer-group', senderId: 'viewer', ts: 17_000, text: 'current user' },
        { kind: 'text', id: 'bob-group', senderId: 'bob', ts: 18_000, text: 'Bob message' },
    ];
}

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
    const selectedThreadId = scenario === 'identity-pm' ? 'peer' : thread.key;
    const initial = scenario === 'continuous'
        ? page(40, 60, 'c1', true)
        : scenario === 'delayed' || scenario === 'selection'
            ? page(40, 80, 'c1', true, true)
            : scenario === 'image'
                ? { ok: true as const, value: { items: [imageMessage], hasNextPage: false, viewerId: 'viewer' } }
                : scenario === 'identity-pm' || scenario === 'identity-group'
                    ? { ok: true as const, value: {
                        items: identityMessages(scenario), hasNextPage: false, viewerId: 'viewer',
                    } }
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
                        : scenario === 'identity-pm' || scenario === 'identity-group'
                            ? [{
                                ...thread,
                                key: selectedThreadId,
                                title: scenario === 'identity-group' ? 'Identity group' : 'Custom support chat',
                                isGroup: scenario === 'identity-group',
                                users: identityUsers,
                            }]
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
    activeStore.selectThread(selectedThreadId);
    await waitFor(() => activeStore?.state.histories[selectedThreadId]?.status === 'ready');
    await waitFor(() => Boolean(document.querySelector('[data-message-id]')));
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
