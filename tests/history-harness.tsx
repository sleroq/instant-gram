import { createElement } from '../vendor/teact/src/teact/teact';
import TeactDOM from '../vendor/teact/src/teact/teact-dom';
import type { Message, Result, ThreadMessages } from '../lib/domain';
import App from '../entrypoints/ui/App';
import type { UiRpc } from '../entrypoints/ui/rpc';
import { createFrontendStore } from '../entrypoints/ui/store';
import '../entrypoints/ui/styles.scss';

type Scenario = 'continuous' | 'delayed' | 'resize' | 'selection';

let activeStore: ReturnType<typeof createFrontendStore> | undefined;
let resolveVisible: ((result: Result<ThreadMessages>) => void) | undefined;
let calls: Array<string | undefined> = [];

const thread = {
    key: 'thread',
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
            : page(0, 40, undefined, false, true);
    const rpc: UiRpc = {
        getInbox: async () => ({
            ok: true,
            value: {
                items: scenario === 'selection' ? [thread, secondThread] : [thread],
                hasNextPage: false,
            },
        }),
        getPins: async () => ({ pinned: [] }),
        togglePin: async () => ({ pinned: [] }),
        getReelMedia: async () => ({ ok: false, error: { message: 'not used' } }),
        getThread: payload => {
            calls.push(payload.cursor);
            if (payload.threadKey === secondThread.key) {
                return Promise.resolve(page(0, 40));
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
    select: (threadId: string) => activeStore?.selectThread(threadId),
    showInbox: () => activeStore?.showInbox(),
    historyState: (threadId: string) => {
        const history = activeStore?.state.histories[threadId];
        return {
            selected: activeStore?.state.selectedThreadId,
            viewportIds: history?.viewportIds,
            isReplacingViewport: history?.isReplacingViewport,
            scrollAnchor: history?.scrollAnchor,
        };
    },
};

declare global {
    interface Window {
        historyHarness: {
            mount: (scenario: Scenario) => Promise<void>;
            calls: () => Array<string | undefined>;
            resolveVisible: () => void;
            select: (threadId: string) => void;
            showInbox: () => void;
            historyState: (threadId: string) => {
                selected?: string;
                viewportIds?: string[];
                isReplacingViewport?: boolean;
                scrollAnchor?: { id: string; offset: number };
            };
        };
    }
}
